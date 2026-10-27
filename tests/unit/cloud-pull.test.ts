import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { DurableCloudClient } from "../../packages/cloud-protocol/src/durable";
import {
  createCloudClient,
  saveCloudDraft,
} from "../../packages/cloud-protocol/src/index";
import { cloudScope, cloudDraft } from "../fixtures/cloud-durable-contract";
import { runCloudPullContract } from "../fixtures/cloud-pull-contract";
it("commits downloaded heads and cursor atomically and preserves local work on SQLite", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-cloud-pull-"));
  try {
    const result = await runCloudPullContract(
      (name, hook) =>
        new SQLiteCloudStateStore(join(folder, `${name}.sqlite3`), hook),
    );
    expect(Object.keys(result.checks)).toHaveLength(4);
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 15000);
it("upgrades recognized version-one Cloud stores atomically and preserves drafts on migration failure", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-cloud-migrate-"));
  const path = join(folder, "legacy.sqlite3");
  const current = saveCloudDraft(
    createCloudClient(cloudScope.collectionId, "synthetic-note"),
    { kind: "upsert", snapshot: cloudDraft("Preserved legacy source") },
  );
  const { observed: _observed, ...old } = current,
    legacy = { ...old, version: 1 };
  try {
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE m0_cloud_meta(id INTEGER PRIMARY KEY CHECK(id=1), schema INTEGER NOT NULL, scope TEXT); CREATE TABLE m0_cloud_states(note_id TEXT PRIMARY KEY,generation INTEGER NOT NULL,state TEXT NOT NULL);",
    );
    db.prepare("INSERT INTO m0_cloud_meta VALUES(1,1,?)").run(
      JSON.stringify(cloudScope),
    );
    db.prepare("INSERT INTO m0_cloud_states VALUES(?,?,?)").run(
      "synthetic-note",
      legacy.generation,
      JSON.stringify(legacy),
    );
    db.close();
    expect(
      () =>
        new SQLiteCloudStateStore(path, () => {
          throw Error("Migration interrupted");
        }),
    ).toThrow("Migration interrupted");
    const preserved = new DatabaseSync(path, { readOnly: true });
    expect(
      preserved.prepare("SELECT schema FROM m0_cloud_meta").get()?.schema,
    ).toBe(1);
    expect(
      preserved.prepare("SELECT state FROM m0_cloud_states").get()?.state,
    ).toBe(JSON.stringify(legacy));
    preserved.close();
    const store = new SQLiteCloudStateStore(path);
    try {
      const repo = new DurableCloudClient(store, cloudScope),
        migrated = (await repo.get("synthetic-note"))!;
      expect(migrated.version).toBe(2);
      expect(migrated.observed).toBeNull();
      expect(migrated.current?.snapshot?.bodyMarkdown).toBe(
        "Preserved legacy source",
      );
      await repo.save(
        "synthetic-note",
        { kind: "upsert", snapshot: cloudDraft("Saved after upgrade") },
        migrated.generation,
      );
    } finally {
      await store.close();
    }
    const upgraded = new DatabaseSync(path, { readOnly: true });
    expect(
      upgraded.prepare("SELECT schema FROM m0_cloud_meta").get()?.schema,
    ).toBe(2);
    upgraded.close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
