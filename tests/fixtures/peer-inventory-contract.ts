import { newNote } from "../../packages/core/src/index";
import {
  DurableReplica,
  type ReplicaStore,
  type StoreIdentity,
} from "../../packages/peer-protocol/src/durable";
import {
  PeerInventory,
  MAX_SCAN_ROWS,
  MAX_SCAN_BYTES,
  type InventoryCursor,
  type InventoryPage,
  type InventoryItem,
  type PendingItem,
  type ScanRequest,
} from "../../packages/peer-protocol/src/inventory";
import { createIdentity } from "../../packages/peer-protocol/src/auth";
import { TrustedReplica } from "../../packages/peer-protocol/src/trusted";
import type { StoreFactory } from "./peer-store-contract";
const library = "synthetic-inventory",
  owner = "1".repeat(64),
  phone = "2".repeat(64),
  web = "3".repeat(64);
const wall = 1793030400000;
function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
const equal = (a: unknown, b: unknown, label: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), label);
const rejected = async (run: () => Promise<unknown>, label: string) => {
  let failed = false;
  try {
    await run();
  } catch {
    failed = true;
  }
  assert(failed, label);
};
export async function runInventoryContract(factory: StoreFactory) {
  const checks: Record<string, boolean> = {},
    stores = new Set<ReplicaStore>();
  const open = (name: string, hook?: () => void) => {
    const store = factory(`inventory-${name}`, hook);
    stores.add(store);
    return {
      store,
      engine: new DurableReplica(store, library, owner),
      inventory: new PeerInventory(store, library, owner),
    };
  };
  const note = (id: string, source = "Synthetic inventory source") => ({
    ...newNote("local", source),
    noteId: id,
  });
  const identity = async (store: ReplicaStore) =>
    (await store.read(null, ["meta/identity"])).rows[0].value as StoreIdentity;
  const check = async (name: string, run: () => Promise<void>) => {
    await run();
    checks[name] = true;
  };
  const collect = async (
    inventory: PeerInventory,
    peerId: string | null = null,
    limit = 7,
  ) => {
    const entries: (InventoryItem | PendingItem)[] = [];
    let cursor: InventoryCursor | null = null,
      pages = 0;
    do {
      const page: InventoryPage<InventoryItem | PendingItem> =
        peerId === null
          ? await inventory.inventoryPage(cursor, limit)
          : await inventory.pendingPage(peerId, cursor, limit);
      assert(
        !page.changed && page.entries.length <= limit && page.scanned <= limit,
        "Unexpected page bound or drift",
      );
      assert(
        new TextEncoder().encode(JSON.stringify(page.entries)).length <=
          MAX_SCAN_BYTES,
        "Page bytes exceeded",
      );
      assert(
        page.complete === (page.cursor === null),
        "Incomplete cursor state",
      );
      entries.push(...page.entries);
      cursor = page.cursor;
      assert(++pages < 1000, "Inventory did not advance");
    } while (cursor);
    return entries;
  };
  try {
    await check(
      "emptyAndLegacyStoresUpgradeWithoutRewritingNotesAndFailedUpgradeRollsBack",
      async () => {
        const empty = open("empty");
        equal(await collect(empty.inventory), [], "Fresh inventory not empty");
        const { store, engine, inventory } = open("legacy");
        await engine.saveLocal(note("legacy-note"), 0, wall, "legacy-edit", [
          phone,
        ]);
        const before = await engine.view("legacy-note");
        for (const schema of [1, 2, 3]) {
          const snapshot = await store.read(null, ["meta/identity"]);
          await store.commit(snapshot.revision, [
            {
              key: "meta/identity",
              row: {
                key: "meta/identity",
                value: { schema, libraryId: library, deviceId: owner },
              },
            },
          ]);
          const entries = await collect(inventory);
          assert(
            entries.length === 1 && entries[0].generation === "legacy-edit",
            "Legacy head missing",
          );
          equal(
            await engine.view("legacy-note"),
            before,
            "Upgrade rewrote a note",
          );
          equal(
            await identity(store),
            {
              schema: 4,
              libraryId: library,
              deviceId: owner,
              inventoryGeneration: 0,
              deliveryGeneration: 0,
            },
            "Legacy counters not initialized",
          );
        }
        let fail = false;
        const failure = open("upgrade-failure", () => {
          if (fail) throw new Error("Synthetic upgrade failure");
        });
        const prior = await failure.store.read(null, ["meta/identity"]);
        fail = true;
        await rejected(
          () => failure.inventory.inventoryPage(),
          "Failed upgrade acknowledged",
        );
        equal(
          await failure.store.read(null, ["meta/identity"]),
          prior,
          "Upgrade partially committed",
        );
        fail = false;
        equal(await collect(failure.inventory), [], "Upgrade retry failed");
      },
    );
    await check(
      "boundedMetadataPagesIncludeHeadsAndPermanentPurgesWithoutSourceOrDrafts",
      async () => {
        const { store, engine, inventory } = open("pages");
        for (let i = 0; i < 95; i++) {
          const id = `note-${String(i).padStart(3, "0")}`;
          await engine.saveLocal(
            note(
              id,
              i === 0
                ? "s".repeat(262144)
                : "Synthetic private source ".repeat(40),
            ),
            0,
            wall + i,
            `edit-${i}`,
            [phone],
          );
          if (i > 0 && i % 5 === 0)
            await engine.applyPurge(
              {
                protocol: 1,
                libraryId: library,
                noteId: id,
                purgeId: `purge-${i}`,
                deviceId: owner,
                purgedAt: wall + i,
              },
              new Set([owner]),
              [phone],
              1,
            );
        }
        await engine.saveDraft(
          note("unpublished-draft", "Synthetic unpublished content"),
          0,
          "draft-only",
        );
        const entries = await collect(inventory);
        assert(
          entries.length === 95 &&
            new Set(entries.map((entry) => entry.noteId)).size === 95,
          "Pagination missed or duplicated identities",
        );
        assert(
          entries.some((entry) => entry.kind === "purge") &&
            entries.some((entry) => entry.kind === "edit"),
          "Missing head or purge phase",
        );
        const text = JSON.stringify(entries);
        assert(
          !text.includes("bodyMarkdown") &&
            !text.includes("Synthetic private source") &&
            !text.includes("unpublished-draft") &&
            text.length < 100000,
          "Source leaked into metadata",
        );
        const page = await store.scan!({
          phase: "head",
          after: null,
          limit: MAX_SCAN_ROWS,
        });
        assert(
          page.scanned <= MAX_SCAN_ROWS &&
            !JSON.stringify(page.rows).includes("bodyMarkdown"),
          "Adapter returned head source",
        );
      },
    );
    await check(
      "headGenerationIgnoresReceiptTrustDraftAndStaleEditWritesButDetectsPublishedChanges",
      async () => {
        const { store, engine, inventory } = open("generations");
        for (let i = 0; i < 4; i++)
          await engine.saveLocal(
            note(`stable-${i}`),
            0,
            wall + i,
            `stable-edit-${i}`,
            [phone],
          );
        const page = await inventory.inventoryPage(null, 1),
          before = await identity(store);
        await engine.acknowledge("stable-0", "stable-edit-0", phone, "edit");
        const peer = await createIdentity(),
          trusted = new TrustedReplica(store, library, owner, () => wall);
        await trusted.confirmPeer(peer);
        await trusted.revokePeer(peer.deviceId);
        const existing = (await engine.view("stable-0")).note!;
        await engine.saveDraft(
          { ...existing, bodyMarkdown: "Synthetic new unstamped source" },
          1,
          "draft-new",
        );
        await engine.applyEdit(
          {
            protocol: 1,
            libraryId: library,
            editId: "older-remote",
            stamp: { physical: wall - 1, logical: 0, deviceId: phone },
            note: note("stable-1"),
          },
          wall + 10,
          new Set([phone]),
        );
        equal(
          (await identity(store)).inventoryGeneration,
          before.inventoryGeneration,
          "Non-head work invalidated inventory",
        );
        assert(
          !(await inventory.inventoryPage(page.cursor, 1)).changed,
          "Receipt/trust/draft/stale write restarted page",
        );
        await engine.publishDraft(
          "stable-0",
          "draft-new",
          2,
          wall + 20,
          "published-new",
          [phone],
        );
        const changed = await inventory.inventoryPage(page.cursor, 1);
        assert(
          changed.changed &&
            !changed.complete &&
            !changed.cursor &&
            !changed.entries.length,
          "Published head did not invalidate cursor",
        );
        let cursor = (await inventory.inventoryPage(null, 64)).cursor!;
        assert(cursor.phase === "tombstone", "Missing purge phase cursor");
        await engine.applyPurge(
          {
            protocol: 1,
            libraryId: library,
            noteId: "stable-1",
            purgeId: "later-purge",
            deviceId: owner,
            purgedAt: wall + 21,
          },
          new Set([owner]),
          [phone],
        );
        assert(
          (await inventory.inventoryPage(cursor)).changed,
          "Purge did not invalidate old phase",
        );
      },
    );
    await check(
      "targetFilteredPendingPagesAdvanceEvenWhenEmptyAndRefuseForeignCursors",
      async () => {
        const { store, engine, inventory } = open("targets");
        for (let i = 0; i < 30; i++)
          await engine.saveLocal(
            note(`target-${String(i).padStart(2, "0")}`),
            0,
            wall + i,
            `target-edit-${i}`,
            [i > 0 && i % 10 === 0 ? phone : web],
          );
        const first = await inventory.pendingPage(phone, null, 3);
        assert(
          first.entries.length === 0 &&
            first.scanned === 3 &&
            first.cursor &&
            !first.complete,
          "Empty filtered page lost progress",
        );
        const entries = await collect(inventory, phone, 3);
        equal(
          entries.map((entry) => entry.noteId),
          ["target-10", "target-20"],
          "Wrong pending target set",
        );
        assert(
          !JSON.stringify(entries).includes(web) &&
            !JSON.stringify(entries).includes("awaiting"),
          "Other target list leaked",
        );
        const before = await store.read(null, ["meta/identity"]);
        for (const invalid of [
          () => inventory.pendingPage(web, first.cursor),
          () =>
            inventory.pendingPage(phone, {
              ...first.cursor!,
              version: 2,
            } as unknown as InventoryCursor),
          () =>
            inventory.pendingPage(phone, {
              ...first.cursor!,
              libraryId: "another-library",
            }),
          () =>
            inventory.pendingPage(phone, { ...first.cursor!, deviceId: web }),
          () =>
            inventory.pendingPage(phone, {
              ...first.cursor!,
              after: "head/target-10",
            }),
          () => inventory.inventoryPage(false as unknown as InventoryCursor),
          () => inventory.inventoryPage("" as unknown as InventoryCursor),
          () => inventory.inventoryPage(null, 0),
          () => inventory.inventoryPage(null, 65),
        ])
          await rejected(invalid, "Invalid inventory request accepted");
        equal(
          await store.read(null, ["meta/identity"]),
          before,
          "Rejected cursor changed store",
        );
      },
    );
    await check(
      "oneGenerationResolutionAvoidsDraftHistoryAndRefusesUnsignedForwarding",
      async () => {
        const { store, engine, inventory } = open("resolve");
        const saved = await engine.saveLocal(
          note("resolve-note", "Synthetic committed source"),
          0,
          wall,
          "resolve-edit",
          [phone],
        );
        const reference = (await inventory.pendingPage(phone)).entries[0];
        await engine.saveDraft(
          { ...saved, bodyMarkdown: "Synthetic unstamped replacement" },
          1,
          "resolve-draft",
        );
        const reads: { noteId: string | null; keys: string[] }[] = [];
        const narrow: ReplicaStore = {
          read: async (noteId, keys) => {
            reads.push({ noteId, keys });
            return store.read(noteId, keys);
          },
          commit: (r, c) => store.commit(r, c),
          close: async () => {},
        };
        const resolver = new PeerInventory(narrow, library, owner);
        const resolved = await resolver.resolvePending(phone, reference);
        assert(
          resolved.outcome === "ready" &&
            resolved.packet.kind === "edit" &&
            resolved.packet.edit.note.bodyMarkdown ===
              "Synthetic committed source",
          "Resolver leaked draft projection",
        );
        assert(
          reads.every(
            (read) =>
              read.noteId === null &&
              read.keys.every(
                (key) =>
                  key === "meta/identity" ||
                  ["head/", "tombstone/", "pending/"].some((prefix) =>
                    key.startsWith(prefix),
                  ),
              ),
          ),
          "Resolver loaded note history/projection",
        );
        await engine.publishDraft(
          "resolve-note",
          "resolve-draft",
          2,
          wall + 1,
          "resolve-new",
          [phone],
        );
        equal(
          (await resolver.resolvePending(phone, reference)).outcome,
          "changed",
          "Old generation resolved newer content",
        );
        assert(
          (await engine.view("resolve-note")).delivery?.generation ===
            "resolve-new",
          "Enumeration cleared delivery",
        );
        const current = (await inventory.pendingPage(phone)).entries[0];
        const latest = await resolver.resolvePending(phone, current);
        assert(
          latest.outcome === "ready" &&
            latest.packet.kind === "edit" &&
            latest.packet.edit.note.bodyMarkdown ===
              "Synthetic unstamped replacement",
          "Current committed generation missing",
        );
        equal(
          (await resolver.resolvePending(web, current)).outcome,
          "changed",
          "Wrong recipient resolved content",
        );
        await engine.applyEdit(
          {
            protocol: 1,
            libraryId: library,
            editId: "forwarded-edit",
            stamp: { physical: wall + 2, logical: 0, deviceId: phone },
            note: note("forwarded-note"),
          },
          wall + 2,
          new Set([phone]),
          [web],
        );
        const forwarded = (await inventory.pendingPage(web)).entries[0];
        equal(
          await inventory.resolvePending(web, forwarded),
          { outcome: "author-proof-required" },
          "Unsigned third-party note forwarded",
        );
        await engine.applyPurge(
          {
            protocol: 1,
            libraryId: library,
            noteId: "forwarded-note",
            purgeId: "remote-purge",
            deviceId: phone,
            purgedAt: wall + 3,
          },
          new Set([phone]),
          [web],
        );
        equal(
          await inventory.resolvePending(
            web,
            (await inventory.pendingPage(web)).entries[0],
          ),
          { outcome: "author-proof-required" },
          "Unsigned third-party purge forwarded",
        );
        await engine.applyPurge(
          {
            protocol: 1,
            libraryId: library,
            noteId: "resolve-note",
            purgeId: "own-purge",
            deviceId: owner,
            purgedAt: wall + 4,
          },
          new Set([owner]),
          [phone],
        );
        const own = (await inventory.pendingPage(phone)).entries.find(
          (entry) => entry.noteId === "resolve-note",
        )!;
        const purge = await inventory.resolvePending(phone, own);
        assert(
          purge.outcome === "ready" &&
            purge.packet.kind === "purge" &&
            !JSON.stringify(purge).includes("bodyMarkdown"),
          "Direct purge unavailable",
        );
      },
    );
    await check(
      "deliveryCursorDriftAndFailedAcknowledgementAreAtomicAcrossReopen",
      async () => {
        let fail = false;
        const hook = () => {
          if (fail) throw new Error("Synthetic receipt failure");
        };
        let { store, engine, inventory } = open("reopen", hook);
        for (let i = 0; i < 4; i++)
          await engine.saveLocal(
            note(`reopen-${i}`),
            0,
            wall + i,
            `reopen-edit-${i}`,
            [phone],
          );
        const page = await inventory.pendingPage(phone, null, 1),
          before = await identity(store);
        fail = true;
        await rejected(
          () => engine.acknowledge("reopen-0", "reopen-edit-0", phone, "edit"),
          "Failed receipt acknowledged",
        );
        equal(
          await identity(store),
          before,
          "Failed receipt advanced generation",
        );
        fail = false;
        await store.close();
        stores.delete(store);
        ({ store, engine, inventory } = open("reopen", hook));
        assert(
          !(await inventory.pendingPage(phone, page.cursor, 1)).changed,
          "Reopen lost generation",
        );
        await engine.acknowledge("reopen-0", "reopen-edit-0", phone, "edit");
        const changed = await inventory.pendingPage(phone, page.cursor, 1);
        assert(
          changed.changed && !changed.complete && !changed.entries.length,
          "Delivery mutation did not invalidate pending cursor",
        );
        equal(
          (await identity(store)).inventoryGeneration,
          before.inventoryGeneration,
          "Receipt changed head generation",
        );
      },
    );
    await check("concurrentWritersPreserveBothGenerationCounters", async () => {
      const first = open("race"),
        second = open("race");
      await collect(first.inventory);
      await Promise.all([
        first.engine.saveLocal(note("race-note"), 0, wall, "race-edit", [
          phone,
          web,
        ]),
        second.engine.applyPurge(
          {
            protocol: 1,
            libraryId: library,
            noteId: "race-purge",
            purgeId: "race-purge-id",
            deviceId: owner,
            purgedAt: wall,
          },
          new Set([owner]),
          [phone],
        ),
      ]);
      const before = await identity(first.store);
      equal(
        [before.inventoryGeneration, before.deliveryGeneration],
        [2, 2],
        "Concurrent mutation lost generation",
      );
      await Promise.all([
        first.engine.acknowledge("race-note", "race-edit", phone, "edit"),
        second.engine.acknowledge("race-note", "race-edit", web, "edit"),
      ]);
      const after = await identity(first.store);
      equal(
        [after.inventoryGeneration, after.deliveryGeneration],
        [2, 4],
        "Concurrent receipt lost generation",
      );
      equal(
        (await collect(first.inventory)).length,
        2,
        "Concurrent inventory lost identity",
      );
    });
    await check(
      "generationExhaustionKeepsClockIndependentDraftAndPendingDelivery",
      async () => {
        const { store, engine, inventory } = open("exhausted");
        const saved = await engine.saveLocal(
          note("exhausted-note"),
          0,
          wall,
          "exhausted-head",
          [phone],
        );
        const snapshot = await store.read(null, ["meta/identity"]);
        const current = snapshot.rows[0].value as StoreIdentity;
        await store.commit(snapshot.revision, [
          {
            key: "meta/identity",
            row: {
              key: "meta/identity",
              value: {
                ...current,
                inventoryGeneration: Number.MAX_SAFE_INTEGER,
                deliveryGeneration: Number.MAX_SAFE_INTEGER,
              },
            },
          },
        ]);
        const draft = await engine.saveDraft(
          {
            ...saved,
            bodyMarkdown: "Synthetic saved source beyond sync capacity",
          },
          1,
          "exhausted-draft",
        );
        await rejected(
          () =>
            engine.publishDraft(
              draft.noteId,
              "exhausted-draft",
              2,
              wall + 1,
              "overflow-publish",
              [phone],
            ),
          "Exhausted generation published",
        );
        const after = await engine.view(draft.noteId);
        assert(
          after.note?.bodyMarkdown === draft.bodyMarkdown &&
            after.draft?.generation === "exhausted-draft" &&
            after.head?.editId === "exhausted-head",
          "Sync counter failure lost draft",
        );
        await rejected(
          () =>
            engine.acknowledge(draft.noteId, "exhausted-head", phone, "edit"),
          "Overflow receipt cleared delivery",
        );
        assert(
          (await engine.view(draft.noteId)).delivery,
          "Failed receipt lost delivery",
        );
        assert(
          (await collect(inventory)).length === 1,
          "Counter ceiling blocked metadata read",
        );
      },
    );
    await check(
      "asyncScanAndCursorInputsRemainImmutableAcrossStorageWaits",
      async () => {
        const { store, engine, inventory } = open("immutable");
        for (const suffix of ["a", "b", "c"])
          await engine.saveLocal(
            note(`immutable-${suffix}`),
            0,
            wall,
            `immutable-edit-${suffix}`,
            [phone],
          );
        const request: ScanRequest = { phase: "head", after: null, limit: 1 };
        const scanning = store.scan!(request);
        request.phase = "pending";
        request.limit = 10000;
        request.peerId = web;
        const scanned = await scanning;
        assert(
          scanned.scanned === 1 &&
            scanned.rows.filter((row) => row.key.startsWith("head/")).length ===
              1 &&
            scanned.nextKey === "head/immutable-a",
          "Mutable scan request changed its validated bounds",
        );
        const first = await inventory.inventoryPage(null, 1);
        const cursor = first.cursor!;
        const paging = inventory.inventoryPage(cursor, 1);
        cursor.libraryId = "another-library";
        cursor.after = "head/immutable-c";
        cursor.generation++;
        const page = await paging;
        assert(
          !page.changed && page.entries[0].noteId === "immutable-b",
          "Mutable cursor changed an in-flight page",
        );
      },
    );
    await check(
      "cursorIntegrityRejectsForgedPhasePositionsAndSurvivesConcurrentInitialization",
      async () => {
        const first = open("cursor-integrity"),
          second = open("cursor-integrity");
        for (const suffix of ["a", "b", "c"])
          await first.engine.saveLocal(
            note(`integrity-${suffix}`),
            0,
            wall,
            `integrity-edit-${suffix}`,
            [phone],
          );
        const [one, two] = await Promise.all([
          first.inventory.inventoryPage(null, 1),
          second.inventory.inventoryPage(null, 1),
        ]);
        assert(
          !(await first.inventory.inventoryPage(two.cursor, 1)).changed,
          "Concurrent initialization issued incompatible cursors",
        );
        for (const forged of [
          { ...one.cursor!, phase: "tombstone" as const, after: null },
          { ...one.cursor!, after: "head/integrity-c" },
          { ...one.cursor!, generation: one.cursor!.generation + 1 },
          { ...one.cursor!, integrity: "0".repeat(64) },
        ])
          await rejected(
            () => first.inventory.inventoryPage(forged),
            "Unissued cursor skipped inventory",
          );
        const snapshot = await first.store.read(null, [
          "meta/inventory-cursor-key",
        ]);
        await first.store.commit(snapshot.revision, [
          { key: "meta/inventory-cursor-key", row: null },
        ]);
        const before = await first.store.read(null, [
          "meta/identity",
          "meta/inventory-cursor-key",
        ]);
        await rejected(
          () => first.inventory.inventoryPage(one.cursor),
          "Missing cursor key accepted old continuation",
        );
        equal(
          await first.store.read(null, [
            "meta/identity",
            "meta/inventory-cursor-key",
          ]),
          before,
          "Failed continuation replaced missing key",
        );
        const restarted = await first.inventory.inventoryPage(null, 1);
        await rejected(
          () => first.inventory.inventoryPage(one.cursor),
          "Reinitialized key accepted old continuation",
        );
        assert(
          !(await second.inventory.inventoryPage(restarted.cursor, 1)).changed,
          "New continuation unavailable across instances",
        );
        const bad = await first.store.read(null, ["meta/inventory-cursor-key"]);
        await first.store.commit(bad.revision, [
          {
            key: "meta/inventory-cursor-key",
            row: { key: "meta/inventory-cursor-key", value: false },
          },
        ]);
        await rejected(
          () => first.inventory.inventoryPage(),
          "Malformed cursor key overwritten",
        );
        const saved = await first.engine.saveDraft(
          note("cursor-independent-draft"),
          0,
          "cursor-independent",
        );
        assert(
          (await first.engine.view(saved.noteId)).draft,
          "Cursor key failure blocked local capture",
        );
      },
    );
    await check(
      "malformedAndFutureIdentitiesFailClosedWithoutReplacingContent",
      async () => {
        const { store, engine, inventory } = open("malformed");
        await engine.saveLocal(
          note("preserved-note"),
          0,
          wall,
          "preserved-edit",
          [phone],
        );
        const good = await identity(store);
        for (const bad of [
          { ...good, schema: 5 },
          { ...good, inventoryGeneration: null },
          { ...good, deliveryGeneration: -1 },
          { ...good, inventoryGeneration: Number.MAX_SAFE_INTEGER + 1 },
        ]) {
          const snapshot = await store.read(null, ["meta/identity"]);
          await store.commit(snapshot.revision, [
            { key: "meta/identity", row: { key: "meta/identity", value: bad } },
          ]);
          const before = await store.read("preserved-note", ["meta/identity"]);
          await rejected(
            () => inventory.inventoryPage(),
            "Malformed identity enumerated",
          );
          equal(
            await store.read("preserved-note", ["meta/identity"]),
            before,
            "Malformed identity/data overwritten",
          );
        }
      },
    );
    return checks;
  } finally {
    for (const store of stores) await store.close();
  }
}
