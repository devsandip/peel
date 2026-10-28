import { createHash } from "node:crypto";
import { readHistoricalCloudInventory } from "./historical-inventory.ts";

type Recipe = {
  json: string;
  pin: Parameters<typeof readHistoricalCloudInventory>[1];
};
type Original = ReturnType<typeof readHistoricalCloudInventory>;
const planLimit = 16 * 1024,
  contextLimit = 32 * 1024,
  minute = 60000;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
class ContextFailure extends Error {
  constructor() {
    super("Original Cloud plan context unavailable");
    Object.freeze(this);
  }
}
const fail = (): never => {
  throw new ContextFailure();
};
function privateCall<T>(work: () => T): T {
  try {
    return work();
  } catch {
    return fail();
  }
}
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
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.fromEntries(
    keys.map((key) => {
      const d = descriptors[key];
      if (!d?.enumerable || !("value" in d)) return fail();
      return [key, d.value];
    }),
  );
}
function bytes(value: unknown, max: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > max)
    return fail();
  return value;
}
function digest(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(value)
  )
    return fail();
  return value;
}
function timestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isSafeInteger(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return fail();
  return value;
}
function frozen<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function original(value: unknown): Original {
  const r = record(value, ["json", "pin"]);
  return readHistoricalCloudInventory(r.json as string, r.pin as Recipe["pin"]);
}
function bound<T extends Record<string, unknown>>(
  value: unknown,
  expected: T,
): T {
  if (
    JSON.stringify(record(value, Object.keys(expected))) !==
    JSON.stringify(expected)
  )
    return fail();
  return expected;
}
function normalized(planJson: string, retained: Original) {
  const encoded = bytes(planJson, planLimit);
  if (hash(encoded) !== retained.planSha256) return fail();
  const r = record(JSON.parse(encoded), [
      "format",
      "runId",
      "createdAt",
      "identity",
      "lease",
      "source",
      "quoteSha256",
      "estimateUSD",
      "runAllowanceUSD",
      "cleanupReserveUSD",
      "reservedEnvelopeUSD",
      "stopTestsAt",
      "cleanupBy",
      "stacks",
    ]),
    inventory = retained.inventory,
    createdAt = timestamp(r.createdAt),
    identity = bound(r.identity, {
      profile: retained.profile,
      accountId: inventory.accountId,
      region: inventory.region,
    }),
    lease = bound(r.lease, { ...inventory.lease }),
    source = bound(r.source, {
      commit: retained.source.commit,
      tree: retained.source.tree,
      lockSha256: retained.source.lockSha256,
      zipSha256: inventory.artifact.sha256,
      zipBytes: inventory.artifact.bytes,
      templatesSha256: inventory.templatesSha256,
    }),
    started = Date.parse(lease.startedAt),
    expires = Date.parse(lease.expiresAt),
    estimate = r.estimateUSD;
  if (
    r.format !== 1 ||
    r.runId !== inventory.runId ||
    expires - started !== 90 * minute ||
    Date.parse(createdAt) > started ||
    started - Date.parse(createdAt) > 15 * minute ||
    typeof estimate !== "number" ||
    !Number.isFinite(estimate) ||
    estimate <= 0 ||
    estimate > 2 ||
    Math.round(estimate * 1e6) / 1e6 !== estimate ||
    r.runAllowanceUSD !== 2 ||
    r.cleanupReserveUSD !== 1 ||
    (r.reservedEnvelopeUSD !== 3 && r.reservedEnvelopeUSD !== 5)
  )
    return fail();
  const name = (kind: "guard" | "artifacts" | "sentinel" | "data") => {
      const stack = inventory.stacks.find((s) => s.kind === kind);
      if (!stack) return fail();
      return stack.name;
    },
    stacks = bound(r.stacks, {
      guard: name("guard"),
      artifacts: name("artifacts"),
      sentinel: name("sentinel"),
      data: name("data"),
    }),
    stopTestsAt = timestamp(r.stopTestsAt),
    cleanupBy = timestamp(r.cleanupBy);
  if (
    stopTestsAt !== new Date(expires - 30 * minute).toISOString() ||
    cleanupBy !== new Date(expires + 30 * minute).toISOString()
  )
    return fail();
  const plan = {
    format: 1 as const,
    runId: inventory.runId,
    createdAt,
    identity,
    lease,
    source,
    quoteSha256: digest(r.quoteSha256),
    estimateUSD: estimate,
    runAllowanceUSD: 2 as const,
    cleanupReserveUSD: 1 as const,
    reservedEnvelopeUSD: r.reservedEnvelopeUSD as 3 | 5,
    stopTestsAt,
    cleanupBy,
    stacks,
  };
  if (JSON.stringify(plan) !== encoded) return fail();
  return frozen(plan);
}
function envelope(manifestSha256: string, planJson: string) {
  return bytes(
    JSON.stringify({
      format: 1,
      kind: "peel-cloud-run-plan-context",
      manifestSha256,
      planJson,
    }),
    contextLimit,
  );
}
function snapshot(
  json: string,
  planJson: string,
  plan: ReturnType<typeof normalized>,
  retained: Original,
) {
  return frozen({
    format: 1 as const,
    json,
    planJson,
    plan,
    contextSha256: hash(json),
    manifestSha256: retained.manifestSha256,
    planSha256: retained.planSha256,
    inventorySha256: retained.inventory.inventorySha256,
    ownership: "unproven" as const,
    runAuthority: "unproven" as const,
    resourceWrites: 0 as const,
  });
}
/** Original normalized bytes/integrity only. No current approval, reservation or provider ownership. */
export function createCloudRunPlanContext(input: {
  planJson: string;
  manifest: Recipe;
}) {
  return privateCall(() => {
    const r = record(input, ["planJson", "manifest"]),
      retained = original(r.manifest),
      planJson = bytes(r.planJson, planLimit),
      plan = normalized(planJson, retained);
    return snapshot(
      envelope(retained.manifestSha256, planJson),
      planJson,
      plan,
      retained,
    );
  });
}
/** Historical local context only; expired source/lease/quotes never trigger fresh approval checks. */
export function readCloudRunPlanContext(json: string, manifest: Recipe) {
  return privateCall(() => {
    const retained = original(manifest),
      encoded = bytes(json, contextLimit),
      r = record(JSON.parse(encoded), [
        "format",
        "kind",
        "manifestSha256",
        "planJson",
      ]);
    if (
      r.format !== 1 ||
      r.kind !== "peel-cloud-run-plan-context" ||
      r.manifestSha256 !== retained.manifestSha256
    )
      return fail();
    const planJson = bytes(r.planJson, planLimit),
      plan = normalized(planJson, retained);
    if (envelope(retained.manifestSha256, planJson) !== encoded) return fail();
    return snapshot(encoded, planJson, plan, retained);
  });
}
