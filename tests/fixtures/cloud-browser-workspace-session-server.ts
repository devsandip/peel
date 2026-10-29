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
import {
  createCloudMutationHandler,
  MAX_CLOUD_REQUEST_BYTES,
} from "../../packages/cloud-protocol/src/server-http";
import {
  CloudCursorSigner,
  CloudPullService,
} from "../../packages/cloud-protocol/src/pull";
import {
  createCloudWebSessionBoundary,
  type CloudWebSession,
} from "../../packages/cloud-protocol/src/web-session";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
} from "../../packages/cloud-protocol/src/index";
import { cloudDraft } from "./cloud-durable-contract";

/** Owned loopback fixture: real session/data boundaries, synthetic identity and same-origin test proxy. */
export async function startCloudBrowserWorkspaceSessionServer(
  browserOrigin: string,
) {
  const origin = new URL(browserOrigin);
  if (
    origin.origin !== browserOrigin ||
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1"
  )
    throw Error("Explicit loopback browser origin required");
  const folder = mkdtempSync(
      join(tmpdir(), "synkies-browser-workspace-service-"),
    ),
    store = new SQLiteCloudServerStore(join(folder, "server.sqlite3")),
    service = new CloudMutationService(store),
    scopes = ["a", "b"].map((letter, index) => ({
      version: 1 as const,
      ownerSubject: `fixture-owner-${letter}`,
      collectionId: `fixture-library-${letter}`,
      modeGeneration: index + 7,
    })),
    credentials = scopes.map(() => randomBytes(32).toString("base64url")),
    records = new Map<string, CloudWebSession>(),
    releases: (() => void)[] = [],
    control = {
      holdContext: false,
      holdMutation: false,
      contexts: 0,
      committed: 0,
      pages: 0,
    },
    observations: {
      path: string;
      status: number;
      hasCookie: boolean;
      hasBinding: boolean;
    }[] = [];
  const serviceOrigin = "https://workspace.synthetic";
  let lastCookie = "",
    boundary!: ReturnType<typeof createCloudWebSessionBoundary>;
  let handler!: ReturnType<typeof createCloudMutationHandler>;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > MAX_CLOUD_REQUEST_BYTES) throw Error("Fixture body bound");
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (typeof value === "string") headers.set(name, value);
      // Test-only proxy: preserve cookie/binding and map only the exact loopback Origin to a fixed synthetic HTTPS origin.
      const suppliedOrigin = headers.get("origin");
      if (suppliedOrigin !== null && suppliedOrigin !== browserOrigin) {
        outgoing.writeHead(403).end();
        return;
      }
      if (suppliedOrigin !== null) headers.set("origin", serviceOrigin);
      const request = new Request(serviceOrigin + incoming.url, {
          method: incoming.method,
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
        response = await handler(request),
        path = new URL(request.url).pathname;
      observations.push({
        path,
        status: response.status,
        hasCookie: headers.has("cookie"),
        hasBinding: headers.has("x-peel-csrf"),
      });
      if (path === "/v1/library-context") {
        control.contexts++;
        if (control.holdContext)
          await new Promise<void>((resolve) => releases.push(resolve));
      }
      if (path === "/v1/mutations" && response.status === 200) {
        control.committed++;
        if (control.holdMutation)
          await new Promise<void>((resolve) => releases.push(resolve));
      }
      if (["/v1/notes", "/v1/sync"].includes(path) && response.status === 200)
        control.pages++;
      if (!outgoing.destroyed) {
        outgoing.writeHead(response.status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        outgoing.end(await response.text());
      }
    } catch {
      if (!outgoing.destroyed)
        outgoing
          .writeHead(503, { "Content-Type": "application/json" })
          .end('{"error":"fixture-unavailable"}');
    }
  });
  try {
    boundary = createCloudWebSessionBoundary(
      { origin: serviceOrigin, lifetimeMs: 3600000 },
      {
        read: async (key) =>
          records.has(key) ? structuredClone(records.get(key)!) : null,
        insert: async (record) => {
          if (records.has(record.idHash)) return false;
          records.set(record.idHash, structuredClone(record));
          return true;
        },
        revoke: async (key) => {
          const record = records.get(key);
          if (record) record.revoked = true;
        },
      },
      async (request) => {
        const index = credentials.indexOf(
          request.headers.get("authorization") ?? "",
        );
        if (index === -1) throw new CloudServerError("unauthorized", 401);
        return scopes[index].ownerSubject;
      },
    );
    for (const scope of scopes)
      await store.seedAccount({
        ...scope,
        status: "active",
        entitlement: "active",
        revision: 1,
        sequence: 0,
        wall: 0,
      });
    const key = await crypto.subtle.generateKey(
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    handler = createCloudMutationHandler(
      service,
      boundary.resolveCaller,
      new CloudPullService(store, new CloudCursorSigner(key)),
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    server.closeAllConnections();
    server.close();
    await store.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Fixture listener unavailable");
  const release = () => {
    control.holdContext = false;
    control.holdMutation = false;
    for (const done of releases.splice(0)) done();
  };
  return {
    api: `http://127.0.0.1:${address.port}`,
    control,
    cookie: () => lastCookie,
    observations,
    release,
    async issue(index: number) {
      if (!scopes[index]) throw Error("Unknown fixture principal");
      const response = await boundary.issue(
        new Request(serviceOrigin + "/auth/session", {
          method: "POST",
          headers: {
            origin: serviceOrigin,
            authorization: credentials[index],
            ...(lastCookie ? { cookie: lastCookie } : {}),
          },
        }),
      );
      if (response.status !== 200)
        throw Error("Synthetic session issuance failed");
      const cookie = response.headers.get("set-cookie")!;
      lastCookie = cookie.split(";")[0];
      return { csrfToken: (await response.json()).csrfToken as string, cookie };
    },
    async seedRemote(index: number, noteId: string, body: string) {
      const scope = scopes[index];
      if (!scope) throw Error("Unknown fixture principal");
      const head = await service.get(scope.ownerSubject, scope, noteId);
      if (head.kind === "purged") throw Error("Use a fresh fixture note ID");
      const state = await startCloudMutation(
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
      await service.mutate(scope.ownerSubject, {
        version: 1,
        collectionId: scope.collectionId,
        modeGeneration: scope.modeGeneration,
        mutation: state.inFlight!,
      });
    },
    head: (index: number, noteId: string) =>
      service.get(scopes[index].ownerSubject, scopes[index], noteId),
    async close() {
      release();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await store.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
