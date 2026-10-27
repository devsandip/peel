import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { IndexedDBCloudStateStore } from "../../packages/cloud-protocol/src/store-idb";
import { DurableCloudClient } from "../../packages/cloud-protocol/src/durable";
import {
  cloudScope,
  cloudDraft,
  runCloudDurableContract,
} from "../fixtures/cloud-durable-contract";

it("keeps Cloud source and pending work atomic across failures, restart and races on SQLite, AC-02/09/12 partial", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-cloud-"));
  try {
    const report = await runCloudDurableContract(
      (name, hook) =>
        new SQLiteCloudStateStore(join(folder, `${name}.sqlite3`), hook),
    );
    expect(Object.keys(report.checks)).toHaveLength(8);
    expect(Object.values(report.checks).every(Boolean)).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 15000);

it("preserves unrelated schemas, future versions and malformed stored Cloud state", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-cloud-schema-"));
  try {
    const unrelatedPath = join(folder, "unrelated.sqlite3"),
      unrelated = new DatabaseSync(unrelatedPath);
    unrelated.exec(
      "CREATE TABLE notes(note_id TEXT); INSERT INTO notes VALUES('preserved');",
    );
    unrelated.close();
    expect(() => new SQLiteCloudStateStore(unrelatedPath)).toThrow("non-M0");
    const check = new DatabaseSync(unrelatedPath, { readOnly: true });
    expect(
      check
        .prepare(
          "SELECT count(*) AS count FROM sqlite_master WHERE type='table'",
        )
        .get()?.count,
    ).toBe(1);
    check.close();
    const path = join(folder, "owned.sqlite3");
    let store = new SQLiteCloudStateStore(path);
    const repo = new DurableCloudClient(store, cloudScope);
    await repo.save(
      "synthetic-note",
      { kind: "upsert", snapshot: cloudDraft("Preserved source") },
      null,
    );
    await store.close();
    const corrupt = new DatabaseSync(path);
    const before = corrupt.prepare("SELECT state FROM m0_cloud_states").get()!
      .state;
    const state = JSON.parse(String(before));
    state.version = 3;
    corrupt
      .prepare("UPDATE m0_cloud_states SET state=?")
      .run(JSON.stringify(state));
    corrupt.close();
    store = new SQLiteCloudStateStore(path);
    await expect(store.read(cloudScope, "synthetic-note")).rejects.toThrow(
      "stored Cloud state",
    );
    await store.close();
    const future = new DatabaseSync(path);
    future.exec("UPDATE m0_cloud_meta SET schema=3");
    future.close();
    expect(() => new SQLiteCloudStateStore(path)).toThrow("schema");
    const preserved = new DatabaseSync(path, { readOnly: true });
    expect(
      JSON.parse(
        String(
          preserved.prepare("SELECT state FROM m0_cloud_states").get()!.state,
        ),
      ),
    ).toEqual(state);
    preserved.close();
    expect(() => new IndexedDBCloudStateStore("peel-local-v1")).toThrow(
      "isolated",
    );
    const scopePath = join(folder, "malformed-scope.sqlite3");
    const empty = new SQLiteCloudStateStore(scopePath);
    await empty.close();
    for (const malformedScope of ["false", "null", "{}"]) {
      const raw = new DatabaseSync(scopePath);
      raw.prepare("UPDATE m0_cloud_meta SET scope=?").run(malformedScope);
      raw.close();
      const rejected = new SQLiteCloudStateStore(scopePath);
      await expect(rejected.read(cloudScope, "synthetic-note")).rejects.toThrow(
        "scope",
      );
      await rejected.close();
      const check = new DatabaseSync(scopePath, { readOnly: true });
      expect(
        check.prepare("SELECT scope FROM m0_cloud_meta").get()?.scope,
      ).toBe(malformedScope);
      expect(
        check.prepare("SELECT count(*) AS count FROM m0_cloud_states").get()
          ?.count,
      ).toBe(0);
      check.close();
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
