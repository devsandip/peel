import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CloudDraftSession } from "../../apps/web/src/cloud-draft-session";
import {
  DurableCloudClient,
  type CloudStateStore,
} from "../../packages/cloud-protocol/src/durable";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import { CloudMutationService } from "../../packages/cloud-protocol/src/server";
import { applyCloudServerReply } from "../../packages/cloud-protocol/src/client-response";
import { mutationHash } from "../../packages/cloud-protocol/src/index";
import { cloudScope, cloudDraft } from "../fixtures/cloud-durable-contract";

const id = "synthetic-note",
  action = (body: string) => ({
    kind: "upsert" as const,
    snapshot: cloudDraft(body),
  });
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function gate() {
  return { entered: deferred(), release: deferred<boolean>() };
}
async function create() {
  const parent = mkdtempSync(join(tmpdir(), "synkies-draft-session-")),
    server = new SQLiteCloudServerStore(join(parent, "server.sqlite3")),
    service = new CloudMutationService(server, () => 1800000000000),
    control = {
      fail: false,
      lost: false,
      commits: 0,
      commitGate: null as ReturnType<typeof gate> | null,
      readGate: null as ReturnType<typeof gate> | null,
    },
    sessions: CloudDraftSession[] = [],
    gates: ReturnType<typeof gate>[] = [];
  const makeStore = () =>
    new SQLiteCloudStateStore(join(parent, "client.sqlite3"), () => {
      if (control.fail) throw Error("synthetic private disk error");
    });
  let local = makeStore();
  const store: CloudStateStore = {
    async read(scope, noteId) {
      const held = control.readGate;
      control.readGate = null;
      const state = await local.read(scope, noteId);
      if (held) {
        held.entered.resolve();
        if (await held.release.promise)
          throw Error("synthetic private read error");
      }
      return state;
    },
    async commit(...args) {
      const held = control.commitGate;
      control.commitGate = null;
      if (held) {
        held.entered.resolve();
        await held.release.promise;
      }
      control.commits++;
      const saved = await local.commit(...args);
      if (control.lost) {
        control.lost = false;
        throw Error("synthetic lost commit response");
      }
      return saved;
    },
    close: () => local.close(),
  };
  const f = {
    store,
    control,
    service,
    client: new DurableCloudClient(local, cloudScope),
    async open(scope = cloudScope, noteId = id) {
      const session = await CloudDraftSession.open(store, scope, noteId);
      sessions.push(session);
      return session;
    },
    hold(kind: "commitGate" | "readGate") {
      const held = gate();
      gates.push(held);
      control[kind] = held;
      return held;
    },
    async reopen() {
      await local.close();
      local = makeStore();
      f.client = new DurableCloudClient(local, cloudScope);
    },
    async prepare(opId: string) {
      const previous = (await f.client.get(id))!;
      await f.client.prepare(id, previous.generation, opId);
      return {
        version: 1 as const,
        collectionId: cloudScope.collectionId,
        modeGeneration: cloudScope.modeGeneration,
        mutation: await f.client.retry(id),
      };
    },
    async confirm(opId: string) {
      const request = await f.prepare(opId);
      await applyCloudServerReply(
        f.client,
        request,
        await service.mutate(cloudScope.ownerSubject, request),
      );
    },
    async cleanup() {
      control.fail = control.lost = false;
      control.commitGate = control.readGate = null;
      for (const held of gates) held.release.resolve(false);
      await Promise.allSettled(sessions.map((session) => session.flush()));
      await local.close();
      await server.close();
      rmSync(parent, { recursive: true, force: true });
    },
  };
  await server.seedAccount({
    ...cloudScope,
    status: "active",
    entitlement: "active",
    revision: 1,
    sequence: 0,
    wall: 0,
  });
  await f.client.save(id, action("Original fixture"), null);
  return f;
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

it("automatically retains pending text across actual reopen and only observes Saved after a real matching server receipt", async () =>
  fixture(async (f) => {
    await f.confirm("session-initial");
    const session = await f.open();
    expect(session.snapshot().status).toBe("Saved in Cloud");
    session.edit("New pending source 原文");
    expect(session.snapshot()).toMatchObject({
      retained: false,
      status: "Pending upload",
    });
    await session.flush();
    expect((await f.client.get(id))!.pending!.snapshot!.bodyMarkdown).toBe(
      "New pending source 原文",
    );
    expect(session.snapshot()).toMatchObject({
      retained: true,
      status: "Pending upload",
    });
    await f.reopen();
    const reopened = await f.open();
    expect(reopened.snapshot()).toMatchObject({
      bodyMarkdown: "New pending source 原文",
      status: "Pending upload",
      retained: true,
    });
    await f.confirm("session-newer");
    expect((await reopened.refresh()).status).toBe("Saved in Cloud");
    expect(Object.isFrozen(reopened.snapshot())).toBe(true);
  }));

it("Put away waits for the latest held actual commit and freezes later edits", async () =>
  fixture(async (f) => {
    const session = await f.open(),
      held = f.hold("commitGate");
    session.edit("First held draft");
    await held.entered.promise;
    session.edit("Newest held draft");
    const closing = session.putAway();
    expect(session.putAway()).toBe(closing);
    expect(session.snapshot().canEdit).toBe(false);
    expect(() => session.edit("Must not enter the closing draft")).toThrow(
      "closing",
    );
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    // Let the close attempt reach its await without releasing the actual store write.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(session.snapshot().closed).toBe(false);
    expect(settled).toBe(false);
    expect((await f.client.get(id))!.current!.snapshot!.bodyMarkdown).toBe(
      "Original fixture",
    );
    held.release.resolve(false);
    expect(await closing).toMatchObject({
      bodyMarkdown: "Newest held draft",
      closed: true,
      retained: true,
      canEdit: false,
      status: "Pending upload",
    });
    await f.reopen();
    expect((await f.client.get(id))!.pending!.snapshot!.bodyMarkdown).toBe(
      "Newest held draft",
    );
  }));

it("failed retention keeps text/open state and a lost local commit reply reconciles without a duplicate write", async () =>
  fixture(async (f) => {
    const session = await f.open();
    f.control.fail = true;
    session.edit("Recoverable source");
    await expect(session.putAway()).rejects.toThrow("Could not retain draft");
    expect(session.snapshot()).toMatchObject({
      bodyMarkdown: "Recoverable source",
      closed: false,
      retained: false,
      canEdit: true,
      status: "Could not retain draft",
    });
    expect(JSON.stringify(session.snapshot())).not.toContain(
      "synthetic private",
    );
    expect((await f.client.get(id))!.current!.snapshot!.bodyMarkdown).toBe(
      "Original fixture",
    );
    f.control.fail = false;
    f.control.lost = true;
    await expect(session.putAway()).rejects.toThrow("Could not retain draft");
    const commits = f.control.commits;
    expect((await f.client.get(id))!.current!.snapshot!.bodyMarkdown).toBe(
      "Recoverable source",
    );
    expect(await session.putAway()).toMatchObject({
      closed: true,
      retained: true,
      status: "Pending upload",
    });
    expect(f.control.commits).toBe(commits);
  }));

it("later typing survives an older actual receipt and edits preserve both actual conflict branches", async () =>
  fixture(async (f) => {
    await f.confirm("session-base");
    const session = await f.open();
    session.edit("First sent source");
    await session.flush();
    const first = await f.prepare("session-first"),
      reply = await f.service.mutate(cloudScope.ownerSubject, first);
    session.edit("Later typing");
    await session.flush();
    expect(await f.client.retry(id)).toEqual(first.mutation);
    await applyCloudServerReply(f.client, first, reply);
    expect(await session.refresh()).toMatchObject({
      bodyMarkdown: "Later typing",
      status: "Pending upload",
    });
    const mutation = {
      version: 1 as const,
      opId: "session-other-device",
      noteId: id,
      baseRevision: 2,
      kind: "upsert" as const,
      snapshot: cloudDraft("Other device branch"),
    };
    await f.service.mutate(cloudScope.ownerSubject, {
      ...first,
      mutation: { ...mutation, contentHash: await mutationHash(mutation) },
    });
    const pending = await f.prepare("session-conflicting");
    await applyCloudServerReply(
      f.client,
      pending,
      await f.service.mutate(cloudScope.ownerSubject, pending),
    );
    expect((await session.refresh()).status).toBe("Conflict");
    session.edit("Local conflict revision");
    await session.flush();
    const state = (await f.client.get(id))!;
    expect(state.conflict!.local.snapshot!.bodyMarkdown).toBe(
      "Local conflict revision",
    );
    expect(state.conflict!.remote!.bodyMarkdown).toBe("Other device branch");
    expect(session.snapshot().status).toBe("Conflict");
  }));

it("scope capture stays bound and competing editor text is never silently overwritten", async () =>
  fixture(async (f) => {
    const scope = { ...cloudScope },
      session = await f.open(scope);
    scope.ownerSubject = "other-owner";
    scope.modeGeneration = 99;
    session.edit("Bound original account");
    await session.flush();
    const other = await f.open();
    other.edit("Other editor retained");
    await other.flush();
    session.edit("My copyable competing draft");
    await expect(session.putAway()).rejects.toThrow("Could not retain draft");
    expect(session.snapshot()).toMatchObject({
      bodyMarkdown: "My copyable competing draft",
      closed: false,
      retained: false,
    });
    expect((await f.client.get(id))!.current!.snapshot!.bodyMarkdown).toBe(
      "Other editor retained",
    );
    await expect(f.open(scope)).rejects.toThrow("Cloud draft unavailable");
  }));

for (const error of [false, true])
  it(`late refresh ${error ? "failure" : "result"} never replaces newer typing or its successful retention`, async () =>
    fixture(async (f) => {
      await f.confirm("session-refresh-base");
      const session = await f.open(),
        held = f.hold("readGate"),
        refresh = session.refresh();
      await held.entered.promise;
      session.edit("Newer retained text");
      await session.flush();
      held.release.resolve(error);
      expect(await refresh).toMatchObject({
        bodyMarkdown: "Newer retained text",
        status: "Pending upload",
        retained: true,
        error: null,
      });
    }));

it("missing, inactive, purged and malformed initial state refuses without writes", async () =>
  fixture(async (f) => {
    const commits = f.control.commits;
    await expect(f.open(cloudScope, "missing-note")).rejects.toThrow(
      "Cloud draft unavailable",
    );
    for (const state of ["archived", "trashed"] as const) {
      const draft = {
        ...cloudDraft("Inactive fixture"),
        noteId: state,
        state,
        deletedAt: state === "trashed" ? "2026-10-27T03:00:00.000Z" : null,
        purgeAfter: state === "trashed" ? "2026-11-27T03:00:00.000Z" : null,
      };
      await f.client.save(state, { kind: "upsert", snapshot: draft }, null);
      await expect(f.open(cloudScope, state)).rejects.toThrow(
        "Cloud draft unavailable",
      );
    }
    const previous = (await f.client.get(id))!;
    await f.client.save(
      id,
      { kind: "purge", snapshot: null },
      previous.generation,
    );
    await expect(f.open()).rejects.toThrow("Cloud draft unavailable");
    await expect(
      CloudDraftSession.open(
        {
          ...f.store,
          read: async () => ({ ...previous, version: 99 }) as never,
        },
        cloudScope,
        id,
      ),
    ).rejects.toThrow("Cloud draft unavailable");
    expect(f.control.commits).toBe(commits);
  }));

it("a generation race cannot close on a failed CAS and retry uses the actual newer confirmed base", async () =>
  fixture(async (f) => {
    await f.confirm("session-cas-initial");
    const session = await f.open(),
      held = f.hold("commitGate");
    session.edit("Pending across acknowledgement race");
    await held.entered.promise;
    const previous = (await f.client.get(id))!;
    await f.client.save(id, action("Original fixture"), previous.generation);
    await f.confirm("session-cas-new-base");
    const closing = session.putAway();
    held.release.resolve(false);
    await expect(closing).rejects.toThrow("Could not retain draft");
    expect(session.snapshot()).toMatchObject({
      bodyMarkdown: "Pending across acknowledgement race",
      closed: false,
      retained: false,
    });
    expect((await f.client.get(id))!.baseRevision).toBe(2);
    expect(await session.putAway()).toMatchObject({
      closed: true,
      retained: true,
      status: "Pending upload",
    });
    const retained = (await f.client.get(id))!;
    expect(retained.baseRevision).toBe(2);
    expect(retained.pending!.snapshot!.bodyMarkdown).toBe(
      "Pending across acknowledgement race",
    );
  }));

it("a late refresh error cannot replace a newer successful refresh without typing", async () =>
  fixture(async (f) => {
    const session = await f.open(),
      held = f.hold("readGate"),
      older = session.refresh();
    await held.entered.promise;
    await f.confirm("session-refresh-confirmed");
    expect((await session.refresh()).status).toBe("Saved in Cloud");
    held.release.resolve(true);
    expect(await older).toMatchObject({
      status: "Saved in Cloud",
      retained: true,
      error: null,
    });
  }));
