import { expect, it } from "vitest";
import { runClockDiagnosticContract } from "../fixtures/clock-diagnostic-contract";
it("signed peer-relative clock diagnostics remain bounded and cannot authorize publication, FR-19 partial", async () => {
  const report = await runClockDiagnosticContract();
  expect(report.count).toBe(9);
  expect(report.realNotesUsed).toBe(false);
}, 15000);
