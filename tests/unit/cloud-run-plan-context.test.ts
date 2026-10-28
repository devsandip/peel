import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  createCloudRunPlanContext,
  readCloudRunPlanContext,
} from "../../infra/cloud/run-plan-context.ts";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as policy from "../../infra/cloud/deployment-plan.ts";
import * as manifestCodec from "../../infra/cloud/run-manifest.ts";
import matched from "../fixtures/cloud-run-plan-context-v1.json";
import opaque from "../fixtures/cloud-inventory-v1-recipe.json";
import { expectedInventoryV1 } from "../../infra/cloud/inventory-v1.ts";
import { readHistoricalCloudInventory } from "../../infra/cloud/historical-inventory.ts";
import { cloudNormalizedPlanFixture } from "../fixtures/cloud-normalized-plan.ts";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const fixture = () => ({
  planJson: matched.planJson,
  manifest: {
    json: matched.manifest.json,
    pin: manifestCodec.normalizeCloudRunManifestPin(matched.manifest.pin),
  },
});
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
function refused(work: () => unknown) {
  let caught: unknown;
  try {
    work();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe(
    "Original Cloud plan context unavailable",
  );
  expect(Object.keys(caught as object)).toEqual([]);
  frozen(caught);
}
function changed(edit: (plan: any) => void) {
  const plan = JSON.parse(matched.planJson);
  edit(plan);
  const planJson = JSON.stringify(plan),
    raw = JSON.parse(matched.manifest.json);
  raw.planSha256 = hash(planJson);
  const json = JSON.stringify(raw),
    pin = {
      ...fixture().manifest.pin,
      sha256: hash(json),
      planSha256: raw.planSha256,
    };
  return { planJson, manifest: { json, pin } };
}
function envelope(f: ReturnType<typeof fixture>) {
  return JSON.stringify({
    format: 1,
    kind: "peel-cloud-run-plan-context",
    manifestSha256: f.manifest.pin.sha256,
    planJson: f.planJson,
  });
}
function refuseChanged(edit: (plan: any) => void) {
  const f = changed(edit);
  // The existing opaque recipe codec correctly does not validate normalized-plan semantics.
  expect(
    manifestCodec.readCloudRunManifest(f.manifest.json, f.manifest.pin)
      .planSha256,
  ).toBe(hash(f.planJson));
  refused(() => createCloudRunPlanContext(f));
  refused(() => readCloudRunPlanContext(envelope(f), f.manifest));
}
afterEach(() => vi.restoreAllMocks());

it("captures the actual normalized validator return as a deterministic original context without changing legacy formats", () => {
  expect(cloudNormalizedPlanFixture()).toEqual(fixture());
  const f = fixture(),
    result = createCloudRunPlanContext(f);
  expect(result.json).toBe(envelope(f));
  expect(result.planJson).toBe(matched.planJson);
  expect(result.planSha256).toBe(hash(matched.planJson));
  expect(result.manifestSha256).toBe(matched.manifest.pin.sha256);
  expect(result.contextSha256).toBe(hash(result.json));
  expect(result.plan).toEqual(JSON.parse(matched.planJson));
  expect(readCloudRunPlanContext(result.json, f.manifest)).toEqual(result);
  expect(
    createCloudRunPlanContext({ manifest: f.manifest, planJson: f.planJson }),
  ).toEqual(result);
  expect(result).toMatchObject({
    ownership: "unproven",
    runAuthority: "unproven",
    resourceWrites: 0,
  });
  expect(result).not.toHaveProperty("approved");
  expect(result).not.toHaveProperty("allowWrite");
  frozen(result);
  const legacy = manifestCodec.readCloudRunManifest(
    opaque.json,
    manifestCodec.normalizeCloudRunManifestPin(opaque.pin),
  );
  expect(legacy.planSha256).toBe("4".repeat(64));
  refused(() =>
    createCloudRunPlanContext({
      planJson: f.planJson,
      manifest: {
        json: opaque.json,
        pin: manifestCodec.normalizeCloudRunManifestPin(opaque.pin),
      },
    }),
  );
});

it("reads expired original context with every current factory/validator/cost/writer/name helper and live clock unavailable", () => {
  const f = fixture(),
    context = createCloudRunPlanContext(f),
    unavailable = () => {
      throw Error("private current source unavailable");
    },
    spies = [
      vi
        .spyOn(current, "cloudExpectedInventory")
        .mockImplementation(unavailable),
      vi
        .spyOn(hosting, "cloudPrivateHostingTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(hosting, "cloudArtifactBootstrapTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(cleanup, "cloudCleanupGuardTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(cleanup, "cloudCleanupSentinelTemplate")
        .mockImplementation(unavailable),
      vi.spyOn(cleanup, "cloudDevStackNames").mockImplementation(unavailable),
      vi
        .spyOn(data, "cloudDataIdentityTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(policy, "validateCloudDeploymentPlan")
        .mockImplementation(unavailable),
      vi.spyOn(policy, "cloudDevelopmentCost").mockImplementation(unavailable),
      vi
        .spyOn(manifestCodec, "createCloudRunManifest")
        .mockImplementation(unavailable),
    ],
    clock = vi.spyOn(Date, "now").mockImplementation(unavailable);
  let result!: ReturnType<typeof readCloudRunPlanContext>,
    captured!: ReturnType<typeof createCloudRunPlanContext>;
  try {
    result = readCloudRunPlanContext(context.json, f.manifest);
    captured = createCloudRunPlanContext(f);
  } finally {
    clock.mockRestore();
  }
  expect(result).toEqual(context);
  expect(captured).toEqual(context);
  expect(result.plan.lease.expiresAt).toBe("2026-10-27T13:30:00.000Z");
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  frozen(result);
});

it("matches both real normalized budget-envelope variants without treating structural data as a slot or approval", () => {
  for (const second of [false, true]) {
    const f = cloudNormalizedPlanFixture(second),
      context = createCloudRunPlanContext(f);
    expect(context.plan.reservedEnvelopeUSD).toBe(second ? 5 : 3);
    expect(context.plan.runAllowanceUSD).toBe(2);
    expect(context.plan.cleanupReserveUSD).toBe(1);
    expect(readCloudRunPlanContext(context.json, f.manifest)).toEqual(context);
    expect(context.runAuthority).toBe("unproven");
    expect(context.ownership).toBe("unproven");
    expect(context).not.toHaveProperty("reservation");
  }
  // A self-consistent changed quote/estimate still cannot authenticate original price or run provenance.
  const f = changed((p) => {
    p.quoteSha256 = "9".repeat(64);
    p.estimateUSD = 2;
  });
  expect(createCloudRunPlanContext(f).runAuthority).toBe("unproven");
});

it("rejects rehashed identity, run, lease, source/artifact/template and stack mismatches", () => {
  for (const edit of [
    (p: any) => {
      p.runId = "00000000-0000-4000-8000-000000000002";
    },
    (p: any) => {
      p.identity.profile = "foreign";
    },
    (p: any) => {
      p.identity.accountId = "222233334444";
    },
    (p: any) => {
      p.identity.region = "us-west-2";
    },
    (p: any) => {
      p.lease.startedAt = "2026-10-27T12:00:01.000Z";
    },
    (p: any) => {
      p.lease.expiresAt = "2026-10-27T13:29:59.000Z";
    },
    (p: any) => {
      p.source.commit = "9".repeat(40);
    },
    (p: any) => {
      p.source.tree = "9".repeat(40);
    },
    (p: any) => {
      p.source.lockSha256 = "9".repeat(64);
    },
    (p: any) => {
      p.source.zipSha256 = "9".repeat(64);
    },
    (p: any) => {
      p.source.zipBytes += 1;
    },
    (p: any) => {
      p.source.templatesSha256 = "9".repeat(64);
    },
    (p: any) => {
      p.stacks.guard += "-foreign";
    },
    (p: any) => {
      delete p.stacks.data;
    },
    (p: any) => {
      p.stacks.extra = "foreign";
    },
  ])
    refuseChanged(edit);
});

it("rejects invalid original scalar, estimate, allowance and derived timing fields even when digests are recomputed", () => {
  for (const edit of [
    (p: any) => {
      p.format = 2;
    },
    (p: any) => {
      p.createdAt = "2026-10-27T12:00:00.001Z";
    },
    (p: any) => {
      p.createdAt = "2026-10-27T11:44:59.999Z";
    },
    (p: any) => {
      p.createdAt = "2026-02-30T11:59:00.000Z";
    },
    (p: any) => {
      p.createdAt += "\n";
    },
    (p: any) => {
      p.quoteSha256 = "invalid";
    },
    (p: any) => {
      p.quoteSha256 += "\n";
    },
    (p: any) => {
      p.quoteSha256 = p.quoteSha256.toUpperCase();
    },
    (p: any) => {
      p.estimateUSD = 0;
    },
    (p: any) => {
      p.estimateUSD = -1;
    },
    (p: any) => {
      p.estimateUSD = 2.000001;
    },
    (p: any) => {
      p.estimateUSD = 0.1234567;
    },
    (p: any) => {
      p.estimateUSD = "1";
    },
    (p: any) => {
      p.runAllowanceUSD = 3;
    },
    (p: any) => {
      p.cleanupReserveUSD = 2;
    },
    (p: any) => {
      p.reservedEnvelopeUSD = 4;
    },
    (p: any) => {
      p.stopTestsAt = "2026-10-27T13:00:00.001Z";
    },
    (p: any) => {
      p.cleanupBy = "2026-10-27T14:00:00.001Z";
    },
    (p: any) => {
      p.cleanupBy += "\n";
    },
    (p: any) => {
      p.stopTestsAt = null;
    },
  ])
    refuseChanged(edit);
});

it("rejects changed schemas, extras, nested shapes and noncanonical normalized JSON", () => {
  for (const edit of [
    (p: any) => {
      p.extra = "private";
    },
    (p: any) => {
      delete p.quoteSha256;
    },
    (p: any) => {
      p.identity.extra = "private";
    },
    (p: any) => {
      p.source.extra = "private";
    },
    (p: any) => {
      p.lease.extra = "private";
    },
    (p: any) => {
      p.identity = null;
    },
    (p: any) => {
      p.source = [];
    },
    (p: any) => {
      p.stacks = [];
    },
    (p: any) => {
      const v = p.format;
      delete p.format;
      p.format = v;
    },
    (p: any) => {
      const v = p.source.commit;
      delete p.source.commit;
      p.source.commit = v;
    },
  ])
    refuseChanged(edit);
  for (const planJson of [
    matched.planJson + " ",
    JSON.stringify(JSON.parse(matched.planJson), null, 2),
    "[]",
    "null",
    "private malformed",
    "é".repeat(8193),
  ])
    refused(() => createCloudRunPlanContext({ ...fixture(), planJson }));
});

it("verifies original pins and exact context version/schema/hash/encoding without reflecting private input", () => {
  const f = fixture(),
    context = createCloudRunPlanContext(f),
    raw = JSON.parse(context.json);
  for (const json of [
    context.json + "\n",
    JSON.stringify(raw, null, 2),
    "private malformed",
    "[]",
    "null",
    "x".repeat(32769),
    JSON.stringify({ ...raw, format: 2 }),
    JSON.stringify({ ...raw, kind: "foreign" }),
    JSON.stringify({ ...raw, manifestSha256: "9".repeat(64) }),
    JSON.stringify({ ...raw, extra: "private" }),
    JSON.stringify({ ...raw, planJson: raw.planJson + " " }),
  ])
    refused(() => readCloudRunPlanContext(json, f.manifest));
  for (const manifest of [
    { ...f.manifest, json: f.manifest.json + " " },
    { ...f.manifest, pin: { ...f.manifest.pin, sha256: "9".repeat(64) } },
    { ...f.manifest, pin: { ...f.manifest.pin, planSha256: "9".repeat(64) } },
    {
      ...f.manifest,
      pin: {
        ...f.manifest.pin,
        source: { ...f.manifest.pin.source, commit: "9".repeat(40) },
      },
    },
    { ...f.manifest, profile: "foreign" },
  ]) {
    refused(() => createCloudRunPlanContext({ ...f, manifest }));
    refused(() => readCloudRunPlanContext(context.json, manifest));
  }
});

it("refuses top-level/getter overrides before reading them and leaves caller state detached", () => {
  const f = fixture(),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...f, approved: true },
    { ...f, profile: "foreign" },
    { ...f, planJson: {} },
    Object.defineProperty({ ...f }, "planJson", { get: getter }),
    {
      ...f,
      manifest: Object.defineProperty({ ...f.manifest }, "json", {
        get: getter,
      }),
    },
    {
      ...f,
      manifest: Object.defineProperty({ ...f.manifest }, "pin", {
        get: getter,
      }),
    },
  ])
    refused(() =>
      createCloudRunPlanContext(input as ReturnType<typeof fixture>),
    );
  expect(getter).not.toHaveBeenCalled();
  const mutable = {
      ...f,
      manifest: {
        ...f.manifest,
        pin: { ...f.manifest.pin, source: { ...f.manifest.pin.source } },
      },
    },
    result = createCloudRunPlanContext(mutable);
  mutable.planJson = "private changed";
  mutable.manifest.json = "changed";
  mutable.manifest.pin.source.commit = "9".repeat(40);
  expect(result.planJson).toBe(matched.planJson);
  expect(result.plan.source.commit).toBe("a".repeat(40));
  frozen(result);
  expect(() =>
    Object.assign(result.plan.identity, { profile: "foreign" }),
  ).toThrow();
});

it("keeps the original normalized ninety-minute lease contract for a self-consistent rehashed shorter inventory", () => {
  const f = fixture(),
    raw = JSON.parse(f.manifest.json),
    old = JSON.parse(raw.inventoryJson),
    lease = {
      startedAt: old.lease.startedAt,
      expiresAt: "2026-10-27T13:00:00.000Z",
    },
    inventory = expectedInventoryV1({
      accountId: old.accountId,
      region: old.region,
      runId: old.runId,
      artifact: old.artifact,
      lease,
      templatesSha256: old.templatesSha256,
    }),
    plan = JSON.parse(f.planJson);
  plan.lease = lease;
  plan.stopTestsAt = "2026-10-27T12:30:00.000Z";
  plan.cleanupBy = "2026-10-27T13:30:00.000Z";
  const planJson = JSON.stringify(plan);
  raw.inventoryJson = JSON.stringify(inventory);
  raw.planSha256 = hash(planJson);
  const json = JSON.stringify(raw),
    manifest = {
      json,
      pin: {
        ...f.manifest.pin,
        sha256: hash(json),
        planSha256: raw.planSha256,
        inventorySha256: inventory.inventorySha256,
      },
    };
  expect(
    readHistoricalCloudInventory(json, manifest.pin).inventory.lease,
  ).toEqual(lease);
  refused(() => createCloudRunPlanContext({ planJson, manifest }));
  refused(() =>
    readCloudRunPlanContext(envelope({ planJson, manifest }), manifest),
  );
});

it("requires the exact original plan digest for a structurally valid changed quote", () => {
  const f = fixture(),
    plan = JSON.parse(f.planJson);
  plan.quoteSha256 = "9".repeat(64);
  const changedInput = { ...f, planJson: JSON.stringify(plan) };
  refused(() => createCloudRunPlanContext(changedInput));
  refused(() => readCloudRunPlanContext(envelope(changedInput), f.manifest));
});
