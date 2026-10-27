import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { SQLiteReplicaStore } from "../../packages/peer-protocol/src/store-sqlite";
import { runTrustedClockContract } from "../fixtures/trusted-clock-contract";

it("uses current durable trust for pre-session diagnostics without note authorization, FR-17/19 partial", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-clock-trust-"));
  try {
    const result = await runTrustedClockContract(
      (name) => new SQLiteReplicaStore(join(folder, `${name}.sqlite3`)),
    );
    expect(result).toEqual({
      count: 4,
      realNotesUsed: false,
      durableDiagnosticWrites: 0,
    });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 15000);
