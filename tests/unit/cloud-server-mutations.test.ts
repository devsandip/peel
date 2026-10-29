import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  mutationHash,
  type CloudDraft,
} from "../../packages/cloud-protocol/src/index";
import {
  CLOUD_RECEIPT_MS,
  CLOUD_TRASH_MS,
  CloudMutationService,
  type CloudAccount,
  type CloudMutationRequest,
  type CloudServerStore,
} from "../../packages/cloud-protocol/src/server";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";

export const SERVER_NOW = 1800000000000;
const owner = "synthetic-owner";
const collectionId = "synthetic-cloud-library";
const scope = { version: 1 as const, collectionId, modeGeneration: 1 };
const account = (subject = owner): CloudAccount => ({
  version: 1,
  ownerSubject: subject,
  collectionId,
  modeGeneration: 1,
  status: "active",
  entitlement: "active",
  revision: 1,
  sequence: 0,
  wall: 0,
});
const draft = (noteId: string, bodyMarkdown: string): CloudDraft => ({
  schemaVersion: 1,
  collectionId,
  noteId,
  bodyMarkdown,
  state: "active",
  createdAt: "2026-10-27T03:00:00.000Z",
  updatedAt: "2026-10-27T03:00:00.000Z",
  deletedAt: null,
  purgeAfter: null,
});
const request = async (
  opId: string,
  noteId = "synthetic-note",
  baseRevision = 0,
  snapshot: CloudDraft | null = draft(noteId, "Synthetic original"),
): Promise<CloudMutationRequest> => {
  const mutation = {
    version: 1 as const,
    opId,
    noteId,
    baseRevision,
    kind: snapshot ? ("upsert" as const) : ("purge" as const),
    snapshot,
  };
  return {
    ...scope,
    mutation: { ...mutation, contentHash: await mutationHash(mutation) },
  };
};
async function fixture(
  run: (env: {
    path: string;
    store: SQLiteCloudServerStore;
    service: CloudMutationService;
    now: { value: number };
    fail: { value: boolean };
  }) => Promise<void>,
) {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-cloud-server-"));
  const path = join(folder, "server.sqlite3");
  const fail = { value: false },
    now = { value: SERVER_NOW };
  const store = new SQLiteCloudServerStore(path, () => {
    if (fail.value) throw Error("Synthetic server transaction abort");
  });
  try {
    await store.seedAccount(account());
    await run({
      path,
      store,
      service: new CloudMutationService(store, () => now.value),
      now,
      fail,
    });
  } finally {
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  }
}
const inspect = (path: string, sql: string) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
};

describe("isolated Cloud server conditional mutation contract, AC-09/10/12/13/22 partial", () => {
  it("returns one stable body-free receipt and the current head after later writes", async () =>
    fixture(async ({ service, store, path }) => {
      const first = await request("operation-1");
      const applied = await service.mutate(owner, first);
      const retry = await service.mutate(owner, first);
      expect(applied.receipt.outcome).toBe("applied");
      expect(retry.receipt).toEqual(applied.receipt);
      expect(retry.replayed).toBe(true);
      await service.mutate(
        owner,
        await request(
          "operation-2",
          "synthetic-note",
          1,
          draft("synthetic-note", "Synthetic later"),
        ),
      );
      const replay = await service.mutate(owner, first);
      expect(replay.receipt.revision).toBe(1);
      expect(replay.head.revision).toBe(2);
      expect(
        replay.head.kind === "note" && replay.head.snapshot.bodyMarkdown,
      ).toBe("Synthetic later");
      expect(
        (await store.read(owner, "synthetic-note")).account?.sequence,
      ).toBe(2);
      const operations = inspect(
        path,
        "SELECT receipt FROM m0_cloud_server_ops",
      );
      expect(operations).toHaveLength(2);
      expect(JSON.stringify(operations)).not.toContain("Synthetic");
      expect(
        inspect(
          path,
          "SELECT sequence FROM m0_cloud_server_changes ORDER BY sequence",
        ),
      ).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    }));
  it("rejects operation reuse and rolls back note, change, receipt and sequence together", async () =>
    fixture(async ({ service, store, path, fail }) => {
      const op = await request("rollback-op");
      const before = await store.read(owner, "synthetic-note", "rollback-op");
      fail.value = true;
      await expect(service.mutate(owner, op)).rejects.toThrow("Synthetic");
      expect(await store.read(owner, "synthetic-note", "rollback-op")).toEqual(
        before,
      );
      expect(
        inspect(path, "SELECT sequence FROM m0_cloud_server_changes"),
      ).toEqual([]);
      fail.value = false;
      expect((await service.mutate(owner, op)).receipt.sequence).toBe(1);
      await expect(
        service.mutate(
          owner,
          await request(
            "rollback-op",
            "synthetic-note",
            1,
            draft("synthetic-note", "Altered payload"),
          ),
        ),
      ).rejects.toMatchObject({ code: "operation-id-reused" });
      await expect(
        service.mutate(owner, await request("rollback-op", "different-note")),
      ).rejects.toMatchObject({ code: "operation-id-reused" });
      expect(
        (await store.read(owner, "synthetic-note")).account?.sequence,
      ).toBe(1);
    }));
  it("separates two owners with identical note and operation IDs and rejects request-supplied authority", async () =>
    fixture(async ({ service, store }) => {
      await store.seedAccount(account("other-synthetic-owner"));
      const a = await request("same-operation");
      const b = await request(
        "same-operation",
        "synthetic-note",
        0,
        draft("synthetic-note", "Other owner's synthetic note"),
      );
      await service.mutate(owner, a);
      await service.mutate("other-synthetic-owner", b);
      const left = await service.get(owner, scope, "synthetic-note"),
        right = await service.get(
          "other-synthetic-owner",
          scope,
          "synthetic-note",
        );
      expect(left.kind === "note" && left.snapshot.bodyMarkdown).toBe(
        "Synthetic original",
      );
      expect(right.kind === "note" && right.snapshot.bodyMarkdown).toBe(
        "Other owner's synthetic note",
      );
      await expect(service.mutate("unknown-owner", a)).rejects.toMatchObject({
        code: "account-unavailable",
      });
      const forged = {
        ...a,
        ownerSubject: "other-synthetic-owner",
        paid: true,
      };
      await expect(service.mutate(owner, forged)).rejects.toMatchObject({
        code: "unrecognized-record",
      });
      await expect(
        service.mutate(owner, { ...a, modeGeneration: 2 }),
      ).rejects.toMatchObject({ code: "collection-generation-mismatch" });
      const oldGenerationPurge = await request(
        "wrong-generation-purge",
        "synthetic-note",
        1,
        null,
      );
      await expect(
        service.mutate(owner, { ...oldGenerationPurge, modeGeneration: 2 }),
      ).rejects.toMatchObject({ code: "collection-generation-mismatch" });
      await expect(
        service.mutate(owner, { ...a, collectionId: "wrong-library" }),
      ).rejects.toMatchObject({ code: "snapshot-collection-mismatch" });
    }));
  it("rechecks current paid policy when a competing revocation wins before commit", async () =>
    fixture(async ({ store }) => {
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>((done) => (release = done)),
        reached = new Promise<void>((done) => (entered = done));
      let hold = true;
      const wrapped: CloudServerStore = {
        readAccount: (subject) => store.readAccount(subject),
        read: (subject, noteId, opId) => store.read(subject, noteId, opId),
        close: async () => {},
        commit: async (subject, noteId, transition) => {
          if (hold) {
            hold = false;
            entered();
            await gate;
          }
          return store.commit(subject, noteId, transition);
        },
      };
      const service = new CloudMutationService(wrapped, () => SERVER_NOW);
      const pending = service.mutate(owner, await request("policy-op"));
      void pending.catch(() => {});
      await reached;
      await store.setPolicy(owner, "active", "inactive");
      release();
      await expect(pending).rejects.toMatchObject({
        code: "cloud-entitlement-inactive",
      });
      const untouched = await store.read(owner, "synthetic-note", "policy-op");
      expect(untouched.head.kind).toBe("missing");
      expect(untouched.receipt).toBeNull();
      expect(untouched.account?.sequence).toBe(0);
      await store.setPolicy(owner, "active", "active");
      const op = await request("policy-op");
      await service.mutate(owner, op);
      await store.setPolicy(owner, "deleted", "inactive");
      await expect(service.mutate(owner, op)).rejects.toMatchObject({
        code: "account-deleted",
      });
      await expect(
        service.get(owner, scope, "synthetic-note"),
      ).rejects.toMatchObject({ code: "account-deleted" });
    }));
  it("serializes different-note sequence contention and preserves a same-note loser as a conflict", async () =>
    fixture(async ({ service, store, path }) => {
      const a = await request(
        "concurrent-a",
        "note-a",
        0,
        draft("note-a", "A"),
      );
      const b = await request(
        "concurrent-b",
        "note-b",
        0,
        draft("note-b", "B"),
      );
      const distinct = await Promise.all([
        service.mutate(owner, a),
        service.mutate(owner, b),
      ]);
      expect(distinct.map((value) => value.receipt.sequence).sort()).toEqual([
        1, 2,
      ]);
      const c = await request(
        "same-a",
        "same-note",
        0,
        draft("same-note", "First competing"),
      );
      const d = await request(
        "same-b",
        "same-note",
        0,
        draft("same-note", "Second competing"),
      );
      const same = await Promise.all([
        service.mutate(owner, c),
        service.mutate(owner, d),
      ]);
      expect(same.map((value) => value.receipt.outcome).sort()).toEqual([
        "applied",
        "conflict",
      ]);
      expect((await store.read(owner, "same-note")).head.revision).toBe(1);
      expect(
        inspect(
          path,
          "SELECT sequence FROM m0_cloud_server_changes ORDER BY sequence",
        ),
      ).toEqual([{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }]);
      const losing = same[0].receipt.outcome === "conflict" ? c : d;
      const stable = await service.mutate(owner, losing);
      expect(stable.receipt.outcome).toBe("conflict");
      expect(stable.replayed).toBe(true);
    }));
  it("uses server Trash deadlines and hides expired text before background cleanup", async () =>
    fixture(async ({ service, store, now, path, fail }) => {
      const trashed = {
        ...draft("synthetic-note", "Synthetic expired content"),
        state: "trashed" as const,
        deletedAt: "2099-01-01T00:00:00.000Z",
        purgeAfter: "2100-01-01T00:00:00.000Z",
      };
      const original = await request("trash-op", "synthetic-note", 0, trashed);
      const first = await service.mutate(owner, original);
      expect(first.head.kind === "note" && first.head.snapshot.deletedAt).toBe(
        new Date(SERVER_NOW).toISOString(),
      );
      expect(first.head.kind === "note" && first.head.snapshot.purgeAfter).toBe(
        new Date(SERVER_NOW + CLOUD_TRASH_MS).toISOString(),
      );
      now.value += 1000;
      await service.mutate(
        owner,
        await request("trash-edit", "synthetic-note", 1, {
          ...trashed,
          bodyMarkdown: "Synthetic second expired content",
        }),
      );
      const edited = await service.get(owner, scope, "synthetic-note");
      expect(edited.kind === "note" && edited.snapshot.purgeAfter).toBe(
        new Date(SERVER_NOW + CLOUD_TRASH_MS).toISOString(),
      );
      now.value = SERVER_NOW + CLOUD_TRASH_MS;
      fail.value = true;
      await expect(service.get(owner, scope, "synthetic-note")).rejects.toThrow(
        "Synthetic",
      );
      fail.value = false;
      expect((await service.get(owner, scope, "synthetic-note")).kind).toBe(
        "purged",
      );
      expect(inspect(path, "SELECT head FROM m0_cloud_server_notes")).toEqual(
        [],
      );
      expect(
        JSON.stringify(
          inspect(path, "SELECT receipt FROM m0_cloud_server_ops"),
        ),
      ).not.toContain("Synthetic expired content");
      expect(
        JSON.stringify(
          inspect(path, "SELECT receipt FROM m0_cloud_server_ops"),
        ),
      ).not.toContain("bodyMarkdown");
      const replay = await service.mutate(owner, original);
      expect(replay.receipt.outcome).toBe("applied");
      expect(replay.receipt.revision).toBe(1);
      expect(replay.head.kind).toBe("purged");
      const restore = await service.mutate(
        owner,
        await request("stale-restore", "synthetic-note", 3),
      );
      expect(restore.receipt.outcome).toBe("conflict");
      expect(restore.head.kind).toBe("purged");
      expect(
        (await store.read(owner, "synthetic-note")).account?.sequence,
      ).toBe(3);
    }));
  it("expires retry receipts logically at 90 days and never replays an old successful write", async () =>
    fixture(async ({ service, store, now }) => {
      const op = await request("old-operation");
      const first = await service.mutate(owner, op);
      now.value = first.receipt.expiresAt;
      const stale = await service.mutate(owner, op);
      expect(stale.replayed).toBe(false);
      expect(stale.receipt.outcome).toBe("conflict");
      expect(
        (await store.read(owner, "synthetic-note")).account?.sequence,
      ).toBe(1);
      expect(stale.receipt.expiresAt).toBe(now.value + CLOUD_RECEIPT_MS);
      now.value--;
      await expect(
        service.get(owner, scope, "synthetic-note"),
      ).rejects.toMatchObject({ code: "server-clock-moved-backwards" });
    }));
  it("retains body-free permanent deletion markers for never-created and existing identities", async () =>
    fixture(async ({ service, now, path }) => {
      const purge = await request("purge-first", "synthetic-note", 0, null);
      const deletion = await service.mutate(owner, purge);
      expect(deletion.head.kind).toBe("purged");
      expect(deletion.head.revision).toBe(1);
      now.value += 365 * 86400000;
      const recreate = await service.mutate(
        owner,
        await request("late-recreate", "synthetic-note", 1),
      );
      expect(recreate.receipt.outcome).toBe("conflict");
      expect(recreate.head.kind).toBe("purged");
      expect(inspect(path, "SELECT head FROM m0_cloud_server_notes")).toEqual(
        [],
      );
      expect(
        JSON.stringify(
          inspect(path, "SELECT head FROM m0_cloud_server_tombstones"),
        ),
      ).not.toContain("bodyMarkdown");
    }));
  it("rejects altered hashes, schemas and oversized serialized notes without partial writes", async () =>
    fixture(async ({ service, store }) => {
      const op = await request("validation-op");
      await expect(
        service.mutate(owner, {
          ...op,
          mutation: { ...op.mutation, contentHash: "0".repeat(64) },
        }),
      ).rejects.toMatchObject({ code: "invalid-mutation-hash-or-schema" });
      await expect(
        service.mutate(owner, {
          ...op,
          version: 2,
        } as unknown as CloudMutationRequest),
      ).rejects.toMatchObject({ code: "unsupported-request" });
      const large = await request(
        "large-item",
        "synthetic-note",
        0,
        draft("synthetic-note", "\u0000".repeat(80000)),
      );
      await expect(service.mutate(owner, large)).rejects.toMatchObject({
        code: "serialized-item-too-large",
      });
      const untouched = await store.read(owner, "synthetic-note");
      expect(untouched.account?.sequence).toBe(0);
      expect(untouched.head.kind).toBe("missing");
    }));
  it("reopens retry receipts and preserves future schemas and malformed outcomes", async () => {
    const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-server-schema-"));
    const path = join(folder, "owned.sqlite3");
    let store: SQLiteCloudServerStore | undefined;
    try {
      store = new SQLiteCloudServerStore(path);
      await store.seedAccount(account());
      const op = await request("reopened-op");
      const original = await new CloudMutationService(
        store,
        () => SERVER_NOW,
      ).mutate(owner, op);
      await store.close();
      store = new SQLiteCloudServerStore(path);
      const replay = await new CloudMutationService(
        store,
        () => SERVER_NOW,
      ).mutate(owner, op);
      expect(replay.replayed).toBe(true);
      expect(replay.receipt).toEqual(original.receipt);
      await store.close();
      store = undefined;
      const raw = new DatabaseSync(path);
      const malformed = { ...original.receipt, version: 2 };
      raw
        .prepare("UPDATE m0_cloud_server_ops SET receipt=?")
        .run(JSON.stringify(malformed));
      raw.close();
      store = new SQLiteCloudServerStore(path);
      await expect(
        new CloudMutationService(store, () => SERVER_NOW).mutate(owner, op),
      ).rejects.toThrow("stored Cloud server record");
      await store.close();
      store = undefined;
      const future = new DatabaseSync(path);
      future.exec("UPDATE m0_cloud_server_schema SET version=2");
      future.close();
      expect(() => new SQLiteCloudServerStore(path)).toThrow("schema");
      expect(
        JSON.parse(
          String(
            inspect(path, "SELECT receipt FROM m0_cloud_server_ops")[0].receipt,
          ),
        ),
      ).toEqual(malformed);
      const unrelated = join(folder, "unrelated.sqlite3"),
        app = new DatabaseSync(unrelated);
      app.exec(
        "CREATE TABLE notes(note_id TEXT); INSERT INTO notes VALUES('preserved');",
      );
      app.close();
      expect(() => new SQLiteCloudServerStore(unrelated)).toThrow("non-M0");
      expect(
        inspect(
          unrelated,
          "SELECT count(*) AS count FROM sqlite_master WHERE type='table'",
        )[0].count,
      ).toBe(1);
    } finally {
      await store?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
