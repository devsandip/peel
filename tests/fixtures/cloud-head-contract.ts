import {
  DurableCloudClient,
  type CloudStateStore,
} from "../../packages/cloud-protocol/src/durable";
import {
  cloudStatus,
  type CloudAcceptedHead,
} from "../../packages/cloud-protocol/src/index";
import {
  cloudAck,
  cloudDraft,
  cloudScope,
  type CloudStoreFactory,
} from "./cloud-durable-contract";
const noteId = "synthetic-note";
const action = (body: string) => ({
  kind: "upsert" as const,
  snapshot: cloudDraft(body),
});
const assert = (value: unknown, label: string) => {
  if (!value) throw Error(`Cloud head fixture: ${label}`);
};
const rejects = async (run: () => Promise<unknown>, label: string) => {
  try {
    await run();
  } catch {
    return;
  }
  throw Error(`Cloud head fixture: ${label}`);
};
export async function runCloudHeadContract(factory: CloudStoreFactory) {
  const stores = new Set<CloudStateStore>();
  const open = (name: string, hook?: () => void) => {
    const store = factory(name, hook);
    stores.add(store);
    return store;
  };
  const close = async (store: CloudStateStore) => {
    await store.close();
    stores.delete(store);
  };
  const checks: Record<string, boolean> = {};
  try {
    {
      let store = open("clean"),
        repo = new DurableCloudClient(store, cloudScope);
      const saved = await repo.save(
        noteId,
        action("Accepted local source"),
        null,
      );
      const prepared = await repo.prepare(
        noteId,
        saved.generation,
        "clean-accepted",
      );
      const reply: CloudAcceptedHead = {
        ...cloudAck(prepared),
        acceptedRevision: 1,
        revision: 3,
        snapshot: {
          ...cloudDraft("Latest authenticated server source"),
          serverRevision: 3,
        },
      };
      const clean = await repo.acceptedHead(noteId, reply);
      assert(
        clean.baseRevision === 3 &&
          !clean.inFlight &&
          !clean.pending &&
          !clean.conflict &&
          clean.current?.snapshot?.bodyMarkdown ===
            "Latest authenticated server source" &&
          cloudStatus(clean) === "synced",
        "clean adoption failed",
      );
      await close(store);
      store = open("clean");
      repo = new DurableCloudClient(store, cloudScope);
      assert(
        JSON.stringify(await repo.get(noteId)) === JSON.stringify(clean),
        "adoption not durable",
      );
      await rejects(
        () => repo.acceptedHead(noteId, reply),
        "stale receipt reapplied",
      );
      assert(
        JSON.stringify(await repo.get(noteId)) === JSON.stringify(clean),
        "stale receipt changed source",
      );
      checks.cleanHeadAdoptionAndRestart = true;
    }
    {
      let fail = false;
      const store = open("pending", () => {
        if (fail) throw Error("Synthetic head commit abort");
      });
      const repo = new DurableCloudClient(store, cloudScope);
      const saved = await repo.save(
        noteId,
        action("First submitted source"),
        null,
      );
      const prepared = await repo.prepare(
        noteId,
        saved.generation,
        "pending-accepted",
      );
      const latest = await repo.save(
        noteId,
        action("Later local source 原文"),
        prepared.generation,
      );
      const reply: CloudAcceptedHead = {
        ...cloudAck(prepared),
        acceptedRevision: 1,
        revision: 2,
        snapshot: {
          ...cloudDraft("Concurrent remote source"),
          serverRevision: 2,
        },
      };
      fail = true;
      await rejects(
        () => repo.acceptedHead(noteId, reply),
        "aborted reconciliation acknowledged",
      );
      assert(
        JSON.stringify(await repo.get(noteId)) === JSON.stringify(latest),
        "failed reconciliation partly committed",
      );
      fail = false;
      const conflict = await repo.acceptedHead(noteId, reply);
      assert(
        conflict.baseRevision === 0 &&
          conflict.base === null &&
          !conflict.inFlight &&
          conflict.conflict?.local.snapshot?.bodyMarkdown ===
            "Later local source 原文" &&
          conflict.conflict.remote?.bodyMarkdown ===
            "Concurrent remote source" &&
          cloudStatus(conflict) === "conflict",
        "later source lost or historical base fabricated",
      );
      checks.laterDraftConflictAndAtomicFailure = true;
    }
    {
      const base = open("race");
      let block = false,
        entered!: () => void,
        release!: () => void;
      const reached = new Promise<void>((done) => (entered = done)),
        gate = new Promise<void>((done) => (release = done));
      const wrapped: CloudStateStore = {
        read: (scope, id) => base.read(scope, id),
        close: async () => {},
        commit: async (scope, id, generation, next) => {
          if (block && !next.inFlight) {
            block = false;
            entered();
            await gate;
          }
          return base.commit(scope, id, generation, next);
        },
      };
      const repo = new DurableCloudClient(wrapped, cloudScope);
      const saved = await repo.save(
        noteId,
        action("Submitted before race"),
        null,
      );
      const prepared = await repo.prepare(
        noteId,
        saved.generation,
        "race-accepted",
      );
      block = true;
      const pending = repo.acceptedHead(noteId, {
        ...cloudAck(prepared),
        acceptedRevision: 1,
        revision: 2,
        snapshot: { ...cloudDraft("Remote during race"), serverRevision: 2 },
      });
      void pending.catch(() => {});
      await reached;
      await new DurableCloudClient(base, cloudScope).save(
        noteId,
        action("Saved during reconciliation"),
        prepared.generation,
      );
      release();
      const result = await pending;
      assert(
        result.baseRevision === 0 &&
          result.conflict?.local.snapshot?.bodyMarkdown ===
            "Saved during reconciliation" &&
          result.conflict.remote?.bodyMarkdown === "Remote during race",
        "CAS retry lost latest draft",
      );
      checks.concurrentSaveChangesAdoptionIntoConflict = true;
    }
    {
      const store = open("purged"),
        repo = new DurableCloudClient(store, cloudScope);
      const saved = await repo.save(
        noteId,
        action("Local before remote purge"),
        null,
      );
      const prepared = await repo.prepare(
        noteId,
        saved.generation,
        "purge-accepted",
      );
      const reply: CloudAcceptedHead = {
        ...cloudAck(prepared),
        acceptedRevision: 1,
        revision: 2,
        snapshot: null,
      };
      await rejects(
        () =>
          repo.acceptedHead(noteId, { ...reply, contentHash: "0".repeat(64) }),
        "wrong receipt hash accepted",
      );
      await rejects(
        () => repo.acceptedHead(noteId, { ...reply, acceptedRevision: 2 }),
        "wrong accepted revision allowed",
      );
      await repo.save(
        noteId,
        action("Newer offline text to recover"),
        prepared.generation,
      );
      const conflict = await repo.acceptedHead(noteId, reply);
      assert(
        conflict.conflict?.remote === null &&
          conflict.conflict.local.snapshot?.bodyMarkdown ===
            "Newer offline text to recover",
        "purged head destroyed later local draft",
      );
      await rejects(
        () =>
          repo.resolve(
            noteId,
            conflict.generation,
            action("Would recreate old ID"),
          ),
        "old purged ID recreated",
      );
      const removed = await repo.resolve(noteId, conflict.generation, "remote");
      assert(
        removed.current?.kind === "purge" &&
          removed.baseRevision === 2 &&
          !JSON.stringify(removed).includes("offline"),
        "explicit purge acceptance retained logical source",
      );
      const cleanId = "synthetic-clean-purge";
      const cleanSaved = await repo.save(
        cleanId,
        {
          kind: "upsert",
          snapshot: { ...cloudDraft("Accepted then purged"), noteId: cleanId },
        },
        null,
      );
      const cleanPrepared = await repo.prepare(
        cleanId,
        cleanSaved.generation,
        "clean-purge-accepted",
      );
      const cleanRemoved = await repo.acceptedHead(cleanId, {
        ...cloudAck(cleanPrepared),
        acceptedRevision: 1,
        revision: 2,
        snapshot: null,
      });
      assert(
        cleanRemoved.current?.kind === "purge" &&
          !cleanRemoved.conflict &&
          !cleanRemoved.inFlight,
        "clean remote purge not adopted",
      );
      const deletion = await repo.save(
        cleanId,
        { kind: "purge", snapshot: null },
        cleanRemoved.generation,
      );
      const deleting = await repo.prepare(
        cleanId,
        deletion.generation,
        "impossible-purge-advance",
      );
      await rejects(
        () =>
          repo.acceptedHead(cleanId, {
            ...cloudAck(deleting),
            acceptedRevision: 3,
            revision: 4,
            snapshot: {
              ...cloudDraft("Impossible resurrection"),
              noteId: cleanId,
              serverRevision: 4,
            },
          }),
        "accepted permanent purge advanced to content",
      );
      checks.remotePurgePreservesOnlyNewerUnsyncedBranch = true;
    }
    return { checks, realNotesUsed: false, applicationDatabasesOpened: 0 };
  } finally {
    await Promise.all([...stores].map((store) => store.close()));
  }
}
