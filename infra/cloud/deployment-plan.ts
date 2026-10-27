import { createHash } from "node:crypto";
import { cloudCleanupGuardTemplate, cloudDevStackNames } from "./cleanup.ts";

const minute = 60000;
const message = "Unsafe Cloud development plan";
const fail = (): never => {
  throw Error(message);
};
function privateCheck<T>(operation: () => T): T {
  try {
    return operation();
  } catch {
    return fail();
  }
}
function record<const K extends readonly string[]>(
  value: unknown,
  keys: K,
): Record<K[number], unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail();
  const own = Reflect.ownKeys(value),
    descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== "string" || !keys.includes(key))
  )
    return fail();
  for (const key of keys)
    if (!descriptors[key]?.enumerable || !("value" in descriptors[key]))
      return fail();
  return Object.fromEntries(
    keys.map((key) => [key, descriptors[key].value]),
  ) as Record<K[number], unknown>;
}
function text(value: unknown, pattern: RegExp, length?: number): string {
  if (
    typeof value !== "string" ||
    (length !== undefined && value.length !== length) ||
    pattern.exec(value)?.[0] !== value
  )
    return fail();
  return value;
}
const digest = (value: unknown, length = 64) =>
  text(value, /^[a-f0-9]+$/, length);
function timestamp(value: unknown): number {
  const iso = text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 24),
    time = Date.parse(iso);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== iso)
    return fail();
  return time;
}
function fresh(value: unknown, now: number, maxAge: number): string {
  const time = timestamp(value);
  if (time > now || now - time > maxAge) return fail();
  return value as string;
}
function identity(value: unknown) {
  const input = record(value, ["profile", "accountId", "region"]);
  if (input.region !== "us-east-1") return fail();
  return {
    profile: text(input.profile, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
    accountId: text(input.accountId, /^\d{12}$/, 12),
    region: "us-east-1" as const,
  };
}
function source(value: unknown) {
  const input = record(value, [
    "commit",
    "tree",
    "lockSha256",
    "zipSha256",
    "zipBytes",
    "templatesSha256",
  ]);
  if (
    typeof input.zipBytes !== "number" ||
    !Number.isSafeInteger(input.zipBytes) ||
    input.zipBytes <= 0 ||
    input.zipBytes > 20 * 1024 * 1024
  )
    return fail();
  return {
    commit: digest(input.commit, 40),
    tree: digest(input.tree, 40),
    lockSha256: digest(input.lockSha256),
    zipSha256: digest(input.zipSha256),
    zipBytes: input.zipBytes,
    templatesSha256: digest(input.templatesSha256),
  };
}
// Per-rate workload units; fixed incidental reserve is added separately.
const usage = {
  lambdaRequestsPerMillion: [64n, 1000000n],
  lambdaGbSecond: [1920n, 1n],
  cognitoMau: [2n, 1n],
  dynamoWritesPerMillion: [1n, 1n],
  dynamoReadsPerMillion: [1n, 1n],
  dynamoGbMonth: [1n, 10n],
  secretMonth: [1n, 1n],
  secretPerTenThousand: [1n, 100n],
  s3GbMonth: [1n, 40n],
  s3PutsPerThousand: [1n, 10n],
  s3GetsPerThousand: [1n, 10n],
  schedulerPerMillion: [1n, 10000n],
} as const;
const rateKeys = Object.keys(usage) as (keyof typeof usage)[];
function microdollars(rate: number, units: readonly [bigint, bigint]): bigint {
  // Preserve the normalized decimal rate, including scientific notation, without FP rounding.
  const [mantissa, exponent = "0"] = rate.toString().split("e"),
    [whole, fraction = ""] = mantissa.split("."),
    places = fraction.length - Number(exponent);
  let numerator = BigInt(whole + fraction) * units[0] * 1000000n,
    denominator: bigint = units[1];
  if (places >= 0) denominator *= 10n ** BigInt(places);
  else numerator *= 10n ** BigInt(-places);
  return (numerator + denominator - 1n) / denominator;
}

/** Pure conservative model. The later collector must authenticate official quote provenance/units. */
export function cloudDevelopmentCost(value: unknown, now: number) {
  return privateCheck(() => {
    if (!Number.isSafeInteger(now) || now < 0) return fail();
    const input = record(value, [
      "checkedAt",
      "region",
      "currency",
      "sourceSha256",
      "rates",
    ]);
    if (input.region !== "us-east-1" || input.currency !== "USD") return fail();
    const checkedAt = fresh(input.checkedAt, now, 24 * 60 * minute),
      raw = record(input.rates, rateKeys);
    const rates = Object.fromEntries(
      rateKeys.map((key) => {
        const rate = raw[key];
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)
          return fail();
        return [key, rate];
      }),
    ) as Record<(typeof rateKeys)[number], number>;
    const normalized = {
      checkedAt,
      region: "us-east-1",
      currency: "USD",
      sourceSha256: digest(input.sourceSha256),
      rates,
    };
    const micros = rateKeys.reduce(
      (total, key) => total + microdollars(rates[key], usage[key]),
      250000n,
    );
    if (micros > BigInt(Number.MAX_SAFE_INTEGER)) return fail();
    const estimateUSD = Number(micros) / 1e6;
    return Object.freeze({
      quoteSha256: createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex"),
      estimateUSD,
    });
  });
}

/** Validate a new-run snapshot only; never gate cleanup of already-owned resources with this. */
export function validateCloudDeploymentPlan(
  value: unknown,
  authorization: unknown,
  observed: unknown,
  ledger: unknown,
  now: number,
) {
  return privateCheck(() => {
    if (!Number.isSafeInteger(now) || now < 0) return fail();
    const plan = record(value, [
        "format",
        "runId",
        "createdAt",
        "identity",
        "lease",
        "source",
        "quoteSha256",
      ]),
      auth = record(authorization, ["identity", "authorizedUntil"]),
      evidence = record(observed, [
        "checkedAt",
        "identity",
        "source",
        "mainCommit",
        "testedCommit",
        "checks",
        "worktree",
        "credentials",
        "unreservedConcurrency",
        "safety",
        "prices",
      ]),
      prior = record(ledger, ["format", "runs"]);
    if (plan.format !== 1 || prior.format !== 1) return fail();
    const expected = identity(auth.identity),
      plannedIdentity = identity(plan.identity),
      actualIdentity = identity(evidence.identity);
    if (
      JSON.stringify(expected) !== JSON.stringify(plannedIdentity) ||
      JSON.stringify(expected) !== JSON.stringify(actualIdentity)
    )
      return fail();
    const runId = text(
        plan.runId,
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
        36,
      ),
      createdAt = fresh(plan.createdAt, now, 15 * minute),
      rawLease = record(plan.lease, ["startedAt", "expiresAt"]),
      started = timestamp(rawLease.startedAt),
      expires = timestamp(rawLease.expiresAt);
    if (
      started % 1000 ||
      expires % 1000 ||
      expires - started !== 90 * minute ||
      started > now ||
      now - started > 30000 ||
      timestamp(createdAt) > started
    )
      return fail();
    fresh(evidence.checkedAt, now, 2 * minute);
    const lease = {
      startedAt: rawLease.startedAt as string,
      expiresAt: rawLease.expiresAt as string,
    };
    // Exercise the actual IaC contract as well as this stricter new-run policy.
    cloudCleanupGuardTemplate({ runId, lease });
    const cleanupBy = expires + 30 * minute;
    if (timestamp(auth.authorizedUntil) < cleanupBy) return fail();
    const prepared = source(plan.source),
      current = source(evidence.source);
    if (
      JSON.stringify(prepared) !== JSON.stringify(current) ||
      digest(evidence.mainCommit, 40) !== prepared.commit ||
      digest(evidence.testedCommit, 40) !== prepared.commit ||
      evidence.worktree !== "clean"
    )
      return fail();
    const checks = record(evidence.checks, [
      "cloud-artifact",
      "web-and-core",
      "native",
    ]);
    if (Object.values(checks).some((check) => check !== "success"))
      return fail();
    const credentials = record(evidence.credentials, [
        "sessionExpiresAt",
        "refreshExpiresAt",
        "refreshProven",
      ]),
      session = timestamp(credentials.sessionExpiresAt);
    if (session <= now || typeof credentials.refreshProven !== "boolean")
      return fail();
    let usableUntil = session;
    if (credentials.refreshProven)
      usableUntil = Math.max(session, timestamp(credentials.refreshExpiresAt));
    else if (credentials.refreshExpiresAt !== null) return fail();
    if (
      usableUntil < cleanupBy ||
      typeof evidence.unreservedConcurrency !== "number" ||
      !Number.isSafeInteger(evidence.unreservedConcurrency) ||
      evidence.unreservedConcurrency < 101
    )
      return fail();
    const safety = record(evidence.safety, [
      "targetNames",
      "hooks",
      "targetDataEvents",
    ]);
    if (Object.values(safety).some((state) => state !== "absent"))
      return fail();
    const cost = cloudDevelopmentCost(evidence.prices, now);
    if (digest(plan.quoteSha256) !== cost.quoteSha256 || cost.estimateUSD > 2)
      return fail();
    if (
      !Array.isArray(prior.runs) ||
      Object.getPrototypeOf(prior.runs) !== Array.prototype ||
      prior.runs.length > 1 ||
      Reflect.ownKeys(prior.runs).length !== prior.runs.length + 1
    )
      return fail();
    for (let index = 0; index < prior.runs.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(prior.runs, index);
      if (!entry || !("value" in entry)) return fail();
      const run = record(entry.value, ["runId", "cleanup"]);
      cloudDevStackNames(run.runId as string);
      if (run.runId === runId || run.cleanup !== "verified") return fail();
    }
    return Object.freeze({
      format: 1 as const,
      runId,
      createdAt,
      identity: Object.freeze(plannedIdentity),
      lease: Object.freeze(lease),
      source: Object.freeze(prepared),
      quoteSha256: cost.quoteSha256,
      estimateUSD: cost.estimateUSD,
      runAllowanceUSD: 2 as const,
      cleanupReserveUSD: 1 as const,
      reservedEnvelopeUSD: (prior.runs.length + 1) * 2 + 1,
      stopTestsAt: new Date(expires - 30 * minute).toISOString(),
      cleanupBy: new Date(cleanupBy).toISOString(),
      stacks: Object.freeze(cloudDevStackNames(runId)),
    });
  });
}
