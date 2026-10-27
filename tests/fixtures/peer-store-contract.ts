import { newNote } from "../../packages/core/src/index";
import {
  HISTORY_MS,
  type Edit,
  type Purge,
} from "../../packages/peer-protocol/src/index";
import {
  DurableReplica,
  type ReplicaStore,
} from "../../packages/peer-protocol/src/durable";
import type { SessionBinding } from "../../packages/peer-protocol/src/auth";

export const library = "synthetic-library",
  device = "1".repeat(64),
  phone = "2".repeat(64),
  web = "3".repeat(64);
export const wall = 1793030400000;
const fixture = () => ({
  ...newNote(),
  noteId: "synthetic-note",
  bodyMarkdown: "# Synthetic\nInitial **text**. ##fixture",
});
const edit = (id: string, offset = 1): Edit => ({
  protocol: 1,
  libraryId: library,
  editId: id,
  stamp: { physical: wall + offset, logical: 0, deviceId: phone },
  note: {
    ...fixture(),
    bodyMarkdown: `Synthetic edit ${id}`,
    localRevision: 900,
  },
});
const marker = (): Purge => ({
  protocol: 1,
  libraryId: library,
  noteId: "synthetic-note",
  purgeId: "purge-1",
  deviceId: device,
  purgedAt: wall + 10,
});
const binding = (digit: string, now = wall): SessionBinding => ({
  version: 1,
  libraryId: library,
  sessionId: digit.repeat(64),
  initiatorId: device,
  responderId: phone,
  initiatorNonce: "a".repeat(64),
  responderNonce: "b".repeat(64),
  offerHash: "c".repeat(64),
  answerHash: "d".repeat(64),
  expiresAt: now + 60000,
});
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const equal = (a: unknown, b: unknown, message: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), message);
const reject = async (operation: () => Promise<unknown>, message: string) => {
  let failed = false;
  try {
    await operation();
  } catch {
    failed = true;
  }
  assert(failed, message);
};
export type StoreFactory = (
  name: string,
  beforeCommit?: () => void,
) => ReplicaStore;

/** The exact same failure/restart contract runs on real SQLite and browser IndexedDB. */
export async function runStoreContract(factory: StoreFactory) {
  const results: Record<string, boolean> = {},
    stores = new Set<ReplicaStore>();
  const open = (name: string, beforeCommit?: () => void) => {
    const store = factory(name, beforeCommit);
    stores.add(store);
    return { store, engine: new DurableReplica(store, library, device) };
  };
  const close = async (store: ReplicaStore) => {
    await store.close();
    stores.delete(store);
  };
  const check = async (name: string, run: () => Promise<void>) => {
    await run();
    results[name] = true;
  };
  try {
    await check(
      "atomicNoteClockHistoryProjectionAndPendingSurviveReopen",
      async () => {
        let { store, engine } = open("restart");
        const saved = await engine.saveLocal(fixture(), 0, wall, "local-1", [
          phone,
        ]);
        equal(saved.localRevision, 1, "First local revision");
        const before = await engine.view(saved.noteId);
        assert(
          before.delivery?.packet && before.delivery.generation === "local-1",
          "Pending head missing",
        );
        equal(
          (before.delivery.packet as Edit).note.localRevision,
          0,
          "Wire snapshot uses no receiving revision",
        );
        await close(store);
        ({ store, engine } = open("restart"));
        equal(
          await engine.view(saved.noteId),
          before,
          "Restart lost atomic state",
        );
        const incoming = edit("remote-1");
        const receipt = await engine.applyEdit(
          incoming,
          wall + 1,
          new Set([phone]),
        );
        assert(
          receipt.committed && receipt.outcome === "applied",
          "No committed receipt",
        );
        const after = await engine.view(saved.noteId);
        equal(
          after.note?.localRevision,
          2,
          "Remote revision must be translated",
        );
        equal(
          after.head?.note.localRevision,
          900,
          "Immutable input revision changed",
        );
        equal(after.history.length, 1, "Previous body not retained");
        equal(after.delivery, null, "Author already has the new winning edit");
        const duplicate = await engine.applyEdit(
          incoming,
          wall + 2,
          new Set([phone]),
        );
        equal(duplicate.outcome, "duplicate", "Retry not deduplicated");
        equal(
          (await engine.view(saved.noteId)).note?.localRevision,
          2,
          "Retry advanced projection",
        );
        const rows = await store.read(saved.noteId, []);
        for (const prefix of ["head/", "history/", "seen/", "note/"])
          assert(
            rows.rows.some((r) => r.key.startsWith(prefix)),
            `Missing normalized ${prefix}`,
          );
      },
    );
    await check(
      "failedEditAndPurgeNeverAcknowledgeOrPartiallyWrite",
      async () => {
        let fail = false;
        const hook = () => {
          if (fail) throw new Error("Synthetic commit failure");
        };
        let { store, engine } = open("failure", hook);
        await engine.saveLocal(fixture(), 0, wall, "local-1", [phone, web]);
        const before = await engine.view("synthetic-note");
        fail = true;
        await reject(
          () =>
            engine.applyEdit(edit("remote-2"), wall + 1, new Set([phone]), [
              web,
            ]),
          "Failed edit acknowledged",
        );
        await close(store);
        fail = false;
        ({ store, engine } = open("failure", hook));
        equal(
          await engine.view("synthetic-note"),
          before,
          "Failed edit partially committed",
        );
        assert(
          (
            await engine.applyEdit(
              edit("remote-2"),
              wall + 1,
              new Set([phone]),
              [web],
            )
          ).committed,
          "Retry failed",
        );
        const beforePurge = await engine.view("synthetic-note");
        fail = true;
        await reject(
          () => engine.applyPurge(marker(), new Set([device]), [phone, web], 2),
          "Failed purge acknowledged",
        );
        equal(
          await engine.view("synthetic-note"),
          beforePurge,
          "Failed purge lost body/history/outbox",
        );
        fail = false;
        await engine.applyPurge(marker(), new Set([device]), [phone, web], 2);
        const rows = await store.read("synthetic-note", []);
        assert(
          rows.rows.every(
            (r) =>
              !["head/", "history/", "seen/", "note/"].some((p) =>
                r.key.startsWith(p),
              ),
          ),
          "Purge retained bodies/digests",
        );
        assert(
          !JSON.stringify(rows).includes("Synthetic edit") &&
            !JSON.stringify(rows).includes("Initial **text**"),
          "Purge retained note text",
        );
      },
    );
    await check(
      "concurrentWritersSerializeWithoutLostNotesOrClock",
      async () => {
        const a = open("concurrent"),
          b = open("concurrent");
        await Promise.all([
          a.engine.applyEdit(edit("remote-a", 1), wall + 3, new Set([phone])),
          b.engine.applyEdit(edit("remote-b", 2), wall + 3, new Set([phone])),
          a.engine.applyEdit(
            {
              ...edit("remote-c", 3),
              note: { ...fixture(), noteId: "second-note" },
            },
            wall + 3,
            new Set([phone]),
          ),
        ]);
        const view = await a.engine.view("synthetic-note");
        equal(view.head?.editId, "remote-b", "Wrong concurrent winner");
        equal(view.history.length, 1, "Losing concurrent edit missing");
        assert(
          (await b.engine.view("second-note")).note,
          "Concurrent note lost",
        );
        const results = await Promise.allSettled([
          a.engine.saveLocal(
            view.note!,
            view.note!.localRevision,
            wall + 4,
            "local-a",
            [phone],
          ),
          b.engine.saveLocal(
            view.note!,
            view.note!.localRevision,
            wall + 4,
            "local-b",
            [phone],
          ),
        ]);
        equal(
          results.filter((r) => r.status === "fulfilled").length,
          1,
          "Two stale expected revisions committed",
        );
        const latest = await b.engine.view("synthetic-note");
        equal(
          latest.note?.localRevision,
          view.note!.localRevision + 1,
          "Concurrent revision skipped",
        );
        equal(
          latest.delivery?.generation,
          latest.head?.editId,
          "Outbox and head diverged",
        );
      },
    );
    await check("oldAcknowledgementsCannotClearNewEditOrPurge", async () => {
      const { engine } = open("outbox");
      let note = await engine.saveLocal(fixture(), 0, wall, "local-1", [
        phone,
        web,
      ]);
      assert(
        await engine.acknowledge(note.noteId, "local-1", phone, "edit"),
        "First peer ack rejected",
      );
      equal(
        (await engine.view(note.noteId)).delivery?.awaiting,
        [web],
        "Ack removed wrong target",
      );
      note = await engine.saveLocal(
        { ...note, bodyMarkdown: "Synthetic newer draft" },
        1,
        wall + 1,
        "local-2",
        [phone, web],
      );
      assert(
        !(await engine.acknowledge(note.noteId, "local-1", web, "edit")),
        "Old ack cleared new generation",
      );
      equal(
        (await engine.view(note.noteId)).delivery?.awaiting,
        [phone, web],
        "New generation target lost",
      );
      await engine.acknowledge(note.noteId, "local-2", phone, "edit");
      await engine.acknowledge(note.noteId, "local-2", web, "edit");
      equal(
        (await engine.view(note.noteId)).delivery,
        null,
        "Acknowledged delivery retained",
      );
      await engine.applyPurge(marker(), new Set([device]), [phone, web], 2);
      assert(
        !(await engine.acknowledge(note.noteId, "local-2", phone, "edit")),
        "Edit ack cleared purge",
      );
      const pending = (await engine.view(note.noteId)).delivery;
      assert(
        pending?.kind === "purge" && !("note" in pending.packet!),
        "Purge outbox contains body",
      );
      await engine.acknowledge(note.noteId, "purge-1", phone, "purge");
      await engine.acknowledge(note.noteId, "purge-1", web, "purge");
      await engine.applyPurge(marker(), new Set([device]), [phone, web]);
      equal(
        (await engine.view(note.noteId)).delivery,
        null,
        "Purge retry revived completed delivery",
      );
      const collision = await engine.saveLocal(
        { ...fixture(), noteId: "collision-note" },
        0,
        wall + 11,
        "shared-generation",
        [phone],
      );
      await engine.applyPurge(
        { ...marker(), noteId: collision.noteId, purgeId: "shared-generation" },
        new Set([device]),
        [phone],
        1,
      );
      assert(
        !(await engine.acknowledge(
          collision.noteId,
          "shared-generation",
          phone,
          "edit",
        )),
        "Edit ack cleared same-ID purge",
      );
      assert(
        await engine.acknowledge(
          collision.noteId,
          "shared-generation",
          phone,
          "purge",
        ),
        "Purge ack rejected",
      );
    });
    await check("historyExpiryAndPermanentPurgeSurviveStaleRetry", async () => {
      const { store, engine } = open("retention");
      const first = edit("first", 0),
        second = edit("second", 1);
      await engine.applyEdit(first, wall, new Set([phone]));
      await engine.applyEdit(second, wall + 1, new Set([phone]));
      await engine.maintenance("synthetic-note", wall + HISTORY_MS + 2);
      equal(
        (await engine.view("synthetic-note")).history.length,
        0,
        "History did not expire",
      );
      await engine.applyEdit(first, wall + HISTORY_MS + 3, new Set([phone]));
      equal(
        (await engine.view("synthetic-note")).history.length,
        0,
        "Retry revived expired body",
      );
      await reject(
        () =>
          engine.applyEdit(
            {
              ...first,
              note: { ...first.note, bodyMarkdown: "Changed reused ID" },
            },
            wall + HISTORY_MS + 3,
            new Set([phone]),
          ),
        "Reused edit ID accepted",
      );
      await engine.applyPurge(marker(), new Set([device]));
      const ignored = await engine.applyEdit(
        second,
        wall + 90 * 86400000,
        new Set([phone]),
      );
      assert(
        ignored.committed && ignored.outcome === "purged",
        "Stale retry resurrected ID",
      );
      await reject(
        () => engine.saveLocal(fixture(), 0, wall + 20, "reuse", []),
        "Local resurrection accepted",
      );
      assert(
        !(await engine.view("synthetic-note")).note,
        "Purged projection returned",
      );
      assert(
        (await store.read("synthetic-note", [])).rows.every(
          (r) => !r.key.startsWith("seen/"),
        ),
        "Purge retry retained edit digest",
      );
      const recovered = await engine.saveLocal(
        { ...fixture(), noteId: "recovered-new-id" },
        0,
        wall + 90 * 86400000,
        "recovered",
        [],
      );
      equal(recovered.localRevision, 1, "Recovery to new ID failed");
    });
    await check("quarantineAndIdentityFailuresNeverAdvanceState", async () => {
      const { store, engine } = open("boundaries");
      await engine.applyEdit(edit("accepted"), wall + 1, new Set([phone]));
      const before = await store.read("synthetic-note", ["meta/clock"]);
      const quarantined = await engine.applyEdit(
        edit("future", 365 * 86400000),
        wall,
        new Set([phone]),
      );
      equal(
        quarantined,
        { committed: false, outcome: "quarantined", editId: "future" },
        "Future edit acknowledged",
      );
      equal(
        await store.read("synthetic-note", ["meta/clock"]),
        before,
        "Quarantine advanced durable clock",
      );
      await reject(
        () =>
          engine.applyEdit(
            { ...edit("bad-library"), libraryId: "other" },
            wall,
            new Set([phone]),
          ),
        "Wrong library accepted",
      );
      await reject(
        () => engine.applyEdit(edit("unknown-author"), wall, new Set()),
        "Unknown author accepted",
      );
      await reject(
        () =>
          engine.applyEdit(
            {
              ...edit("accepted"),
              note: { ...fixture(), noteId: "other-note" },
            },
            wall + 1,
            new Set([phone]),
          ),
        "Global edit ID reuse accepted",
      );
      await reject(
        () => new DurableReplica(store, "other", device).view("synthetic-note"),
        "Other library opened store",
      );
      await reject(
        () => new DurableReplica(store, library, web).view("synthetic-note"),
        "Other device opened store",
      );
      equal(
        await store.read("synthetic-note", ["meta/clock"]),
        before,
        "Rejected identity modified state",
      );
    });
    await check(
      "durableChallengeAndClaimCommitTogetherAcrossReopen",
      async () => {
        let fail = true;
        const hook = () => {
          if (fail) throw new Error("Synthetic claim commit failure");
        };
        let { store, engine } = open("session", hook);
        const proof = binding("4");
        await reject(
          () => engine.claimVerifiedSession(proof, phone, () => wall),
          "Failed claim acknowledged",
        );
        await close(store);
        fail = false;
        ({ store, engine } = open("session", hook));
        await engine.claimVerifiedSession(proof, phone, () => wall);
        await close(store);
        ({ store, engine } = open("session", hook));
        await reject(
          () => engine.claimVerifiedSession(proof, phone, () => wall),
          "Restart accepted replay",
        );
        await reject(
          () =>
            engine.claimVerifiedSession(
              { ...proof, sessionId: "5".repeat(64) },
              phone,
              () => wall,
            ),
          "Cross-session challenge reuse accepted",
        );
        const fresh = {
          ...proof,
          sessionId: "6".repeat(64),
          initiatorNonce: "e".repeat(64),
        };
        await reject(
          () => engine.claimVerifiedSession(fresh, web, () => wall),
          "Wrong verified signer accepted",
        );
        await reject(
          () => engine.claimVerifiedSession(fresh, phone, () => wall - 1),
          "Clock rollback accepted",
        );
        const other = open("session", hook);
        const concurrent = await Promise.allSettled([
          engine.claimVerifiedSession(fresh, phone, () => wall),
          other.engine.claimVerifiedSession(fresh, phone, () => wall),
        ]);
        equal(
          concurrent.filter((r) => r.status === "fulfilled").length,
          1,
          "Concurrent replay consumed twice",
        );
        const snapshot = await store.read(null, [
          `nonce/${fresh.initiatorNonce}`,
          `claim/${fresh.sessionId}`,
          "meta/session-count",
        ]);
        equal(snapshot.rows.length, 3, "Claim and nonce/count not atomic");
        equal(
          snapshot.rows.find((r) => r.key === "meta/session-count")?.value,
          2,
          "Failed claims consumed capacity",
        );
      },
    );
    await check(
      "clockIndependentDraftCommitReopenAndSafePublication",
      async () => {
        let { store, engine } = open("draft-clock");
        const future = wall + 365 * 86400000;
        const first = await engine.saveLocal(
          fixture(),
          0,
          future,
          "future-local",
          [phone],
        );
        const before = await engine.view(first.noteId);
        const source = {
          ...first,
          bodyMarkdown: "Synthetic saved draft with unsafe sync clock",
        };
        const saved = await engine.saveDraft(source, 1, "draft-generation-1");
        equal(saved.localRevision, 2, "Draft did not get a local revision");
        let view = await engine.view(first.noteId);
        equal(view.clock, before.clock, "Draft changed the protocol clock");
        equal(view.head, before.head, "Draft became a network edit");
        equal(
          view.delivery,
          before.delivery,
          "Draft entered a delivery packet",
        );
        equal(view.draft?.baseEditId, "future-local", "Draft base missing");
        equal(
          await engine.saveDraft(source, 1, "draft-generation-1"),
          saved,
          "Lost-ack retry changed the revision",
        );
        await close(store);
        ({ store, engine } = open("draft-clock"));
        equal(
          await engine.view(first.noteId),
          view,
          "Restart lost unstamped text",
        );
        await engine.maintenance(first.noteId, wall);
        equal(
          (await engine.view(first.noteId)).note,
          saved,
          "Maintenance lost local draft",
        );
        const paused = await engine.view(first.noteId);
        await reject(
          () =>
            engine.publishDraft(
              first.noteId,
              "draft-generation-1",
              2,
              wall,
              "publish-unsafe",
              [phone],
            ),
          "Unsafe clock published draft",
        );
        equal(
          await engine.view(first.noteId),
          paused,
          "Failed clock check changed durable draft",
        );
        await reject(
          () => engine.saveLocal(saved, 2, future + 1, "bypass-draft", [phone]),
          "Stamped helper bypassed the draft",
        );
        const published = await engine.publishDraft(
          first.noteId,
          "draft-generation-1",
          2,
          future + 1,
          "publish-safe-input",
          [phone],
        );
        equal(
          published,
          saved,
          "Publication changed display dates or local revision",
        );
        view = await engine.view(first.noteId);
        equal(view.draft, null, "Published draft marker survived");
        equal(
          view.head?.note.bodyMarkdown,
          saved.bodyMarkdown,
          "Published wrong source",
        );
        equal(
          view.delivery?.generation,
          "publish-safe-input",
          "Publication missing delivery",
        );
        equal(
          await engine.publishDraft(
            first.noteId,
            "draft-generation-1",
            2,
            future + 1,
            "publish-safe-input",
            [phone],
          ),
          saved,
          "Publication retry changed note",
        );
        equal(
          await engine.view(first.noteId),
          view,
          "Publication retry changed protocol state",
        );
        equal(
          await engine.acknowledge(first.noteId, "future-local", phone, "edit"),
          false,
          "Old ack cleared draft publication",
        );
        await engine.saveDraft(
          {
            ...fixture(),
            noteId: "unstamped-reload",
            bodyMarkdown: "Synthetic pending reload draft",
          },
          0,
          "reload-generation",
        );
        const identity = await store.read(null, ["meta/identity"]);
        equal(
          (identity.rows[0].value as { schema: number }).schema,
          4,
          "Old engines could open protected peer state",
        );
      },
    );
    await check(
      "failedDraftAndPublicationAreAtomicAndCoalesceLatestText",
      async () => {
        let fail = true;
        const hook = () => {
          if (fail) throw new Error("Synthetic draft commit failure");
        };
        let { store, engine } = open("draft-failure", hook);
        await reject(
          () => engine.saveDraft(fixture(), 0, "first-draft"),
          "Failed draft acknowledged",
        );
        equal(
          (await engine.view("synthetic-note")).note,
          null,
          "Failed draft partially saved",
        );
        fail = false;
        const saved = await engine.saveDraft(fixture(), 0, "first-draft");
        const before = await engine.view(saved.noteId);
        fail = true;
        await reject(
          () =>
            engine.publishDraft(
              saved.noteId,
              "first-draft",
              1,
              wall,
              "draft-publish-1",
              [phone],
            ),
          "Failed publication acknowledged",
        );
        await close(store);
        fail = false;
        ({ store, engine } = open("draft-failure", hook));
        equal(
          await engine.view(saved.noteId),
          before,
          "Failed publication partially changed head or marker",
        );
        await engine.publishDraft(
          saved.noteId,
          "first-draft",
          1,
          wall,
          "draft-publish-1",
          [phone],
        );
        const second = await engine.saveDraft(
          { ...saved, bodyMarkdown: "Synthetic newer local draft" },
          1,
          "second-draft",
        );
        const beforeFailure = await engine.view(saved.noteId);
        fail = true;
        await reject(
          () =>
            engine.saveDraft(
              { ...second, bodyMarkdown: "Synthetic failed later save" },
              2,
              "third-draft",
            ),
          "Failed replacement acknowledged",
        );
        equal(
          await engine.view(saved.noteId),
          beforeFailure,
          "Failed replacement lost saved draft",
        );
        fail = false;
        const latest = await engine.saveDraft(
          { ...second, bodyMarkdown: "Synthetic latest coalesced draft" },
          2,
          "third-draft",
        );
        await reject(
          () =>
            engine.publishDraft(
              saved.noteId,
              "second-draft",
              2,
              wall + 1,
              "stale-publish",
              [phone],
            ),
          "Stale generation published",
        );
        equal(
          (await engine.view(saved.noteId)).note,
          latest,
          "Stale publication changed source",
        );
        await engine.publishDraft(
          saved.noteId,
          "third-draft",
          3,
          wall + 1,
          "draft-publish-3",
          [phone],
        );
        equal(
          (await engine.view(saved.noteId)).note?.localRevision,
          3,
          "Publication added an editor revision",
        );
      },
    );
    await check(
      "remoteHeadsAndMaintenancePreserveDraftUntilPermanentPurge",
      async () => {
        const { store, engine } = open("draft-remote");
        const saved = await engine.saveDraft(fixture(), 0, "local-draft");
        await engine.maintenance(saved.noteId, wall);
        equal(
          (await engine.view(saved.noteId)).note,
          saved,
          "Headless draft lost in maintenance",
        );
        const receipt = await engine.applyEdit(
          edit("draft-remote-1"),
          wall + 1,
          new Set([phone]),
          [web],
        );
        assert(
          receipt.committed && receipt.outcome === "applied",
          "Remote head not durably received",
        );
        let view = await engine.view(saved.noteId);
        equal(view.note, saved, "Remote head overwrote saved local draft");
        equal(view.head?.editId, "draft-remote-1", "Remote head missing");
        equal(
          view.draft?.baseEditId,
          null,
          "Remote receipt rewrote draft base",
        );
        equal(
          (view.delivery?.packet as Edit).note.bodyMarkdown,
          "Synthetic edit draft-remote-1",
          "Unstamped draft leaked into delivery",
        );
        const next = await engine.saveDraft(
          { ...saved, bodyMarkdown: "Synthetic continued local draft" },
          1,
          "continued-draft",
        );
        view = await engine.view(saved.noteId);
        equal(
          view.draft?.baseEditId,
          null,
          "Coalescing rewrote original null base",
        );
        await engine.maintenance(saved.noteId, wall + HISTORY_MS + 1);
        equal(
          (await engine.view(saved.noteId)).note,
          next,
          "Pruning overwrote draft",
        );
        const metadata = (await store.read(saved.noteId, [])).rows.find((row) =>
          row.key.startsWith("draft/"),
        );
        assert(
          metadata && !JSON.stringify(metadata).includes("Synthetic"),
          "Draft marker duplicates body",
        );
        await engine.applyPurge(
          { ...marker(), deviceId: phone },
          new Set([phone]),
          [web],
        );
        view = await engine.view(saved.noteId);
        assert(
          !view.note && !view.draft && !view.head && !view.history.length,
          "Purge retained draft content",
        );
        const rows = await store.read(saved.noteId, []);
        assert(
          !JSON.stringify(rows).includes("Synthetic"),
          "Purge retained source",
        );
        await reject(
          () => engine.saveDraft(saved, 0, "resurrection"),
          "Purged draft resurrected",
        );
        await reject(
          () =>
            engine.publishDraft(
              saved.noteId,
              "continued-draft",
              2,
              wall + 2,
              "resurrection",
              [phone],
            ),
          "Purged draft published",
        );
      },
    );
    await check("concurrentDraftSaveInvalidatesPausedPublication", async () => {
      const first = open("draft-race"),
        second = open("draft-race");
      const input = fixture();
      const both = await Promise.all([
        first.engine.saveDraft(input, 0, "same-draft"),
        second.engine.saveDraft(input, 0, "same-draft"),
      ]);
      equal(both[0], both[1], "Concurrent identical retries diverged");
      await reject(
        () =>
          first.engine.saveDraft(
            { ...both[0], bodyMarkdown: "Changed same generation" },
            0,
            "same-draft",
          ),
        "Reused generation changed source",
      );
      let release = () => {},
        notify = () => {};
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        notify = resolve;
      });
      let pause = true;
      const delayed = new DurableReplica(
        {
          read: (id, keys) => first.store.read(id, keys),
          async commit(revision, changes) {
            if (
              pause &&
              changes.some((change) => change.key.startsWith("head/"))
            ) {
              pause = false;
              notify();
              await waiting;
            }
            return first.store.commit(revision, changes);
          },
          close: () => first.store.close(),
        },
        library,
        device,
      );
      const publishing = delayed.publishDraft(
        "synthetic-note",
        "same-draft",
        1,
        wall,
        "paused-publication",
        [phone],
      );
      const observed = publishing.then(() => {
        throw new Error("Publication did not pause");
      });
      void observed.catch(() => {});
      await Promise.race([started, observed]);
      const latest = await second.engine
        .saveDraft(
          { ...both[0], bodyMarkdown: "Synthetic draft wins capture race" },
          1,
          "new-generation",
        )
        .finally(release);
      await reject(() => publishing, "Paused stale publication committed");
      const view = await first.engine.view("synthetic-note");
      equal(view.note, latest, "Stale publication lost latest local source");
      assert(
        !view.head &&
          !view.delivery &&
          view.draft?.generation === "new-generation",
        "Stale publication partially committed",
      );
      await first.engine.publishDraft(
        "synthetic-note",
        "new-generation",
        2,
        wall + 1,
        "current-publication",
        [phone],
      );
      equal(
        (await first.engine.view("synthetic-note")).head?.note.bodyMarkdown,
        latest.bodyMarkdown,
        "Current publication failed",
      );
    });
    return results;
  } finally {
    for (const store of stores) await store.close();
  }
}
