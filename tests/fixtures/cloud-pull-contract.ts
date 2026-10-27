import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import {
  cloudStatus,
  createCloudClient,
} from "../../packages/cloud-protocol/src/index";
import {
  DurableCloudPull,
  type CloudPullStateStore,
} from "../../packages/cloud-protocol/src/pull-local";
import {
  cloudScopeHash,
  type CloudPullStart,
  type CloudPullPage,
} from "../../packages/cloud-protocol/src/pull";
import { cloudDraft, cloudScope, cloudAck } from "./cloud-durable-contract";
export type CloudPullStoreFactory = (
  name: string,
  hook?: () => void,
) => CloudPullStateStore;
const assert = (ok: unknown, label: string) => {
  if (!ok) throw Error(`Cloud pull fixture: ${label}`);
};
const rejects = async (run: () => Promise<unknown>, label: string) => {
  try {
    await run();
  } catch {
    return;
  }
  throw Error(`Cloud pull fixture: ${label}`);
};
const head = (noteId: string, revision: number, text: string) => ({
  kind: "note" as const,
  noteId,
  revision,
  snapshot: { ...cloudDraft(text), noteId, serverRevision: revision },
});
const action = (noteId: string, text: string) => ({
  kind: "upsert" as const,
  snapshot: { ...cloudDraft(text), noteId },
});
export async function runCloudPullContract(factory: CloudPullStoreFactory) {
  const stores = new Set<CloudPullStateStore>();
  const open = (name: string, hook?: () => void) => {
    const store = factory(name, hook);
    stores.add(store);
    return store;
  };
  const close = async (store: CloudPullStateStore) => {
    await store.close();
    stores.delete(store);
  };
  const scopeHash = await cloudScopeHash(cloudScope),
    roundId = "1".repeat(32);
  const start: CloudPullStart = {
    version: 1,
    kind: "bootstrap",
    scopeHash,
    roundId,
    fromSequence: 0,
    upperSequence: null,
    next: { kind: "heads", token: "heads-1" },
  };
  const page = (heads: CloudPullPage["heads"], upper = 2): CloudPullPage => ({
    version: 1,
    kind: "heads",
    scopeHash,
    roundId,
    from: "heads-1",
    fromSequence: 0,
    upperSequence: upper,
    throughSequence: 0,
    heads,
    next: { kind: "changes", token: "changes-1" },
    checkpoint: null,
  });
  const finish = (
    heads: CloudPullPage["heads"] = [],
    upper = 2,
  ): CloudPullPage => ({
    version: 1,
    kind: "changes",
    scopeHash,
    roundId,
    from: "changes-1",
    fromSequence: 0,
    upperSequence: upper,
    throughSequence: upper,
    heads,
    next: null,
    checkpoint: "completed-checkpoint",
  });
  const checks: Record<string, boolean> = {};
  try {
    {
      let fail = false,
        store = open("atomic", () => {
          if (fail) throw Error("Synthetic page abort");
        });
      let pull = new DurableCloudPull(store, cloudScope),
        repo = new DurableCloudClient(store, cloudScope);
      const before = await pull.begin(start, null),
        incoming = page([head("note-a", 1, "A"), head("note-b", 1, "B")]);
      fail = true;
      await rejects(() => pull.apply(incoming), "failed page acknowledged");
      assert(
        (await repo.get("note-a")) === null &&
          JSON.stringify(await pull.progress()) === JSON.stringify(before),
        "cursor or note partly committed",
      );
      fail = false;
      const saved = await pull.apply(incoming);
      assert(
        saved.kind === "applied" && saved.progress.next?.token === "changes-1",
        "page did not advance",
      );
      fail = true;
      await rejects(
        () => pull.apply(finish([head("note-a", 2, "A2")])),
        "failed terminal page acknowledged",
      );
      assert(
        (await repo.get("note-a"))?.baseRevision === 1 &&
          (await pull.progress())?.checkpoint === null,
        "terminal cursor skipped uncommitted state",
      );
      fail = false;
      const complete = await pull.apply(finish([head("note-a", 2, "A2")]));
      assert(
        (await pull.apply(finish([head("note-a", 2, "A2")]))).kind ===
          "already-applied",
        "duplicate page changed state",
      );
      assert(
        (await pull.apply(incoming)).kind === "stale",
        "old page reapplied",
      );
      await close(store);
      store = open("atomic");
      pull = new DurableCloudPull(store, cloudScope);
      repo = new DurableCloudClient(store, cloudScope);
      assert(
        JSON.stringify(await pull.progress()) ===
          JSON.stringify(complete.progress) &&
          (await repo.get("note-a"))?.current?.snapshot?.bodyMarkdown === "A2",
        "page/restart lost cursor or state",
      );
      checks.atomicPageCursorFailureDuplicateAndRestart = true;
      await rejects(
        () =>
          pull.begin(
            {
              ...start,
              kind: "changes",
              fromSequence: 3,
              upperSequence: 3,
              next: { kind: "changes", token: "foreign-checkpoint-progress" },
            },
            complete.progress.generation,
          ),
        "change round skipped this store's completed sequence",
      );
    }
    {
      const store = open("drafts"),
        pull = new DurableCloudPull(store, cloudScope),
        repo = new DurableCloudClient(store, cloudScope);
      await repo.save("note-a", action("note-a", "Unsent local A"), null);
      const b = await repo.save(
          "note-b",
          action("note-b", "Submitted B"),
          null,
        ),
        bp = await repo.prepare("note-b", b.generation, "observed-b");
      const c = await repo.save(
          "note-c",
          action("note-c", "Submitted C"),
          null,
        ),
        cp = await repo.prepare("note-c", c.generation, "observed-c");
      await repo.save(
        "note-c",
        action("note-c", "Later local C"),
        cp.generation,
      );
      const d = await repo.save(
          "note-d",
          action("note-d", "Submitted D"),
          null,
        ),
        dp = await repo.prepare("note-d", d.generation, "observed-d");
      const e = await repo.save(
          "note-e",
          action("note-e", "Submitted E"),
          null,
        ),
        ep = await repo.prepare("note-e", e.generation, "observed-e");
      await pull.begin(start, null);
      await pull.apply(
        page(
          [
            head("note-a", 1, "Remote A"),
            head("note-b", 3, "Remote B3"),
            head("note-c", 3, "Remote C3"),
            {
              kind: "purged",
              noteId: "note-d",
              revision: 3,
              purgedAt: 1800000000000,
            },
            head("note-e", 3, "Remote E3"),
          ],
          7,
        ),
      );
      assert(
        (await repo.get("note-a"))?.conflict?.local.snapshot?.bodyMarkdown ===
          "Unsent local A",
        "unsent draft overwritten",
      );
      const beforeAck = (await repo.get("note-b"))!;
      assert(
        beforeAck.observed?.revision === 3 &&
          beforeAck.inFlight?.opId === "observed-b" &&
          cloudStatus(beforeAck) === "waiting",
        "in-flight head not durably deferred",
      );
      const clean = await repo.acknowledge("note-b", cloudAck(bp));
      assert(
        clean.baseRevision === 3 &&
          clean.current?.snapshot?.bodyMarkdown === "Remote B3" &&
          !clean.observed,
        "ack did not consume observed head",
      );
      const dirty = await repo.acknowledge("note-c", cloudAck(cp));
      assert(
        dirty.conflict?.local.snapshot?.bodyMarkdown === "Later local C" &&
          dirty.conflict.remote?.bodyMarkdown === "Remote C3" &&
          !dirty.observed,
        "ack lost later local source",
      );
      const purged = await repo.acknowledge("note-d", cloudAck(dp));
      assert(
        purged.baseRevision === 3 &&
          purged.current?.kind === "purge" &&
          !purged.observed,
        "deferred permanent purge was not adopted",
      );
      const conflicted = await repo.conflict("note-e", {
        ...cloudAck(ep),
        revision: 2,
        snapshot: head("note-e", 2, "Intermediate E2").snapshot,
      });
      assert(
        conflicted.conflict?.remoteRevision === 3 &&
          conflicted.conflict.local.snapshot?.bodyMarkdown === "Submitted E" &&
          conflicted.conflict.remote?.bodyMarkdown === "Remote E3" &&
          !conflicted.observed,
        "409 settled an older head over the durable observation",
      );
      checks.unsentAndInFlightDraftsSurviveObservedHeads = true;
    }
    {
      const base = open("race");
      let block = false,
        reached!: () => void,
        release!: () => void;
      const entered = new Promise<void>((done) => (reached = done)),
        gate = new Promise<void>((done) => (release = done));
      const wrapped: CloudPullStateStore = {
        read: (s, id) => base.read(s, id),
        commit: (s, id, gen, value) => base.commit(s, id, gen, value),
        close: async () => {},
        readPull: (s, ids) => base.readPull(s, ids),
        commitPull: async (s, gen, p, writes) => {
          if (block && writes.length) {
            block = false;
            reached();
            await gate;
          }
          return base.commitPull(s, gen, p, writes);
        },
      };
      const pull = new DurableCloudPull(wrapped, cloudScope),
        repo = new DurableCloudClient(base, cloudScope);
      await rejects(
        () =>
          pull.begin(
            {
              ...start,
              kind: "changes",
              upperSequence: 0,
              next: { kind: "changes", token: "unbootstrapped-checkpoint" },
            },
            null,
          ),
        "new store resumed changes without its own bootstrap",
      );
      await base.commit(cloudScope, "note-a", null, {
        ...createCloudClient(
          cloudScope.collectionId,
          "note-a",
          head("note-a", 1, "Old base").snapshot,
        ),
        generation: 1,
      });
      await pull.begin(start, null);
      block = true;
      const applying = pull.apply(page([head("note-a", 2, "New remote")]));
      void applying.catch(() => {});
      await entered;
      await repo.save(
        "note-a",
        action("note-a", "Saved during page commit"),
        1,
      );
      release();
      await applying;
      const state = await repo.get("note-a");
      assert(
        state?.conflict?.local.snapshot?.bodyMarkdown ===
          "Saved during page commit" &&
          state.conflict.remote?.bodyMarkdown === "New remote",
        "page race overwrote new save",
      );
      await rejects(
        () => pull.apply({ ...finish(), scopeHash: "0".repeat(64) }),
        "foreign scope page accepted",
      );
      const other = new DurableCloudPull(base, {
        ...cloudScope,
        ownerSubject: "different-owner",
      } as CloudScope);
      await rejects(
        () => other.begin(start, null),
        "foreign owner bootstrap accepted",
      );
      checks.pageCASRetryAndScopeIsolation = true;
    }
    {
      const store = open("monotonic"),
        repo = new DurableCloudClient(store, cloudScope),
        pull = new DurableCloudPull(store, cloudScope);
      await store.commit(cloudScope, "note-a", null, {
        ...createCloudClient(
          cloudScope.collectionId,
          "note-a",
          head("note-a", 5, "Known new head").snapshot,
        ),
        generation: 1,
      });
      await pull.begin(start, null);
      await pull.apply(page([head("note-a", 3, "Old event snapshot")], 6));
      const before = await pull.progress();
      await rejects(
        () =>
          pull.apply(
            finish(
              [
                head("note-b", 1, "Must roll back"),
                head("note-a", 5, "Reused revision content"),
              ],
              6,
            ),
          ),
        "same revision changed content",
      );
      assert(
        JSON.stringify(await pull.progress()) === JSON.stringify(before) &&
          (await repo.get("note-a"))?.baseRevision === 5 &&
          (await repo.get("note-b")) === null,
        "invalid page advanced progress",
      );
      await pull.apply(finish([head("note-a", 6, "Latest head")], 6));
      checks.monotonicHeadsAndRevisionIntegrity = true;
    }
    return { checks, realNotesUsed: false, applicationDatabasesOpened: 0 };
  } finally {
    await Promise.all([...stores].map((store) => store.close()));
  }
}
