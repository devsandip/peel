import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  createCloudStackCreateIntent,
  readCloudStackCreateIntent,
  normalizeCloudStackCreateIntentPin,
} from "../../infra/cloud/stack-create-intent.ts";
import { createCloudRunPlanContext } from "../../infra/cloud/run-plan-context.ts";
import * as manifestCodec from "../../infra/cloud/run-manifest.ts";
import { expectedInventoryV1 } from "../../infra/cloud/inventory-v1.ts";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as policy from "../../infra/cloud/deployment-plan.ts";
import matched from "../fixtures/cloud-run-plan-context-v1.json";

const entropy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("node:crypto", async (original) => {
  const actual = await original<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID: () => {
      entropy.calls++;
      throw Error("private token generation unavailable");
    },
  };
});

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const nonce = "10000000-0000-4000-8000-000000000001";
const templateDigests = {
  artifacts: "0c5c0af4ed809671cb7d840ee7529dca1f01ea57c1e161f238817cc9c8872df1",
  guard: "19db64d86bb0ab015bd7df1c4d03f2e202cdde1e5cc21d930019a84b5bbf833b",
  sentinel: "ed9ca2ee1867a1cacbeeeb44fe93d72932bb7bdc802e81c0f7fb932b38c99020",
  data: "e7c249ac80fe914ccafdd869dc55bc42f94f2d95a3912c87c75e3ca2f124284e",
};
type Stack = keyof typeof templateDigests;
function fixture(kind: Stack = "artifacts") {
  const manifest = {
      json: matched.manifest.json,
      pin: manifestCodec.normalizeCloudRunManifestPin(matched.manifest.pin),
    },
    context = createCloudRunPlanContext({
      planJson: matched.planJson,
      manifest,
    });
  return {
    original: {
      contextJson: context.json,
      contextSha256: context.contextSha256,
      manifest,
    },
    stackKind: kind,
    clientRequestToken: `peel-${context.plan.runId}-${kind}-${nonce}`,
  };
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
    "Original Cloud stack creation intent unavailable",
  );
  expect(Object.keys(caught as object)).toEqual([]);
  expect((caught as Error).cause).toBeUndefined();
  expect(Object.isFrozen(caught)).toBe(true);
}
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
function rehashed(edit: (intent: any) => void, original = fixture()) {
  const valid = createCloudStackCreateIntent(original),
    value = JSON.parse(valid.json);
  edit(value);
  const json = JSON.stringify(value);
  return {
    json,
    expected: {
      original: original.original,
      pin: { ...valid.pin, sha256: hash(json) },
    },
  };
}
function changedTemplates(edit: (json: string) => string) {
  const f = fixture(),
    raw = JSON.parse(f.original.manifest.json),
    old = JSON.parse(raw.inventoryJson),
    plan = JSON.parse(matched.planJson);
  raw.templates = edit(raw.templates);
  const inventory = expectedInventoryV1({
    accountId: old.accountId,
    region: old.region,
    runId: old.runId,
    artifact: old.artifact,
    lease: old.lease,
    templatesSha256: hash(raw.templates),
  });
  raw.inventoryJson = JSON.stringify(inventory);
  plan.source.templatesSha256 = inventory.templatesSha256;
  const planJson = JSON.stringify(plan);
  raw.planSha256 = hash(planJson);
  const json = JSON.stringify(raw),
    manifest = {
      json,
      pin: {
        ...f.original.manifest.pin,
        sha256: hash(json),
        planSha256: raw.planSha256,
        templatesSha256: inventory.templatesSha256,
        inventorySha256: inventory.inventorySha256,
      },
    },
    context = createCloudRunPlanContext({ planJson, manifest });
  // Rehashed originals pass existing opaque/context contracts; this reader must check its own bundle schema.
  expect(manifestCodec.readCloudRunManifest(json, manifest.pin).templates).toBe(
    raw.templates,
  );
  return {
    ...f,
    original: {
      contextJson: context.json,
      contextSha256: context.contextSha256,
      manifest,
    },
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  entropy.calls = 0;
});

it.each(["artifacts", "guard", "sentinel", "data"] as const)(
  "binds exact frozen original %s template/name and retains one scoped token",
  (kind) => {
    const f = fixture(kind),
      result = createCloudStackCreateIntent(f),
      plan = JSON.parse(matched.planJson);
    expect(result.intent).toEqual({
      format: 1,
      kind: "peel-cloud-stack-create-intent",
      contextSha256: f.original.contextSha256,
      manifestSha256: matched.manifest.pin.sha256,
      planSha256: matched.manifest.pin.planSha256,
      inventorySha256: matched.manifest.pin.inventorySha256,
      identity: plan.identity,
      runId: plan.runId,
      stack: {
        kind,
        name: plan.stacks[kind],
        templateSha256: templateDigests[kind],
      },
      clientRequestToken: f.clientRequestToken,
    });
    expect(result.json).toBe(JSON.stringify(result.intent));
    expect(result.pin.sha256).toBe(hash(result.json));
    expect(result.pin.stackKind).toBe(kind);
    expect(result.intent.clientRequestToken.length).toBeLessThanOrEqual(128);
    expect(result).toMatchObject({
      ownership: "unproven",
      runAuthority: "unproven",
      resourceWrites: 0,
    });
    expect(
      readCloudStackCreateIntent(result.json, {
        original: f.original,
        pin: result.pin,
      }),
    ).toEqual(result);
    expect(
      createCloudStackCreateIntent({
        clientRequestToken: f.clientRequestToken,
        stackKind: kind,
        original: {
          manifest: f.original.manifest,
          contextSha256: f.original.contextSha256,
          contextJson: f.original.contextJson,
        },
      }),
    ).toEqual(result);
    expect(result).not.toHaveProperty("request");
    expect(result).not.toHaveProperty("allowWrite");
    expect(result).not.toHaveProperty("approved");
    frozen(result);
  },
);

it("captures detached immutable original pins and treats a different nonce/new pins as another identity, not a submission", () => {
  const f = fixture(),
    input = structuredClone(f),
    result = createCloudStackCreateIntent(input);
  input.original.manifest.pin.source.commit = "9".repeat(40);
  input.original.contextSha256 = "9".repeat(64);
  input.clientRequestToken = "private";
  expect(
    readCloudStackCreateIntent(result.json, {
      original: f.original,
      pin: result.pin,
    }),
  ).toEqual(result);
  expect(
    normalizeCloudStackCreateIntentPin(structuredClone(result.pin)),
  ).toEqual(result.pin);
  const other = createCloudStackCreateIntent({
    ...f,
    clientRequestToken: f.clientRequestToken.replace(
      nonce,
      "20000000-0000-4000-8000-000000000002",
    ),
  });
  expect(other.pin.sha256).not.toBe(result.pin.sha256);
  refused(() =>
    readCloudStackCreateIntent(other.json, {
      original: f.original,
      pin: result.pin,
    }),
  );
  expect(other.runAuthority).toBe("unproven");
  frozen(other);
});

it("rejects rehashed original identity, stack name/template and semantic field changes", () => {
  const edits = [
    (x: any) => {
      x.format = 2;
    },
    (x: any) => {
      x.kind = "private";
    },
    (x: any) => {
      x.contextSha256 = "9".repeat(64);
    },
    (x: any) => {
      x.manifestSha256 = "9".repeat(64);
    },
    (x: any) => {
      x.planSha256 = "9".repeat(64);
    },
    (x: any) => {
      x.inventorySha256 = "9".repeat(64);
    },
    (x: any) => {
      x.identity.accountId = "222233334444";
    },
    (x: any) => {
      x.identity.profile = "foreign";
    },
    (x: any) => {
      x.identity.region = "us-west-2";
    },
    (x: any) => {
      x.identity.approved = true;
    },
    (x: any) => {
      x.runId = "00000000-0000-4000-8000-000000000099";
    },
    (x: any) => {
      x.stack.name += "-foreign";
    },
    (x: any) => {
      x.stack.templateSha256 = "9".repeat(64);
    },
    (x: any) => {
      x.stack.kind = "other";
    },
    (x: any) => {
      x.stack.kind = "guard";
    },
    (x: any) => {
      x.stack.templateJson = "private";
    },
    (x: any) => {
      x.allowWrite = true;
    },
  ];
  for (const edit of edits) {
    const f = rehashed(edit);
    refused(() => readCloudStackCreateIntent(f.json, f.expected));
  }
});

it("rejects wrong independent original/descriptor pins, strict extras and data accessors", () => {
  const f = fixture(),
    valid = createCloudStackCreateIntent(f),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...f, approved: true },
    { ...f, stackKind: "unknown" },
    { ...f, original: { ...f.original, contextSha256: "9".repeat(64) } },
    {
      ...f,
      original: { ...f.original, contextJson: f.original.contextJson + " " },
    },
    { ...f, original: { ...f.original, extra: true } },
    {
      ...f,
      original: {
        ...f.original,
        manifest: {
          ...f.original.manifest,
          pin: { ...f.original.manifest.pin, sha256: "9".repeat(64) },
        },
      },
    },
    Object.defineProperty({ ...f }, "clientRequestToken", { get: getter }),
    {
      ...f,
      original: Object.defineProperty({ ...f.original }, "manifest", {
        get: getter,
      }),
    },
    {
      ...f,
      original: {
        ...f.original,
        manifest: {
          ...f.original.manifest,
          pin: Object.defineProperty({ ...f.original.manifest.pin }, "sha256", {
            get: getter,
          }),
        },
      },
    },
  ])
    refused(() => createCloudStackCreateIntent(input as typeof f));
  for (const pin of [
    null,
    { ...valid.pin, owned: true },
    Object.defineProperty({ ...valid.pin }, "sha256", { get: getter }),
    ...Object.keys(valid.pin).map((key) => ({
      ...valid.pin,
      [key]: key === "stackKind" ? "guard" : "9".repeat(64),
    })),
  ])
    refused(() =>
      readCloudStackCreateIntent(valid.json, {
        original: f.original,
        pin: pin as typeof valid.pin,
      }),
    );
  refused(() =>
    readCloudStackCreateIntent(
      valid.json,
      Object.defineProperty({ original: f.original, pin: valid.pin }, "pin", {
        get: getter,
      }),
    ),
  );
  expect(getter).not.toHaveBeenCalled();
});

it("enforces Peel's stricter original run/kind/lowercase-v4 nonce token policy on create and rehashed read", () => {
  const f = fixture();
  for (const value of [
    "",
    "token",
    f.clientRequestToken + "\n",
    f.clientRequestToken + "-extra",
    f.clientRequestToken.replace("artifacts", "guard"),
    f.clientRequestToken.replace("peel-", "Peel-"),
    f.clientRequestToken.replace(nonce, "10000000-0000-5000-8000-000000000001"),
    f.clientRequestToken.replace(nonce, "10000000-0000-4000-7000-000000000001"),
    f.clientRequestToken.replace(nonce, "A0000000-0000-4000-8000-000000000001"),
    f.clientRequestToken.replace(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000099",
    ),
    "x".repeat(129),
  ]) {
    refused(() =>
      createCloudStackCreateIntent({ ...f, clientRequestToken: value }),
    );
    const changed = rehashed((x) => {
      x.clientRequestToken = value;
    });
    refused(() => readCloudStackCreateIntent(changed.json, changed.expected));
  }
});

it("rejects noncanonical, duplicated-key, BOM and overbound UTF8 input even with recomputed descriptor hashes", () => {
  const f = fixture(),
    valid = createCloudStackCreateIntent(f),
    parsed = JSON.parse(valid.json);
  for (const json of [
    valid.json + " ",
    "\ufeff" + valid.json,
    JSON.stringify(parsed, null, 2),
    JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse())),
    valid.json.slice(0, -1) + ',"format":1}',
    valid.json + " ".repeat(4096),
    "界".repeat(1500),
    "null",
    "[]",
  ])
    refused(() =>
      readCloudStackCreateIntent(json, {
        original: f.original,
        pin: { ...valid.pin, sha256: hash(json) },
      }),
    );
});

it("checks its original five-template canonical bundle rather than relying on opaque recipe checksums", () => {
  for (const edit of [
    (json: string) => JSON.stringify(JSON.parse(json), null, 2),
    (json: string) => {
      const b = JSON.parse(json);
      delete b["artifact-bootstrap"];
      return JSON.stringify(b);
    },
    (json: string) => {
      const b = JSON.parse(json);
      b.extra = {};
      return JSON.stringify(b);
    },
    (json: string) => {
      const b = JSON.parse(json);
      b["artifact-bootstrap"] = null;
      return JSON.stringify(b);
    },
    (json: string) => {
      const b = JSON.parse(json);
      b["data-identity"] = [];
      return JSON.stringify(b);
    },
    (json: string) =>
      json.slice(0, -1) +
      ',"data-identity":' +
      JSON.stringify(JSON.parse(json)["data-identity"]) +
      "}",
  ])
    refused(() => createCloudStackCreateIntent(changedTemplates(edit)));
});

it("reads expired originals while all current factories/policy/clock and token generation are unavailable", () => {
  const f = fixture(),
    valid = createCloudStackCreateIntent(f),
    unavailable = () => {
      throw Error("private current helper unavailable");
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
  let recovered!: typeof valid;
  try {
    recovered = readCloudStackCreateIntent(valid.json, {
      original: f.original,
      pin: valid.pin,
    });
  } finally {
    clock.mockRestore();
  }
  expect(entropy.calls).toBe(0);
  expect(recovered).toEqual(valid);
  expect(recovered.intent.clientRequestToken).toBe(f.clientRequestToken);
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  frozen(recovered);
});
