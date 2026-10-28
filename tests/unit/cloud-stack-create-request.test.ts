import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { cloudJournalInput } from "../fixtures/cloud-journal-input.ts";
import golden from "../fixtures/cloud-stack-create-request-golden.json";
import {
  createCloudStackCreateIntent,
  readCloudStackCreateIntent,
} from "../../infra/cloud/stack-create-intent.ts";
import {
  createCloudStackCreateRequest,
  readCloudStackCreateRequestProjection,
  cloudStackCreateRequestInput,
  discardCloudStackCreateRequest,
} from "../../infra/cloud/stack-create-request.ts";
import * as factories from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as policy from "../../infra/cloud/deployment-plan.ts";
import * as manifestCodec from "../../infra/cloud/run-manifest.ts";

const effects = vi.hoisted(() => ({ fs: 0, sqlite: 0, random: 0, network: 0 }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  const denied = () => {
    effects.fs++;
    throw Error("synthetic private filesystem unavailable");
  };
  return {
    ...actual,
    openSync: denied,
    lstatSync: denied,
    fstatSync: denied,
    readSync: denied,
    readFileSync: denied,
    realpathSync: denied,
    readdirSync: denied,
    mkdirSync: denied,
    writeFileSync: denied,
    fsyncSync: denied,
    closeSync: denied,
  };
});
vi.mock("node:sqlite", () => ({
  DatabaseSync: class {
    constructor() {
      effects.sqlite++;
      throw Error("synthetic private SQL unavailable");
    }
  },
}));
vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  const denied = () => {
    effects.random++;
    throw Error("synthetic private randomness unavailable");
  };
  return { ...actual, randomUUID: denied, randomBytes: denied };
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex"),
  nonce = "10000000-0000-4000-8000-000000000001",
  key = Buffer.alloc(32).toString("base64"),
  kinds = ["artifacts", "guard", "sentinel", "data"] as const;
function fixture(kind: (typeof kinds)[number] = "data") {
  const f = cloudJournalInput("/synthetic/workspace"),
    original = {
      contextJson: f.context.json,
      contextSha256: f.context.sha256,
      manifest: { json: f.manifest.json, pin: f.manifest.pin },
    },
    intent = createCloudStackCreateIntent({
      original,
      stackKind: kind,
      clientRequestToken: `peel-${f.manifest.pin.runId}-${kind}-${nonce}`,
    });
  return {
    original,
    intent: { json: intent.json, pin: intent.pin },
    cursorKey: kind === "data" ? key : null,
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
    "Original Cloud stack request unavailable",
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
function changedTemplate(kind: (typeof kinds)[number], edit: (t: any) => void) {
  const f = fixture(kind),
    raw = JSON.parse(f.original.manifest.json),
    bundle = JSON.parse(raw.templates),
    names = {
      artifacts: "artifact-bootstrap",
      guard: "cleanup-guard",
      sentinel: "cleanup-sentinel",
      data: "private-hosting",
    };
  edit(bundle[names[kind]]);
  raw.templates = JSON.stringify(bundle);
  const inventory = JSON.parse(raw.inventoryJson);
  inventory.templatesSha256 = hash(raw.templates);
  const { inventorySha256: _, ...graph } = inventory;
  inventory.inventorySha256 = hash(JSON.stringify(graph));
  raw.inventoryJson = JSON.stringify(inventory);
  const context = JSON.parse(f.original.contextJson),
    plan = JSON.parse(context.planJson);
  plan.source.templatesSha256 = inventory.templatesSha256;
  context.planJson = JSON.stringify(plan);
  raw.planSha256 = hash(context.planJson);
  const json = JSON.stringify(raw),
    pin = {
      ...f.original.manifest.pin,
      sha256: hash(json),
      planSha256: raw.planSha256,
      templatesSha256: inventory.templatesSha256,
      inventorySha256: inventory.inventorySha256,
    };
  context.manifestSha256 = pin.sha256;
  const contextJson = JSON.stringify(context),
    original = {
      contextJson,
      contextSha256: hash(contextJson),
      manifest: { json, pin },
    },
    intent = createCloudStackCreateIntent({
      original,
      stackKind: kind,
      clientRequestToken: `peel-${pin.runId}-${kind}-${nonce}`,
    });
  expect(
    readCloudStackCreateIntent(intent.json, { original, pin: intent.pin }).pin,
  ).toEqual(intent.pin);
  return {
    original,
    intent: { json: intent.json, pin: intent.pin },
    cursorKey: f.cursorKey,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(effects).toEqual({ fs: 0, sqlite: 0, random: 0, network: 0 });
});

it("pins all four complete unsigned requests against independent Python serialization of frozen originals", () => {
  // Oracle serialized the documented field order in Python; no new builder code was imported.
  for (const kind of kinds) {
    const f = fixture(kind),
      value = createCloudStackCreateRequest(f),
      g = golden[kind];
    expect(value.pin).toEqual({
      sha256: g.sha256,
      unsignedSha256: g.unsignedSha256,
    });
    expect(Buffer.byteLength(value.json)).toBe(g.projectionBytes);
    expect(value.projection.input.TemplateBody.utf8Bytes).toBe(g.templateBytes);
    expect(value.projection.stackKind).toBe(kind);
    frozen(value);
    const input = cloudStackCreateRequestInput(value) as any;
    expect(input.StackName).toBe(value.projection.input.StackName);
    expect(input.ClientRequestToken).toBe(
      value.projection.input.ClientRequestToken,
    );
    expect(hash(input.TemplateBody)).toBe(
      value.projection.input.TemplateBody.sha256,
    );
    expect(input.OnFailure).toBe("ROLLBACK");
    expect(input.EnableTerminationProtection).toBe(false);
    expect(input.RetainExceptOnCreate).toBe(false);
    expect(input.TimeoutInMinutes).toBe(5);
    expect(input.DeploymentConfig).toEqual({ Mode: "STANDARD" });
    for (const absent of [
      "RoleARN",
      "DisableRollback",
      "NotificationARNs",
      "ResourceTypes",
      "RollbackConfiguration",
      "StackPolicyBody",
      "StackPolicyURL",
      "TemplateURL",
    ])
      expect(Object.hasOwn(input, absent)).toBe(false);
    expect(input.Capabilities).toEqual(
      kind === "guard" || kind === "data"
        ? ["CAPABILITY_NAMED_IAM"]
        : undefined,
    );
    expect(input.Tags).toEqual([
      { Key: "PeelProject", Value: "peel" },
      { Key: "PeelEnvironment", Value: "synthetic-cloud-dev" },
      { Key: "PeelRun", Value: "00000000-0000-4000-8000-000000000001" },
    ]);
    if (kind === "data") {
      expect(input.Parameters.length).toBe(1);
      expect(Object.keys(input.Parameters[0])).toEqual([
        "ParameterKey",
        "ParameterValue",
      ]);
      expect(input.Parameters[0].ParameterValue === key).toBe(true);
    } else expect(Object.hasOwn(input, "Parameters")).toBe(false);
    expect(value).toMatchObject({
      ownership: "unproven",
      runAuthority: "unproven",
      resourceWrites: 0,
    });
    expect(
      readCloudStackCreateRequestProjection(value.json, {
        original: f.original,
        intent: f.intent,
        pin: value.pin,
      }),
    ).toEqual(value);
  }
});

it("binds original deadlines and intended transport/identity without renewing expired lease or selecting environment defaults", () => {
  for (const kind of kinds) {
    const f = fixture(kind),
      value = createCloudStackCreateRequest(f),
      binding = value.projection.binding;
    expect(binding).toMatchObject({
      service: "cloudformation",
      operation: "CreateStack",
      apiVersion: "2010-05-15",
      method: "POST",
      destination: "https://cloudformation.us-east-1.amazonaws.com/",
      identity: {
        profile: "synthetic-dev",
        accountId: "111122223333",
        region: "us-east-1",
      },
      lease: {
        startedAt: "2026-10-27T12:00:00.000Z",
        expiresAt: "2026-10-27T13:30:00.000Z",
      },
      stopTestsAt: "2026-10-27T13:00:00.000Z",
      cleanupBy: "2026-10-27T14:00:00.000Z",
    });
    expect(binding.createBy).toBe(
      kind === "guard" || kind === "sentinel"
        ? "2026-10-27T12:10:00.000Z"
        : "2026-10-27T13:00:00.000Z",
    );
  }
});

it("keeps supplied NoEcho values out of handle enumeration/JSON/projection and binds their exact canonical value", () => {
  const f = fixture(),
    a = createCloudStackCreateRequest(f),
    otherKey = Buffer.alloc(32, 0xfb).toString("base64"),
    b = createCloudStackCreateRequest({ ...f, cursorKey: otherKey });
  expect(a.pin.unsignedSha256).not.toBe(b.pin.unsignedSha256);
  expect(a.pin.sha256).not.toBe(b.pin.sha256);
  expect(Object.keys(a)).toEqual([
    "json",
    "pin",
    "projection",
    "ownership",
    "runAuthority",
    "resourceWrites",
  ]);
  expect(Object.getOwnPropertySymbols(a)).toEqual([]);
  for (const value of [a, b]) {
    const serialized = JSON.stringify(value);
    expect(serialized.includes(key) || serialized.includes(otherKey)).toBe(
      false,
    );
    expect(value.json.includes(hash(value === a ? key : otherKey))).toBe(false);
  }
  expect(
    (cloudStackCreateRequestInput(b) as any).Parameters[0].ParameterValue ===
      otherKey,
  ).toBe(true);
});

it("cannot recover private material from copied/parsed/readback metadata and explicitly discards the active reference", () => {
  const f = fixture(),
    value = createCloudStackCreateRequest(f),
    read = readCloudStackCreateRequestProjection(value.json, {
      original: f.original,
      intent: f.intent,
      pin: value.pin,
    }),
    copy = cloudStackCreateRequestInput(value);
  for (const unknown of [
    read,
    { ...value },
    JSON.parse(JSON.stringify(value)),
    value.json,
    null,
    undefined,
  ])
    refused(() => cloudStackCreateRequestInput(unknown));
  frozen(copy);
  discardCloudStackCreateRequest(value);
  discardCloudStackCreateRequest(value);
  refused(() => cloudStackCreateRequestInput(value));
  expect((copy as any).Parameters[0].ParameterValue === key).toBe(true); // No claim of erasing caller copies.
});

it("treats a data request digest as opaque after material loss, without turning self-consistent metadata into authority", () => {
  const f = fixture(),
    value = createCloudStackCreateRequest(f),
    changed = JSON.parse(value.json);
  changed.unsignedSha256 = "f".repeat(64);
  const json = JSON.stringify(changed),
    pin = { sha256: hash(json), unsignedSha256: changed.unsignedSha256 },
    read = readCloudStackCreateRequestProjection(json, {
      original: f.original,
      intent: f.intent,
      pin,
    });
  expect(read.runAuthority).toBe("unproven");
  refused(() => cloudStackCreateRequestInput(read));
  const nonsecret = fixture("artifacts"),
    a = createCloudStackCreateRequest(nonsecret),
    x = JSON.parse(a.json);
  x.unsignedSha256 = "f".repeat(64);
  const encoded = JSON.stringify(x);
  refused(() =>
    readCloudStackCreateRequestProjection(encoded, {
      original: nonsecret.original,
      intent: nonsecret.intent,
      pin: { sha256: hash(encoded), unsignedSha256: x.unsignedSha256 },
    }),
  );
});

it("rejects rehashed nonsecret request fields, roles, capabilities, keys and original binding changes", () => {
  const f = fixture(),
    value = createCloudStackCreateRequest(f);
  for (const edit of [
    (x: any) => {
      x.policyVersion = 2;
    },
    (x: any) => {
      x.binding.identity.region = "us-west-2";
    },
    (x: any) => {
      x.binding.method = "GET";
    },
    (x: any) => {
      x.binding.destination = "https://example.invalid/";
    },
    (x: any) => {
      x.binding.createBy = "2027-01-01T00:00:00.000Z";
    },
    (x: any) => {
      x.input.OnFailure = "DO_NOTHING";
    },
    (x: any) => {
      x.input.DisableRollback = true;
    },
    (x: any) => {
      x.input.DeploymentConfig.Mode = "EXPRESS";
    },
    (x: any) => {
      x.input.RoleARN = "arn:aws:iam::111122223333:role/deletion";
    },
    (x: any) => {
      x.input.Capabilities = ["CAPABILITY_AUTO_EXPAND"];
    },
    (x: any) => {
      x.input.TemplateURL = "https://example.invalid/template";
    },
    (x: any) => {
      x.input.TimeoutInMinutes = 60;
    },
    (x: any) => {
      x.input.Tags.pop();
    },
    (x: any) => {
      x.input.TemplateBody.sha256 = "f".repeat(64);
    },
    (x: any) => {
      x.input.Parameters[0].UsePreviousValue = true;
    },
    (x: any) => {
      x.input.Parameters[0].ParameterValue = "synthetic-private";
    },
    (x: any) => {
      x.intentSha256 = "f".repeat(64);
    },
    (x: any) => {
      x.extra = true;
    },
  ]) {
    const changed = JSON.parse(value.json);
    edit(changed);
    const json = JSON.stringify(changed);
    refused(() =>
      readCloudStackCreateRequestProjection(json, {
        original: f.original,
        intent: f.intent,
        pin: { ...value.pin, sha256: hash(json) },
      }),
    );
  }
});

it("refuses invalid/no/unreviewed key input, parameter overrides and accessors privately before effects", () => {
  const f = fixture(),
    getter = vi.fn(() => key);
  for (const value of [
    null,
    { ...f, owned: true },
    { ...f, RoleARN: "private" },
    { ...f, cursorKey: null },
    { ...f, cursorKey: undefined },
    { ...f, cursorKey: key + "\n" },
    { ...f, cursorKey: Buffer.alloc(31).toString("base64") },
    { ...f, cursorKey: key.replace("A", "_") },
    { ...f, cursorKey: "*****" },
    { ...f, original: { ...f.original, contextSha256: "f".repeat(64) } },
    { ...f, intent: { ...f.intent, extra: true } },
    Object.defineProperty({ ...f }, "cursorKey", { get: getter }),
  ])
    refused(() => createCloudStackCreateRequest(value as never));
  expect(getter).not.toHaveBeenCalled();
  for (const kind of ["artifacts", "guard", "sentinel"] as const)
    refused(() =>
      createCloudStackCreateRequest({ ...fixture(kind), cursorKey: key }),
    );
});

it("refuses coherently rehashed extra resources, names, tags, retained policies, transforms and changed parameters", () => {
  for (const edit of [
    (t: any) => {
      t.Resources.Extra = { Type: "AWS::S3::Bucket", Properties: {} };
    },
    (t: any) => {
      t.Resources.CursorSecret.Properties.Name = "foreign";
    },
    (t: any) => {
      t.Resources.CursorSecret.Properties.Tags = [];
    },
    (t: any) => {
      t.Resources.CursorSecret.DeletionPolicy = "Retain";
    },
    (t: any) => {
      t.Resources.CursorSecret.UpdateReplacePolicy = "Snapshot";
    },
    (t: any) => {
      t.Transform = "AWS::Serverless-2016-10-31";
    },
    (t: any) => {
      t.Resources.CursorSecret.Properties.Extra = {
        "Fn::Transform": { Name: "private" },
      };
    },
    (t: any) => {
      t.Parameters.CursorKey.Default = "synthetic-private";
    },
    (t: any) => {
      t.Parameters.CursorKey.NoEcho = false;
    },
    (t: any) => {
      t.Parameters.Other = { Type: "String" };
    },
    (t: any) => {
      t.Resources.CloudFunction.Properties.Code.S3Key = "foreign";
    },
  ])
    refused(() => createCloudStackCreateRequest(changedTemplate("data", edit)));
  refused(() =>
    createCloudStackCreateRequest(
      changedTemplate("artifacts", (t: any) => {
        t.Parameters = {};
      }),
    ),
  );
});

it("refuses NoEcho references/substitutions outside its original secret slot and supplied literal checkpoints", () => {
  for (const edit of [
    (t: any) => {
      t.Outputs.Leak = { Value: { Ref: "CursorKey" } };
    },
    (t: any) => {
      t.Metadata = { Leak: { "Fn::Sub": "${CursorKey}" } };
    },
    (t: any) => {
      t.Resources.CursorSecret.Properties.SecretString = "literal";
    },
    (t: any) => {
      t.Description = key;
    },
  ])
    refused(() => createCloudStackCreateRequest(changedTemplate("data", edit)));
});

it("enforces inline template byte bounds without URL fallback or duplicating the body in its safe projection", () => {
  const initial = fixture("artifacts"),
    raw = JSON.parse(JSON.parse(initial.original.manifest.json).templates)[
      "artifact-bootstrap"
    ],
    baseBytes = Buffer.byteLength(JSON.stringify({ ...raw, Description: "" })),
    exact = changedTemplate("artifacts", (t) => {
      t.Description = "x".repeat(51200 - baseBytes);
    }),
    value = createCloudStackCreateRequest(exact);
  expect(value.projection.input.TemplateBody.utf8Bytes).toBe(51200);
  expect(Buffer.byteLength(value.json)).toBeLessThan(16 * 1024);
  expect(
    Object.hasOwn(cloudStackCreateRequestInput(value), "TemplateURL"),
  ).toBe(false);
  refused(() =>
    createCloudStackCreateRequest(
      changedTemplate("artifacts", (t) => {
        t.Description = "x".repeat(51201 - baseBytes);
      }),
    ),
  );
});

it("rejects noncanonical/bounded projection bytes and wrong independent integrity without leaking inputs", () => {
  const f = fixture(),
    value = createCloudStackCreateRequest(f);
  for (const json of [
    value.json + " ",
    "\ufeff" + value.json,
    JSON.stringify(JSON.parse(value.json), null, 2),
    value.json.slice(0, -1) + ',"format":1}',
    "x".repeat(16385),
    "界".repeat(6000),
  ])
    refused(() =>
      readCloudStackCreateRequestProjection(json, {
        original: f.original,
        intent: f.intent,
        pin: { ...value.pin, sha256: hash(json) },
      }),
    );
  refused(() =>
    readCloudStackCreateRequestProjection(value.json, {
      original: f.original,
      intent: f.intent,
      pin: { ...value.pin, sha256: "f".repeat(64) },
    }),
  );
});

it("constructs/reads expired originals with current factories/policy/clock, RNG, stores and network unavailable", () => {
  const f = fixture(),
    expected = createCloudStackCreateRequest(f),
    denied = () => {
      throw Error("synthetic private current helper unavailable");
    };
  vi.spyOn(factories, "cloudExpectedInventory").mockImplementation(denied);
  vi.spyOn(hosting, "cloudPrivateHostingTemplate").mockImplementation(denied);
  vi.spyOn(hosting, "cloudArtifactBootstrapTemplate").mockImplementation(
    denied,
  );
  vi.spyOn(cleanup, "cloudCleanupGuardTemplate").mockImplementation(denied);
  vi.spyOn(cleanup, "cloudCleanupSentinelTemplate").mockImplementation(denied);
  vi.spyOn(cleanup, "cloudDevStackNames").mockImplementation(denied);
  vi.spyOn(data, "cloudDataIdentityTemplate").mockImplementation(denied);
  vi.spyOn(policy, "validateCloudDeploymentPlan").mockImplementation(denied);
  vi.spyOn(policy, "cloudDevelopmentCost").mockImplementation(denied);
  vi.spyOn(manifestCodec, "createCloudRunManifest").mockImplementation(denied);
  vi.spyOn(Date, "now").mockImplementation(denied);
  vi.stubGlobal("fetch", () => {
    effects.network++;
    return denied();
  });
  let created: unknown, read: unknown;
  try {
    created = createCloudStackCreateRequest(f);
    read = readCloudStackCreateRequestProjection(expected.json, {
      original: f.original,
      intent: f.intent,
      pin: expected.pin,
    });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
  expect(created).toEqual(expected);
  expect(read).toEqual(expected);
});

it("reads safe metadata in an actual new process without a secret-bearing input checkpoint", async () => {
  const f = fixture(),
    value = createCloudStackCreateRequest(f),
    child = spawn(
      process.execPath,
      ["tests/fixtures/cloud-stack-request-loss-worker.mjs"],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
    );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", () => {});
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error("synthetic request worker failed")),
    );
  });
  const serialized = JSON.stringify({
    json: value.json,
    expected: { original: f.original, intent: f.intent, pin: value.pin },
  });
  expect(serialized.includes(key)).toBe(false);
  try {
    child.stdin.end(serialized);
    await done;
    expect(JSON.parse(output)).toEqual({
      projectionRead: true,
      materialUnavailable: true,
      resourceWrites: 0,
    });
  } finally {
    child.kill("SIGKILL");
  }
}, 15000);
