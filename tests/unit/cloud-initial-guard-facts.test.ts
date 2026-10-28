import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import raw from "../fixtures/cloud-initial-guard-v1.json";
import golden from "../fixtures/cloud-initial-guard-golden.json";
import { checkCloudInitialGuardFacts } from "../../infra/cloud/initial-guard-facts.ts";
import { createCloudJournalGenesis } from "../../infra/cloud/journal-genesis.ts";
import { CloudPreparationSession } from "../../infra/cloud/preparation-session.ts";
import * as policy from "../../infra/cloud/deployment-plan.ts";
import * as names from "../../infra/cloud/cleanup.ts";
import * as inventory from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";

const effects = vi.hoisted(() => ({
  fs: 0,
  sql: 0,
  random: 0,
  network: 0,
  process: 0,
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  const denied = () => {
    effects.fs++;
    throw Error("synthetic filesystem unavailable");
  };
  return {
    ...actual,
    openSync: denied,
    readFileSync: denied,
    writeFileSync: denied,
    lstatSync: denied,
    fstatSync: denied,
    realpathSync: denied,
    fsyncSync: denied,
    mkdirSync: denied,
    closeSync: denied,
    opendirSync: denied,
    readdirSync: denied,
  };
});
vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    constructor() {
      effects.sql++;
      throw Error("synthetic SQL unavailable");
    }
  },
}));
vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  const denied = () => {
    effects.random++;
    throw Error("synthetic randomness unavailable");
  };
  return { ...actual, randomUUID: denied, randomBytes: denied };
});
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const denied = () => {
    effects.process++;
    throw Error("synthetic process unavailable");
  };
  return {
    ...actual,
    execFile: denied,
    execFileSync: denied,
    spawn: denied,
    spawnSync: denied,
  };
});
type Case = {
  input: Parameters<typeof checkCloudInitialGuardFacts>[0];
  now: number;
};
function fixture(kind: "first" | "second" = "first"): Case {
  return structuredClone(raw[kind]) as unknown as Case;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex"),
  iso = (n: number) => new Date(n).toISOString();
function refused(work: () => unknown) {
  let error: unknown;
  try {
    work();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(
    "Initial reserved Cloud guard facts unavailable",
  );
  expect((error as Error).cause).toBeUndefined();
  expect(Object.keys(error as object)).toEqual([]);
  expect(Object.isFrozen(error)).toBe(true);
}
function frozen(v: unknown) {
  if (v && typeof v === "object") {
    expect(Object.isFrozen(v)).toBe(true);
    Object.values(v).forEach(frozen);
  }
}
function snapshot(f: Case): any {
  return f.input.ledger.snapshot;
}
function rehash(f: Case, derive = true) {
  const s = snapshot(f);
  if (derive) {
    s.reservedEnvelopeUSD = s.runs.length * 2 + 1;
    s.policyLedger = {
      format: 1,
      runs: s.runs.map((r: any) => ({
        runId: r.runId,
        cleanup: r.cleanup ? "verified" : "pending",
      })),
    };
  }
  s.snapshotSha256 = hash(
    JSON.stringify({
      format: s.format,
      authorizationSha256: s.authorizationSha256,
      runs: s.runs,
    }),
  );
  f.input.ledger.sha256 = s.snapshotSha256;
}
function receipt(f: Case, index = 0) {
  const r = snapshot(f).runs[index];
  return {
    runId: r.runId,
    planSha256: r.planSha256,
    inventorySha256: JSON.parse(f.input.genesis.json).manifest.pin
      .inventorySha256,
    checkedAt: iso(Date.parse(r.reservedAt) + 5000),
  };
}
function reverse(v: any): any {
  if (Array.isArray(v)) return v.map(reverse);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v)
        .reverse()
        .map(([k, v]) => [k, reverse(v)]),
    );
  return v;
}
/** Coherent supplied-data mutation, not an actual ledger/provider observation. */
function rebindPrice(f: Case, checkedAt: string) {
  const o = f.input.observed as any,
    g = JSON.parse(f.input.genesis.json),
    c = JSON.parse(g.context.json),
    p = JSON.parse(c.planJson);
  o.prices.checkedAt = checkedAt;
  const quote = policy.cloudDevelopmentCost(
    o.prices,
    Date.parse(g.anchor.reservation.reservedAt),
  );
  p.quoteSha256 = quote.quoteSha256;
  p.estimateUSD = quote.estimateUSD;
  c.planJson = JSON.stringify(p);
  const planSha = hash(c.planJson),
    m = JSON.parse(g.manifest.json);
  m.planSha256 = planSha;
  g.manifest.json = JSON.stringify(m);
  g.manifest.pin.sha256 = hash(g.manifest.json);
  g.manifest.pin.planSha256 = planSha;
  c.manifestSha256 = g.manifest.pin.sha256;
  g.context.json = JSON.stringify(c);
  g.context.sha256 = hash(g.context.json);
  g.anchor.reservation.planSha256 = planSha;
  f.input.genesis.anchor.reservation.planSha256 = planSha;
  f.input.genesis.json = JSON.stringify(g);
  f.input.genesis.sha256 = hash(f.input.genesis.json);
  snapshot(f).runs.at(-1).planSha256 = planSha;
  rehash(f);
}
beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    effects.network++;
    throw Error("synthetic network unavailable");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(effects).toEqual({ fs: 0, sql: 0, random: 0, network: 0, process: 0 });
});

it.each(["first", "second"] as const)(
  "checks %s public-API-generated metadata against an independent projection oracle",
  (kind) => {
    const f = fixture(kind),
      result = checkCloudInitialGuardFacts(f.input, f.now),
      json = JSON.stringify(result),
      g = golden[kind];
    expect(hash(json)).toBe(g.sha256);
    expect(Buffer.byteLength(json)).toBe(g.utf8Bytes);
    expect(result.observedSha256).toBe(g.observedSha256);
    expect(result).toMatchObject({
      phase: "initial-guard",
      ownership: "unproven",
      runAuthority: "unproven",
      currentAuthority: "unproven",
      resourceWrites: 0,
      guard: {
        createBy: "2026-10-27T12:10:00.000Z",
        remainingWindowMs: 480000,
      },
    });
    frozen(result);
    expect(Object.keys(result)).not.toContain("observed");
    expect(Object.keys(result)).not.toContain("genesis");
    expect(json.includes("111122223333")).toBe(false);
    expect(json.includes("synthetic-dev")).toBe(false);
  },
);

it("normalizes caller property order and detaches narrow output from all inputs", () => {
  const f = fixture(),
    result = checkCloudInitialGuardFacts(f.input, f.now);
  expect(checkCloudInitialGuardFacts(reverse(f.input), f.now)).toEqual(result);
  const prior = JSON.stringify(result);
  (f.input.observed as any).source.commit = "f".repeat(40);
  snapshot(f).runs[0].runId = "changed";
  expect(JSON.stringify(result)).toBe(prior);
  frozen(result);
});

it("uses original reservation birth time rather than replaying fresh-plan/start ages", () => {
  const f = fixture(),
    g = JSON.parse(f.input.genesis.json),
    p = JSON.parse(JSON.parse(g.context.json).planJson);
  expect(f.now - Date.parse(p.createdAt)).toBeGreaterThan(15 * 60000);
  expect(f.now - Date.parse(p.lease.startedAt)).toBeGreaterThan(30000);
  expect(checkCloudInitialGuardFacts(f.input, f.now).currentAuthority).toBe(
    "unproven",
  );
});

it("enforces the original guard deadline without claiming a positive last millisecond is adequate runway", () => {
  const f = fixture(),
    end = Date.parse("2026-10-27T12:10:00.000Z");
  (f.input.observed as any).checkedAt = iso(end - 1);
  const result = checkCloudInitialGuardFacts(f.input, end - 1);
  expect(result.guard.remainingWindowMs).toBe(1);
  expect(result.currentAuthority).toBe("unproven");
  refused(() => checkCloudInitialGuardFacts(f.input, end));
  refused(() => checkCloudInitialGuardFacts(f.input, end + 1));
});

it("checks exact critical age, no future tolerance, and no observation before original reserve", () => {
  const f = fixture(),
    o = f.input.observed as any,
    now = Date.parse("2026-10-27T12:03:00.000Z");
  o.checkedAt = iso(now - 120000);
  checkCloudInitialGuardFacts(f.input, now);
  for (const n of [
    now - 120001,
    now + 1,
    Date.parse(f.input.genesis.anchor.reservation.reservedAt) - 1,
  ]) {
    o.checkedAt = iso(n);
    refused(() => checkCloudInitialGuardFacts(f.input, now));
  }
});

it.each([
  [
    "identity",
    (o: any) => {
      o.identity.accountId = "999900001111";
    },
  ],
  [
    "profile",
    (o: any) => {
      o.identity.profile = "other";
    },
  ],
  [
    "region",
    (o: any) => {
      o.identity.region = "us-west-2";
    },
  ],
  [
    "source",
    (o: any) => {
      o.source.zipBytes++;
    },
  ],
  [
    "main",
    (o: any) => {
      o.mainCommit = "b".repeat(40);
    },
  ],
  [
    "tested",
    (o: any) => {
      o.testedCommit = "b".repeat(40);
    },
  ],
  [
    "checks",
    (o: any) => {
      o.checks.native = "pending";
    },
  ],
  [
    "worktree",
    (o: any) => {
      o.worktree = "dirty";
    },
  ],
] as const)("rejects supplied current %s drift", (_, edit) => {
  const f = fixture();
  edit(f.input.observed);
  refused(() => checkCloudInitialGuardFacts(f.input, f.now));
});

it("requires current credentials and claimed cleanup runway while refresh remains unproven data", () => {
  const f = fixture(),
    o = f.input.observed as any,
    cleanup = "2026-10-27T14:00:00.000Z";
  o.credentials.sessionExpiresAt = cleanup;
  checkCloudInitialGuardFacts(f.input, f.now);
  o.credentials.sessionExpiresAt = iso(f.now);
  refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  o.credentials.sessionExpiresAt = iso(f.now + 10000);
  refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  o.credentials.refreshProven = true;
  o.credentials.refreshExpiresAt = cleanup;
  expect(checkCloudInitialGuardFacts(f.input, f.now).currentAuthority).toBe(
    "unproven",
  );
  o.credentials.refreshExpiresAt = iso(Date.parse(cleanup) - 1);
  refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  o.credentials.refreshProven = "true";
  refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  o.credentials.refreshProven = false;
  o.credentials.refreshExpiresAt = cleanup;
  refused(() => checkCloudInitialGuardFacts(f.input, f.now));
});

it("requires integral initial quota and supplied absence without turning those fields into proof", () => {
  for (const quota of [
    100,
    101.5,
    "101",
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const f = fixture();
    (f.input.observed as any).unreservedConcurrency = quota;
    refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  }
  for (const key of ["targetNames", "hooks", "targetDataEvents"])
    for (const state of ["unknown", "present", "partial", true]) {
      const f = fixture();
      (f.input.observed as any).safety[key] = state;
      refused(() => checkCloudInitialGuardFacts(f.input, f.now));
    }
});

it("binds the original quote and rates rather than silently restamping a fresh current quote", () => {
  for (const edit of [
    (p: any) => {
      p.checkedAt = "2026-10-27T12:02:00.000Z";
    },
    (p: any) => {
      p.rates.secretMonth = 0.5;
    },
    (p: any) => {
      p.sourceSha256 = "0".repeat(64);
    },
    (p: any) => {
      p.currency = "EUR";
    },
    (p: any) => {
      p.region = "us-west-2";
    },
    (p: any) => {
      p.forecastUSD = 0;
    },
  ]) {
    const f = fixture();
    edit((f.input.observed as any).prices);
    refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  }
});

it("enforces the original quote's exact 24-hour boundary even with coherent supplied original hashes", () => {
  const f = fixture(),
    start = Date.parse("2026-10-27T12:00:00.000Z"),
    now = start + 30000;
  rebindPrice(f, iso(now - 24 * 60 * 60000));
  (f.input.observed as any).checkedAt = iso(start + 20000);
  expect(checkCloudInitialGuardFacts(f.input, now).currentAuthority).toBe(
    "unproven",
  );
  refused(() => checkCloudInitialGuardFacts(f.input, now + 1));
});

it("rejects an already cleaned selected run after coherent ledger rehash", () => {
  const f = fixture();
  snapshot(f).runs[0].cleanup = receipt(f);
  rehash(f);
  refused(() => checkCloudInitialGuardFacts(f.input, f.now));
});

it("requires the original selected tuple, authority, pin and real-format consumed projection as data", () => {
  for (const edit of [
    (s: any) => {
      s.authorizationSha256 = "f".repeat(64);
    },
    (s: any) => {
      s.runs[0].planSha256 = "f".repeat(64);
    },
    (s: any) => {
      s.runs[0].runId = "00000000-0000-4000-8000-000000000003";
    },
    (s: any) => {
      s.runs[0].reservedAt = "2026-10-27T12:00:11.000Z";
    },
    (s: any) => {
      s.runs = [];
    },
    (s: any) => {
      s.format = 2;
    },
  ]) {
    const f = fixture();
    edit(snapshot(f));
    rehash(f);
    refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  }
  for (const target of ["snapshot", "pin"]) {
    const f = fixture();
    if (target === "snapshot") snapshot(f).snapshotSha256 = "f".repeat(64);
    else f.input.ledger.sha256 = "f".repeat(64);
    refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  }
});

it("refuses old selected history when a later consumed run is supplied", () => {
  const f = fixture();
  f.input.ledger = fixture("second").input.ledger;
  refused(() => checkCloudInitialGuardFacts(f.input, f.now));
});

it("validates prior cleanup chronology and derived policy/envelope without claiming provider truth", () => {
  for (const edit of [
    (s: any) => {
      s.runs[0].cleanup = null;
    },
    (s: any) => {
      s.runs[0].cleanup.planSha256 = "f".repeat(64);
    },
    (s: any) => {
      s.runs[0].cleanup.checkedAt = "2026-10-27T12:01:00.000Z";
    },
    (s: any) => {
      s.runs[1].slot = 1;
    },
    (s: any) => {
      s.runs[1].runId = s.runs[0].runId;
    },
  ]) {
    const f = fixture("second");
    edit(snapshot(f));
    rehash(f);
    refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  }
  for (const key of ["policy", "envelope"]) {
    const f = fixture();
    if (key === "policy") snapshot(f).policyLedger.runs[0].cleanup = "verified";
    else snapshot(f).reservedEnvelopeUSD = 5;
    refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  }
});

it("requires independent original pins, anchor and exact canonical genesis bytes", () => {
  for (const edit of [
    (f: Case) => {
      f.input.genesis.sha256 = "f".repeat(64);
    },
    (f: Case) => {
      f.input.genesis.anchor.reservation.planSha256 = "f".repeat(64);
    },
    (f: Case) => {
      f.input.genesis.json += " ";
      f.input.genesis.sha256 = hash(f.input.genesis.json);
    },
    (f: Case) => {
      const g = JSON.parse(f.input.genesis.json);
      g.revision = 1;
      f.input.genesis.json = JSON.stringify(g);
      f.input.genesis.sha256 = hash(f.input.genesis.json);
    },
  ]) {
    const f = fixture();
    edit(f);
    refused(() => checkCloudInitialGuardFacts(f.input, f.now));
  }
});

it("rejects getters, callback/approval/phase extras, prototypes, array holes and encoding/size errors privately", () => {
  const f = fixture(),
    getter = vi.fn(() => f.input.observed),
    items: any[] = [
      null,
      { ...f.input, approved: true },
      { ...f.input, phase: "data" },
      { ...f.input, hooks: { clock: () => f.now } },
      Object.defineProperty({ ...f.input }, "observed", { get: getter }),
      Object.assign(Object.create({}), f.input),
    ];
  for (const value of items)
    refused(() => checkCloudInitialGuardFacts(value, f.now));
  expect(getter).not.toHaveBeenCalled();
  for (const edit of [
    (f: any) => {
      f.input.observed.credentials.token = "synthetic private extra";
    },
    (f: any) => {
      f.input.genesis.json = "界".repeat(600000);
    },
    (f: any) => {
      f.input.genesis.json = "\ud800";
    },
    (f: any) => {
      f.input.ledger.snapshot.runs = Array(1);
    },
    (f: any) => {
      Object.defineProperty(f.input.observed.identity, "accountId", {
        get: getter,
      });
    },
  ]) {
    const value = fixture();
    edit(value);
    refused(() => checkCloudInitialGuardFacts(value.input, value.now));
  }
  expect(getter).not.toHaveBeenCalled();
});

it("uses only the explicit valid clock and refuses regression or coercion", () => {
  const f = fixture();
  for (const now of [
    NaN,
    Infinity,
    -1,
    f.now + 0.5,
    "now",
    undefined,
    Date.parse(f.input.genesis.anchor.reservation.reservedAt) - 1,
  ])
    refused(() => checkCloudInitialGuardFacts(f.input, now as never));
});

it("works with current new-run/name/template helpers and Date.now unavailable, without effects", () => {
  const f = fixture(),
    denied = () => {
      throw Error("synthetic current helper unavailable");
    };
  vi.spyOn(policy, "validateCloudDeploymentPlan").mockImplementation(denied);
  vi.spyOn(names, "cloudDevStackNames").mockImplementation(denied);
  vi.spyOn(names, "cloudCleanupGuardTemplate").mockImplementation(denied);
  vi.spyOn(inventory, "cloudExpectedInventory").mockImplementation(denied);
  vi.spyOn(hosting, "cloudPrivateHostingTemplate").mockImplementation(denied);
  vi.spyOn(Date, "now").mockImplementation(denied);
  let result: unknown;
  try {
    result = checkCloudInitialGuardFacts(f.input, f.now);
  } finally {
    vi.restoreAllMocks();
  }
  expect((result as any).currentAuthority).toBe("unproven");
});

it("leaves coherent fabricated scope metadata unproven and unable to satisfy a live session brand", () => {
  const f = fixture(),
    g = JSON.parse(f.input.genesis.json);
  g.anchor.workspaceDirectory = "/synthetic/different";
  g.manifest.directory = "/synthetic/different/recipe";
  g.context.directory = "/synthetic/different/context";
  const original = createCloudJournalGenesis({
    anchor: g.anchor,
    manifest: g.manifest,
    context: g.context,
  });
  f.input.genesis = {
    json: original.json,
    sha256: original.sha256,
    anchor: original.genesis.anchor,
  };
  const result = checkCloudInitialGuardFacts(f.input, f.now);
  expect(result.currentAuthority).toBe("unproven");
  expect(result.resourceWrites).toBe(0);
  for (const copy of [
    result,
    JSON.parse(JSON.stringify(result)),
    { ...result },
  ])
    expect(() =>
      CloudPreparationSession.prototype.read.call(copy as never),
    ).toThrow("Fresh Cloud preparation session unavailable");
});
