import { createHash } from "node:crypto";
import { readCloudJournalGenesis } from "./journal-genesis.ts";
import { readCloudRunPlanContext } from "./run-plan-context.ts";
import { cloudDevelopmentCost } from "./deployment-plan.ts";

type Input = {
  genesis: {
    json: string;
    sha256: string;
    anchor: Parameters<typeof readCloudJournalGenesis>[1];
  };
  ledger: { snapshot: unknown; sha256: string };
  observed: unknown;
};
class FactsFailure extends Error {
  constructor() {
    super("Initial reserved Cloud guard facts unavailable");
    Object.freeze(this);
  }
}
function fail(): never {
  throw new FactsFailure();
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  return Object.fromEntries(
    keys.map((k) => {
      if (!d[k]?.enumerable || !("value" in d[k])) return fail();
      return [k, d[k].value];
    }),
  );
}
function bytes(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    Buffer.byteLength(value) > max ||
    Buffer.from(value).toString("utf8") !== value
  )
    return fail();
  return value;
}
function digest(value: unknown, length = 64) {
  const s = bytes(value, length);
  if (s.length !== length || !/^[a-f0-9]+$/.test(s)) return fail();
  return s;
}
function uuid(value: unknown) {
  const s = bytes(value, 36);
  if (
    s.length !== 36 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      s,
    )
  )
    return fail();
  return s;
}
function timestamp(value: unknown) {
  const s = bytes(value, 24);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) ||
    !Number.isSafeInteger(Date.parse(s)) ||
    new Date(s).toISOString() !== s
  )
    return fail();
  return s;
}
function array(value: unknown, max: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    return fail();
  return Array.from({ length: value.length }, (_, i) => {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (!d?.enumerable || !("value" in d)) return fail();
    return d.value;
  });
}
function equalFields(
  value: Record<string, unknown>,
  expected: Record<string, unknown>,
) {
  for (const k of Object.keys(value))
    if (value[k] !== expected[k]) return fail();
}
function frozen<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function cleanup(value: unknown) {
  if (value === null) return null;
  const r = record(value, [
    "runId",
    "planSha256",
    "inventorySha256",
    "checkedAt",
  ]);
  return {
    runId: uuid(r.runId),
    planSha256: digest(r.planSha256),
    inventorySha256: digest(r.inventorySha256),
    checkedAt: timestamp(r.checkedAt),
  };
}
function ledger(
  value: unknown,
  pin: unknown,
  anchor: ReturnType<typeof readCloudJournalGenesis>["genesis"]["anchor"],
  now: number,
) {
  const l = record(value, [
      "format",
      "authorizationSha256",
      "runs",
      "snapshotSha256",
      "reservedEnvelopeUSD",
      "policyLedger",
    ]),
    expectedPin = digest(pin),
    authoritySha256 = digest(l.authorizationSha256);
  if (
    l.format !== 1 ||
    authoritySha256 !== hash(JSON.stringify(anchor.authority))
  )
    return fail();
  const runs = array(l.runs, 2).map((value, i) => {
    const r = record(value, [
      "slot",
      "runId",
      "planSha256",
      "reservedAt",
      "cleanup",
    ]);
    if (r.slot !== i + 1) return fail();
    const result = {
      slot: i + 1,
      runId: uuid(r.runId),
      planSha256: digest(r.planSha256),
      reservedAt: timestamp(r.reservedAt),
      cleanup: cleanup(r.cleanup),
    };
    if (
      Date.parse(result.reservedAt) > now ||
      (result.cleanup &&
        (result.cleanup.runId !== result.runId ||
          result.cleanup.planSha256 !== result.planSha256 ||
          Date.parse(result.cleanup.checkedAt) <
            Date.parse(result.reservedAt) ||
          Date.parse(result.cleanup.checkedAt) > now))
    )
      return fail();
    return result;
  });
  if (
    new Set(runs.map((r) => r.runId)).size !== runs.length ||
    l.reservedEnvelopeUSD !== runs.length * 2 + 1
  )
    return fail();
  const canonical = { format: 1, authorizationSha256: authoritySha256, runs },
    sha256 = hash(JSON.stringify(canonical)),
    policy = record(l.policyLedger, ["format", "runs"]);
  if (
    digest(l.snapshotSha256) !== sha256 ||
    expectedPin !== sha256 ||
    policy.format !== 1
  )
    return fail();
  const suppliedPolicy = array(policy.runs, 2).map((value) => {
    const p = record(value, ["runId", "cleanup"]);
    if (p.cleanup !== "verified" && p.cleanup !== "pending") return fail();
    return { runId: uuid(p.runId), cleanup: p.cleanup };
  });
  if (
    JSON.stringify(suppliedPolicy) !==
    JSON.stringify(
      runs.map((r) => ({
        runId: r.runId,
        cleanup: r.cleanup ? "verified" : "pending",
      })),
    )
  )
    return fail();
  const selected = runs.find((r) => r.runId === anchor.reservation.runId);
  if (
    !selected ||
    selected.slot !== runs.length ||
    selected.slot !== anchor.reservation.slot ||
    selected.planSha256 !== anchor.reservation.planSha256 ||
    selected.reservedAt !== anchor.reservation.reservedAt
  )
    return fail();
  if (selected.cleanup !== null) return fail();
  for (const prior of runs.slice(0, -1))
    if (
      !prior.cleanup ||
      Date.parse(prior.cleanup.checkedAt) > Date.parse(selected.reservedAt)
    )
      return fail();
  bytes(
    JSON.stringify({
      ...canonical,
      snapshotSha256: sha256,
      reservedEnvelopeUSD: l.reservedEnvelopeUSD,
      policyLedger: policy,
    }),
    16 * 1024,
  );
  return { sha256, selected };
}
const identityKeys = ["profile", "accountId", "region"] as const,
  sourceKeys = [
    "commit",
    "tree",
    "lockSha256",
    "zipSha256",
    "zipBytes",
    "templatesSha256",
  ] as const;
function observation(
  value: unknown,
  plan: ReturnType<typeof readCloudRunPlanContext>["plan"],
  now: number,
  reservedAt: string,
) {
  const o = record(value, [
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
    checkedAt = timestamp(o.checkedAt),
    checked = Date.parse(checkedAt);
  if (
    checked < Date.parse(reservedAt) ||
    checked > now ||
    now - checked > 2 * 60000
  )
    return fail();
  const identity = record(o.identity, identityKeys),
    source = record(o.source, sourceKeys);
  equalFields(identity, plan.identity);
  equalFields(source, plan.source);
  const mainCommit = digest(o.mainCommit, 40),
    testedCommit = digest(o.testedCommit, 40),
    checks = record(o.checks, ["cloud-artifact", "web-and-core", "native"]);
  if (
    mainCommit !== plan.source.commit ||
    testedCommit !== plan.source.commit ||
    Object.values(checks).some((s) => s !== "success") ||
    o.worktree !== "clean"
  )
    return fail();
  const raw = record(o.credentials, [
      "sessionExpiresAt",
      "refreshExpiresAt",
      "refreshProven",
    ]),
    sessionExpiresAt = timestamp(raw.sessionExpiresAt);
  if (
    typeof raw.refreshProven !== "boolean" ||
    Date.parse(sessionExpiresAt) <= now
  )
    return fail();
  const refreshExpiresAt = raw.refreshProven
    ? timestamp(raw.refreshExpiresAt)
    : null;
  if (!raw.refreshProven && raw.refreshExpiresAt !== null) return fail();
  if (
    Math.max(
      Date.parse(sessionExpiresAt),
      refreshExpiresAt === null ? 0 : Date.parse(refreshExpiresAt),
    ) < Date.parse(plan.cleanupBy)
  )
    return fail();
  const credentials = {
      sessionExpiresAt,
      refreshExpiresAt,
      refreshProven: raw.refreshProven,
    },
    safety = record(o.safety, ["targetNames", "hooks", "targetDataEvents"]);
  if (
    !Number.isSafeInteger(o.unreservedConcurrency) ||
    (o.unreservedConcurrency as number) < 101 ||
    Object.values(safety).some((s) => s !== "absent")
  )
    return fail();
  const price = record(o.prices, [
      "checkedAt",
      "region",
      "currency",
      "sourceSha256",
      "rates",
    ]),
    rates = record(price.rates, [
      "lambdaRequestsPerMillion",
      "lambdaGbSecond",
      "cognitoMau",
      "dynamoWritesPerMillion",
      "dynamoReadsPerMillion",
      "dynamoGbMonth",
      "secretMonth",
      "secretPerTenThousand",
      "s3GbMonth",
      "s3PutsPerThousand",
      "s3GetsPerThousand",
      "schedulerPerMillion",
    ]);
  if (
    Object.values(rates).some(
      (v) => typeof v !== "number" || !Number.isFinite(v) || v <= 0,
    )
  )
    return fail();
  const prices = {
    checkedAt: timestamp(price.checkedAt),
    region: price.region,
    currency: price.currency,
    sourceSha256: digest(price.sourceSha256),
    rates,
  };
  if (prices.region !== plan.identity.region || prices.currency !== "USD")
    return fail();
  const quote = cloudDevelopmentCost(prices, now);
  if (
    quote.quoteSha256 !== plan.quoteSha256 ||
    quote.estimateUSD !== plan.estimateUSD
  )
    return fail();
  const normalized = {
    checkedAt,
    identity,
    source,
    mainCommit,
    testedCommit,
    checks,
    worktree: "clean",
    credentials,
    unreservedConcurrency: o.unreservedConcurrency,
    safety,
    prices: { quoteSha256: quote.quoteSha256, estimateUSD: quote.estimateUSD },
  };
  return {
    checkedAt,
    sha256: hash(bytes(JSON.stringify(normalized), 16 * 1024)),
    quoteSha256: quote.quoteSha256,
  };
}

/** Pure consistency of supplied first-guard data. Never actual readiness, provenance or a capability. */
export function checkCloudInitialGuardFacts(value: Input, now: number) {
  try {
    if (!Number.isSafeInteger(now) || now < 0) return fail();
    const r = record(value, ["genesis", "ledger", "observed"]),
      g = record(r.genesis, ["json", "sha256", "anchor"]),
      l = record(r.ledger, ["snapshot", "sha256"]),
      json = bytes(g.json, 1536 * 1024),
      expectedGenesisSha256 = digest(g.sha256);
    if (hash(json) !== expectedGenesisSha256) return fail();
    const original = readCloudJournalGenesis(
        json,
        g.anchor as Input["genesis"]["anchor"],
      ),
      data = original.genesis,
      context = readCloudRunPlanContext(data.context.json, {
        json: data.manifest.json,
        pin: data.manifest.pin,
      }),
      plan = context.plan,
      currentLedger = ledger(l.snapshot, l.sha256, data.anchor, now),
      createBy = new Date(
        Date.parse(plan.lease.startedAt) + 10 * 60000,
      ).toISOString(),
      remainingWindowMs = Date.parse(createBy) - now;
    if (
      now < Date.parse(data.anchor.reservation.reservedAt) ||
      remainingWindowMs <= 0 ||
      now >= Date.parse(plan.stopTestsAt)
    )
      return fail();
    const current = observation(
      r.observed,
      plan,
      now,
      currentLedger.selected.reservedAt,
    );
    return frozen({
      format: 1 as const,
      kind: "synkies-cloud-initial-guard-facts" as const,
      phase: "initial-guard" as const,
      runId: plan.runId,
      genesisSha256: original.sha256,
      scopeSha256: original.scopeSha256,
      contextSha256: context.contextSha256,
      manifestSha256: context.manifestSha256,
      planSha256: context.planSha256,
      inventorySha256: context.inventorySha256,
      ledgerSnapshotSha256: currentLedger.sha256,
      observedSha256: current.sha256,
      quoteSha256: current.quoteSha256,
      checkedAt: new Date(now).toISOString(),
      criticalObservedAt: current.checkedAt,
      guard: { name: plan.stacks.guard, createBy, remainingWindowMs },
      ownership: "unproven" as const,
      runAuthority: "unproven" as const,
      currentAuthority: "unproven" as const,
      resourceWrites: 0 as const,
    });
  } catch {
    return fail();
  }
}
