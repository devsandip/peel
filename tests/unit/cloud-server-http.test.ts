import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import {
  mutationHash,
  cloudStatus,
  type CloudClientState,
} from "../../packages/cloud-protocol/src/index";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import {
  CloudMutationService,
  CloudServerError,
  type CloudMutationRequest,
  type CloudServerResult,
} from "../../packages/cloud-protocol/src/server";
import {
  createCloudMutationHandler,
  MAX_CLOUD_REQUEST_BYTES,
} from "../../packages/cloud-protocol/src/server-http";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  applyCloudServerReply,
  planCloudServerReply,
} from "../../packages/cloud-protocol/src/client-response";
import { cloudDraft, cloudScope } from "../fixtures/cloud-durable-contract";
import {
  CloudPullService,
  CloudCursorSigner,
  type CloudPullStart,
  type CloudPullPage,
} from "../../packages/cloud-protocol/src/pull";
import { DurableCloudPull } from "../../packages/cloud-protocol/src/pull-local";

const NOW = 1800000000000,
  owner = cloudScope.ownerSubject;
const serverAccount = {
  version: 1 as const,
  ownerSubject: owner,
  collectionId: cloudScope.collectionId,
  modeGeneration: 1,
  status: "active" as const,
  entitlement: "active" as const,
  revision: 1,
  sequence: 0,
  wall: 0,
};
const envelope = (state: CloudClientState): CloudMutationRequest => ({
  version: 1,
  collectionId: cloudScope.collectionId,
  modeGeneration: 1,
  mutation: structuredClone(state.inFlight!),
});
const authorize = async (request: Request) => {
  if (request.headers.get("authorization") !== "Bearer synthetic-fixture-only")
    throw new CloudServerError("unauthorized", 401);
  return owner;
};
const headers = {
  Authorization: "Bearer synthetic-fixture-only",
  "Content-Type": "application/json",
};

it("bounds the HTTP request, resolves authority before reading payloads, and hides internal errors", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-cloud-http-"));
  let fail = false;
  const store = new SQLiteCloudServerStore(
    join(folder, "server.sqlite3"),
    () => {
      if (fail) throw Error("Synthetic private diagnostic must stay internal");
    },
  );
  try {
    await store.seedAccount(serverAccount);
    const handler = createCloudMutationHandler(
      new CloudMutationService(store, () => NOW),
      authorize,
    );
    const url = "http://127.0.0.1/v1/mutations";
    expect(
      (await handler(new Request(url, { method: "POST", body: "not-json" })))
        .status,
    ).toBe(401);
    expect(
      (
        await handler(
          new Request(url, { method: "POST", headers, body: "not-json" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request(url, {
            method: "POST",
            headers: { Authorization: headers.Authorization },
            body: "{}",
          }),
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await handler(
          new Request(url, {
            method: "POST",
            headers,
            body: "x".repeat(MAX_CLOUD_REQUEST_BYTES + 1),
          }),
        )
      ).status,
    ).toBe(413);
    expect(
      (await handler(new Request(url, { method: "GET", headers }))).status,
    ).toBe(405);
    const mutation = {
      version: 1 as const,
      opId: "http-op",
      noteId: "synthetic-note",
      baseRevision: 0,
      kind: "upsert" as const,
      snapshot: cloudDraft("Synthetic HTTP source"),
    };
    const payload = {
      version: 1,
      collectionId: cloudScope.collectionId,
      modeGeneration: 1,
      mutation: { ...mutation, contentHash: await mutationHash(mutation) },
    };
    fail = true;
    const failed = await handler(
      new Request(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      }),
    );
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "service-unavailable" });
    fail = false;
    expect(
      (
        await handler(
          new Request(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          }),
        )
      ).status,
    ).toBe(200);
    await store.setPolicy(owner, "active", "inactive");
    expect(
      (
        await handler(
          new Request(url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
          }),
        )
      ).status,
    ).toBe(403);
  } finally {
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it("connects two durable local clients over loopback HTTP through repeated conflicts and lost acknowledgements", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-cloud-roundtrip-"));
  const serverStore = new SQLiteCloudServerStore(
    join(folder, "server.sqlite3"),
  );
  const localA = new SQLiteCloudStateStore(join(folder, "client-a.sqlite3"));
  let localB = new SQLiteCloudStateStore(join(folder, "client-b.sqlite3"));
  const clientScope: CloudScope = { ...cloudScope };
  let clientB = new DurableCloudClient(localB, clientScope);
  const clientA = new DurableCloudClient(localA, clientScope);
  const signingKey = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const handler = createCloudMutationHandler(
    new CloudMutationService(serverStore, () => NOW),
    authorize,
    new CloudPullService(
      serverStore,
      new CloudCursorSigner(signingKey, () => NOW),
      () => NOW,
    ),
  );
  let origin = "http://127.0.0.1";
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_CLOUD_REQUEST_BYTES) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const requestHeaders = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (value !== undefined)
          requestHeaders.set(
            key,
            Array.isArray(value) ? value.join(",") : value,
          );
      const response = await handler(
        new Request(new URL(req.url ?? "/", origin), {
          method: req.method,
          headers: requestHeaders,
          ...(req.method === "POST"
            ? { body: Buffer.concat(chunks).toString("utf8") }
            : {}),
        }),
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(503);
      res.end();
    }
  });
  try {
    await serverStore.seedAccount(serverAccount);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Synthetic HTTP port missing");
    origin = `http://127.0.0.1:${address.port}`;
    const send = async (
      request: CloudMutationRequest,
      expectedStatus: number,
    ) => {
      const response = await fetch(`${origin}/v1/mutations`, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
      });
      expect(response.status).toBe(expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return (await response.json()) as CloudServerResult;
    };
    const download = async (store: SQLiteCloudStateStore, fresh: boolean) => {
      const pull = new DurableCloudPull(store, clientScope),
        previous = await pull.progress();
      const startResponse = fresh
        ? await fetch(`${origin}/v1/sync/bootstrap`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              version: 1,
              collectionId: clientScope.collectionId,
              modeGeneration: 1,
            }),
          })
        : await fetch(
            `${origin}/v1/sync?after=${encodeURIComponent(previous!.checkpoint!)}`,
            { headers },
          );
      expect(startResponse.status).toBe(200);
      let progress = await pull.begin(
        (await startResponse.json()) as CloudPullStart,
        previous?.generation ?? null,
      );
      for (let count = 0; progress.next; count++) {
        if (count > 50) throw Error("Synthetic pull did not complete");
        const path = progress.next.kind === "heads" ? "/v1/notes" : "/v1/sync";
        const response = await fetch(
          `${origin}${path}?pageToken=${encodeURIComponent(progress.next.token)}&limit=1`,
          { headers },
        );
        expect(response.status).toBe(200);
        progress = (await pull.apply((await response.json()) as CloudPullPage))
          .progress;
      }
      expect(progress.checkpoint).toBeTruthy();
      return progress;
    };
    const saved = await clientA.save(
      "synthetic-note",
      { kind: "upsert", snapshot: cloudDraft("Shared starting source") },
      null,
    );
    const first = await clientA.prepare(
      "synthetic-note",
      saved.generation,
      "initial-http-op",
    );
    const firstRequest = envelope(first),
      firstResult = await send(firstRequest, 200);
    expect(() =>
      planCloudServerReply(
        {
          ...firstResult,
          receipt: {
            ...firstResult.receipt,
            contentHash: "0".repeat(64),
          },
        },
        firstRequest,
      ),
    ).toThrow("identity");
    expect(
      (await applyCloudServerReply(clientA, firstRequest, firstResult)).kind,
    ).toBe("acknowledge");
    if (firstResult.head.kind !== "note")
      throw Error("Initial server snapshot missing");
    await download(localB, true);
    const bootstrap = (await clientB.get("synthetic-note"))!;
    const currentA = (await clientA.get("synthetic-note"))!;
    const editA = await clientA.save(
      "synthetic-note",
      { kind: "upsert", snapshot: cloudDraft("Offline A") },
      currentA.generation,
    );
    const editB = await clientB.save(
      "synthetic-note",
      { kind: "upsert", snapshot: cloudDraft("Offline B") },
      bootstrap.generation,
    );
    const opA = envelope(
      await clientA.prepare("synthetic-note", editA.generation, "offline-a"),
    );
    const opB = envelope(
      await clientB.prepare("synthetic-note", editB.generation, "offline-b"),
    );
    await applyCloudServerReply(clientA, opA, await send(opA, 200));
    await applyCloudServerReply(clientB, opB, await send(opB, 409));
    const conflictB = (await clientB.get("synthetic-note"))!;
    expect(conflictB.conflict?.local.snapshot?.bodyMarkdown).toBe("Offline B");
    expect(conflictB.conflict?.remote?.bodyMarkdown).toBe("Offline A");
    const mergedB = await clientB.resolve(
      "synthetic-note",
      conflictB.generation,
      { kind: "upsert", snapshot: cloudDraft("Chosen merge B") },
    );
    const mergedRequest = envelope(
      await clientB.prepare("synthetic-note", mergedB.generation, "merged-b"),
    );
    const atA = (await clientA.get("synthetic-note"))!;
    const laterA = await clientA.save(
      "synthetic-note",
      { kind: "upsert", snapshot: cloudDraft("Another A edit") },
      atA.generation,
    );
    const laterRequest = envelope(
      await clientA.prepare("synthetic-note", laterA.generation, "later-a"),
    );
    await applyCloudServerReply(
      clientA,
      laterRequest,
      await send(laterRequest, 200),
    );
    await applyCloudServerReply(
      clientB,
      mergedRequest,
      await send(mergedRequest, 409),
    );
    const secondConflict = (await clientB.get("synthetic-note"))!;
    expect(secondConflict.conflict?.local.snapshot?.bodyMarkdown).toBe(
      "Chosen merge B",
    );
    const chosen = await clientB.resolve(
      "synthetic-note",
      secondConflict.generation,
      { kind: "upsert", snapshot: cloudDraft("Final chosen merge") },
    );
    const finalRequest = envelope(
      await clientB.prepare("synthetic-note", chosen.generation, "final-merge"),
    );
    const lost = await send(finalRequest, 200); // Deliberately omit the local acknowledgement.
    await localB.close();
    localB = new SQLiteCloudStateStore(join(folder, "client-b.sqlite3"));
    clientB = new DurableCloudClient(localB, clientScope);
    expect(await clientB.retry("synthetic-note")).toEqual(
      finalRequest.mutation,
    );
    const replay = await send(finalRequest, 200);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(lost.receipt);
    await applyCloudServerReply(clientB, finalRequest, replay);
    expect(cloudStatus((await clientB.get("synthetic-note"))!)).toBe("synced");
    const bNow = (await clientB.get("synthetic-note"))!;
    const pending = await clientB.save(
      "synthetic-note",
      { kind: "upsert", snapshot: cloudDraft("Unacknowledged B edit") },
      bNow.generation,
    );
    const pendingRequest = envelope(
      await clientB.prepare(
        "synthetic-note",
        pending.generation,
        "late-replay-b",
      ),
    );
    const oldAck = await send(pendingRequest, 200);
    const external = {
      ...pendingRequest.mutation,
      opId: "synthetic-third-client",
      baseRevision: oldAck.head.revision,
      snapshot: cloudDraft("Newer remote head"),
    };
    const { contentHash: _oldHash, ...externalPayload } = external;
    await send(
      {
        ...pendingRequest,
        mutation: {
          ...externalPayload,
          contentHash: await mutationHash(externalPayload),
        },
      },
      200,
    );
    const advanced = await send(pendingRequest, 200);
    expect(planCloudServerReply(advanced, pendingRequest).kind).toBe(
      "accepted-head",
    );
    expect(
      (await applyCloudServerReply(clientB, pendingRequest, advanced)).kind,
    ).toBe("accepted-head");
    const reconciled = (await clientB.get("synthetic-note"))!;
    expect(reconciled.inFlight).toBeNull();
    expect(reconciled.current?.snapshot?.bodyMarkdown).toBe(
      "Newer remote head",
    );
    expect(cloudStatus(reconciled)).toBe("synced");
    const latest = await fetch(`${origin}/v1/notes/synthetic-note`, {
      headers: {
        Authorization: headers.Authorization,
        "X-Peel-Collection": clientScope.collectionId,
        "X-Peel-Mode-Generation": "1",
      },
    });
    expect(latest.status).toBe(200);
    expect((await latest.json()).head.snapshot.bodyMarkdown).toBe(
      "Newer remote head",
    );
    const resumed = await download(localB, false);
    expect(resumed.throughSequence).toBe(6);
    await download(localA, true);
    expect((await clientA.get("synthetic-note"))?.current).toEqual(
      (await clientB.get("synthetic-note"))?.current,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await localA.close();
    await localB.close();
    await serverStore.close();
    rmSync(folder, { recursive: true, force: true });
  }
}, 20000);
