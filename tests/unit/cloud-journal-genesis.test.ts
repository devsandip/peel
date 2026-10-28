import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  cloudJournalLocation,
  createCloudJournalGenesis,
  normalizeCloudJournalAnchor,
  readCloudJournalGenesis,
} from "../../infra/cloud/journal-genesis.ts";
import * as manifestCodec from "../../infra/cloud/run-manifest.ts";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as policy from "../../infra/cloud/deployment-plan.ts";
import matched from "../fixtures/cloud-run-plan-context-v1.json";

const effects = vi.hoisted(() => ({ fs: 0, sqlite: 0, random: 0 }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  const blocked = () => {
    effects.fs++;
    throw Error("synthetic private filesystem unavailable");
  };
  return {
    ...actual,
    openSync: blocked,
    lstatSync: blocked,
    fstatSync: blocked,
    readSync: blocked,
    readFileSync: blocked,
    realpathSync: blocked,
    readdirSync: blocked,
    mkdirSync: blocked,
    writeFileSync: blocked,
    fsyncSync: blocked,
    closeSync: blocked,
  };
});
vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    constructor() {
      effects.sqlite++;
      throw Error("synthetic private database unavailable");
    }
  },
}));
vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  const blocked = () => {
    effects.random++;
    throw Error("synthetic private entropy unavailable");
  };
  return { ...actual, randomUUID: blocked, randomBytes: blocked };
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const pin = manifestCodec.normalizeCloudRunManifestPin(matched.manifest.pin),
    contextJson = JSON.stringify({
      format: 1,
      kind: "peel-cloud-run-plan-context",
      manifestSha256: pin.sha256,
      planJson: matched.planJson,
    });
  return {
    anchor: {
      workspaceDirectory: "/synthetic/workspace",
      ledgerDirectory: "/synthetic/funding",
      authority: {
        identity: {
          profile: pin.profile,
          accountId: pin.accountId,
          region: pin.region,
        },
        authorizedUntil: "2026-10-27T18:00:00.000Z",
      },
      reservation: {
        slot: 1 as 1 | 2,
        runId: pin.runId,
        planSha256: pin.planSha256,
        reservedAt: "2026-10-27T12:00:10.000Z",
      },
    },
    manifest: {
      directory: "/synthetic/recipe",
      json: matched.manifest.json,
      pin,
    },
    context: {
      directory: "/synthetic/context",
      json: contextJson,
      sha256: hash(contextJson),
    },
  };
}
function refused(work: () => unknown) {
  let error: unknown;
  try {
    work();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(
    "Original Cloud journal genesis unavailable",
  );
  expect(Object.keys(error as object)).toEqual([]);
  expect((error as Error).cause).toBeUndefined();
  expect(Object.isFrozen(error)).toBe(true);
}
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  expect(effects).toEqual({ fs: 0, sqlite: 0, random: 0 });
});

it("pins independently serialized canonical bytes and deterministic original run scope/location", () => {
  const f = fixture(),
    result = createCloudJournalGenesis(f);
  // Independent Python serialization of the frozen original fixture, not production codec output.
  expect(f.context.sha256).toBe(
    "e3814d9882ce0150457a3888fbfb00ec8bb2685e845132ec74ae40b97b465b47",
  );
  expect(result.sha256).toBe(
    "15ee52507cd7b8eae8553445b2c61b6a763401b3bf8fe9e16f135268bda229b2",
  );
  expect(result.scopeSha256).toBe(
    "734db0a1d42e8b3fa7d6e8f6ae06db11868a5f4fb7efb99178f80cb4ae3b912d",
  );
  expect(Buffer.byteLength(result.json)).toBe(44191);
  expect(result.journalDirectory).toBe(
    "/synthetic/workspace/journal-00000000-0000-4000-8000-000000000001",
  );
  expect(cloudJournalLocation(f.anchor)).toEqual({
    directory: result.journalDirectory,
    scopeSha256: result.scopeSha256,
  });
  expect(result.genesis.manifest.json).toBe(matched.manifest.json);
  expect(result.genesis.context.json).toBe(f.context.json);
  expect(result.genesis).toMatchObject({
    format: 1,
    catalogVersion: 1,
    revision: 0,
    anchor: f.anchor,
  });
  expect(result).toMatchObject({
    ownership: "unproven",
    runAuthority: "unproven",
    resourceWrites: 0,
  });
  frozen(result);
});
it("reads exact originals from the independent durable tuple without a caller genesis/token digest", () => {
  const f = fixture(),
    result = createCloudJournalGenesis(f);
  expect(readCloudJournalGenesis(result.json, f.anchor)).toEqual(result);
  for (const change of [
    (a: any) => (a.workspaceDirectory += "-other"),
    (a: any) => (a.ledgerDirectory += "-other"),
    (a: any) => (a.reservation.slot = 2),
    (a: any) => (a.reservation.planSha256 = "0".repeat(64)),
    (a: any) => (a.reservation.runId = "00000000-0000-4000-8000-000000000002"),
    (a: any) => (a.reservation.reservedAt = "2026-10-27T12:00:11.000Z"),
    (a: any) => (a.authority.identity.accountId = "999900001111"),
    (a: any) => (a.authority.authorizedUntil = "2026-10-27T19:00:00.000Z"),
  ]) {
    const a = structuredClone(f.anchor);
    change(a);
    refused(() => readCloudJournalGenesis(result.json, a));
    expect(cloudJournalLocation(a).scopeSha256).not.toBe(result.scopeSha256);
  }
});
it("detaches original authority/reservation and pin/source selections from mutable caller data", () => {
  const f = fixture(),
    original = structuredClone(f),
    normalized = normalizeCloudJournalAnchor(f.anchor),
    result = createCloudJournalGenesis(f);
  f.anchor.authority.identity.profile = "changed";
  f.anchor.reservation.planSha256 = "a".repeat(64);
  f.context.json = "synthetic private replacement";
  f.manifest.directory = "/synthetic/other";
  expect(normalized).toEqual(original.anchor);
  expect(result.genesis.anchor).toEqual(original.anchor);
  expect(result.genesis.context.json).toBe(original.context.json);
  expect(result.genesis.manifest.directory).toBe(original.manifest.directory);
  expect(readCloudJournalGenesis(result.json, original.anchor)).toEqual(result);
  frozen(normalized);
});
it("binds reservation plan/run/slot and original funding identity and cleanup margin", () => {
  for (const change of [
    (f: any) => (f.anchor.reservation.slot = 2),
    (f: any) => (f.anchor.reservation.planSha256 = "f".repeat(64)),
    (f: any) =>
      (f.anchor.reservation.runId = "00000000-0000-4000-8000-000000000002"),
    (f: any) => (f.anchor.authority.identity.accountId = "999900001111"),
    (f: any) => (f.anchor.authority.identity.profile = "other-profile"),
    (f: any) => (f.anchor.authority.identity.region = "us-west-2"),
    (f: any) =>
      (f.anchor.authority.authorizedUntil = "2026-10-27T13:59:59.999Z"),
  ]) {
    const f = fixture();
    change(f);
    refused(() => createCloudJournalGenesis(f));
  }
  const f = fixture();
  f.anchor.authority.authorizedUntil = "2026-10-27T14:00:00.000Z";
  expect(createCloudJournalGenesis(f).genesis.anchor.authority).toEqual(
    f.anchor.authority,
  );
});
it("enforces stable reservation time and original plan timing without current expiry approval", () => {
  for (const time of [
    "2026-10-27T11:59:59.999Z",
    "2026-10-27T12:00:30.001Z",
    "2026-10-27T12:00:10Z",
    "2026-02-30T00:00:00.000Z",
  ]) {
    const f = fixture();
    f.anchor.reservation.reservedAt = time;
    refused(() => createCloudJournalGenesis(f));
  }
  for (const time of ["2026-10-27T12:00:00.000Z", "2026-10-27T12:00:30.000Z"]) {
    const f = fixture();
    f.anchor.reservation.reservedAt = time;
    expect(
      createCloudJournalGenesis(f).genesis.anchor.reservation.reservedAt,
    ).toBe(time);
  }
});
it("rejects altered raw pins and rehashed semantic context against the independent plan", () => {
  for (const field of [
    "sha256",
    "planSha256",
    "templatesSha256",
    "inventorySha256",
  ] as const) {
    const f = fixture();
    f.manifest.pin = { ...f.manifest.pin, [field]: "a".repeat(64) };
    refused(() => createCloudJournalGenesis(f));
  }
  const f = fixture(),
    context = JSON.parse(f.context.json),
    plan = JSON.parse(context.planJson);
  plan.stacks.guard += "-other";
  context.planJson = JSON.stringify(plan);
  f.context.json = JSON.stringify(context);
  f.context.sha256 = hash(f.context.json);
  refused(() => createCloudJournalGenesis(f));
  const g = fixture();
  g.context.sha256 = "b".repeat(64);
  refused(() => createCloudJournalGenesis(g));
});
it("rejects a fully coherent rehashed original plan unless the independent reservation agrees", () => {
  const f = fixture(),
    oldPlan = f.anchor.reservation.planSha256,
    plan = JSON.parse(matched.planJson),
    manifest = JSON.parse(f.manifest.json);
  plan.quoteSha256 = "a".repeat(64);
  const planJson = JSON.stringify(plan);
  manifest.planSha256 = hash(planJson);
  f.manifest.json = JSON.stringify(manifest);
  f.manifest.pin = {
    ...f.manifest.pin,
    sha256: hash(f.manifest.json),
    planSha256: hash(planJson),
  };
  f.context.json = JSON.stringify({
    format: 1,
    kind: "peel-cloud-run-plan-context",
    manifestSha256: f.manifest.pin.sha256,
    planJson,
  });
  f.context.sha256 = hash(f.context.json);
  expect(hash(planJson)).not.toBe(oldPlan);
  refused(() => createCloudJournalGenesis(f));
  // The original codecs accept these internally coherent bytes. Only a matching independent funding tuple can bind them.
  f.anchor.reservation.planSha256 = hash(planJson);
  expect(createCloudJournalGenesis(f).genesis.context.json).toBe(
    f.context.json,
  );
});
it("refuses changed canonical fields even when callers compute a fresh checksum", () => {
  const f = fixture(),
    original = createCloudJournalGenesis(f);
  for (const change of [
    (g: any) => (g.format = 2),
    (g: any) => (g.kind = "other-kind"),
    (g: any) => (g.catalogVersion = 2),
    (g: any) => (g.revision = 1),
    (g: any) => (g.journalDirectory += "-other"),
    (g: any) => (g.anchor.reservation.planSha256 = "b".repeat(64)),
    (g: any) => (g.manifest.pin.sha256 = "b".repeat(64)),
    (g: any) => (g.context.sha256 = "b".repeat(64)),
    (g: any) => (g.context.owned = true),
    (g: any) => (g.genesisSha256 = original.sha256),
  ]) {
    const value = JSON.parse(original.json);
    change(value);
    const encoded = JSON.stringify(value);
    expect(hash(encoded)).not.toBe(original.sha256);
    refused(() => readCloudJournalGenesis(encoded, f.anchor));
  }
  refused(() => readCloudJournalGenesis(" " + original.json, f.anchor));
  refused(() => readCloudJournalGenesis(original.json + "\n", f.anchor));
});
it("keeps global funding outside per-run workspace while rejecting overlapping source/journal stores", () => {
  const f = fixture();
  expect(createCloudJournalGenesis(f).genesis.anchor.ledgerDirectory).toBe(
    "/synthetic/funding",
  );
  f.anchor.ledgerDirectory = "/synthetic/workspace/funding";
  expect(createCloudJournalGenesis(f).journalDirectory).toContain(
    "/synthetic/workspace/journal-",
  );
  for (const change of [
    (g: any) => (g.anchor.ledgerDirectory = g.anchor.workspaceDirectory),
    (g: any) => (g.manifest.directory = g.context.directory),
    (g: any) => (g.context.directory = g.manifest.directory + "/nested"),
    (g: any) => (g.manifest.directory = g.anchor.workspaceDirectory),
    (g: any) =>
      (g.context.directory = cloudJournalLocation(g.anchor).directory),
    (g: any) => (g.anchor.ledgerDirectory = "/synthetic"),
  ]) {
    const g = fixture();
    change(g);
    refused(() => createCloudJournalGenesis(g));
  }
});
it("requires absolute normalized bounded UTF8 paths without resolving or opening them", () => {
  for (const value of [
    "relative/private",
    "/",
    "/synthetic/../private",
    "/synthetic/path/",
    "/synthetic/\nprivate",
    "/synthetic/\ud800",
    "/" + "é".repeat(2048),
  ]) {
    for (const field of ["workspaceDirectory", "ledgerDirectory"] as const) {
      const f = fixture();
      f.anchor[field] = value;
      refused(() => createCloudJournalGenesis(f));
    }
    for (const field of ["manifest", "context"] as const) {
      const f = fixture();
      f[field].directory = value;
      refused(() => createCloudJournalGenesis(f));
    }
  }
  const f = fixture();
  f.anchor.workspaceDirectory = "/synthetic/桌面";
  expect(createCloudJournalGenesis(f).journalDirectory).toContain(
    "/桌面/journal-",
  );
});
it("bounds recipes, context, complete UTF8 envelopes and rejects malformed/private extra data", () => {
  const f = fixture();
  f.manifest.json = "x".repeat(512 * 1024 + 1);
  refused(() => createCloudJournalGenesis(f));
  const g = fixture();
  g.context.json = "x".repeat(32 * 1024 + 1);
  refused(() => createCloudJournalGenesis(g));
  for (const encoded of [
    "x".repeat(1536 * 1024 + 1),
    "{",
    "\ufeff{}",
    "\ud800",
    "null",
    "[]",
  ])
    refused(() => readCloudJournalGenesis(encoded, fixture().anchor));
  let reads = 0;
  const getter = Object.defineProperty({ ...fixture() }, "context", {
    enumerable: true,
    get() {
      reads++;
      throw Error("synthetic private accessor");
    },
  });
  for (const value of [
    getter,
    { ...fixture(), owned: true },
    Object.assign(Object.create({}), fixture()),
    Object.defineProperty(fixture(), "private", { value: true }),
    Object.assign(fixture(), { [Symbol("private")]: true }),
  ])
    refused(() => createCloudJournalGenesis(value as any));
  expect(reads).toBe(0);
  refused(() =>
    normalizeCloudJournalAnchor({
      ...fixture().anchor,
      reservation: { ...fixture().anchor.reservation, cleanup: "verified" },
    }),
  );
});
it("is structural integrity only: different valid source selections are never ownership or permissions", () => {
  const f = fixture();
  f.manifest.directory = "/synthetic/unavailable-source";
  const value = createCloudJournalGenesis(f),
    read = readCloudJournalGenesis(value.json, f.anchor);
  expect(read).toMatchObject({
    ownership: "unproven",
    runAuthority: "unproven",
    resourceWrites: 0,
  });
  expect(read.genesis.manifest.directory).toBe("/synthetic/unavailable-source");
  expect(effects).toEqual({ fs: 0, sqlite: 0, random: 0 });
});
it("recovers expired original material while current factories, policy, clock and physical stores are unavailable", () => {
  const f = fixture(),
    value = createCloudJournalGenesis(f),
    unavailable = () => {
      throw Error("synthetic private current helper unavailable");
    };
  const spies = [
    vi.spyOn(current, "cloudExpectedInventory").mockImplementation(unavailable),
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
    vi.spyOn(data, "cloudDataIdentityTemplate").mockImplementation(unavailable),
    vi
      .spyOn(policy, "validateCloudDeploymentPlan")
      .mockImplementation(unavailable),
    vi.spyOn(policy, "cloudDevelopmentCost").mockImplementation(unavailable),
    vi
      .spyOn(manifestCodec, "createCloudRunManifest")
      .mockImplementation(unavailable),
    vi.spyOn(Date, "now").mockImplementation(unavailable),
  ];
  let read: unknown, created: unknown;
  try {
    read = readCloudJournalGenesis(value.json, f.anchor);
    created = createCloudJournalGenesis(f);
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
  expect(read).toEqual(value);
  expect(created).toEqual(value);
});
