import {
  cloudStatus,
  type CloudDraft,
  type CloudClientState,
  type CloudResponse,
} from "../../packages/cloud-protocol/src/index";
import {
  DurableCloudClient,
  type CloudScope,
  type CloudStateStore,
} from "../../packages/cloud-protocol/src/durable";

export const cloudScope: CloudScope = {
  version: 1,
  ownerSubject: "synthetic-owner",
  collectionId: "synthetic-cloud-library",
  modeGeneration: 1,
};
export const cloudDraft = (bodyMarkdown: string): CloudDraft => ({
  schemaVersion: 1,
  collectionId: cloudScope.collectionId,
  noteId: "synthetic-note",
  bodyMarkdown,
  state: "active",
  createdAt: "2026-10-27T03:00:00.000Z",
  updatedAt: "2026-10-27T03:00:00.000Z",
  deletedAt: null,
  purgeAfter: null,
});
const action = (body: string) => ({
  kind: "upsert" as const,
  snapshot: cloudDraft(body),
});
const noteId = "synthetic-note";
const assert: (value: unknown, message: string) => asserts value = (
  value,
  message,
) => {
  if (!value) throw Error(`Cloud durable fixture: ${message}`);
};
const rejects = async (run: () => Promise<unknown>, message: string) => {
  try {
    await run();
  } catch {
    return;
  }
  throw Error(`Cloud durable fixture: ${message}`);
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
export const cloudAck = (
  state: CloudClientState,
  revision = state.baseRevision + 1,
): CloudResponse => ({
  opId: state.inFlight!.opId,
  contentHash: state.inFlight!.contentHash,
  revision,
  snapshot: state.inFlight!.snapshot
    ? { ...state.inFlight!.snapshot, serverRevision: revision }
    : null,
});
export type CloudStoreFactory = (
  name: string,
  beforeCommit?: () => void,
) => CloudStateStore;

/** Same synthetic failure/reopen/race contract for actual SQLite and IndexedDB. */
export async function runCloudDurableContract(factory: CloudStoreFactory) {
  const openStores = new Set<CloudStateStore>();
  const open = (name: string, hook?: () => void) => {
    const store = factory(name, hook);
    openStores.add(store);
    return store;
  };
  const close = async (store: CloudStateStore) => {
    await store.close();
    openStores.delete(store);
  };
  const checks: Record<string, boolean> = {};
  try {
    {
      let fail = true;
      const store = open("initial", () => {
        if (fail) throw Error("Synthetic abort");
      });
      const repo = new DurableCloudClient(store, cloudScope);
      await rejects(
        () => repo.save(noteId, action("Not committed"), null),
        "failed initial save acknowledged",
      );
      assert(
        (await repo.get(noteId)) === null,
        "initial save partly committed",
      );
      fail = false;
      // Failed first commit must not bind the empty store to an account.
      const other = new DurableCloudClient(store, {
        ...cloudScope,
        ownerSubject: "other-synthetic-owner",
      });
      const digest = crypto.subtle.digest;
      crypto.subtle.digest = async () => {
        throw Error("Crypto unavailable");
      };
      try {
        const saved = await other.save(
          noteId,
          action("Saved without cryptography 原文"),
          null,
        );
        assert(
          saved.current?.snapshot?.bodyMarkdown ===
            "Saved without cryptography 原文" && saved.pending,
          "capture needs crypto",
        );
      } finally {
        crypto.subtle.digest = digest;
      }
      await rejects(() => repo.get(noteId), "failed scope ownership binding");
      checks.atomicFirstSaveAndCryptoIndependentCapture = true;
    }
    {
      let store = open("restart");
      let repo = new DurableCloudClient(store, cloudScope);
      const saved = await repo.save(
        noteId,
        action("First source café ##work"),
        null,
      );
      const prepared = await repo.prepare(
        noteId,
        saved.generation,
        "restart-op",
      );
      const operation = await repo.retry(noteId);
      await close(store);
      store = open("restart");
      repo = new DurableCloudClient(store, cloudScope);
      assert(
        JSON.stringify(await repo.retry(noteId)) === JSON.stringify(operation),
        "restart changed retry payload",
      );
      const later = await repo.save(
        noteId,
        action("Latest source 原文 ##work"),
        prepared.generation,
      );
      const acknowledged = await repo.acknowledge(noteId, cloudAck(prepared));
      assert(
        acknowledged.baseRevision === 1 &&
          acknowledged.current?.snapshot?.bodyMarkdown ===
            later.current?.snapshot?.bodyMarkdown &&
          acknowledged.pending?.snapshot?.bodyMarkdown ===
            "Latest source 原文 ##work" &&
          cloudStatus(acknowledged) === "waiting",
        "ack lost later source",
      );
      await rejects(
        () => repo.acknowledge(noteId, cloudAck(prepared)),
        "duplicate ack applied again",
      );
      assert(
        JSON.stringify(await repo.get(noteId)) === JSON.stringify(acknowledged),
        "duplicate ack changed state",
      );
      const second = await repo.prepare(
        noteId,
        acknowledged.generation,
        "restart-op-2",
      );
      const complete = await repo.acknowledge(noteId, cloudAck(second));
      const deletion = await repo.save(
        noteId,
        { kind: "purge", snapshot: null },
        complete.generation,
      );
      const purge = await repo.prepare(
        noteId,
        deletion.generation,
        "restart-purge",
      );
      const tombstone = await repo.acknowledge(noteId, cloudAck(purge));
      assert(
        tombstone.baseRevision === 3 &&
          tombstone.base === null &&
          tombstone.current?.kind === "purge" &&
          !tombstone.inFlight &&
          !tombstone.pending &&
          !JSON.stringify(tombstone).includes("source"),
        "acknowledged purge retained logical source",
      );
      await rejects(
        () => repo.save(noteId, action("Old identity"), tombstone.generation),
        "purged ID reused",
      );
      checks.immutableRestartRetryAndAtomicAckRebase = true;
    }
    {
      let fail = false;
      const store = open("failures", () => {
        if (fail) throw Error("Synthetic transaction abort");
      });
      const repo = new DurableCloudClient(store, cloudScope);
      let state = await repo.save(noteId, action("Before operation"), null);
      const previous = structuredClone(state);
      fail = true;
      await rejects(
        () => repo.prepare(noteId, state.generation, "abort-op"),
        "failed prepare acknowledged",
      );
      assert(
        JSON.stringify(await repo.get(noteId)) === JSON.stringify(previous),
        "failed prepare changed source/outbox",
      );
      fail = false;
      state = await repo.prepare(noteId, state.generation, "abort-op");
      fail = true;
      await rejects(
        () => repo.acknowledge(noteId, cloudAck(state)),
        "failed ack acknowledged",
      );
      assert(
        JSON.stringify(await repo.get(noteId)) === JSON.stringify(state),
        "failed ack lost outbox",
      );
      await rejects(
        () =>
          repo.conflict(noteId, {
            ...cloudAck(state),
            revision: 2,
            snapshot: { ...cloudDraft("Remote"), serverRevision: 2 },
          }),
        "failed conflict acknowledged",
      );
      assert(
        JSON.stringify(await repo.get(noteId)) === JSON.stringify(state),
        "failed conflict lost draft",
      );
      fail = false;
      const conflict = await repo.conflict(noteId, {
        ...cloudAck(state),
        revision: 2,
        snapshot: { ...cloudDraft("Remote"), serverRevision: 2 },
      });
      fail = true;
      await rejects(
        () => repo.resolve(noteId, conflict.generation, action("Chosen merge")),
        "failed resolution acknowledged",
      );
      assert(
        JSON.stringify(await repo.get(noteId)) === JSON.stringify(conflict),
        "failed resolution removed branches",
      );
      fail = false;
      const resolved = await repo.resolve(
        noteId,
        conflict.generation,
        action("Chosen merge"),
      );
      assert(
        resolved.pending?.snapshot?.bodyMarkdown === "Chosen merge" &&
          resolved.baseRevision === 2,
        "resolution retry lost merge",
      );
      checks.failedPrepareAckConflictAndResolutionRollBack = true;
    }
    {
      const store = open("hash-race"),
        repo = new DurableCloudClient(store, cloudScope);
      const saved = await repo.save(noteId, action("Old source"), null);
      const entered = deferred(),
        release = deferred();
      const method = crypto.subtle.digest,
        original = method.bind(crypto.subtle);
      crypto.subtle.digest = async (...args) => {
        entered.resolve();
        await release.promise;
        return original(...args);
      };
      try {
        const preparing = repo.prepare(
          noteId,
          saved.generation,
          "stale-hash-op",
        );
        void preparing.catch(() => {});
        await entered.promise;
        const newer = await repo.save(
          noteId,
          action("Newer source during hash"),
          saved.generation,
        );
        release.resolve();
        await rejects(() => preparing, "stale hash committed");
        assert(
          JSON.stringify(await repo.get(noteId)) === JSON.stringify(newer) &&
            !newer.inFlight,
          "stale hash overwrote newer text",
        );
      } finally {
        release.resolve();
        crypto.subtle.digest = method;
      }
      checks.newerSaveDefeatsHeldRealHash = true;
    }
    {
      const base = open("ack-race");
      const entered = deferred(),
        release = deferred();
      let block = false;
      const wrapped: CloudStateStore = {
        read: (scope, id) => base.read(scope, id),
        close: async () => {},
        commit: async (scope, id, generation, next) => {
          if (block && !next.inFlight) {
            block = false;
            entered.resolve();
            await release.promise;
          }
          return base.commit(scope, id, generation, next);
        },
      };
      const repo = new DurableCloudClient(wrapped, cloudScope);
      const saved = await repo.save(noteId, action("Sent body"), null);
      const prepared = await repo.prepare(
        noteId,
        saved.generation,
        "ack-race-op",
      );
      block = true;
      const acknowledging = repo.acknowledge(noteId, cloudAck(prepared));
      void acknowledging.catch(() => {});
      await entered.promise;
      await new DurableCloudClient(base, cloudScope).save(
        noteId,
        action("Saved during ack"),
        prepared.generation,
      );
      release.resolve();
      const result = await acknowledging;
      assert(
        result.baseRevision === 1 &&
          result.pending?.snapshot?.bodyMarkdown === "Saved during ack" &&
          result.current?.snapshot?.bodyMarkdown === "Saved during ack",
        "ack retry lost concurrent save",
      );
      checks.ackCASRetryPreservesConcurrentSave = true;
    }
    {
      let store = open("conflict"),
        repo = new DurableCloudClient(store, cloudScope);
      const saved = await repo.save(noteId, action("Local branch"), null);
      const sent = await repo.prepare(
        noteId,
        saved.generation,
        "conflict-op-1",
      );
      const conflicted = await repo.conflict(noteId, {
        ...cloudAck(sent),
        revision: 2,
        snapshot: { ...cloudDraft("Remote branch"), serverRevision: 2 },
      });
      await close(store);
      store = open("conflict");
      repo = new DurableCloudClient(store, cloudScope);
      const edited = await repo.save(
        noteId,
        action("Edited local conflict"),
        conflicted.generation,
      );
      await rejects(
        () => repo.resolve(noteId, conflicted.generation, "remote"),
        "stale resolution discarded latest branch",
      );
      const merged = await repo.resolve(
        noteId,
        edited.generation,
        action("Explicit merge"),
      );
      const next = await repo.prepare(
        noteId,
        merged.generation,
        "conflict-op-2",
      );
      const again = await repo.conflict(noteId, {
        ...cloudAck(next),
        revision: 3,
        snapshot: { ...cloudDraft("Another remote branch"), serverRevision: 3 },
      });
      assert(
        again.conflict?.local.snapshot?.bodyMarkdown === "Explicit merge" &&
          again.conflict.remote?.bodyMarkdown === "Another remote branch",
        "second 409 lost merge",
      );
      checks.conflictRestartAndExplicitRepeatedResolution = true;
    }
    {
      const store = open("scope"),
        repo = new DurableCloudClient(store, cloudScope);
      const saved = await repo.save(
        noteId,
        action("Private synthetic source"),
        null,
      );
      for (const wrong of [
        { ...cloudScope, ownerSubject: "different-synthetic-owner" },
        { ...cloudScope, collectionId: "different-library" },
        { ...cloudScope, modeGeneration: 2 },
      ]) {
        const other = new DurableCloudClient(store, wrong);
        await rejects(() => other.get(noteId), "foreign scope read state");
        await rejects(
          () => other.save(noteId, action("Wrong scope"), saved.generation),
          "foreign scope wrote state",
        );
      }
      const a = repo.save(noteId, action("Editor A"), saved.generation);
      const b = repo.save(noteId, action("Editor B"), saved.generation);
      const outcomes = await Promise.allSettled([a, b]);
      assert(
        outcomes.filter((outcome) => outcome.status === "fulfilled").length ===
          1,
        "concurrent editors both committed",
      );
      checks.scopeIsolationAndCompetingEditors = true;
    }
    {
      const store = open("bad-hash"),
        repo = new DurableCloudClient(store, cloudScope);
      const saved = await repo.save(
        noteId,
        action("Saved before corrupt hash"),
        null,
      );
      const prepared = await repo.prepare(
        noteId,
        saved.generation,
        "corrupt-hash-op",
      );
      const bad = structuredClone(prepared);
      bad.generation++;
      bad.inFlight!.contentHash = "0".repeat(64);
      assert(
        await store.commit(cloudScope, noteId, prepared.generation, bad),
        "could not set synthetic hash corruption",
      );
      await rejects(() => repo.retry(noteId), "corrupt hash sent");
      const latest = await repo.save(
        noteId,
        action("Local capture still works"),
        bad.generation,
      );
      assert(
        latest.pending?.snapshot?.bodyMarkdown === "Local capture still works",
        "hash corruption blocked capture",
      );
      const malformed = structuredClone(latest);
      malformed.generation++;
      malformed.pending = null;
      await rejects(
        () => store.commit(cloudScope, noteId, latest.generation, malformed),
        "untracked source accepted",
      );
      await rejects(
        () =>
          store.commit(cloudScope, noteId, latest.generation, {
            ...latest,
            generation: latest.generation + 1,
            current: null,
            pending: null,
            inFlight: null,
          }),
        "empty projection erased saved work",
      );
      assert(
        JSON.stringify(await repo.get(noteId)) === JSON.stringify(latest),
        "malformed write changed state",
      );
      checks.corruptHashPausesRetryButNotLocalCapture = true;
    }
    return { checks, realNotesUsed: false, applicationDatabasesOpened: 0 };
  } finally {
    await Promise.all([...openStores].map((store) => store.close()));
  }
}
