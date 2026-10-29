import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { expect, it } from "vitest";
import {
  CloudLibraryDownload,
  CLOUD_DOWNLOAD_PASS_PAGES,
  type CloudDownloadRequest,
  type CloudDownloadSender,
} from "../../apps/web/src/cloud-library-download";
import { DurableCloudClient } from "../../packages/cloud-protocol/src/durable";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  CloudMutationService,
  CloudServerError,
} from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import {
  CloudCursorSigner,
  CloudPullService,
  CLOUD_PAGE_WIRE_BYTES,
} from "../../packages/cloud-protocol/src/pull";
import { type CloudPullStateStore } from "../../packages/cloud-protocol/src/pull-local";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
} from "../../packages/cloud-protocol/src/index";
import { cloudScope, cloudDraft } from "../fixtures/cloud-durable-contract";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}
async function fixture(
  run: (f: Awaited<ReturnType<typeof create>>) => Promise<void>,
) {
  const f = await create();
  try {
    await run(f);
  } finally {
    await f.close();
  }
}
async function create() {
  const parent = mkdtempSync(join(tmpdir(), "synkies-download-")),
    serverStore = new SQLiteCloudServerStore(join(parent, "server.sqlite3")),
    controller = new AbortController(),
    token = randomBytes(32).toString("hex"),
    requests: CloudDownloadRequest[] = [],
    control = {
      now: 1800000000000,
      unauthorized: false,
      limit: 32,
      failCommit: false,
      read: null as null | (() => Promise<void>),
      after: null as
        | null
        | ((reply: {
            status: number;
            body: any;
          }) => Promise<{ status: number; body: unknown }>),
    };
  let local = new SQLiteCloudStateStore(join(parent, "cache.sqlite3"));
  const service = new CloudMutationService(serverStore, () => control.now);
  const key = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const handler = createCloudMutationHandler(
    service,
    async (request) => {
      if (
        control.unauthorized ||
        request.headers.get("x-synthetic-fixture") !== token
      )
        throw new CloudServerError("unauthorized", 401);
      return cloudScope.ownerSubject;
    },
    new CloudPullService(
      serverStore,
      new CloudCursorSigner(key, () => control.now),
      () => control.now,
    ),
  );
  let origin = "";
  const http = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 8192) throw Error("Synthetic request bound");
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (typeof value === "string") headers.set(name, value);
      const reply = await handler(
        new Request(origin + incoming.url, {
          method: incoming.method,
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      outgoing.writeHead(reply.status, Object.fromEntries(reply.headers));
      outgoing.end(await reply.text());
    } catch {
      outgoing.writeHead(503).end('{"error":"synthetic-failure"}');
    }
  });
  await serverStore.seedAccount({
    ...cloudScope,
    status: "active",
    entitlement: "active",
    revision: 1,
    sequence: 0,
    wall: 0,
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", resolve);
  });
  const address = http.address();
  if (!address || typeof address === "string")
    throw Error("Missing owned listener");
  origin = `http://127.0.0.1:${address.port}`;
  const store: CloudPullStateStore = {
    read: (...args) => local.read(...args),
    commit: (...args) => local.commit(...args),
    async readPull(...args) {
      const result = await local.readPull(...args),
        held = control.read;
      control.read = null;
      if (held) await held();
      return result;
    },
    commitPull: (...args) => {
      if (control.failCommit) throw Error("Private commit diagnostic");
      return local.commitPull(...args);
    },
    close: async () => {},
  };
  const send: CloudDownloadSender = async (request, signal) => {
    requests.push(structuredClone(request));
    const url =
      request.kind === "bootstrap"
        ? "/v1/sync/bootstrap"
        : request.kind === "resume"
          ? `/v1/sync?after=${encodeURIComponent(request.checkpoint)}`
          : `${request.location.kind === "heads" ? "/v1/notes" : "/v1/sync"}?pageToken=${encodeURIComponent(request.location.token)}&limit=${control.limit}`;
    const response = await fetch(origin + url, {
      method: request.kind === "bootstrap" ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-synthetic-fixture": token,
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      ...(request.kind === "bootstrap"
        ? { body: JSON.stringify(request.scope) }
        : {}),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > CLOUD_PAGE_WIRE_BYTES)
      throw Error("Synthetic response bound");
    const reply = {
      status: response.status,
      body: JSON.parse(new TextDecoder().decode(bytes)),
    };
    return control.after ? control.after(reply) : reply;
  };
  const client = () => new DurableCloudClient(store, cloudScope);
  return {
    store,
    control,
    requests,
    controller,
    send,
    client,
    owner: () =>
      new CloudLibraryDownload(store, cloudScope, send, controller.signal),
    local: () => local,
    async reopen() {
      await local.close();
      local = new SQLiteCloudStateStore(join(parent, "cache.sqlite3"));
    },
    async seed(noteId: string, body: string) {
      const head = await service.get(
        cloudScope.ownerSubject,
        cloudScope,
        noteId,
      );
      const prepared = await startCloudMutation(
        saveCloudDraft(
          createCloudClient(
            cloudScope.collectionId,
            noteId,
            head.kind === "note" ? head.snapshot : null,
          ),
          {
            kind: "upsert",
            snapshot: { ...cloudDraft(body), noteId },
          },
        ),
        crypto.randomUUID(),
      );
      return service.mutate(cloudScope.ownerSubject, {
        version: 1,
        collectionId: cloudScope.collectionId,
        modeGeneration: cloudScope.modeGeneration,
        mutation: prepared.inFlight!,
      });
    },
    async close() {
      controller.abort();
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
      await local.close();
      await serverStore.close();
      rmSync(parent, { recursive: true, force: true });
    },
  };
}

it("downloads an independent committed library over actual HTTP, then catches up from its own durable checkpoint", async () =>
  fixture(async (f) => {
    for (let i = 0; i < 35; i++) await f.seed(`note-${i}`, `Server note ${i}`);
    const owner = f.owner();
    expect((await owner.download()).kind).toBe("complete");
    const page = await f.local().listLibrary(cloudScope, {
      collection: "notes",
      limit: 32,
      cursor: null,
    });
    expect(page.entries).toHaveLength(32);
    expect(page.next).not.toBeNull();
    expect(
      page.entries.every((entry) => entry.status === "Saved in Cloud"),
    ).toBe(true);
    expect(
      (await f.client().get("note-34"))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Server note 34");
    const checkpoint = (await f.local().readPull(cloudScope, [])).progress!
      .checkpoint;
    await f.reopen();
    await f.seed("late-note", "Created after first checkpoint");
    await f.seed("note-34", "Edited after first checkpoint");
    const before = f.requests.length;
    expect((await f.owner().download()).kind).toBe("complete");
    expect(f.requests[before]).toEqual({ kind: "resume", checkpoint });
    expect(
      (await f.client().get("late-note"))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Created after first checkpoint");
    expect((await f.client().get("note-34"))?.baseRevision).toBe(2);
    expect(
      (await f.client().get("note-34"))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Edited after first checkpoint");
  }));

it("bounds one pass, resumes an interrupted page after reopen and never calls it complete early", async () =>
  fixture(async (f) => {
    for (let i = 0; i < 12; i++) await f.seed(`note-${i}`, `Server ${i}`);
    f.control.limit = 1;
    expect(await f.owner().download()).toMatchObject({
      kind: "more",
      pages: CLOUD_DOWNLOAD_PASS_PAGES,
    });
    const progress = (await f.local().readPull(cloudScope, [])).progress!;
    expect(progress.next).not.toBeNull();
    const count = f.requests.length;
    await f.reopen();
    expect((await f.owner().download()).kind).toBe("complete");
    expect(f.requests[count]).toEqual({
      kind: "page",
      location: progress.next,
    });
    expect((await f.client().get("note-9"))?.baseRevision).toBe(1);
  }));

it("retains unrelated pending text and exposes a same-note remote conflict without acknowledging it", async () =>
  fixture(async (f) => {
    await f.client().save(
      "local-only",
      {
        kind: "upsert",
        snapshot: { ...cloudDraft("Unsent local"), noteId: "local-only" },
      },
      null,
    );
    await f.client().save(
      "shared",
      {
        kind: "upsert",
        snapshot: { ...cloudDraft("Unsent conflicting"), noteId: "shared" },
      },
      null,
    );
    await f.seed("shared", "Committed remote");
    expect((await f.owner().download()).kind).toBe("complete");
    const local = await f.client().get("local-only"),
      conflict = await f.client().get("shared");
    expect(local?.pending?.snapshot?.bodyMarkdown).toBe("Unsent local");
    expect(local?.baseRevision).toBe(0);
    expect(conflict?.current?.snapshot?.bodyMarkdown).toBe(
      "Unsent conflicting",
    );
    expect(conflict?.conflict?.remote?.bodyMarkdown).toBe("Committed remote");
  }));

it("coalesces concurrent calls and stops dispatch when a synchronous observer cancels", async () =>
  fixture(async (f) => {
    const owner = f.owner();
    const unsubscribe = owner.subscribe(() => {
      if (owner.snapshot().kind === "downloading") f.controller.abort();
    });
    const a = owner.download(),
      b = owner.download();
    expect(a).toBe(b);
    expect((await a).kind).toBe("canceled");
    expect(f.requests).toHaveLength(0);
    unsubscribe();
  }));

it("refuses a late start commit after cancellation inside its held progress read", async () =>
  fixture(async (f) => {
    const entered = deferred(),
      release = deferred();
    f.control.after = async (reply) => {
      f.control.read = async () => {
        entered.resolve();
        await release.promise;
      };
      return reply;
    };
    const task = f.owner().download();
    await entered.promise;
    f.controller.abort();
    release.resolve();
    expect((await task).kind).toBe("canceled");
    expect((await f.local().readPull(cloudScope, [])).progress).toBeNull();
  }));

it("refuses a late page commit after cancellation inside its held note/progress read", async () =>
  fixture(async (f) => {
    await f.seed("server-note", "Committed remote");
    const entered = deferred(),
      release = deferred();
    let startProgress: unknown;
    f.control.after = async (reply) => {
      if (reply.body.heads) {
        startProgress = (await f.local().readPull(cloudScope, [])).progress;
        f.control.read = async () => {
          entered.resolve();
          await release.promise;
        };
      }
      return reply;
    };
    const task = f.owner().download();
    await entered.promise;
    f.controller.abort();
    release.resolve();
    expect((await task).kind).toBe("canceled");
    expect((await f.local().readPull(cloudScope, [])).progress).toEqual(
      startProgress,
    );
    expect(await f.client().get("server-note")).toBeNull();
  }));

it("pauses a real401 without retry and resumes only on a new explicit call", async () =>
  fixture(async (f) => {
    f.control.unauthorized = true;
    const owner = f.owner();
    expect((await owner.download()).kind).toBe("sign-in-required");
    expect(f.requests).toHaveLength(1);
    expect((await f.local().readPull(cloudScope, [])).progress).toBeNull();
    f.control.unauthorized = false;
    expect((await owner.download()).kind).toBe("complete");
  }));

it("keeps an expired cursor and pending drafts until explicit snapshot recovery", async () =>
  fixture(async (f) => {
    for (let i = 0; i < 10; i++) await f.seed(`note-${i}`, `Server ${i}`);
    await f.client().save(
      "local-only",
      {
        kind: "upsert",
        snapshot: {
          ...cloudDraft("Preserved pending"),
          noteId: "local-only",
        },
      },
      null,
    );
    f.control.limit = 1;
    const owner = f.owner();
    expect((await owner.download()).kind).toBe("more");
    const progress = (await f.local().readPull(cloudScope, [])).progress;
    f.control.now += 16 * 60 * 1000;
    expect((await owner.download()).kind).toBe("snapshot-required");
    expect((await f.local().readPull(cloudScope, [])).progress).toEqual(
      progress,
    );
    f.control.limit = 32;
    expect((await owner.restartSnapshot()).kind).toBe("complete");
    expect(
      (await f.client().get("local-only"))?.pending?.snapshot?.bodyMarkdown,
    ).toBe("Preserved pending");
  }));

it.each(["foreign-start", "wrong-start-kind", "foreign-page", "bad-page"])(
  "refuses %s without advancing untrusted state",
  async (failure) =>
    fixture(async (f) => {
      await f.seed("remote", "Remote body");
      f.control.after = async (reply) => {
        if (failure === "foreign-start" && reply.body.kind === "bootstrap")
          reply.body.scopeHash = "0".repeat(64);
        if (failure === "wrong-start-kind" && reply.body.kind === "bootstrap")
          reply.body.kind = "changes";
        if (failure === "foreign-page" && reply.body.heads)
          reply.body.scopeHash = "0".repeat(64);
        if (failure === "bad-page" && reply.body.heads)
          reply.body.version = 999;
        return reply;
      };
      expect((await f.owner().download()).kind).toBe("paused");
      expect(await f.client().get("remote")).toBeNull();
      const progress = (await f.local().readPull(cloudScope, [])).progress;
      if (failure.endsWith("start") || failure === "wrong-start-kind")
        expect(progress).toBeNull();
      else expect(progress?.lastPage).toBeNull();
    }),
);

it("hides private errors, performs no automatic retry and preserves failed local commits", async () =>
  fixture(async (f) => {
    const before = await f.local().readPull(cloudScope, []);
    f.control.failCommit = true;
    const owner = f.owner();
    expect((await owner.download()).kind).toBe("paused");
    expect(JSON.stringify(owner.snapshot())).not.toContain("Private");
    expect(f.requests).toHaveLength(1);
    expect(await f.local().readPull(cloudScope, [])).toEqual(before);
    f.control.failCommit = false;
    expect((await owner.download()).kind).toBe("complete");
  }));

it("copies input scope, rejects an invalid scope before I/O and refuses a foreign cached progress hash", async () =>
  fixture(async (f) => {
    const scope = { ...cloudScope },
      owner = new CloudLibraryDownload(
        f.store,
        scope,
        f.send,
        f.controller.signal,
      );
    scope.collectionId = "other-library";
    expect((await owner.download()).kind).toBe("complete");
    expect(f.requests[0]).toMatchObject({
      kind: "bootstrap",
      scope: { collectionId: cloudScope.collectionId },
    });
    expect(
      () =>
        new CloudLibraryDownload(
          f.store,
          null as any,
          f.send,
          f.controller.signal,
        ),
    ).toThrow();
    const reads = f.requests.length;
    const badStore: CloudPullStateStore = {
      ...f.store,
      async readPull(...args) {
        const value = await f.store.readPull(...args);
        return {
          ...value,
          progress: value.progress
            ? { ...value.progress, scopeHash: "0".repeat(64) }
            : null,
        };
      },
    };
    expect(
      (
        await new CloudLibraryDownload(
          badStore,
          cloudScope,
          f.send,
          f.controller.signal,
        ).download()
      ).kind,
    ).toBe("paused");
    expect(f.requests).toHaveLength(reads);
  }));

it("keeps the committed prefix when an observer cancels between pages", async () =>
  fixture(async (f) => {
    for (let i = 0; i < 3; i++) await f.seed(`note-${i}`, `Server ${i}`);
    f.control.limit = 1;
    const owner = f.owner();
    owner.subscribe(() => {
      if (owner.snapshot().pages === 1) f.controller.abort();
    });
    expect(await owner.download()).toMatchObject({
      kind: "canceled",
      pages: 1,
    });
    expect(f.requests).toHaveLength(2);
    expect((await f.client().get("note-0"))?.baseRevision).toBe(1);
    expect(await f.client().get("note-1")).toBeNull();
    expect(
      (await f.local().readPull(cloudScope, [])).progress?.next,
    ).not.toBeNull();
  }));

it("ignores a successful response released after the captured account was canceled", async () =>
  fixture(async (f) => {
    const entered = deferred(),
      release = deferred();
    f.control.after = async (reply) => {
      entered.resolve();
      await release.promise;
      return reply;
    };
    const task = f.owner().download();
    await entered.promise;
    f.controller.abort();
    release.resolve();
    expect((await task).kind).toBe("canceled");
    expect((await f.local().readPull(cloudScope, [])).progress).toBeNull();
    expect(f.requests).toHaveLength(1);
  }));

it("retains the old cursor on a failed page commit and retries that page only on explicit request", async () =>
  fixture(async (f) => {
    await f.seed("remote", "Committed source");
    let before: unknown;
    f.control.after = async (reply) => {
      if (reply.body.heads) {
        before = (await f.local().readPull(cloudScope, [])).progress;
        f.control.failCommit = true;
      }
      return reply;
    };
    const owner = f.owner();
    expect((await owner.download()).kind).toBe("paused");
    expect((await f.local().readPull(cloudScope, [])).progress).toEqual(before);
    expect(await f.client().get("remote")).toBeNull();
    expect(f.requests).toHaveLength(2);
    const previous = f.requests[1];
    f.control.after = null;
    f.control.failCommit = false;
    expect((await owner.download()).kind).toBe("complete");
    expect(f.requests[2]).toEqual(previous);
    expect((await f.client().get("remote"))?.baseRevision).toBe(1);
  }));

it.each(["network", "http503"])(
  "pauses %s with no automatic failed-request retry or payload leakage",
  async (failure) =>
    fixture(async (f) => {
      f.control.after = async () => {
        if (failure === "network") throw Error("Private transport diagnostic");
        return { status: 503, body: { error: "Private service diagnostic" } };
      };
      const owner = f.owner();
      expect((await owner.download()).kind).toBe("paused");
      expect(JSON.stringify(owner.snapshot())).not.toContain("Private");
      expect(f.requests).toHaveLength(1);
      expect((await f.local().readPull(cloudScope, [])).progress).toBeNull();
    }),
);
