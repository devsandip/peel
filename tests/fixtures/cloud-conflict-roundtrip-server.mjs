import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite.ts";
import {
  CloudMutationService,
  CloudServerError,
} from "../../packages/cloud-protocol/src/server.ts";
import {
  createCloudMutationHandler,
  MAX_CLOUD_REQUEST_BYTES,
} from "../../packages/cloud-protocol/src/server-http.ts";
import {
  CloudCursorSigner,
  CloudPullService,
} from "../../packages/cloud-protocol/src/pull.ts";
import { createCloudWebSessionBoundary } from "../../packages/cloud-protocol/src/web-session.ts";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
} from "../../packages/cloud-protocol/src/index.ts";
import { cloudDraft } from "./cloud-durable-contract.ts";

const SERVICE_ORIGIN = "https://conflict-roundtrip.synthetic";

/**
 * Owned loopback fixture: real service, pull and session boundaries with
 * synthetic principals and a same-origin test proxy. It is not Cognito, a
 * browser-managed Secure cookie, DynamoDB, hosted, live or paid-entitlement
 * proof. Observations hold metadata only, never bodies, cookies or tokens.
 */
export async function startCloudConflictRoundtripServer(browserOrigin) {
  const origin = new URL(browserOrigin);
  if (
    origin.origin !== browserOrigin ||
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1"
  )
    throw Error("Explicit loopback browser origin required");
  const folder = mkdtempSync(join(tmpdir(), "synkies-conflict-roundtrip-")),
    store = new SQLiteCloudServerStore(join(folder, "server.sqlite3")),
    service = new CloudMutationService(store),
    accounts = ["one", "two"].map((name, index) =>
      Object.freeze({
        version: 1,
        ownerSubject: `fixture-roundtrip-owner-${name}`,
        collectionId: `fixture-roundtrip-library-${name}`,
        modeGeneration: index + 3,
      }),
    ),
    credentials = accounts.map(() => randomBytes(32).toString("base64url")),
    records = new Map(),
    sessions = new Map(),
    labels = new Map(),
    observations = [];
  let boundary, handler;
  const session = (label) => {
    const found = sessions.get(label);
    if (!found) throw Error("Unknown fixture session");
    return found;
  };
  const server = createServer(async (incoming, outgoing) => {
    const label = labels.get(incoming.headers.cookie ?? "") ?? "none",
      switches = sessions.get(label)?.switches,
      url = new URL(incoming.url ?? "/", SERVICE_ORIGIN),
      entry = { session: label, method: incoming.method, path: url.pathname };
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > MAX_CLOUD_REQUEST_BYTES) throw Error("Fixture body bound");
        chunks.push(chunk);
      }
      const body = chunks.length ? Buffer.concat(chunks) : null,
        mutating = url.pathname === "/v1/mutations" && !!body;
      if (mutating) {
        try {
          const { opId, contentHash, kind } = JSON.parse(
            body.toString("utf8"),
          ).mutation;
          Object.assign(entry, { opId, contentHash, kind });
        } catch {
          entry.opId = null;
        }
      }
      observations.push(entry);
      if (switches?.offline) {
        entry.disposition = "offline";
        incoming.socket.destroy();
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (typeof value === "string") headers.set(name, value);
      // Map only the exact loopback browser Origin to the synthetic HTTPS origin.
      const supplied = headers.get("origin");
      if (supplied !== null && supplied !== browserOrigin) {
        entry.disposition = "foreign-origin";
        entry.status = 403;
        outgoing.writeHead(403).end();
        return;
      }
      if (supplied !== null) headers.set("origin", SERVICE_ORIGIN);
      const response = await handler(
          new Request(SERVICE_ORIGIN + incoming.url, {
            method: incoming.method,
            headers,
            ...(body ? { body } : {}),
          }),
        ),
        text = await response.text();
      entry.status = response.status;
      if (mutating) {
        try {
          entry.replayed = JSON.parse(text).replayed ?? null;
        } catch {
          entry.replayed = null;
        }
      }
      // Hold and lose apply after the real commit, so only the reply is affected.
      if (mutating && switches?.lose > 0) {
        switches.lose--;
        entry.disposition = "lost";
        incoming.socket.destroy();
        return;
      }
      if (mutating && switches?.hold) {
        entry.disposition = "held";
        await new Promise((resolve) => switches.releases.push(resolve));
      }
      entry.disposition ??= "delivered";
      if (!outgoing.destroyed) {
        outgoing.writeHead(response.status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        outgoing.end(text);
      }
    } catch {
      entry.disposition = "fixture-failure";
      if (!outgoing.destroyed)
        outgoing
          .writeHead(503, { "Content-Type": "application/json" })
          .end('{"error":"fixture-unavailable"}');
    }
  });
  try {
    boundary = createCloudWebSessionBoundary(
      { origin: SERVICE_ORIGIN, lifetimeMs: 3600000 },
      {
        read: async (key) =>
          records.has(key) ? structuredClone(records.get(key)) : null,
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
        return accounts[index].ownerSubject;
      },
    );
    for (const account of accounts)
      await store.seedAccount({
        ...account,
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
    await new Promise((resolve, reject) => {
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
  const account = (index) => {
    if (!accounts[index]) throw Error("Unknown fixture account");
    return accounts[index];
  };
  // A third client writing through the real service, never through a browser cache.
  const write = async (index, noteId, action) => {
    const scope = account(index),
      head = await service.get(scope.ownerSubject, scope, noteId);
    if (head.kind === "purged") throw Error("Use a fresh fixture note ID");
    const state = await startCloudMutation(
      saveCloudDraft(
        createCloudClient(
          scope.collectionId,
          noteId,
          head.kind === "note" ? head.snapshot : null,
        ),
        action,
      ),
      crypto.randomUUID(),
    );
    return service.mutate(scope.ownerSubject, {
      version: 1,
      collectionId: scope.collectionId,
      modeGeneration: scope.modeGeneration,
      mutation: state.inFlight,
    });
  };
  const release = (label) => {
    for (const candidate of label ? [session(label)] : sessions.values()) {
      candidate.switches.hold = false;
      for (const done of candidate.switches.releases.splice(0)) done();
    }
  };
  let closed = false;
  return {
    api: `http://127.0.0.1:${address.port}`,
    folder,
    accounts,
    observations,
    /** Synthetic issuance through the real boundary, one independent session per label. */
    async openSession(label, index) {
      if (sessions.has(label)) throw Error("Fixture session already open");
      account(index);
      const before = new Set(records.keys()),
        response = await boundary.issue(
          new Request(SERVICE_ORIGIN + "/auth/session", {
            method: "POST",
            headers: {
              origin: SERVICE_ORIGIN,
              authorization: credentials[index],
            },
          }),
        );
      if (response.status !== 200)
        throw Error("Synthetic session issuance failed");
      const issued = response.headers.get("set-cookie"),
        cookie = issued.split(";")[0],
        recordKey = [...records.keys()].find((key) => !before.has(key));
      sessions.set(label, {
        cookie,
        recordKey,
        switches: { offline: false, hold: false, lose: 0, releases: [] },
      });
      labels.set(cookie, label);
      return { csrfToken: (await response.json()).csrfToken, cookie, issued };
    },
    cookie: (label) => session(label).cookie,
    /** Offline, hold and lose switches for one named session only. */
    setSwitch(label, values) {
      const { switches } = session(label);
      for (const name of ["offline", "hold", "lose"])
        if (Object.hasOwn(values, name)) switches[name] = values[name];
    },
    release,
    held: (label) => session(label).switches.releases.length,
    /** Real boundary revocation, so the next request gets an actual 401. */
    revokeSession: (label) => {
      const record = records.get(session(label).recordKey);
      if (!record) throw Error("Fixture session record missing");
      record.revoked = true;
    },
    seedNote: (index, noteId, bodyMarkdown) =>
      write(index, noteId, {
        kind: "upsert",
        snapshot: {
          ...cloudDraft(bodyMarkdown),
          collectionId: account(index).collectionId,
          noteId,
        },
      }),
    /** A third client moves the note to Trash through the real service. */
    trashNote(index, noteId, bodyMarkdown) {
      const deleted = Date.now();
      return write(index, noteId, {
        kind: "upsert",
        snapshot: {
          ...cloudDraft(bodyMarkdown),
          collectionId: account(index).collectionId,
          noteId,
          state: "trashed",
          updatedAt: new Date(deleted).toISOString(),
          deletedAt: new Date(deleted).toISOString(),
          purgeAfter: new Date(deleted + 30 * 86400000).toISOString(),
        },
      });
    },
    purgeNote: (index, noteId) =>
      write(index, noteId, { kind: "purge", snapshot: null }),
    head: (index, noteId) =>
      service.get(account(index).ownerSubject, account(index), noteId),
    libraryContext: (index) =>
      service.libraryContext(account(index).ownerSubject),
    /** Status only: a foreign probe must never surface another account's payload. */
    async foreignGet(label, index, noteId) {
      const scope = account(index),
        response = await fetch(
          `http://127.0.0.1:${address.port}/v1/notes/${noteId}`,
          {
            headers: {
              cookie: session(label).cookie,
              "x-peel-collection": scope.collectionId,
              "x-peel-mode-generation": String(scope.modeGeneration),
            },
          },
        );
      return { status: response.status, text: await response.text() };
    },
    resourcesRemoved: () => closed && !existsSync(folder),
    async close() {
      if (closed) return;
      closed = true;
      release();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await store.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}
