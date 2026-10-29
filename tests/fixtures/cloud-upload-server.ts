import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  CloudMutationService,
  CloudServerError,
} from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import { cloudScope, cloudDraft } from "./cloud-durable-contract";
import {
  CloudPullService,
  CloudCursorSigner,
} from "../../packages/cloud-protocol/src/pull";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
} from "../../packages/cloud-protocol/src/index";
import {
  validateCloudScope,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";

/** Test-only loopback service. No default DB, actual credentials or provider. */
export async function startCloudUploadServer(
  browserOrigin: string,
  secondScope?: CloudScope,
  enablePull = false,
) {
  const otherScope =
    secondScope === undefined ? null : validateCloudScope(secondScope);
  if (otherScope?.ownerSubject === cloudScope.ownerSubject)
    throw Error("Distinct fixture owner required");
  const parent = mkdtempSync(join(tmpdir(), "synkies-browser-upload-")),
    store = new SQLiteCloudServerStore(join(parent, "server.sqlite3")),
    token = randomBytes(32).toString("hex"),
    control = {
      hold: false,
      holdDownloads: false,
      unauthorized: false,
      committed: 0,
      downloaded: 0,
    },
    releases: (() => void)[] = [];
  await store.seedAccount({
    ...cloudScope,
    status: "active",
    entitlement: "active",
    revision: 1,
    sequence: 0,
    wall: 0,
  });
  const contexts = [{ scope: cloudScope, token }];
  if (otherScope) {
    const scope = otherScope;
    await store.seedAccount({
      ...scope,
      status: "active",
      entitlement: "active",
      revision: 1,
      sequence: 0,
      wall: 0,
    });
    contexts.push({ scope, token: randomBytes(32).toString("hex") });
  }
  const service = new CloudMutationService(store),
    pull = enablePull
      ? new CloudPullService(
          store,
          new CloudCursorSigner(
            await crypto.subtle.generateKey(
              { name: "HMAC", hash: "SHA-256" },
              false,
              ["sign", "verify"],
            ),
          ),
        )
      : undefined;
  const handler = createCloudMutationHandler(
    service,
    async (request) => {
      const context = contexts.find(
        (candidate) =>
          candidate.token === request.headers.get("x-synthetic-fixture"),
      );
      if (control.unauthorized || !context)
        throw new CloudServerError("unauthorized", 401);
      return context.scope.ownerSubject;
    },
    pull,
  );
  let api = "";
  const server = createServer(async (incoming, outgoing) => {
    const origin = incoming.headers.origin;
    if (origin && origin !== browserOrigin) {
      outgoing.writeHead(403).end();
      return;
    }
    outgoing.setHeader("Access-Control-Allow-Origin", browserOrigin);
    outgoing.setHeader(
      "Access-Control-Allow-Headers",
      "content-type,x-synthetic-fixture,x-peel-collection,x-peel-mode-generation",
    );
    outgoing.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
    outgoing.setHeader("Cache-Control", "no-store");
    if (incoming.method === "OPTIONS") {
      outgoing.writeHead(204).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 65536) throw Error("Fixture body bound");
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (typeof value === "string") headers.set(name, value);
      const response = await handler(
        new Request(api + incoming.url, {
          method: incoming.method,
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      const path = new URL(api + incoming.url).pathname;
      if (
        incoming.method === "POST" &&
        path === "/v1/mutations" &&
        response.status === 200
      ) {
        control.committed++;
        if (control.hold)
          await new Promise<void>((resolve) => releases.push(resolve));
      }
      if (
        enablePull &&
        ["/v1/sync/bootstrap", "/v1/notes", "/v1/sync"].includes(path) &&
        response.status === 200
      ) {
        control.downloaded++;
        if (control.holdDownloads)
          await new Promise<void>((resolve) => releases.push(resolve));
      }
      if (!outgoing.destroyed) {
        outgoing.writeHead(response.status, {
          "Content-Type": "application/json",
        });
        outgoing.end(await response.text());
      }
    } catch {
      if (!outgoing.destroyed)
        outgoing.writeHead(503).end('{"error":"fixture-unavailable"}');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Fixture listener unavailable");
  api = `http://127.0.0.1:${address.port}`;
  const release = () => {
    control.hold = false;
    control.holdDownloads = false;
    for (const done of releases.splice(0)) done();
  };
  return {
    api,
    token,
    scope: cloudScope,
    contexts,
    control,
    release,
    async seedRemote(noteId: string, body: string, contextIndex = 0) {
      const context = contexts[contextIndex];
      if (!context || !enablePull)
        throw Error("Explicit synthetic pull context required");
      const scope = context.scope,
        head = await service.get(scope.ownerSubject, scope, noteId);
      if (head.kind === "purged") throw Error("Use a fresh synthetic note ID");
      const prepared = await startCloudMutation(
        saveCloudDraft(
          createCloudClient(
            scope.collectionId,
            noteId,
            head.kind === "note" ? head.snapshot : null,
          ),
          {
            kind: "upsert",
            snapshot: {
              ...cloudDraft(body),
              collectionId: scope.collectionId,
              noteId,
            },
          },
        ),
        crypto.randomUUID(),
      );
      const result = await service.mutate(scope.ownerSubject, {
        version: 1,
        collectionId: scope.collectionId,
        modeGeneration: scope.modeGeneration,
        mutation: prepared.inFlight!,
      });
      if (result.receipt.outcome !== "applied")
        throw Error("Synthetic seed did not commit");
    },
    async close() {
      release();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await store.close();
      rmSync(parent, { recursive: true, force: true });
    },
  };
}
