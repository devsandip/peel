import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SQLiteReplicaStore } from "../../packages/peer-protocol/src/store-sqlite";
import { runTrustedContract } from "../fixtures/trusted-peer-contract";

it("orders durable trust, replay and direct-peer operations on actual SQLite, AC-13/21 partial", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-trust-"));
  try {
    const checks = await runTrustedContract(
      (name, hook) =>
        new SQLiteReplicaStore(join(folder, `${name}.sqlite3`), hook),
    );
    expect(Object.keys(checks)).toHaveLength(11);
    expect(Object.values(checks).every(Boolean)).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
