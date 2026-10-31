import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import {
  CloudConflictNewNoteRecovery,
  type CloudConflictNewNoteResult,
} from "../../apps/web/src/cloud-conflict-new-note";
import {
  CloudConflictResolutionError,
  type CloudConflictResolutionGate,
} from "../../apps/web/src/cloud-conflict-resolution";
import { CloudLibraryOwners } from "../../apps/web/src/cloud-library-owners";
import { projectCloudCachedNote } from "../../apps/web/src/cloud-note-cache";
import type { CloudMutationSender } from "../../apps/web/src/cloud-note-upload";
import { applyCloudServerReply } from "../../packages/cloud-protocol/src/client-response";
import {
  CloudLocalGenerationChangedError,
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
  type CloudAction,
} from "../../packages/cloud-protocol/src/index";
import type { CloudLibraryStateStore } from "../../packages/cloud-protocol/src/library-local";
import {
  CloudMutationService,
  type CloudMutationRequest,
} from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { cloudDraft, cloudScope } from "../fixtures/cloud-durable-contract";

const noteId = "purged-conflict-source";

type ReadHook = (targetId: string, count: number) => Promise<void> | void;
type AfterReadHook = (targetId: string, count: number) => void;
type ReadPredicate = (targetId: string, count: number) => boolean;
type CommitHook = (
  targetId: string,
  expectedGeneration: number | null,
) => Promise<void> | void;
type RawStateRow = { generation: number; state: string; raw: Uint8Array };

function action(
  bodyMarkdown: string,
  targetNoteId = noteId,
  lifecycle: "active" | "archived" | "trashed" = "active",
): CloudAction {
  const trashed = lifecycle === "trashed";
  const deletedAt = trashed ? "2026-10-15T10:00:00.000Z" : null;
  const purgeAfter = trashed ? "2026-11-14T10:00:00.000Z" : null;
  return {
    kind: "upsert",
    snapshot: {
      ...cloudDraft(bodyMarkdown),
      noteId: targetNoteId,
      state: lifecycle,
      deletedAt,
      purgeAfter,
    },
  };
}

const openGate: CloudConflictResolutionGate = async (_id, run) => {
  return run(Object.freeze({ retire: () => {}, changed: () => {} }));
};

async function fixture(
  run: (f: Awaited<ReturnType<typeof create>>) => Promise<void>,
): Promise<void> {
  const f = await create();
  try {
    await run(f);
  } finally {
    await f.cleanup();
  }
}

async function create() {
  const folder = mkdtempSync(join(tmpdir(), "synkies-conflict-new-note-"));
  const path = join(folder, "cache.sqlite3");
  const serverPath = join(folder, "server.sqlite3");
  const server = new SQLiteCloudServerStore(serverPath);
  const service = new CloudMutationService(server);
  const controller = new AbortController();
  const requests: CloudMutationRequest[] = [];
  const tasks: Promise<unknown>[] = [];
  const releases: (() => void)[] = [];
  const readCounts = new Map<string, number>();
  let local = new SQLiteCloudStateStore(path);

  const control = {
    reads: 0,
    commits: 0,
    closes: 0,
    readIds: [] as string[],
    commitRecords: [] as {
      scope: CloudScope;
      noteId: string;
      expectedGeneration: number | null;
    }[],
    onRead: null as ReadHook | null,
    afterRead: null as AfterReadHook | null,
    onCommit: null as CommitHook | null,
    failReadFor: null as ReadPredicate | null,
    failCommit: false,
    lostCommit: false,
  };

  const store: CloudLibraryStateStore = {
    read: async (scope, targetId) => {
      control.reads++;
      control.readIds.push(targetId);
      const count = (readCounts.get(targetId) ?? 0) + 1;
      readCounts.set(targetId, count);
      const result = await local.read(scope, targetId);
      if (control.onRead) {
        await control.onRead(targetId, count);
      }
      if (control.failReadFor?.(targetId, count)) {
        throw Error("private read detail");
      }
      control.afterRead?.(targetId, count);
      return result;
    },
    commit: async (scope, targetId, expectedGeneration, next) => {
      control.commits++;
      control.commitRecords.push({
        scope: structuredClone(scope),
        noteId: targetId,
        expectedGeneration,
      });
      if (control.onCommit) {
        await control.onCommit(targetId, expectedGeneration);
      }
      if (control.failCommit) {
        throw Error("private commit detail");
      }
      const committed = await local.commit(
        scope,
        targetId,
        expectedGeneration,
        next,
      );
      if (control.lostCommit) {
        control.lostCommit = false;
        throw Error("private committed acknowledgement");
      }
      return committed;
    },
    listLibrary: (scope, request) => local.listLibrary(scope, request),
    close: async () => {
      control.closes++;
      await local.close();
    },
  };

  try {
    await server.seedAccount({
      ...cloudScope,
      status: "active",
      entitlement: "active",
      revision: 1,
      sequence: 0,
      wall: 0,
    });

    const handler = createCloudMutationHandler(service, async () => {
      return cloudScope.ownerSubject;
    });

    const sendImpl: CloudMutationSender = async (request, signal) => {
      requests.push(structuredClone(request));
      const reply = await handler(
        new Request("https://new-note-recovery.synthetic/v1/mutations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal,
        }),
      );
      return { status: reply.status, body: await reply.json() };
    };
    const send = vi.fn(sendImpl);

    const seedPurgedConflict = async (
      targetNoteId: string,
      localAction: CloudAction,
    ) => {
      const initialRemote = await startCloudMutation(
        saveCloudDraft(
          createCloudClient(cloudScope.collectionId, targetNoteId),
          action("Initial server note", targetNoteId),
        ),
        crypto.randomUUID(),
      );
      const firstReply = await service.mutate(cloudScope.ownerSubject, {
        version: 1,
        collectionId: cloudScope.collectionId,
        modeGeneration: cloudScope.modeGeneration,
        mutation: initialRemote.inFlight!,
      });
      if (
        firstReply.receipt.outcome !== "applied" ||
        firstReply.head.kind !== "note"
      ) {
        throw Error("Expected initial remote note commit");
      }
      const purgeRemote = await startCloudMutation(
        saveCloudDraft(
          createCloudClient(
            cloudScope.collectionId,
            targetNoteId,
            firstReply.head.snapshot,
          ),
          { kind: "purge", snapshot: null },
        ),
        crypto.randomUUID(),
      );
      await service.mutate(cloudScope.ownerSubject, {
        version: 1,
        collectionId: cloudScope.collectionId,
        modeGeneration: cloudScope.modeGeneration,
        mutation: purgeRemote.inFlight!,
      });

      const directClient = new DurableCloudClient(local, cloudScope);
      const savedLocal = await directClient.save(
        targetNoteId,
        localAction,
        null,
      );
      const preparedLocal = await directClient.prepare(
        targetNoteId,
        savedLocal.generation,
        crypto.randomUUID(),
      );
      const conflictRequest: CloudMutationRequest = {
        version: 1,
        collectionId: cloudScope.collectionId,
        modeGeneration: cloudScope.modeGeneration,
        mutation: preparedLocal.inFlight!,
      };
      await applyCloudServerReply(
        directClient,
        conflictRequest,
        await service.mutate(cloudScope.ownerSubject, conflictRequest),
      );
    };

    await seedPurgedConflict(noteId, action("Device branch"));

    const context = { store, scope: { ...cloudScope } };
    const owners = new CloudLibraryOwners(context, send, controller.signal);
    const conflicts = owners.conflicts();
    const client = new DurableCloudClient(local, cloudScope);

    return {
      folder,
      path,
      store,
      server,
      service,
      controller,
      control,
      send,
      requests,
      context,
      owners,
      conflicts,
      client,
      seedPurgedConflict,
      rawRow(targetId: string) {
        const db = new DatabaseSync(path);
        try {
          const sql =
            "SELECT generation, state, CAST(state AS BLOB) AS raw " +
            "FROM m0_cloud_states WHERE note_id = ?";
          const row = db.prepare(sql).get(targetId) as RawStateRow | undefined;
          if (!row) {
            return null;
          }
          return {
            generation: Number(row.generation),
            state: String(row.state),
            bytes: Buffer.from(row.raw),
          };
        } finally {
          db.close();
        }
      },
      async closeOwner(
        upload: Awaited<ReturnType<CloudLibraryOwners["open"]>>,
      ) {
        await upload.session.putAway();
        owners.putAway({
          context: owners.context,
          upload,
          session: upload.session,
        });
      },
      async reopenOwners() {
        await local.close();
        local = new SQLiteCloudStateStore(path);
        return new CloudLibraryOwners(
          { store, scope: { ...cloudScope } },
          send,
          controller.signal,
        );
      },
      track<T>(task: Promise<T>): Promise<T> {
        tasks.push(task);
        void task.catch(() => {});
        return task;
      },
      hold() {
        let enter!: () => void;
        let release!: () => void;
        const entered = new Promise<void>((resolve) => {
          enter = resolve;
        });
        const waiting = new Promise<void>((resolve) => {
          release = resolve;
        });
        releases.push(release);
        return {
          entered,
          release,
          wait: async () => {
            enter();
            await waiting;
          },
        };
      },
      async cleanup() {
        controller.abort();
        for (const release of releases) {
          release();
        }
        await Promise.allSettled(tasks);
        await Promise.allSettled(
          owners.retainedOwners().map((upload) => upload.upload()),
        );
        await local.close();
        await server.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    controller.abort();
    await local.close();
    await server.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

function expectRetained(
  result: CloudConflictNewNoteResult,
): asserts result is Readonly<{ kind: "retained"; newNoteId: string }> {
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.keys(result)).toEqual(["kind", "newNoteId"]);
  expect(result.kind).toBe("retained");
  expect(typeof result.newNoteId).toBe("string");
}

it("caches owners.newNoteRecovery() lazily with zero storage, network or close calls", async () =>
  fixture(async (f) => {
    const before = [f.control.reads, f.control.commits, f.control.closes];
    const first = f.owners.newNoteRecovery();
    const second = f.owners.newNoteRecovery();
    expect(first).toBeInstanceOf(CloudConflictNewNoteRecovery);
    expect(second).toBe(first);
    expect(first.signal).toBe(f.controller.signal);
    expect([f.control.reads, f.control.commits, f.control.closes]).toEqual(
      before,
    );
    expect(f.send).not.toHaveBeenCalled();
  }));

it.each([
  {
    label: "nonempty Markdown",
    body: "# Launch Café 原文\n- [x] Recover ##work",
    lifecycle: "active" as const,
    withOrigin: false,
  },
  {
    label: "empty string",
    body: "",
    lifecycle: "active" as const,
    withOrigin: false,
  },
  {
    label: "archived source",
    body: "Archived draft text ##archive",
    lifecycle: "archived" as const,
    withOrigin: true,
  },
  {
    label: "trashed source",
    body: "Trashed draft text before remote purge",
    lifecycle: "trashed" as const,
    withOrigin: true,
  },
])(
  "retains a fresh Active Pending copy for $label while preserving original source bytes",
  async ({ body, lifecycle, withOrigin }) =>
    fixture(async (f) => {
      const targetId = "source-variant";
      const baseAction = action(body, targetId, lifecycle);
      if (baseAction.kind !== "upsert") {
        throw Error("Expected upsert fixture action");
      }
      const seededAction: CloudAction = withOrigin
        ? {
            kind: "upsert",
            snapshot: {
              ...baseAction.snapshot,
              origin: {
                collectionId: "prior-local-library",
                noteId: "prior-local-note",
                moveId: "move-transition-1",
              },
            },
          }
        : baseAction;
      await f.seedPurgedConflict(targetId, seededAction);

      const view = await f.conflicts.read(targetId);
      expect(view.status).toBe("Conflict");
      expect(view.conflict?.remote).toBeNull();
      expect(view.conflict?.remoteRevision).toBeGreaterThanOrEqual(1);

      const sourceBefore = f.rawRow(targetId);
      expect(sourceBefore).not.toBeNull();
      const refreshBefore = f.owners.snapshot().refreshKey;
      const startedAt = Date.now();

      const recovery = f.owners.newNoteRecovery();
      const result = await recovery.prepare(targetId, view.generation!);
      const finishedAt = Date.now();

      expectRetained(result);
      expect(result.newNoteId).not.toBe(targetId);
      expect(f.owners.snapshot().refreshKey).toBeGreaterThan(refreshBefore);
      expect(f.owners.retainedOwners()).toEqual([]);
      expect(f.send).not.toHaveBeenCalled();
      expect(f.requests).toHaveLength(0);
      expect(f.control.closes).toBe(0);

      const sourceAfter = f.rawRow(targetId);
      expect(sourceAfter?.generation).toBe(sourceBefore!.generation);
      expect(Buffer.compare(sourceAfter!.bytes, sourceBefore!.bytes)).toBe(0);
      expect(
        f.control.commitRecords.filter((record) => record.noteId === targetId),
      ).toEqual([]);

      const retained = await f.client.get(result.newNoteId);
      expect(retained).not.toBeNull();
      expect(retained!.version).toBe(2);
      expect(retained!.collectionId).toBe(cloudScope.collectionId);
      expect(retained!.noteId).toBe(result.newNoteId);
      expect(retained!.generation).toBe(1);
      expect(retained!.baseRevision).toBe(0);
      expect(retained!.base).toBeNull();
      expect(retained!.inFlight).toBeNull();
      expect(retained!.observed).toBeNull();
      expect(retained!.conflict).toBeNull();
      expect(retained!.current).toEqual(retained!.pending);
      expect(retained!.current?.kind).toBe("upsert");

      const draft = retained!.current!.snapshot!;
      expect(draft.schemaVersion).toBe(1);
      expect(draft.collectionId).toBe(cloudScope.collectionId);
      expect(draft.noteId).toBe(result.newNoteId);
      expect(draft.bodyMarkdown).toBe(body);
      expect(draft.state).toBe("active");
      expect(draft.deletedAt).toBeNull();
      expect(draft.purgeAfter).toBeNull();
      expect("origin" in draft).toBe(false);
      expect("serverRevision" in draft).toBe(false);
      expect(draft.createdAt).toBe(draft.updatedAt);
      expect(Date.parse(draft.createdAt)).toBeGreaterThanOrEqual(startedAt);
      expect(Date.parse(draft.createdAt)).toBeLessThanOrEqual(finishedAt);

      const projected = projectCloudCachedNote(
        cloudScope,
        result.newNoteId,
        retained,
      );
      expect(projected.status).toBe("Pending upload");
      expect(projected.bodyMarkdown).toBe(body);

      const notesPage = await f.store.listLibrary(cloudScope, {
        collection: "notes",
        limit: 32,
        cursor: null,
      });
      const catalogEntry = notesPage.entries.find(
        (entry) => entry.noteId === result.newNoteId,
      );
      expect(catalogEntry).toMatchObject({
        noteId: result.newNoteId,
        kind: "active",
        status: "Pending upload",
      });

      const attentionPage = await f.store.listLibrary(cloudScope, {
        collection: "attention",
        limit: 32,
        cursor: null,
      });
      expect(
        attentionPage.entries.some((entry) => entry.noteId === targetId),
      ).toBe(true);
    }),
);

it("preserves an explicitly recovered empty draft across open, putAway and later upload without reviving the purged ID", async () =>
  fixture(async (f) => {
    const emptySourceId = "empty-purged-source";
    await f.seedPurgedConflict(emptySourceId, action("", emptySourceId));
    const view = await f.conflicts.read(emptySourceId);

    const recovery = f.owners.newNoteRecovery();
    const prepared = await recovery.prepare(emptySourceId, view.generation!);
    expectRetained(prepared);

    const opened = await f.owners.open({
      ...f.owners.context,
      noteId: prepared.newNoteId,
    });
    expect(opened.session.snapshot()).toMatchObject({
      noteId: prepared.newNoteId,
      bodyMarkdown: "",
      status: "Pending upload",
      retained: true,
    });
    await f.closeOwner(opened);
    await Promise.resolve();
    expect(f.owners.retainedOwners()).toContain(opened);
    expect((await f.client.get(prepared.newNoteId))?.pending).not.toBeNull();
    expect(f.send).not.toHaveBeenCalled();

    await opened.upload();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].mutation.noteId).toBe(prepared.newNoteId);
    expect(f.requests[0].mutation.baseRevision).toBe(0);
    expect(f.requests[0].mutation.snapshot?.bodyMarkdown).toBe("");

    const newHead = await f.service.get(
      cloudScope.ownerSubject,
      cloudScope,
      prepared.newNoteId,
    );
    expect(newHead.kind).toBe("note");
    const oldHead = await f.service.get(
      cloudScope.ownerSubject,
      cloudScope,
      emptySourceId,
    );
    expect(oldHead.kind).toBe("purged");

    // Original conflict remains until separate explicit acceptance of the observed purge.
    expect((await f.conflicts.read(emptySourceId)).status).toBe("Conflict");
    const discarded = await f.conflicts.resolve(
      emptySourceId,
      view.generation!,
      { kind: "cloud" },
    );
    expect(discarded.kind).toBe("complete");
    expect(discarded.view?.status).toBe("Deleted in Cloud");
  }));

it("does not run automatically on reopen and keeps prior retained copies in the account library", async () =>
  fixture(async (f) => {
    const view = await f.conflicts.read(noteId);
    const recovery = f.owners.newNoteRecovery();
    const first = await recovery.prepare(noteId, view.generation!);
    expectRetained(first);

    const countsBeforeReopen = [f.control.reads, f.control.commits];
    const reopened = await f.reopenOwners();
    const reopenedRecovery = reopened.newNoteRecovery();
    expect([f.control.reads, f.control.commits]).toEqual(countsBeforeReopen);

    const second = await reopenedRecovery.prepare(noteId, view.generation!);
    expectRetained(second);
    expect(second.newNoteId).not.toBe(first.newNoteId);

    const notesPage = await f.store.listLibrary(cloudScope, {
      collection: "notes",
      limit: 32,
      cursor: null,
    });
    const noteIds = notesPage.entries.map((entry) => entry.noteId);
    expect(noteIds).toContain(first.newNoteId);
    expect(noteIds).toContain(second.newNoteId);
    expect(f.send).not.toHaveBeenCalled();
  }));

it("refuses missing, non-conflict, non-purged, local-purge, stale and malformed inputs without writing", async () =>
  fixture(async (f) => {
    const recovery = f.owners.newNoteRecovery();
    const view = await f.conflicts.read(noteId);

    const beforeMalformed = [f.control.reads, f.control.commits];
    for (const badId of ["", "bad/id", "line\nid", 123 as unknown as string]) {
      const result = await recovery.prepare(badId, view.generation!);
      expect(result).toEqual({ kind: "unavailable", newNoteId: null });
      expect(Object.isFrozen(result)).toBe(true);
    }
    for (const badGen of [0, -1, 1.5, Number.NaN, undefined, null]) {
      const result = await recovery.prepare(noteId, badGen as number);
      expect(result).toEqual({ kind: "unavailable", newNoteId: null });
      expect(Object.isFrozen(result)).toBe(true);
    }
    expect([f.control.reads, f.control.commits]).toEqual(beforeMalformed);

    // Missing source note -> not-recoverable.
    const commitsBefore = f.control.commits;
    expect(await recovery.prepare("missing-source", 1)).toEqual({
      kind: "not-recoverable",
      newNoteId: null,
    });

    // Stale generations -> stale.
    expect(await recovery.prepare(noteId, view.generation! - 1)).toEqual({
      kind: "stale",
      newNoteId: null,
    });
    expect(await recovery.prepare(noteId, view.generation! + 1)).toEqual({
      kind: "stale",
      newNoteId: null,
    });
    expect(f.control.commits).toBe(commitsBefore);

    // Non-conflict pending draft -> not-recoverable, preserving its queued closed owner.
    const pendingSaved = await f.client.save(
      "plain-pending",
      action("Queued plain draft", "plain-pending"),
      null,
    );
    const pendingOwner = await f.owners.open({
      ...f.owners.context,
      noteId: "plain-pending",
    });
    await f.closeOwner(pendingOwner);
    const beforePlain = f.control.commits;
    const plainOutcome = await recovery.prepare(
      "plain-pending",
      pendingSaved.generation,
    );
    expect(plainOutcome).toEqual({ kind: "not-recoverable", newNoteId: null });
    expect(f.control.commits).toBe(beforePlain);
    expect(f.owners.retainedOwners()).toContain(pendingOwner);
    expect(pendingOwner.resolutionReady()).toBe(true);

    // Non-purged remote conflict (remote snapshot exists) -> not-recoverable.
    for (const remoteLifecycle of ["active", "archived", "trashed"] as const) {
      const activeId = `non-purged-${remoteLifecycle}`;
      const remoteInit = await startCloudMutation(
        saveCloudDraft(
          createCloudClient(cloudScope.collectionId, activeId),
          action("Remote alive", activeId, remoteLifecycle),
        ),
        crypto.randomUUID(),
      );
      await f.service.mutate(cloudScope.ownerSubject, {
        version: 1,
        collectionId: cloudScope.collectionId,
        modeGeneration: cloudScope.modeGeneration,
        mutation: remoteInit.inFlight!,
      });
      const localDraft = await f.client.save(
        activeId,
        action("Local draft", activeId),
        null,
      );
      const localPrep = await f.client.prepare(
        activeId,
        localDraft.generation,
        crypto.randomUUID(),
      );
      const req: CloudMutationRequest = {
        version: 1,
        collectionId: cloudScope.collectionId,
        modeGeneration: cloudScope.modeGeneration,
        mutation: localPrep.inFlight!,
      };
      const conflicted = await applyCloudServerReply(
        f.client,
        req,
        await f.service.mutate(cloudScope.ownerSubject, req),
      );
      if (conflicted.kind === "reconcile-required") {
        throw Error("Expected retained conflict state");
      }
      const beforeNonPurged = f.control.commits;
      const nonPurgedOutcome = await recovery.prepare(
        activeId,
        conflicted.state.generation,
      );
      expect(nonPurgedOutcome).toEqual({
        kind: "not-recoverable",
        newNoteId: null,
      });
      expect(f.control.commits).toBe(beforeNonPurged);
    }

    // Local-purge conflict against observed remote purge -> not-recoverable.
    const localPurgeSource = await f.client.save(
      noteId,
      { kind: "purge", snapshot: null },
      view.generation!,
    );
    const beforePurge = f.control.commits;
    const purgeOutcome = await recovery.prepare(
      noteId,
      localPurgeSource.generation,
    );
    expect(purgeOutcome).toEqual({ kind: "not-recoverable", newNoteId: null });
    expect(f.control.commits).toBe(beforePurge);

    // Stale generation after conflict was resolved -> stale; current resolved gen -> not-recoverable.
    const accepted = await f.conflicts.resolve(
      noteId,
      localPurgeSource.generation,
      { kind: "cloud" },
    );
    expect(accepted.kind).toBe("complete");
    const beforeResolved = f.control.commits;
    const staleAfterResolve = await recovery.prepare(
      noteId,
      localPurgeSource.generation,
    );
    expect(staleAfterResolve).toEqual({ kind: "stale", newNoteId: null });
    const resolvedOutcome = await recovery.prepare(
      noteId,
      accepted.view!.generation!,
    );
    expect(resolvedOutcome).toEqual({
      kind: "not-recoverable",
      newNoteId: null,
    });
    expect(f.control.commits).toBe(beforeResolved);

    // Only the plain-pending setup, three non-purged setups, local-purge save, and cloud resolve wrote.
    const unexpectedNewNotes = await f.store.listLibrary(cloudScope, {
      collection: "notes",
      limit: 32,
      cursor: null,
    });
    expect(unexpectedNewNotes.entries.map((e) => e.noteId)).toEqual([
      "non-purged-active",
      "non-purged-archived",
      "plain-pending",
    ]);
    expect(f.send).not.toHaveBeenCalled();
  }));

it("refuses open, retention-errored, opening and uploading owners as busy without writing", async () =>
  fixture(async (f) => {
    const recovery = f.owners.newNoteRecovery();

    // 1. Open active editor (including failed retention) -> busy.
    const openUpload = await f.owners.open({ ...f.owners.context, noteId });
    f.control.failCommit = true;
    openUpload.session.edit("Unretained copyable text");
    await expect(openUpload.session.flush()).rejects.toThrow();
    f.control.failCommit = false;

    const currentView = await f.conflicts.read(noteId);
    const commitsWhileErrored = f.control.commits;
    expect(await recovery.prepare(noteId, currentView.generation!)).toEqual({
      kind: "busy",
      newNoteId: null,
    });
    expect(f.control.commits).toBe(commitsWhileErrored);
    expect(openUpload.session.snapshot().bodyMarkdown).toBe(
      "Unretained copyable text",
    );

    await openUpload.session.flush();
    const flushedView = await f.conflicts.read(noteId);
    const commitsWhileOpen = f.control.commits;
    expect(await recovery.prepare(noteId, flushedView.generation!)).toEqual({
      kind: "busy",
      newNoteId: null,
    });
    expect(f.control.commits).toBe(commitsWhileOpen);

    // 2. Closed owner with an active held upload task -> busy.
    await f.closeOwner(openUpload);
    const uploadHold = f.hold();
    f.control.onRead = async (targetId) => {
      if (targetId === noteId) {
        f.control.onRead = null;
        await uploadHold.wait();
      }
    };
    const uploading = f.track(openUpload.upload());
    await Promise.race([
      uploadHold.entered,
      uploading.then(() => {
        throw Error("Expected held owner upload");
      }),
    ]);
    const commitsWhileUploading = f.control.commits;
    expect(await recovery.prepare(noteId, flushedView.generation!)).toEqual({
      kind: "busy",
      newNoteId: null,
    });
    expect(f.control.commits).toBe(commitsWhileUploading);
    expect(f.owners.retainedOwners()).toContain(openUpload);
    uploadHold.release();
    await uploading;

    // 3. Another note whose owner is currently opening -> busy.
    const secondId = "opening-purged-note";
    await f.seedPurgedConflict(secondId, action("Opening branch", secondId));
    const secondView = await f.conflicts.read(secondId);
    const openHold = f.hold();
    f.control.onRead = async (targetId) => {
      if (targetId === secondId) {
        f.control.onRead = null;
        await openHold.wait();
      }
    };
    const opening = f.track(
      f.owners.open({ ...f.owners.context, noteId: secondId }),
    );
    await Promise.race([
      openHold.entered,
      opening.then(() => {
        throw Error("Expected held owner open");
      }),
    ]);
    const commitsWhileOpening = f.control.commits;
    expect(await recovery.prepare(secondId, secondView.generation!)).toEqual({
      kind: "busy",
      newNoteId: null,
    });
    expect(f.control.commits).toBe(commitsWhileOpening);
    openHold.release();
    await opening;
  }));

it("retires a closed settled owner, cancels its queued timer and rechecks quiescence after source read", async () =>
  fixture(async (f) => {
    const recovery = f.owners.newNoteRecovery();
    const upload = await f.owners.open({ ...f.owners.context, noteId });
    await f.closeOwner(upload);

    // Part 1: If the closed owner starts work while prepare's initial source read is held, retire refuses busy.
    const view = await f.conflicts.read(noteId);
    const sourceReadHold = f.hold();
    const ownerWorkHold = f.hold();
    f.control.onRead = async (targetId) => {
      if (targetId === noteId) {
        f.control.onRead = null;
        await sourceReadHold.wait();
      }
    };
    const racedPrepare = f.track(recovery.prepare(noteId, view.generation!));
    await Promise.race([
      sourceReadHold.entered,
      racedPrepare.then(() => {
        throw Error("Expected held source validation read");
      }),
    ]);

    f.control.onRead = async (targetId) => {
      if (targetId === noteId) {
        f.control.onRead = null;
        await ownerWorkHold.wait();
      }
    };
    const ownerTask = f.track(upload.upload());
    await Promise.race([
      ownerWorkHold.entered,
      ownerTask.then(() => {
        throw Error("Expected held owner upload read");
      }),
    ]);
    const commitsBefore = f.control.commits;
    sourceReadHold.release();
    expect(await racedPrepare).toEqual({ kind: "busy", newNoteId: null });
    expect(f.control.commits).toBe(commitsBefore);
    expect(f.owners.retainedOwners()).toContain(upload);
    ownerWorkHold.release();
    expect((await ownerTask).kind).toBe("conflict");

    // Reopen and close cleanly so upload status returns to a fresh scheduled timer test on another purged note.
    const timerNoteId = "timer-purged-source";
    await f.seedPurgedConflict(
      timerNoteId,
      action("Timer retirement body", timerNoteId),
    );
    const timerUpload = await f.owners.open({
      ...f.owners.context,
      noteId: timerNoteId,
    });
    await f.closeOwner(timerUpload);
    const timerView = await f.conflicts.read(timerNoteId);

    vi.useFakeTimers();
    try {
      const spy = vi.spyOn(timerUpload, "upload");
      timerUpload.schedule();
      const destHold = f.hold();
      f.control.onCommit = async (targetId) => {
        if (targetId !== timerNoteId) {
          f.control.onCommit = null;
          await destHold.wait();
        }
      };
      const preparing = f.track(
        recovery.prepare(timerNoteId, timerView.generation!),
      );
      await Promise.race([
        destHold.entered,
        preparing.then(() => {
          throw Error("Expected held destination commit");
        }),
      ]);
      expect(timerUpload.resolutionReady()).toBe(false);
      expect(f.owners.retainedOwners()).not.toContain(timerUpload);
      await vi.advanceTimersByTimeAsync(250);
      expect(spy).not.toHaveBeenCalled();
      destHold.release();
      const retained = await preparing;
      expectRetained(retained);
    } finally {
      vi.useRealTimers();
    }
    expect(f.send).not.toHaveBeenCalled();
  }));

it("shares the per-note gate with conflicts()/open() and rejects duplicate concurrent calls", async () =>
  fixture(async (f) => {
    const recovery = f.owners.newNoteRecovery();
    const otherId = "independent-purged-note";
    await f.seedPurgedConflict(otherId, action("Independent text", otherId));

    const view = await f.conflicts.read(noteId);
    const otherView = await f.conflicts.read(otherId);
    const holdSource = f.hold();
    f.control.onRead = async (targetId) => {
      if (targetId === noteId) {
        f.control.onRead = null;
        await holdSource.wait();
      }
    };

    const primary = f.track(recovery.prepare(noteId, view.generation!));
    await Promise.race([
      holdSource.entered,
      primary.then(() => {
        throw Error("Expected held prepare");
      }),
    ]);

    // Same-note open, conflicts().resolve, and duplicate prepare are all blocked while gate is held.
    await expect(
      f.owners.open({ ...f.owners.context, noteId }),
    ).rejects.toThrow("Could not open");
    expect(
      (await f.conflicts.resolve(noteId, view.generation!, { kind: "cloud" }))
        .kind,
    ).toBe("busy");
    expect(await recovery.prepare(noteId, view.generation!)).toEqual({
      kind: "busy",
      newNoteId: null,
    });

    // Competing notes remain completely independent.
    const independent = await recovery.prepare(otherId, otherView.generation!);
    expectRetained(independent);
    const created = f.owners.create(f.owners.context);
    expect(created.session.snapshot().noteId).not.toBe(noteId);

    holdSource.release();
    const completed = await primary;
    expectRetained(completed);
    expect(completed.newNoteId).not.toBe(independent.newNoteId);

    // Direct model instance also guards overlapping duplicate calls even with an open gate double.
    let allocations = 0;
    const direct = new CloudConflictNewNoteRecovery(
      f.owners.context,
      f.controller.signal,
      openGate,
      () => `direct-allocated-${++allocations}`,
    );
    const pair = await Promise.all([
      direct.prepare(noteId, view.generation!),
      direct.prepare(noteId, view.generation!),
    ]);
    expect(pair.map((item) => item.kind).sort()).toEqual(["busy", "retained"]);
    expect(allocations).toBe(1);
  }));

it("reuses the same allocated ID after pre-commit read or commit failure", async () =>
  fixture(async (f) => {
    const recovery = f.owners.newNoteRecovery();
    const view = await f.conflicts.read(noteId);

    // 1. Pre-commit destination read failure -> unavailable, then same-ID retry succeeds.
    f.control.failReadFor = (targetId) => targetId !== noteId;
    const readFailed = await recovery.prepare(noteId, view.generation!);
    expect(readFailed).toEqual({ kind: "unavailable", newNoteId: null });
    expect(JSON.stringify(readFailed)).not.toContain("private");
    const attemptedFromRead = f.control.readIds.find((id) => id !== noteId);
    expect(attemptedFromRead).toBeDefined();
    expect(await f.client.get(attemptedFromRead!)).toBeNull();

    f.control.failReadFor = null;
    const afterReadFail = await recovery.prepare(noteId, view.generation!);
    expect(afterReadFail).toEqual({
      kind: "retained",
      newNoteId: attemptedFromRead!,
    });

    // 2. Pre-commit destination commit failure -> unavailable, then same-ID retry succeeds.
    const secondSource = "precommit-fail-source";
    await f.seedPurgedConflict(
      secondSource,
      action("Pre-commit retry text", secondSource),
    );
    const secondView = await f.conflicts.read(secondSource);
    const knownDestIds = new Set(
      f.control.readIds.filter((id) => id !== noteId && id !== secondSource),
    );

    f.control.failCommit = true;
    const commitFailed = await recovery.prepare(
      secondSource,
      secondView.generation!,
    );
    expect(commitFailed).toEqual({ kind: "unavailable", newNoteId: null });
    expect(JSON.stringify(commitFailed)).not.toContain("private");
    const attemptedFromCommit = f.control.readIds.find(
      (id) => id !== noteId && id !== secondSource && !knownDestIds.has(id),
    );
    expect(attemptedFromCommit).toBeDefined();
    expect(await f.client.get(attemptedFromCommit!)).toBeNull();

    f.control.failCommit = false;
    const recoveredAfterCommit = await recovery.prepare(
      secondSource,
      secondView.generation!,
    );
    expect(recoveredAfterCommit).toEqual({
      kind: "retained",
      newNoteId: attemptedFromCommit!,
    });
    expect(
      (await f.client.get(attemptedFromCommit!))?.current?.snapshot
        ?.bodyMarkdown,
    ).toBe("Pre-commit retry text");
  }));

it("verifies and reuses a matching retained row after post-commit uncertainty without rewriting", async () =>
  fixture(async (f) => {
    const recovery = f.owners.newNoteRecovery();
    const view = await f.conflicts.read(noteId);

    f.control.lostCommit = true;
    const uncertain = await recovery.prepare(noteId, view.generation!);
    expect(uncertain).toEqual({ kind: "unavailable", newNoteId: null });
    expect(JSON.stringify(uncertain)).not.toContain("private");

    const allocatedId = f.control.commitRecords.at(-1)?.noteId;
    expect(allocatedId).toBeDefined();
    expect(allocatedId).not.toBe(noteId);
    const committedBeforeRetry = f.rawRow(allocatedId!);
    expect(committedBeforeRetry).not.toBeNull();

    const commitsAfterFirst = f.control.commits;
    const refreshBeforeRetry = f.owners.snapshot().refreshKey;

    const retried = await recovery.prepare(noteId, view.generation!);
    expect(retried).toEqual({ kind: "retained", newNoteId: allocatedId! });
    expect(f.control.commits).toBe(commitsAfterFirst);
    expect(f.owners.snapshot().refreshKey).toBeGreaterThan(refreshBeforeRetry);
    expect(
      Buffer.compare(
        f.rawRow(allocatedId!)!.bytes,
        committedBeforeRetry!.bytes,
      ),
    ).toBe(0);
  }));

it("never overwrites a later destination edit or silently rotates an uncertain ID", async () =>
  fixture(async (f) => {
    const recovery = f.owners.newNoteRecovery();
    const view = await f.conflicts.read(noteId);

    f.control.lostCommit = true;
    const uncertain = await recovery.prepare(noteId, view.generation!);
    expect(uncertain).toEqual({ kind: "unavailable", newNoteId: null });
    const uncertainId = f.control.commitRecords.at(-1)!.noteId;

    // User edits the retained new note before retrying recovery on the original conflict.
    const editor = await f.owners.open({
      ...f.owners.context,
      noteId: uncertainId,
    });
    editor.session.edit("Device branch plus later user edits");
    await editor.session.flush();
    await f.closeOwner(editor);

    const editedRow = f.rawRow(uncertainId);
    expect(editedRow?.generation).toBe(2);
    const commitsBeforeRetry = f.control.commits;

    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await recovery.prepare(noteId, view.generation!);
      expect(outcome).toEqual({ kind: "unavailable", newNoteId: null });
    }

    expect(f.control.commits).toBe(commitsBeforeRetry);
    const latestUncertainRow = f.rawRow(uncertainId)!;
    expect(Buffer.compare(latestUncertainRow.bytes, editedRow!.bytes)).toBe(0);
    expect(
      (await f.client.get(uncertainId))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Device branch plus later user edits");

    const distinctDestReads = new Set(
      f.control.readIds.filter((id) => id !== noteId),
    );
    expect([...distinctDestReads]).toEqual([uncertainId]);
  }));

it("refuses invalid, old, throwing and colliding allocator outputs without overwriting or looping", async () =>
  fixture(async (f) => {
    const existing = await f.client.save(
      "existing-destination",
      action("Pre-existing unrelated note", "existing-destination"),
      null,
    );
    const existingBefore = f.rawRow("existing-destination");
    const view = await f.conflicts.read(noteId);

    const sequence = [
      noteId,
      "",
      "invalid/slash",
      "invalid\nnewline",
      null as unknown as string,
      "__THROW__",
      "existing-destination",
      "__RACE_COLLISION__",
      "fresh-valid-copy",
    ];
    let index = 0;
    const model = new CloudConflictNewNoteRecovery(
      f.owners.context,
      f.controller.signal,
      openGate,
      () => {
        const next = sequence[index++];
        if (next === "__THROW__") {
          throw Error("private allocator exception");
        }
        if (next === "__RACE_COLLISION__") {
          return "raced-destination";
        }
        return next;
      },
    );

    // 1..7: old source ID, malformed IDs, non-string, thrown exception, and pre-existing collision.
    for (let step = 0; step < 7; step++) {
      const commitsBefore = f.control.commits;
      const callsBefore = index;
      const result = await model.prepare(noteId, view.generation!);
      expect(result).toEqual({ kind: "unavailable", newNoteId: null });
      expect(JSON.stringify(result)).not.toContain("private");
      expect(index).toBe(callsBefore + 1);
      expect(f.control.commits).toBe(commitsBefore);
    }
    expect(await f.client.get("existing-destination")).toEqual(existing);
    expect(
      Buffer.compare(
        f.rawRow("existing-destination")!.bytes,
        existingBefore!.bytes,
      ),
    ).toBe(0);

    // 8: Concurrent writer creates raced-destination after null read -> expected-null CAS returns false.
    f.control.onRead = async (targetId) => {
      if (targetId === "raced-destination") {
        f.control.onRead = null;
        await f.client.save(
          "raced-destination",
          action("Concurrently created note", "raced-destination"),
          null,
        );
      }
    };
    const racedResult = await model.prepare(noteId, view.generation!);
    expect(racedResult).toEqual({ kind: "unavailable", newNoteId: null });
    expect(
      (await f.client.get("raced-destination"))?.current?.snapshot
        ?.bodyMarkdown,
    ).toBe("Concurrently created note");

    // 9: Subsequent explicit call with a fresh valid allocator output succeeds cleanly.
    const succeeded = await model.prepare(noteId, view.generation!);
    expect(succeeded).toEqual({
      kind: "retained",
      newNoteId: "fresh-valid-copy",
    });
  }));

it.each(["conflict-edit", "resolved"] as const)(
  "guards source generation after a held destination read (%s) and prevents destination commit",
  async (advanceKind) =>
    fixture(async (f) => {
      const recovery = f.owners.newNoteRecovery();
      const view = await f.conflicts.read(noteId);
      const destReadHold = f.hold();
      let allocatedId = "";

      f.control.onRead = async (targetId) => {
        if (targetId !== noteId) {
          f.control.onRead = null;
          allocatedId = targetId;
          await destReadHold.wait();
        }
      };

      const task = f.track(recovery.prepare(noteId, view.generation!));
      await Promise.race([
        destReadHold.entered,
        task.then(() => {
          throw Error("Expected held destination read");
        }),
      ]);
      expect(allocatedId).not.toBe("");
      expect(allocatedId).not.toBe(noteId);

      if (advanceKind === "conflict-edit") {
        await f.client.save(
          noteId,
          action("Newer conflict text while destination read held"),
          view.generation!,
        );
      } else {
        await f.client.resolve(noteId, view.generation!, "remote");
      }

      const commitsBeforeRelease = f.control.commits;
      destReadHold.release();

      const result = await task;
      expect(result).toEqual({ kind: "stale", newNoteId: null });
      expect(f.control.commits).toBe(commitsBeforeRelease);
      expect(await f.client.get(allocatedId)).toBeNull();
      const committedToDest = f.control.commitRecords.some(
        (record) => record.noteId === allocatedId,
      );
      expect(committedToDest).toBe(false);
    }),
);

it("allows an already-started destination commit to finish as a snapshot copy while keeping newer source edits intact", async () =>
  fixture(async (f) => {
    const recovery = f.owners.newNoteRecovery();
    const view = await f.conflicts.read(noteId);
    const commitHold = f.hold();
    let allocatedId = "";

    f.control.onCommit = async (targetId, expectedGen) => {
      if (targetId !== noteId) {
        f.control.onCommit = null;
        allocatedId = targetId;
        expect(expectedGen).toBeNull();
        await commitHold.wait();
      }
    };

    const task = f.track(recovery.prepare(noteId, view.generation!));
    await Promise.race([
      commitHold.entered,
      task.then(() => {
        throw Error("Expected held destination commit");
      }),
    ]);

    const newerSource = await f.client.save(
      noteId,
      action("Newer source edit during already-started destination commit"),
      view.generation!,
    );
    commitHold.release();

    const result = await task;
    expect(result).toEqual({ kind: "retained", newNoteId: allocatedId });
    expect(
      (await f.client.get(allocatedId))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Device branch");
    expect(await f.client.get(noteId)).toEqual(newerSource);
  }));

it.each([
  "before-call",
  "source-read",
  "dest-read",
  "queued-precommit",
  "during-commit",
] as const)(
  "handles abort (%s) by stopping unstarted commits, withholding late IDs and isolating original scope",
  async (phase) =>
    fixture(async (f) => {
      const recovery = f.owners.newNoteRecovery();
      const view = await f.conflicts.read(noteId);
      const sourceBefore = f.rawRow(noteId);

      if (phase === "before-call") {
        f.controller.abort("private early abort");
        const before = [f.control.reads, f.control.commits];
        const result = await recovery.prepare(noteId, view.generation!);
        expect(result).toEqual({ kind: "canceled", newNoteId: null });
        expect([f.control.reads, f.control.commits]).toEqual(before);
        return;
      }

      if (phase === "queued-precommit") {
        let destId = "";
        f.control.afterRead = (targetId) => {
          if (targetId !== noteId) {
            destId = targetId;
          }
          if (targetId === noteId && destId !== "") {
            queueMicrotask(() => {
              queueMicrotask(() => f.controller.abort("queued abort"));
            });
          }
        };
        const commitsBefore = f.control.commits;
        const result = await recovery.prepare(noteId, view.generation!);
        expect(f.controller.signal.aborted).toBe(true);
        expect(result).toEqual({ kind: "canceled", newNoteId: null });
        expect(f.control.commits).toBe(commitsBefore);
        expect(destId).not.toBe("");
        expect(await f.client.get(destId)).toBeNull();
        return;
      }

      const h = f.hold();
      let allocatedId = "";
      if (phase === "source-read") {
        f.control.onRead = async (targetId) => {
          if (targetId === noteId) {
            f.control.onRead = null;
            await h.wait();
          }
        };
      } else if (phase === "dest-read") {
        f.control.onRead = async (targetId) => {
          if (targetId !== noteId) {
            f.control.onRead = null;
            allocatedId = targetId;
            await h.wait();
          }
        };
      } else {
        f.control.onCommit = async (targetId) => {
          if (targetId !== noteId) {
            f.control.onCommit = null;
            allocatedId = targetId;
            await h.wait();
          }
        };
      }

      const commitsBefore = f.control.commits;
      const task = f.track(recovery.prepare(noteId, view.generation!));
      await Promise.race([
        h.entered,
        task.then(() => {
          throw Error("Expected held phase");
        }),
      ]);

      f.controller.abort("private account switch");
      f.context.scope.ownerSubject = "later-account";
      f.context.scope.collectionId = "later-library";
      h.release();

      const result = await task;
      expect(result).toEqual({ kind: "canceled", newNoteId: null });
      expect(JSON.stringify(result)).not.toContain("private");
      const sourceNow = f.rawRow(noteId)!;
      expect(Buffer.compare(sourceNow.bytes, sourceBefore!.bytes)).toBe(0);
      expect(
        f.control.commitRecords.every(
          (r) => JSON.stringify(r.scope) === JSON.stringify(cloudScope),
        ),
      ).toBe(true);

      if (phase !== "during-commit") {
        expect(f.control.commits).toBe(commitsBefore);
        if (allocatedId) {
          expect(await f.client.get(allocatedId)).toBeNull();
        }
      } else {
        expect(allocatedId).not.toBe("");
        const committedRow = await f.client.get(allocatedId);
        expect(committedRow?.collectionId).toBe(cloudScope.collectionId);
        const committedBody = committedRow?.current?.snapshot?.bodyMarkdown;
        expect(committedBody).toBe("Device branch");
      }
      expect(f.control.closes).toBe(0);
    }),
);

it("isolates captured bindings from mutable caller inputs, foreign scopes and gate errors", async () =>
  fixture(async (f) => {
    const mutableContext = {
      store: f.store,
      scope: { ...cloudScope },
    };
    const captured = new CloudConflictNewNoteRecovery(
      mutableContext,
      f.controller.signal,
      openGate,
      crypto.randomUUID,
    );

    // Mutate caller context and store methods after construction.
    mutableContext.scope.ownerSubject = "mutated-owner";
    mutableContext.scope.collectionId = "mutated-library";
    const originalRead = f.store.read;
    const originalCommit = f.store.commit;
    f.store.read = async () => {
      throw Error("caller replacement read must not run");
    };
    f.store.commit = async () => {
      throw Error("caller replacement commit must not run");
    };
    try {
      const view = await f.conflicts.read(noteId);
      const retained = await captured.prepare(noteId, view.generation!);
      expectRetained(retained);
      expect((await f.client.get(retained.newNoteId))?.collectionId).toBe(
        cloudScope.collectionId,
      );
    } finally {
      f.store.read = originalRead;
      f.store.commit = originalCommit;
    }

    // Foreign scope against already-bound SQLite store refuses unavailable with zero writes.
    const foreignModel = new CloudConflictNewNoteRecovery(
      {
        store: f.store,
        scope: { ...cloudScope, ownerSubject: "foreign-account" },
      },
      f.controller.signal,
      openGate,
    );
    const commitsBeforeForeign = f.control.commits;
    expect(await foreignModel.prepare(noteId, 1)).toEqual({
      kind: "unavailable",
      newNoteId: null,
    });
    expect(f.control.commits).toBe(commitsBeforeForeign);

    // Gate error mapping (busy, canceled, stale, LocalGenerationChanged, other).
    const mappedKinds: [unknown, CloudConflictNewNoteResult["kind"]][] = [
      [new CloudConflictResolutionError("busy"), "busy"],
      [new CloudConflictResolutionError("canceled"), "canceled"],
      [new CloudConflictResolutionError("stale"), "stale"],
      [new CloudConflictResolutionError("paused"), "unavailable"],
      [new CloudLocalGenerationChangedError(), "stale"],
      [Error("private gate cause"), "unavailable"],
    ];
    for (const [thrown, expectedKind] of mappedKinds) {
      const gated = new CloudConflictNewNoteRecovery(
        f.owners.context,
        f.controller.signal,
        async () => {
          throw thrown;
        },
      );
      const outcome = await gated.prepare(noteId, 1);
      expect(outcome).toEqual({ kind: expectedKind, newNoteId: null });
      expect(JSON.stringify(outcome)).not.toContain("private");
    }

    // Invalid constructor bindings and hostile getters throw fixed error without invoking getters or I/O.
    const countsBeforeCtor = [f.control.reads, f.control.commits];
    const hostileContext = {} as typeof f.owners.context;
    let getterRan = false;
    Object.defineProperty(hostileContext, "store", {
      enumerable: true,
      get() {
        getterRan = true;
        return f.store;
      },
    });
    Object.defineProperty(hostileContext, "scope", {
      enumerable: true,
      value: cloudScope,
    });
    expect(() => {
      new CloudConflictNewNoteRecovery(
        hostileContext,
        f.controller.signal,
        openGate,
      );
    }).toThrow("Cloud conflict new-note recovery unavailable");
    expect(getterRan).toBe(false);

    for (const invalidArgs of [
      [null, f.controller.signal, openGate, undefined],
      [f.owners.context, null, openGate, undefined],
      [f.owners.context, f.controller.signal, null, undefined],
      [f.owners.context, f.controller.signal, openGate, "not-a-fn"],
      [
        { store: f.store, scope: { ...cloudScope, modeGeneration: 0 } },
        f.controller.signal,
        openGate,
        undefined,
      ],
    ] as const) {
      expect(() => {
        new CloudConflictNewNoteRecovery(
          invalidArgs[0] as never,
          invalidArgs[1] as never,
          invalidArgs[2] as never,
          invalidArgs[3] as never,
        );
      }).toThrow("Cloud conflict new-note recovery unavailable");
    }
    expect([f.control.reads, f.control.commits]).toEqual(countsBeforeCtor);
    expect(f.control.closes).toBe(0);
  }));
