import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SQLiteReplicaStore } from "../../packages/peer-protocol/src/store-sqlite";
import { IndexedDBReplicaStore } from "../../packages/peer-protocol/src/store-idb";
import { runStoreContract } from "../fixtures/peer-store-contract";
import { DurableReplica } from "../../packages/peer-protocol/src/durable";
import { newNote } from "../../packages/core/src/index";

describe("M0 durable peer state, AC-02/09/10/12/21/25 partial", () => {
  it("upgrades logical identity 1 on a draft commit and preserves unknown future identities", async () => {
    const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-peer-"));
    const store = new SQLiteReplicaStore(
      join(folder, "logical-identity.sqlite3"),
    );
    try {
      const engine = new DurableReplica(
        store,
        "legacy-library",
        "legacy-device",
      );
      const first = await engine.saveLocal(
        newNote("local", "Synthetic legacy source"),
        0,
        1000,
        "legacy-edit",
        [],
      );
      const identity = (schema: number) => ({
        key: "meta/identity",
        value: {
          schema,
          libraryId: "legacy-library",
          deviceId: "legacy-device",
        },
      });
      let snapshot = await store.read(null, ["meta/identity"]);
      await store.commit(snapshot.revision, [
        { key: "meta/identity", row: identity(1) },
      ]);
      const saved = await engine.saveDraft(
        { ...first, bodyMarkdown: "Synthetic upgraded draft" },
        1,
        "upgraded-draft",
      );
      const view = await engine.view(saved.noteId);
      expect(view.head?.editId).toBe("legacy-edit");
      expect(view.note?.localRevision).toBe(2);
      snapshot = await store.read(null, ["meta/identity"]);
      expect(snapshot.rows[0].value).toEqual({
        ...identity(4).value,
        inventoryGeneration: 0,
        deliveryGeneration: 0,
      });
      for (const value of [
        identity(5).value,
        identity(4).value,
        null,
        false,
        {},
        "unknown",
      ]) {
        snapshot = await store.read(null, ["meta/identity"]);
        await store.commit(snapshot.revision, [
          { key: "meta/identity", row: { key: "meta/identity", value } },
        ]);
        const before = await store.read(saved.noteId, ["meta/identity"]);
        await expect(
          engine.saveDraft(saved, 2, "future-rejected"),
        ).rejects.toThrow("protocol version");
        expect(await store.read(saved.noteId, ["meta/identity"])).toEqual(
          before,
        );
      }
    } finally {
      await store.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it("passes the serialized commit/restart/failure contract on SQLite", async () => {
    const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-peer-"));
    try {
      const results = await runStoreContract(
        (name, hook) =>
          new SQLiteReplicaStore(join(folder, `${name}.sqlite3`), hook),
      );
      expect(Object.keys(results)).toHaveLength(11);
      expect(Object.values(results).every(Boolean)).toBe(true);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it("refuses non-experiment app databases and future M0 schemas before writes", async () => {
    const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-peer-"));
    try {
      const path = join(folder, "app-schema.sqlite3"),
        db = new DatabaseSync(path);
      db.exec(
        "CREATE TABLE notes(id TEXT PRIMARY KEY, body TEXT); INSERT INTO notes VALUES('fixture','Synthetic preserved source'); PRAGMA user_version=1;",
      );
      db.close();
      expect(() => new SQLiteReplicaStore(path)).toThrow("non-M0");
      const preserved = new DatabaseSync(path, { readOnly: true });
      expect(preserved.prepare("SELECT body FROM notes").get()?.body).toBe(
        "Synthetic preserved source",
      );
      expect(
        preserved
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type='table'",
          )
          .get()?.count,
      ).toBe(1);
      preserved.close();
      const futurePath = join(folder, "future.sqlite3"),
        store = new SQLiteReplicaStore(futurePath);
      await store.close();
      const future = new DatabaseSync(futurePath);
      future.exec("UPDATE m0_peer_meta SET schema=2");
      future.close();
      expect(() => new SQLiteReplicaStore(futurePath)).toThrow("schema");
      expect(() => new IndexedDBReplicaStore("peel-local-v1")).toThrow(
        "isolated",
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
