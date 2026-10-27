import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SQLiteReplicaStore } from "../../packages/peer-protocol/src/store-sqlite";
import { runInventoryContract } from "../fixtures/peer-inventory-contract";
it("enumerates bounded metadata and generation-scoped delivery on actual SQLite, AC-12/21 partial", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-inventory-"));
  try {
    const checks = await runInventoryContract(
      (name, hook) =>
        new SQLiteReplicaStore(join(folder, `${name}.sqlite3`), hook),
    );
    expect(Object.keys(checks)).toHaveLength(11);
    expect(Object.values(checks).every(Boolean)).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
