import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CloudLibraryOwners } from "../../apps/web/src/cloud-library-owners";
import { CloudNoteUpload } from "../../apps/web/src/cloud-note-upload";
import { DurableCloudClient } from "../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../packages/cloud-protocol/src/library-local";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  CloudMutationService,
  type CloudMutationRequest,
} from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import { cloudDraft, cloudScope } from "../fixtures/cloud-durable-contract";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
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
  const parent = mkdtempSync(join(tmpdir(), "synkies-library-owners-")),
    local = new SQLiteCloudStateStore(join(parent, "local.sqlite3")),
    remote = new SQLiteCloudServerStore(join(parent, "remote.sqlite3")),
    service = new CloudMutationService(remote),
    controller = new AbortController(),
    requests: CloudMutationRequest[] = [],
    all = new Set<CloudNoteUpload>(),
    releases: (() => void)[] = [],
    control = {
      reads: 0,
      commits: 0,
      closes: 0,
      failCommit: false,
      failRead: false,
      read: null as null | (() => Promise<void>),
      reply: null as null | (() => Promise<void>),
      status: 200,
    };
  const store: CloudLibraryStateStore = {
    async read(...args) {
      control.reads++;
      const hold = control.read;
      control.read = null;
      const result = await local.read(...args);
      if (hold) await hold();
      if (control.failRead) throw Error("synthetic private read failure");
      return result;
    },
    async commit(...args) {
      control.commits++;
      if (control.failCommit) throw Error("synthetic private commit failure");
      return local.commit(...args);
    },
    listLibrary: (...args) => local.listLibrary(...args),
    async close() {
      control.closes++;
      await local.close();
    },
  };
  await remote.seedAccount({
    ...cloudScope,
    status: "active",
    entitlement: "active",
    revision: 1,
    sequence: 0,
    wall: 0,
  });
  const handler = createCloudMutationHandler(
      service,
      async () => cloudScope.ownerSubject,
    ),
    send = async (request: CloudMutationRequest) => {
      requests.push(structuredClone(request));
      if (control.status !== 200)
        return { status: control.status, body: { private: "never display" } };
      const response = await handler(
        new Request("https://synthetic.invalid/v1/mutations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }),
      );
      const result = { status: response.status, body: await response.json() },
        held = control.reply;
      control.reply = null;
      if (held) await held();
      return result;
    },
    context = { store, scope: { ...cloudScope } },
    owners = new CloudLibraryOwners(context, send, controller.signal),
    client = new DurableCloudClient(local, cloudScope);
  for (const noteId of ["first", "second"])
    await client.save(
      noteId,
      {
        kind: "upsert",
        snapshot: { ...cloudDraft(`Body ${noteId}`), noteId },
      },
      null,
    );
  const selection = (noteId = "first") => ({ ...owners.context, noteId });
  return {
    owners,
    context,
    controller,
    control,
    requests,
    store,
    client,
    service,
    selection,
    track(upload: CloudNoteUpload) {
      all.add(upload);
      return upload;
    },
    hold() {
      const entered = deferred(),
        release = deferred();
      releases.push(release.resolve);
      return {
        entered,
        release,
        wait: async () => {
          entered.resolve();
          await release.promise;
        },
      };
    },
    async close(upload: CloudNoteUpload) {
      await upload.session.putAway();
      const closed = {
        context: owners.context,
        upload,
        session: upload.session,
      };
      owners.putAway(closed);
      return closed;
    },
    async cleanup() {
      for (const upload of owners.retainedOwners()) all.add(upload);
      controller.abort();
      for (const release of releases) release();
      await Promise.all([...all].map((upload) => upload.upload()));
      await local.close();
      await remote.close();
      rmSync(parent, { recursive: true, force: true });
    },
  };
}

it("captures scope, creates without I/O, and rejects foreign context before I/O", async () =>
  fixture(async (f) => {
    const before = [f.control.reads, f.control.commits];
    f.context.scope.ownerSubject = "later-global-owner";
    const upload = f.track(f.owners.create(f.owners.context));
    expect(f.owners.context.scope.ownerSubject).toBe(cloudScope.ownerSubject);
    expect(Object.isFrozen(f.owners.context.scope)).toBe(true);
    expect([f.control.reads, f.control.commits]).toEqual(before);
    expect(f.requests).toHaveLength(0);
    for (const context of [
      { ...f.owners.context, store: { ...f.store } },
      { ...f.owners.context, scope: { ...cloudScope, modeGeneration: 2 } },
    ]) {
      expect(() => f.owners.create(context)).toThrow("Could not open");
      await expect(
        f.owners.open({ ...context, noteId: "first" }),
      ).rejects.toThrow("Could not open");
    }
    await expect(f.owners.open(f.selection("bad/id"))).rejects.toThrow(
      "Could not open",
    );
    expect([f.control.reads, f.control.commits]).toEqual(before);
    expect(f.owners.retainedOwners()).toEqual([upload]);
    expect(f.control.closes).toBe(0);
  }));

it("coalesces overlapping same-note reads into one registered owner", async () =>
  fixture(async (f) => {
    const held = f.hold();
    f.control.read = held.wait;
    const first = f.owners.open(f.selection()),
      second = f.owners.open(f.selection());
    expect(first).toBe(second);
    await held.entered.promise;
    expect(f.control.reads).toBe(1);
    held.release.resolve();
    const upload = f.track(await first);
    expect(await second).toBe(upload);
    expect(await f.owners.open(f.selection())).toBe(upload);
    expect(f.owners.retainedOwners()).toEqual([upload]);
    expect(f.requests).toHaveLength(0);
  }));

it("supersedes an older cache read without retaining an unshown owner", async () =>
  fixture(async (f) => {
    const held = f.hold();
    f.control.read = held.wait;
    const stale = f.owners.open(f.selection());
    const rejected = expect(stale).rejects.toThrow("Could not open");
    await held.entered.promise;
    const current = f.track(await f.owners.open(f.selection("second")));
    held.release.resolve();
    await rejected;
    expect(f.owners.retainedOwners()).toEqual([current]);
    expect(f.requests).toHaveLength(0);
  }));

it("a synchronous capture supersedes a held cache read", async () =>
  fixture(async (f) => {
    const held = f.hold();
    f.control.read = held.wait;
    const stale = f.owners.open(f.selection()),
      rejected = expect(stale).rejects.toThrow("Could not open");
    await held.entered.promise;
    const current = f.track(f.owners.create(f.owners.context));
    held.release.resolve();
    await rejected;
    expect(f.owners.retainedOwners()).toEqual([current]);
  }));

it("keeps the same owner through close, held ACK, reopen and newer edits", async () =>
  fixture(async (f) => {
    const upload = f.track(await f.owners.open(f.selection())),
      held = f.hold();
    f.control.reply = held.wait;
    const first = upload.upload();
    await held.entered.promise;
    const oldSession = upload.session;
    await f.close(upload);
    const reopening = f.owners.open(f.selection());
    const same = await reopening;
    expect(same).toBe(upload);
    expect(same.session).not.toBe(oldSession);
    same.session.edit("Newer retained text");
    await same.session.flush();
    held.release.resolve();
    await first;
    expect(same.session.snapshot().status).toBe("Pending upload");
    await same.upload();
    expect(same.session.snapshot().status).toBe("Saved in Cloud");
    expect(f.requests.map((r) => r.mutation.snapshot!.bodyMarkdown)).toEqual([
      "Body first",
      "Newer retained text",
    ]);
    expect(f.owners.retainedOwners()).toEqual([same]);
    const closed = await f.close(same);
    expect(f.owners.retainedOwners()).toEqual([]);
    expect(() => f.owners.putAway(closed)).not.toThrow();
  }));

it("does not retire on early confirmation until the exact close callback is acknowledged", async () =>
  fixture(async (f) => {
    const upload = f.track(await f.owners.open(f.selection()));
    await upload.session.putAway();
    await upload.upload();
    expect(upload.session.snapshot().status).toBe("Saved in Cloud");
    expect(f.owners.retainedOwners()).toEqual([upload]);
    const before = f.owners.snapshot().refreshKey;
    await f.close(upload);
    expect(f.owners.retainedOwners()).toEqual([]);
    expect(f.owners.snapshot().refreshKey).toBeGreaterThan(before);
  }));

it("background confirmation refreshes a closed catalog and revokes the old owner's queued actor", async () =>
  fixture(async (f) => {
    const upload = f.track(await f.owners.open(f.selection())),
      held = f.hold();
    f.control.reply = held.wait;
    const first = upload.upload();
    await held.entered.promise;
    await f.close(upload);
    void upload.upload(); // Queue another window while the real reply is still held.
    const seen: number[] = [],
      unsubscribe = f.owners.subscribe(() =>
        seen.push(f.owners.snapshot().refreshKey),
      );
    held.release.resolve();
    await first;
    expect(f.owners.retainedOwners()).toEqual([]);
    const next = f.track(await f.owners.open(f.selection()));
    expect(next).not.toBe(upload);
    next.session.edit("Only fresh owner may send");
    await next.session.flush();
    upload.schedule();
    await upload.upload();
    await next.upload();
    expect(f.requests.map((r) => r.mutation.snapshot!.bodyMarkdown)).toEqual([
      "Body first",
      "Only fresh owner may send",
    ]);
    expect(next.session.snapshot().status).toBe("Saved in Cloud");
    expect(seen.length).toBeGreaterThan(0);
    unsubscribe();
    expect(Object.keys(f.owners.snapshot())).toEqual(["refreshKey"]);
  }));

it("discards a proven absent untouched capture but retains a touched-then-cleared pending draft", async () =>
  fixture(async (f) => {
    const empty = f.track(f.owners.create(f.owners.context));
    await f.close(empty);
    await expect.poll(() => f.owners.retainedOwners().length).toBe(0);
    expect(await f.client.get(empty.session.snapshot().noteId)).toBeNull();
    const touched = f.track(f.owners.create(f.owners.context));
    touched.session.edit("Temporary text");
    await touched.session.flush();
    touched.session.edit("");
    await touched.session.flush();
    await f.close(touched);
    await Promise.resolve();
    expect(f.owners.retainedOwners()).toEqual([touched]);
    expect(
      (await f.client.get(touched.session.snapshot().noteId))!.pending,
    ).not.toBeNull();
    await touched.upload();
    expect(f.owners.retainedOwners()).toEqual([]);
  }));

it("retains on failed absence inspection without an automatic retry loop", async () =>
  fixture(async (f) => {
    const empty = f.track(f.owners.create(f.owners.context));
    f.control.failRead = true;
    const closed = await f.close(empty);
    await Promise.resolve();
    expect(f.control.reads).toBe(1);
    f.owners.putAway(closed);
    await empty.upload();
    expect(f.control.reads).toBe(2); // Explicit upload read only, no second absence probe.
    expect(f.owners.retainedOwners()).toEqual([empty]);
  }));

it("reuses an auth-paused owner without sending from reopening", async () =>
  fixture(async (f) => {
    const upload = f.track(await f.owners.open(f.selection()));
    f.control.status = 401;
    await upload.upload();
    await f.close(upload);
    expect(f.requests).toHaveLength(1);
    const reopened = await f.owners.open(f.selection());
    expect(reopened).toBe(upload);
    expect(reopened.snapshot().kind).toBe("sign-in-required");
    expect(f.requests).toHaveLength(1);
    expect(reopened.snapshot().message).not.toContain("never display");
    f.control.status = 200;
    await reopened.upload();
    expect(f.requests[1]).toEqual(f.requests[0]);
  }));

it("a held reopen cannot retire the retained owner when its earlier ACK arrives", async () =>
  fixture(async (f) => {
    const upload = f.track(await f.owners.open(f.selection())),
      reply = f.hold();
    f.control.reply = reply.wait;
    const work = upload.upload();
    await reply.entered.promise;
    await f.close(upload);
    const read = f.hold();
    f.control.read = read.wait;
    const reopening = f.owners.open(f.selection());
    await read.entered.promise;
    reply.release.resolve();
    await work;
    expect(f.owners.retainedOwners()).toEqual([upload]);
    read.release.resolve();
    expect(await reopening).toBe(upload);
    expect(upload.session.snapshot().canEdit).toBe(true);
  }));

it("superseded reopening restores local closure and preserves its pending owner", async () =>
  fixture(async (f) => {
    const upload = f.track(await f.owners.open(f.selection()));
    await f.close(upload);
    const read = f.hold();
    f.control.read = read.wait;
    const stale = f.owners.open(f.selection()),
      rejected = expect(stale).rejects.toThrow("Could not open");
    await read.entered.promise;
    const next = f.track(f.owners.create(f.owners.context));
    read.release.resolve();
    await rejected;
    expect(upload.session.snapshot()).toMatchObject({
      closed: true,
      retained: true,
      status: "Pending upload",
    });
    expect(f.owners.retainedOwners()).toEqual([upload, next]);
    expect(f.requests).toHaveLength(0);
  }));

it("rejects foreign owners and stale/open sessions without releasing a live owner", async () =>
  fixture(async (f) => {
    const upload = f.track(await f.owners.open(f.selection()));
    expect(() =>
      f.owners.putAway({
        context: f.owners.context,
        upload,
        session: upload.session,
      }),
    ).toThrow();
    const foreign = f.track(
      CloudNoteUpload.capture(
        f.store,
        cloudScope,
        async () => ({ status: 503, body: {} }),
        f.controller.signal,
      ),
    );
    await foreign.session.putAway();
    expect(() =>
      f.owners.putAway({
        context: f.owners.context,
        upload: foreign,
        session: foreign.session,
      }),
    ).toThrow();
    const closed = await f.close(upload);
    await f.owners.open(f.selection());
    expect(() =>
      f.owners.putAway({ ...closed, session: foreign.session }),
    ).toThrow();
    expect(() => f.owners.putAway(closed)).not.toThrow();
    expect(upload.session.snapshot().canEdit).toBe(true);
    expect(f.owners.retainedOwners()).toContain(upload);
  }));

it("account abort rejects late reads, preserves copyable failed retention and never closes storage", async () =>
  fixture(async (f) => {
    const draft = f.track(f.owners.create(f.owners.context));
    f.control.failCommit = true;
    draft.session.edit("Copyable original account recovery");
    await expect(draft.session.flush()).rejects.toThrow();
    const held = f.hold();
    f.control.read = held.wait;
    const pending = f.owners.open(f.selection()),
      rejected = expect(pending).rejects.toThrow("Could not open");
    await held.entered.promise;
    f.controller.abort();
    held.release.resolve();
    await rejected;
    expect(f.owners.retainedOwners()).toEqual([draft]);
    expect(draft.session.snapshot()).toMatchObject({
      bodyMarkdown: "Copyable original account recovery",
      retained: false,
      canEdit: true,
    });
    expect(() => f.owners.create(f.owners.context)).toThrow();
    await expect(f.owners.open(f.selection())).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
    expect(f.control.closes).toBe(0);
  }));

it("a newer selection of the same held note supersedes a different pending selection", async () =>
  fixture(async (f) => {
    const held = f.hold();
    f.control.read = held.wait;
    const first = f.owners.open(f.selection());
    await held.entered.promise;
    const secondHold = f.hold();
    f.control.read = secondHold.wait;
    const other = f.owners.open(f.selection("second")),
      rejected = expect(other).rejects.toThrow("Could not open");
    await secondHold.entered.promise;
    expect(f.owners.open(f.selection())).toBe(first);
    held.release.resolve();
    const current = f.track(await first);
    secondHold.release.resolve();
    await rejected;
    expect(f.owners.retainedOwners()).toEqual([current]);
  }));

it("a failed reopen leaves original closed recovery owned and reports no private storage error", async () =>
  fixture(async (f) => {
    const upload = f.track(await f.owners.open(f.selection()));
    await f.close(upload);
    const session = upload.session;
    f.control.failRead = true;
    await expect(f.owners.open(f.selection())).rejects.toThrow(
      "Could not open this Cloud note",
    );
    expect(upload.session).toBe(session);
    expect(f.owners.retainedOwners()).toEqual([upload]);
    f.control.failRead = false;
    expect(await f.owners.open(f.selection())).toBe(upload);
    expect(f.requests).toHaveLength(0);
  }));

it("context abort retains a closed pending owner and refuses the later server ACK commit", async () =>
  fixture(async (f) => {
    const upload = f.track(await f.owners.open(f.selection())),
      held = f.hold();
    f.control.reply = held.wait;
    const task = upload.upload();
    await held.entered.promise;
    await f.close(upload);
    const before = f.control.commits;
    f.controller.abort();
    held.release.resolve();
    await task;
    expect(f.owners.retainedOwners()).toEqual([upload]);
    expect(upload.snapshot().kind).toBe("canceled");
    expect(upload.session.snapshot().status).toBe("Pending upload");
    expect(f.control.commits).toBe(before);
    expect(f.control.closes).toBe(0);
    const remote = await f.service.get(
      cloudScope.ownerSubject,
      cloudScope,
      "first",
    );
    expect(remote.kind).toBe("note");
  }));
