import { cloudDevelopmentCost } from "../../infra/cloud/deployment-plan.ts";

// Synthetic policy inputs only. These facts are not account, CI or managed-service evidence.
export const ledgerRunIds = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
export function cloudLedgerPlan(
  runId = ledgerRunIds[0],
  now = Date.parse("2026-10-27T12:00:10.000Z"),
) {
  const start = Math.floor(now / 1000) * 1000,
    iso = (t: number) => new Date(t).toISOString(),
    minute = 60000;
  const identity = {
    profile: "synthetic-dev",
    accountId: "111122223333",
    region: "us-east-1",
  };
  const source = {
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    lockSha256: "c".repeat(64),
    zipSha256: "d".repeat(64),
    zipBytes: 1024,
    templatesSha256: "e".repeat(64),
  };
  const prices = {
    checkedAt: iso(now - 60 * minute),
    region: "us-east-1",
    currency: "USD",
    sourceSha256: "f".repeat(64),
    rates: {
      lambdaRequestsPerMillion: 0.2,
      lambdaGbSecond: 0.0000166667,
      cognitoMau: 0.015,
      dynamoWritesPerMillion: 0.625,
      dynamoReadsPerMillion: 0.125,
      dynamoGbMonth: 0.25,
      secretMonth: 0.4,
      secretPerTenThousand: 0.05,
      s3GbMonth: 0.023,
      s3PutsPerThousand: 0.005,
      s3GetsPerThousand: 0.0004,
      schedulerPerMillion: 1,
    },
  };
  const cutoff = "2026-10-27T18:00:00.000Z";
  return {
    now,
    authorization: { identity: { ...identity }, authorizedUntil: cutoff },
    plan: {
      format: 1,
      runId,
      createdAt: iso(start - minute),
      identity: { ...identity },
      lease: { startedAt: iso(start), expiresAt: iso(start + 90 * minute) },
      source: { ...source },
      quoteSha256: cloudDevelopmentCost(prices, now).quoteSha256,
    },
    observed: {
      checkedAt: iso(now - 10000),
      identity: { ...identity },
      source: { ...source },
      mainCommit: source.commit,
      testedCommit: source.commit,
      checks: {
        "cloud-artifact": "success",
        "web-and-core": "success",
        native: "success",
      },
      worktree: "clean",
      credentials: {
        sessionExpiresAt: cutoff,
        refreshExpiresAt: null,
        refreshProven: false,
      },
      unreservedConcurrency: 101,
      safety: {
        targetNames: "absent",
        hooks: "absent",
        targetDataEvents: "absent",
      },
      prices,
    },
  };
}
