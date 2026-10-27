import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { runCloudHeadContract } from "../fixtures/cloud-head-contract";
it("reconciles accepted receipts with newer heads without dropping local text, AC-09/12 partial", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-cloud-head-"));
  try {
    const result = await runCloudHeadContract(
      (name, hook) =>
        new SQLiteCloudStateStore(join(folder, `${name}.sqlite3`), hook),
    );
    expect(Object.keys(result.checks)).toHaveLength(4);
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 15000);
