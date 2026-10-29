import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  CloudLibraryDownload,
  CLOUD_DOWNLOAD_PASS_PAGES,
} from "../../apps/web/src/cloud-library-download";
import { createCloudDownloadWebSender } from "../../apps/web/src/cloud-download-web-transport";
import { cloudChangeHintFromChange } from "../../packages/cloud-protocol/src/change-hints";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
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
} from "../../packages/cloud-protocol/src/pull";
import type { CloudPullStateStore } from "../../packages/cloud-protocol/src/pull-local";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
  cloudStatus,
} from "../../packages/cloud-protocol/src/index";
import {
  createCloudWebSessionBoundary,
  type CloudWebSession,
} from "../../packages/cloud-protocol/src/web-session";
import { cloudDraft } from "../fixtures/cloud-durable-contract";

const origin = "https://hint-pull.synthetic",
  scope: CloudScope = {
    version: 1,
    ownerSubject: "hint-pull-owner-a",
    collectionId: "hint-pull-library-a",
    modeGeneration: 7,
  },
  now = 1800000000000;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((done) => setImmediate(done));
const reached = (
  entered: Promise<void>,
  task: ReturnType<CloudLibraryDownload["acceptHint"]>,
) =>
  Promise.race([
    entered,
    task.then((view) => {
      throw Error("Expected held Fetch request; pass settled as " + view.kind);
    }),
  ]);

async function fixture(
  run: (f: Awaited<ReturnType<typeof create>>) => Promise<void>,
) {
  const f = await create();
  try {
    await run(f);
  } finally {
    await f.cleanup();
  }
}
async function create() {
  const folder = mkdtempSync(join(tmpdir(), "synkies-hint-catchup-")),
    control = {
      cookie: "",
      limit: 32,
      failRead: false,
      failCommit: false,
      failPage: false,
      pageWrite: false,
      corruptProgress: false,
      reads: 0,
      writes: 0,
      closes: 0,
      after: null as
        null | ((request: Request, reply: Response) => Promise<void>),
    },
    local = new SQLiteCloudStateStore(join(folder, "receiver.sqlite3"), () => {
      if (control.failCommit || (control.failPage && control.pageWrite))
        throw Error("synthetic private storage detail");
    }),
    remote = new SQLiteCloudServerStore(join(folder, "source.sqlite3")),
    service = new CloudMutationService(remote, () => now),
    sessions = new Map<string, CloudWebSession>(),
    controllers: AbortController[] = [],
    tasks = new Set<Promise<unknown>>(),
    releases: (() => void)[] = [],
    requests: { path: string; method: string }[] = [];
  const store: CloudPullStateStore = {
    read: (...args) => local.read(...args),
    commit: (...args) => local.commit(...args),
    async readPull(...args) {
      control.reads++;
      if (control.failRead) throw Error("synthetic private read path");
      const result = await local.readPull(...args);
      return control.corruptProgress && result.progress
        ? {
            ...result,
            progress: { ...result.progress, scopeHash: "0".repeat(64) },
          }
        : result;
    },
    async commitPull(...args) {
      control.writes++;
      control.pageWrite = args[3].length > 0;
      try {
        return await local.commitPull(...args);
      } finally {
        control.pageWrite = false;
      }
    },
    async close() {
      control.closes++;
      await local.close();
    },
  };
  try {
    for (const letter of ["a", "b"])
      await remote.seedAccount({
        ...scope,
        ownerSubject: `hint-pull-owner-${letter}`,
        collectionId: `hint-pull-library-${letter}`,
        status: "active",
        entitlement: "active",
        revision: 1,
        sequence: 0,
        wall: 0,
      });
    const boundary = createCloudWebSessionBoundary(
      { origin, lifetimeMs: 3600000 },
      {
        read: async (key) =>
          sessions.has(key) ? structuredClone(sessions.get(key)!) : null,
        insert: async (record) => {
          if (sessions.has(record.idHash)) return false;
          sessions.set(record.idHash, structuredClone(record));
          return true;
        },
        revoke: async (key) => {
          const record = sessions.get(key);
          if (record) record.revoked = true;
        },
      },
      async (request) => {
        const letter = request.headers.get("authorization");
        if (letter !== "synthetic-a" && letter !== "synthetic-b")
          throw new CloudServerError("unauthorized", 401);
        return letter === "synthetic-a"
          ? scope.ownerSubject
          : "hint-pull-owner-b";
      },
      () => now,
    );
    const key = await crypto.subtle.generateKey(
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      ),
      handler = createCloudMutationHandler(
        service,
        boundary.resolveCaller,
        new CloudPullService(
          remote,
          new CloudCursorSigner(key, () => now),
          () => now,
        ),
      );
    const fetcher = vi.fn(
      async (input: string | URL | Request, options?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        // Test-only smaller actual handler pages force the unchanged eight-page budget.
        if (url.searchParams.has("pageToken"))
          url.searchParams.set("limit", String(control.limit));
        const request = new Request(url, options);
        request.headers.set("cookie", control.cookie);
        request.headers.set("origin", origin);
        requests.push({ path: url.pathname, method: request.method });
        const reply = await handler(request);
        if (control.after) await control.after(request, reply);
        return reply;
      },
    ) as unknown as typeof fetch;
    async function issue(letter = "a") {
      const reply = await boundary.issue(
        new Request(origin + "/auth/session", {
          method: "POST",
          headers: {
            origin,
            authorization: `synthetic-${letter}`,
            ...(control.cookie ? { cookie: control.cookie } : {}),
          },
        }),
      );
      if (reply.status !== 200) throw Error("Synthetic issuance failed");
      control.cookie = reply.headers.get("set-cookie")!.split(";")[0];
      return { origin, csrfToken: (await reply.json()).csrfToken as string };
    }
    const config = await issue(),
      sender = createCloudDownloadWebSender(config, fetcher),
      track = <T>(task: Promise<T>) => {
        tasks.add(task);
        void task.catch(() => {});
        return task;
      },
      client = new DurableCloudClient(local, scope);
    return {
      local,
      remote,
      control,
      requests,
      fetcher,
      store,
      config,
      client,
      issue,
      track,
      make(input = scope) {
        const controller = new AbortController();
        controllers.push(controller);
        return {
          controller,
          owner: new CloudLibraryDownload(
            store,
            input,
            sender,
            controller.signal,
          ),
        };
      },
      hold() {
        const entered = deferred(),
          release = deferred();
        releases.push(release.resolve);
        return { entered, release };
      },
      progress: async () => (await local.readPull(scope, [])).progress,
      async seed(noteId = "shared-note", body = "Source text") {
        const head = await service.get(scope.ownerSubject, scope, noteId);
        if (head.kind === "purged")
          throw Error("Fresh fixture identity required");
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
        const result = await service.mutate(scope.ownerSubject, {
          version: 1,
          collectionId: scope.collectionId,
          modeGeneration: scope.modeGeneration,
          mutation: state.inFlight!,
        });
        if (result.receipt.outcome !== "applied")
          throw Error("Synthetic commit failed");
        const page = await remote.changesPage(
          scope.ownerSubject,
          result.receipt.sequence! - 1,
          result.receipt.sequence!,
          1,
        );
        return cloudChangeHintFromChange(scope, page.changes[0]);
      },
      async saveLocal(noteId: string, body: string) {
        const previous = await client.get(noteId);
        return client.save(
          noteId,
          {
            kind: "upsert",
            snapshot: {
              ...cloudDraft(body),
              collectionId: scope.collectionId,
              noteId,
            },
          },
          previous?.generation ?? null,
        );
      },
      async cleanup() {
        for (const controller of controllers) controller.abort();
        for (const release of releases) release();
        await Promise.allSettled([...tasks]);
        await Promise.allSettled(
          (fetcher as any).mock.results.map((result: any) => result.value),
        );
        await local.close();
        await remote.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await local.close();
    await remote.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

it("uses a committed hint to transactionally download a separate receiver, captures inputs and skips covered duplicates without network", async () =>
  fixture(async (f) => {
    const one = await f.seed(),
      two = await f.seed("other-note", "Other source"),
      input = { ...scope },
      { owner } = f.make(input),
      raw = { ...one };
    input.ownerSubject = "later-owner";
    input.collectionId = "later-library";
    input.modeGeneration++;
    const first = f.track(owner.acceptHint(raw)),
      second = f.track(owner.acceptHint(two));
    raw.sequence = 999;
    expect(first).toBe(second);
    expect((await first).kind).toBe("complete");
    expect(
      (await f.client.get("shared-note"))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Source text");
    expect(
      (await f.client.get("other-note"))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Other source");
    expect(await f.progress()).toMatchObject({
      throughSequence: 2,
      next: null,
    });
    const count = f.requests.length,
      writes = f.control.writes;
    expect(await f.track(owner.acceptHint(one))).toMatchObject({
      kind: "complete",
      pages: 0,
    });
    expect(await f.track(owner.acceptHint(two))).toMatchObject({
      kind: "complete",
      pages: 0,
    });
    expect(f.requests).toHaveLength(count);
    expect(f.control.writes).toBe(writes);
    expect(f.control.closes).toBe(0);
    await f.track(owner.download());
    expect(f.requests.length).toBeGreaterThan(count);
  }));

it("rejects invalid/foreign/aborted hints without local or remote I/O or presentation changes", async () =>
  fixture(async (f) => {
    const { owner, controller } = f.make(),
      before = owner.snapshot(),
      raw = {
        ...scope,
        kind: "library-changed",
        sequence: 1,
        noteId: "shared-note",
      };
    for (const input of [
      null,
      { ...raw, ownerSubject: "other-owner" },
      { ...raw, modeGeneration: 8 },
      { ...raw, bodyMarkdown: "private source" },
    ])
      await expect(f.track(owner.acceptHint(input))).rejects.toThrow(
        "Cloud change hint unavailable",
      );
    controller.abort("synthetic private reason");
    await expect(f.track(owner.acceptHint(raw))).rejects.toThrow(
      "Cloud change hint unavailable",
    );
    expect(owner.snapshot()).toBe(before);
    expect(f.control.reads).toBe(0);
    expect(f.control.writes).toBe(0);
    expect(f.requests).toEqual([]);
  }));

it("invalid input does not disturb a held valid pass", async () =>
  fixture(async (f) => {
    const hint = await f.seed(),
      held = f.hold(),
      { owner } = f.make();
    f.control.after = async (request) => {
      if (new URL(request.url).pathname === "/v1/sync/bootstrap") {
        held.entered.resolve();
        await held.release.promise;
      }
    };
    const task = f.track(owner.acceptHint(hint));
    await reached(held.entered.promise, task);
    const before = owner.snapshot(),
      reads = f.control.reads,
      requests = f.requests.length;
    await expect(
      f.track(owner.acceptHint({ ...hint, message: "private detail" })),
    ).rejects.toThrow("Cloud change hint unavailable");
    expect(owner.snapshot()).toBe(before);
    expect(f.control.reads).toBe(reads);
    expect(f.requests).toHaveLength(requests);
    held.release.resolve();
    expect((await task).kind).toBe("complete");
  }));

it("keeps a later coalesced target pending after a held older round with no automatic follow-up", async () =>
  fixture(async (f) => {
    await f.seed();
    const { owner } = f.make();
    await f.track(owner.download());
    const two = await f.seed("shared-note", "Second source"),
      held = f.hold();
    f.control.after = async (request) => {
      if (new URL(request.url).searchParams.has("after")) {
        held.entered.resolve();
        await held.release.promise;
      }
    };
    const first = f.track(owner.acceptHint(two));
    await reached(held.entered.promise, first);
    const three = await f.seed("third-note", "Third source"),
      later = f.track(owner.acceptHint(three));
    expect(later).toBe(first);
    held.release.resolve();
    expect((await first).kind).toBe("more");
    expect((await f.progress())?.throughSequence).toBe(2);
    expect(await f.client.get("third-note")).toBeNull();
    const count = f.requests.length;
    await tick();
    expect(f.requests).toHaveLength(count);
    expect((await f.track(owner.acceptHint(three))).kind).toBe("complete");
    expect((await f.progress())?.throughSequence).toBe(3);
    expect(
      (await f.client.get("third-note"))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Third source");
  }));

it.each(["synchronous", "microtask"])(
  "does not lose a %s completion-observer hint in the settlement gap",
  async (delivery) =>
    fixture(async (f) => {
      await f.seed();
      const { owner } = f.make();
      await f.track(owner.download());
      const two = await f.seed("shared-note", "Second source"),
        held = f.hold();
      f.control.after = async (request) => {
        if (new URL(request.url).searchParams.has("after")) {
          held.entered.resolve();
          await held.release.promise;
        }
      };
      const task = f.track(owner.acceptHint(two));
      await reached(held.entered.promise, task);
      const three = await f.seed("third-note", "Third source"),
        delivered = deferred();
      let invoked = false,
        later: ReturnType<typeof owner.acceptHint> | null = null;
      const unsubscribe = owner.subscribe(() => {
        if (owner.snapshot().kind !== "complete" || invoked) return;
        invoked = true;
        const deliver = () => {
          later = f.track(owner.acceptHint(three));
          delivered.resolve();
        };
        if (delivery === "microtask") queueMicrotask(deliver);
        else deliver();
      });
      held.release.resolve();
      await delivered.promise;
      expect(later).toBe(task);
      expect((await task).kind).toBe("more");
      unsubscribe();
      const count = f.requests.length;
      await tick();
      expect(f.requests).toHaveLength(count);
      expect((await f.track(owner.acceptHint(three))).kind).toBe("complete");
      expect((await f.progress())?.throughSequence).toBe(3);
    }),
);

it("never deduplicates a covered sequence while its eight-page inventory is incomplete", async () =>
  fixture(async (f) => {
    f.control.limit = 1;
    let hint = await f.seed("note-00");
    for (let i = 1; i < 10; i++)
      hint = await f.seed(`note-${String(i).padStart(2, "0")}`);
    const { owner } = f.make(),
      first = await f.track(owner.acceptHint(hint));
    expect(first).toMatchObject({
      kind: "more",
      pages: CLOUD_DOWNLOAD_PASS_PAGES,
    });
    expect(await f.progress()).toMatchObject({
      throughSequence: hint.sequence,
      next: expect.any(Object),
    });
    const count = f.requests.length;
    const next = await f.track(owner.acceptHint(hint));
    expect(next.kind).toBe("complete");
    expect(next.pages).toBeLessThanOrEqual(CLOUD_DOWNLOAD_PASS_PAGES);
    expect(f.requests.length).toBeGreaterThan(count);
    expect((await f.progress())?.next).toBeNull();
  }));

it.each([false, true])(
  "completing an older partial round yields more rather than false pause (recreated=%s)",
  async (recreated) =>
    fixture(async (f) => {
      for (let i = 0; i < 10; i++)
        await f.seed(`note-${String(i).padStart(2, "0")}`, "Initial");
      let pair = f.make();
      await f.track(pair.owner.download());
      f.control.limit = 1;
      for (let i = 0; i < 10; i++)
        await f.seed(`note-${String(i).padStart(2, "0")}`, "Old bounded round");
      expect((await f.track(pair.owner.download())).kind).toBe("more");
      expect((await f.progress())?.upperSequence).toBe(20);
      const hint = await f.seed("note-09", "Later source");
      if (recreated) {
        pair.controller.abort();
        pair = f.make();
      }
      expect((await f.track(pair.owner.acceptHint(hint))).kind).toBe("more");
      expect((await f.progress())?.throughSequence).toBe(20);
      expect((await f.track(pair.owner.acceptHint(hint))).kind).toBe(
        "complete",
      );
      expect((await f.progress())?.throughSequence).toBe(21);
    }),
);

it("remembers a fresh round's start target across bounded passes and pauses unverified hints without poisoning covered hints", async () =>
  fixture(async (f) => {
    f.control.limit = 1;
    let hint = await f.seed("note-00");
    for (let i = 1; i < 10; i++)
      hint = await f.seed(`note-${String(i).padStart(2, "0")}`);
    const { owner } = f.make(),
      ahead = { ...hint, sequence: 100 };
    expect((await f.track(owner.acceptHint(ahead))).kind).toBe("more");
    expect(await f.track(owner.acceptHint(ahead))).toMatchObject({
      kind: "paused",
      message:
        "Could not verify the Cloud notification. Your cached notes and drafts remain on this device.",
    });
    const count = f.requests.length;
    await tick();
    expect(f.requests).toHaveLength(count);
    expect(await f.track(owner.acceptHint(hint))).toMatchObject({
      kind: "complete",
      pages: 0,
    });
    expect(f.requests).toHaveLength(count);
    expect((await f.progress())?.throughSequence).toBe(10);
  }));

it.each([false, true])(
  "preserves pending/conflict/in-flight work independently of the collection checkpoint (inFlight=%s)",
  async (inFlight) =>
    fixture(async (f) => {
      await f.seed();
      const { owner } = f.make();
      await f.track(owner.download());
      let local = await f.saveLocal("shared-note", "Pending device source");
      if (inFlight)
        local = await f.client.prepare(
          "shared-note",
          local.generation,
          crypto.randomUUID(),
        );
      const operation = structuredClone(local.inFlight),
        hint = await f.seed("shared-note", "Concurrent server source");
      expect((await f.track(owner.acceptHint(hint))).kind).toBe("complete");
      const after = await f.client.get("shared-note");
      expect(after?.current?.snapshot?.bodyMarkdown).toBe(
        "Pending device source",
      );
      expect(cloudStatus(after!)).toBe(inFlight ? "waiting" : "conflict");
      if (inFlight) {
        expect(after?.inFlight).toEqual(operation);
        expect(after?.observed?.snapshot?.bodyMarkdown).toBe(
          "Concurrent server source",
        );
      } else {
        expect(after?.conflict?.local.snapshot?.bodyMarkdown).toBe(
          "Pending device source",
        );
        expect(after?.conflict?.remote?.bodyMarkdown).toBe(
          "Concurrent server source",
        );
      }
      expect((await f.progress())?.throughSequence).toBe(hint.sequence);
      expect(
        f.requests.some((request) => request.path === "/v1/mutations"),
      ).toBe(false);
      expect(f.control.closes).toBe(0);
    }),
);

it.each(["missing", "rotated"])(
  "honors real %s session failure without account retargeting or retries",
  async (failure) =>
    fixture(async (f) => {
      const hint = await f.seed(),
        { owner } = f.make();
      if (failure === "missing") f.control.cookie = "";
      else await f.issue("b");
      expect((await f.track(owner.acceptHint(hint))).kind).toBe(
        failure === "missing" ? "sign-in-required" : "paused",
      );
      expect(f.requests).toHaveLength(1);
      await tick();
      expect(f.requests).toHaveLength(1);
      expect(await f.progress()).toBeNull();
      expect(await f.client.get("shared-note")).toBeNull();
    }),
);

it("rolls back a failed page and explicitly resumes it without erasing pending local-only work", async () =>
  fixture(async (f) => {
    const hint = await f.seed(),
      pending = await f.saveLocal("local-only", "Retained original local work"),
      { owner } = f.make();
    f.control.failPage = true;
    expect((await f.track(owner.acceptHint(hint))).kind).toBe("paused");
    const before = await f.progress();
    expect(before?.next).not.toBeNull();
    expect(await f.client.get("shared-note")).toBeNull();
    expect(await f.client.get("local-only")).toEqual(pending);
    const count = f.requests.length;
    await tick();
    expect(f.requests).toHaveLength(count);
    f.control.failPage = false;
    expect((await f.track(owner.acceptHint(hint))).kind).toBe("complete");
    expect(await f.client.get("local-only")).toEqual(pending);
    expect(
      (await f.client.get("shared-note"))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Source text");
    expect((await f.progress())?.next).toBeNull();
  }));

it("refuses private read failures and foreign durable progress before network deduplication", async () =>
  fixture(async (f) => {
    const hint = await f.seed(),
      { owner } = f.make();
    f.control.failRead = true;
    expect(await f.track(owner.acceptHint(hint))).toMatchObject({
      kind: "paused",
      message:
        "Could not download. Your cached notes and drafts remain on this device.",
    });
    expect(f.requests).toEqual([]);
    f.control.failRead = false;
    await f.track(owner.acceptHint(hint));
    const count = f.requests.length;
    f.control.corruptProgress = true;
    expect((await f.track(owner.acceptHint(hint))).kind).toBe("paused");
    expect(f.requests).toHaveLength(count);
    f.control.corruptProgress = false;
    expect(await f.track(owner.acceptHint(hint))).toMatchObject({
      kind: "complete",
      pages: 0,
    });
    expect(f.requests).toHaveLength(count);
  }));

it("cancels a held late page without committing its body or cursor and never closes the caller's store", async () =>
  fixture(async (f) => {
    const hint = await f.seed(),
      held = f.hold(),
      { owner, controller } = f.make();
    f.control.after = async (request) => {
      if (new URL(request.url).searchParams.has("pageToken")) {
        held.entered.resolve();
        await held.release.promise;
      }
    };
    const task = f.track(owner.acceptHint(hint));
    await reached(held.entered.promise, task);
    const before = await f.progress();
    controller.abort("private canceled account");
    expect((await task).kind).toBe("canceled");
    held.release.resolve();
    await Promise.allSettled(
      (f.fetcher as any).mock.results.map((result: any) => result.value),
    );
    await tick();
    expect(await f.progress()).toEqual(before);
    expect(await f.client.get("shared-note")).toBeNull();
    expect(f.control.closes).toBe(0);
  }));

it("a queued completion-time abort cannot return a completed result to the canceled lifetime", async () =>
  fixture(async (f) => {
    const hint = await f.seed(),
      { owner, controller } = f.make();
    let invoked = false;
    owner.subscribe(() => {
      if (!invoked && owner.snapshot().kind === "complete") {
        invoked = true;
        queueMicrotask(() => controller.abort("private completion abort"));
      }
    });
    expect(await f.track(owner.acceptHint(hint))).toMatchObject({
      kind: "canceled",
      message: null,
    });
    expect(owner.snapshot().kind).toBe("canceled");
    expect(f.control.closes).toBe(0);
  }));
