import { expect, it, vi } from "vitest";
import {
  cloudDevelopmentCost,
  validateCloudDeploymentPlan,
} from "../../infra/cloud/deployment-plan";
import { cloudPrivateHostingTemplate } from "../../infra/cloud/private-hosting";
import { cloudCleanupGuardTemplate } from "../../infra/cloud/cleanup";

const start = Date.parse("2026-10-27T12:00:00.000Z"),
  minute = 60000;
const iso = (time: number) => new Date(time).toISOString();
const run = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const now = start + 10000;
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
  return {
    now,
    plan: {
      format: 1,
      runId: run,
      createdAt: iso(start - minute),
      identity: { ...identity },
      lease: { startedAt: iso(start), expiresAt: iso(start + 90 * minute) },
      source: { ...source },
      quoteSha256: cloudDevelopmentCost(prices, now).quoteSha256,
    },
    authorization: {
      identity: { ...identity },
      authorizedUntil: iso(start + 120 * minute),
    },
    observed: {
      checkedAt: iso(start - 10000),
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
        sessionExpiresAt: iso(start + 120 * minute),
        refreshExpiresAt: null as string | null,
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
    ledger: { format: 1, runs: [] as { runId: string; cleanup: string }[] },
  };
}
type Fixture = ReturnType<typeof fixture>;
const check = (f: Fixture) =>
  validateCloudDeploymentPlan(
    f.plan,
    f.authorization,
    f.observed,
    f.ledger,
    f.now,
  );
function replace(f: Fixture, path: string, value: unknown) {
  const parts = path.split(".");
  let target = f as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1))
    target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = value;
}
function refuses(path: string, value: unknown) {
  const f = fixture();
  replace(f, path, value);
  expect(() => check(f)).toThrow(new Error("Unsafe Cloud development plan"));
}
const reprice = (f: Fixture) => {
  f.plan.quoteSha256 = cloudDevelopmentCost(
    f.observed.prices,
    f.now,
  ).quoteSha256;
};

it("returns a frozen new-run snapshot whose timing matches the actual hosting and independent cleanup factories", () => {
  const f = fixture(),
    approved = check(f);
  expect(approved).toMatchObject({
    runId: run,
    estimateUSD: 1.488729,
    runAllowanceUSD: 2,
    cleanupReserveUSD: 1,
    reservedEnvelopeUSD: 3,
    stopTestsAt: iso(start + 60 * minute),
    cleanupBy: iso(start + 120 * minute),
  });
  const main = cloudPrivateHostingTemplate({
    runId: approved.runId,
    lease: approved.lease,
    artifact: {
      sha256: approved.source.zipSha256,
      bytes: approved.source.zipBytes,
    },
  });
  const guard = cloudCleanupGuardTemplate({
    runId: approved.runId,
    lease: approved.lease,
  });
  expect(
    main.Resources.CloudFunction.Properties.Environment.Variables
      .PEEL_CLOUD_LEASE_EXPIRES_AT,
  ).toBe(approved.lease.expiresAt);
  expect(guard.Resources.DataCleanup.Properties.ScheduleExpression).toBe(
    "at(2026-10-27T13:30:00)",
  );
  for (const object of [
    approved,
    approved.identity,
    approved.lease,
    approved.source,
    approved.stacks,
  ])
    expect(Object.isFrozen(object)).toBe(true);
  f.plan.identity.accountId = "222233334444";
  f.plan.source.zipSha256 = "0".repeat(64);
  f.plan.lease.expiresAt = iso(start);
  expect(approved.identity.accountId).toBe("111122223333");
  expect(approved.source.zipSha256).toBe("d".repeat(64));
  expect(approved.lease.expiresAt).toBe(iso(start + 90 * minute));
});

it("compares planned and observed identities with an independent expected pin instead of trusting observed STS as authorization", () => {
  for (const prefix of ["plan", "observed", "authorization"])
    for (const [key, value] of [
      ["accountId", "222233334444"],
      ["profile", "other-profile"],
      ["region", "us-west-2"],
    ])
      refuses(prefix + ".identity." + key, value);
  const f = fixture();
  f.plan.identity.accountId = f.observed.identity.accountId = "222233334444";
  expect(() => check(f)).toThrow("Unsafe Cloud development plan");
  for (const value of ["synthetic-dev\n", "", "../admin"])
    refuses("plan.identity.profile", value);
});

it("rejects source, main, tested-commit, artifact and required-CI drift", () => {
  for (const field of [
    "commit",
    "tree",
    "lockSha256",
    "zipSha256",
    "templatesSha256",
  ])
    refuses(
      "observed.source." + field,
      "0".repeat(field === "commit" || field === "tree" ? 40 : 64),
    );
  for (const [path, value] of [
    ["observed.source.zipBytes", 1025],
    ["plan.source.zipBytes", "1024"],
    ["plan.source.zipBytes", 0],
    ["plan.source.zipBytes", 20 * 1024 * 1024 + 1],
    ["observed.mainCommit", "f".repeat(40)],
    ["observed.testedCommit", "f".repeat(40)],
    ["plan.source.commit", "A".repeat(40)],
    ["observed.worktree", "dirty"],
    ["observed.checks.native", "pending"],
    ["observed.checks.cloud-artifact", "failure"],
    ["observed.checks.web-and-core", true],
  ] as const)
    refuses(path, value);
  refuses("observed.checks", {
    "cloud-artifact": "success",
    "web-and-core": "success",
  });
});

it("enforces exact new-run freshness, lease and authorization cleanup boundaries without future-time tolerance", () => {
  const f = fixture();
  f.plan.createdAt = iso(f.now - 15 * minute);
  f.observed.checkedAt = iso(f.now - 2 * minute);
  f.now = start + 30000;
  // Rebuild the age-boundary observations for this explicit clock.
  f.plan.createdAt = iso(f.now - 15 * minute);
  f.observed.checkedAt = iso(f.now - 2 * minute);
  expect(() => check(f)).not.toThrow();
  refuses("plan.createdAt", iso(fixture().now - 15 * minute - 1));
  refuses("observed.checkedAt", iso(fixture().now - 2 * minute - 1));
  for (const path of ["plan.createdAt", "observed.checkedAt"])
    refuses(path, iso(fixture().now + 1));
  for (const clock of [start - 1, start + 30001, NaN, Infinity, 1.5, -1])
    refuses("now", clock);
  for (const expiry of [
    iso(start + 60 * minute),
    iso(start + 90 * minute + 1),
    "+010000-10-27T13:30:00.000Z",
  ])
    refuses("plan.lease.expiresAt", expiry);
  refuses("plan.lease.startedAt", "2026-10-27T12:00:00Z");
  refuses("authorization.authorizedUntil", iso(start + 120 * minute - 1));
});

it("requires session and cleanup runway, accepting proven refresh instead of pretending a short STS session lasts two hours", () => {
  const f = fixture();
  f.observed.credentials.sessionExpiresAt = iso(start + 30 * minute);
  expect(() => check(f)).toThrow();
  f.observed.credentials.refreshProven = true;
  f.observed.credentials.refreshExpiresAt = iso(start + 120 * minute);
  expect(() => check(f)).not.toThrow();
  f.observed.credentials.refreshExpiresAt = iso(start + 120 * minute - 1);
  expect(() => check(f)).toThrow();
  for (const [path, value] of [
    ["observed.credentials.sessionExpiresAt", iso(fixture().now)],
    ["observed.credentials.sessionExpiresAt", iso(start + 120 * minute - 1)],
    ["observed.credentials.refreshProven", "true"],
    ["observed.credentials.refreshProven", true],
    ["observed.credentials.refreshExpiresAt", iso(start + 120 * minute)],
  ] as const)
    refuses(path, value);
});

it("refuses insufficient reservation quota, target-name collisions, hooks and unknown/payload audit configurations", () => {
  for (const value of [100, 0, 101.5, "101", NaN, Infinity])
    refuses("observed.unreservedConcurrency", value);
  for (const field of ["targetNames", "hooks", "targetDataEvents"])
    for (const value of ["present", "unknown", true, "absent\n"])
      refuses("observed.safety." + field, value);
});

it("calculates and binds all marginal regional rates, retrieval time and source provenance without forecast overrides", () => {
  const f = fixture(),
    quote = f.observed.prices;
  expect(cloudDevelopmentCost(quote, f.now).estimateUSD).toBe(1.488729);
  const reversed = {
    ...quote,
    rates: Object.fromEntries(Object.entries(quote.rates).reverse()),
  };
  expect(cloudDevelopmentCost(reversed, f.now)).toEqual(
    cloudDevelopmentCost(quote, f.now),
  );
  for (const key of Object.keys(quote.rates)) {
    const changed = fixture();
    replace(
      changed,
      "observed.prices.rates." + key,
      quote.rates[key as keyof typeof quote.rates] * 1.01,
    );
    expect(() => check(changed)).toThrow();
    for (const value of [0, -1, NaN, Infinity, Number.MAX_VALUE, "0.2"])
      refuses("observed.prices.rates." + key, value);
  }
  for (const [path, value] of [
    ["observed.prices.currency", "INR"],
    ["observed.prices.region", "us-west-2"],
    ["observed.prices.sourceSha256", "0".repeat(64)],
    ["observed.prices.checkedAt", iso(f.now - 1000)],
    ["plan.quoteSha256", "0".repeat(64)],
  ])
    refuses(path, value);
  quote.checkedAt = iso(f.now - 24 * 60 * minute);
  reprice(f);
  expect(() => check(f)).not.toThrow();
  quote.checkedAt = iso(f.now - 24 * 60 * minute - 1);
  expect(() => cloudDevelopmentCost(quote, f.now)).toThrow();
  quote.checkedAt = iso(f.now + 1);
  expect(() => cloudDevelopmentCost(quote, f.now)).toThrow();
  const tiny = fixture();
  for (const key of Object.keys(tiny.observed.prices.rates))
    replace(tiny, "observed.prices.rates." + key, Number.MIN_VALUE);
  expect(cloudDevelopmentCost(tiny.observed.prices, tiny.now).estimateUSD).toBe(
    0.250012,
  );
});

it("rounds conservatively and rejects a recomputed forecast one microdollar above the USD 2 allowance", () => {
  const f = fixture();
  f.observed.prices.rates.secretMonth +=
    2 - cloudDevelopmentCost(f.observed.prices, f.now).estimateUSD;
  reprice(f);
  expect(check(f).estimateUSD).toBe(2);
  f.observed.prices.rates.secretMonth = Number(
    (f.observed.prices.rates.secretMonth + 0.000001).toFixed(6),
  );
  reprice(f);
  expect(cloudDevelopmentCost(f.observed.prices, f.now).estimateUSD).toBe(
    2.000001,
  );
  expect(() => check(f)).toThrow();
});

it("reserves two fixed run slots and a separate cleanup dollar, refusing duplicate, unresolved or third attempts", () => {
  const f = fixture();
  f.ledger.runs = [{ runId: other, cleanup: "verified" }];
  expect(check(f).reservedEnvelopeUSD).toBe(5);
  for (const runs of [
    [{ runId: run, cleanup: "verified" }],
    [{ runId: other, cleanup: "pending" }],
    [{ runId: other, cleanup: "unknown" }],
    [
      { runId: other, cleanup: "verified" },
      { runId: run, cleanup: "verified" },
    ],
    [{ runId: "unowned", cleanup: "verified" }],
  ])
    refuses("ledger.runs", runs);
  const getter = vi.fn(() => ({ runId: other, cleanup: "verified" }));
  Object.defineProperty(f.ledger.runs, "0", { get: getter });
  expect(() => check(f)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it("rejects extra sensitive fields, custom objects, accessors and coercion with one private error", () => {
  for (const path of [
    "plan.token",
    "plan.identity.password",
    "plan.source.note",
    "plan.lease.cursorKey",
    "authorization.token",
    "observed.token",
    "observed.checks.extra",
    "observed.credentials.accessKey",
    "observed.safety.note",
    "observed.prices.forecastUSD",
    "observed.prices.rates.extra",
    "ledger.token",
  ])
    refuses(path, "synthetic-sensitive-marker");
  const getter = vi.fn(() => "synthetic-sensitive-marker"),
    toString = vi.fn(() => "111122223333");
  const f = fixture();
  Object.defineProperty(f.plan, "runId", { get: getter, enumerable: true });
  expect(() => check(f)).toThrow(new Error("Unsafe Cloud development plan"));
  expect(getter).not.toHaveBeenCalled();
  refuses("plan.identity.accountId", { toString });
  expect(toString).not.toHaveBeenCalled();
  refuses(
    "plan.identity",
    Object.create({
      profile: "synthetic-dev",
      accountId: "111122223333",
      region: "us-east-1",
    }),
  );
  const symbol = fixture();
  Object.assign(symbol.plan, {
    [Symbol("token")]: "synthetic-sensitive-marker",
  });
  expect(() => check(symbol)).toThrow();
});
