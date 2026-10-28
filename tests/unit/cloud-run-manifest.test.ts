import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { cloudStackFixture } from "../fixtures/cloud-stack-pages.ts";
import {
  createCloudRunManifest,
  readCloudRunManifest,
} from "../../infra/cloud/run-manifest.ts";

const factory = vi.hoisted(() => ({ disabled: false, calls: 0 }));
vi.mock("../../infra/cloud/expected-inventory.ts", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../infra/cloud/expected-inventory.ts")
    >();
  return {
    ...actual,
    cloudExpectedInventory: (
      ...args: Parameters<typeof actual.cloudExpectedInventory>
    ) => {
      factory.calls++;
      if (factory.disabled) throw Error("private changed factory");
      return actual.cloudExpectedInventory(...args);
    },
  };
});
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const f = cloudStackFixture();
  const input = {
    ...f.input,
    source: {
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      lockSha256: "3".repeat(64),
    },
    planSha256: "4".repeat(64),
  };
  return { ...f, input, captured: createCloudRunManifest(input) };
}
const frozen = (v: unknown) => {
  if (v && typeof v === "object") {
    expect(Object.isFrozen(v)).toBe(true);
    Object.values(v).forEach(frozen);
  }
};
function refused(work: () => unknown) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Reviewed Cloud run manifest unavailable",
    );
    expect((error as Error).cause).toBeUndefined();
    expect(Object.isFrozen(error)).toBe(true);
    return;
  }
  throw Error("Expected manifest refusal");
}
function modified(
  captured: ReturnType<typeof createCloudRunManifest>,
  json: string,
) {
  return () =>
    readCloudRunManifest(json, { ...captured.pin, sha256: hash(json) });
}
afterEach(() => {
  factory.disabled = false;
  factory.calls = 0;
  vi.restoreAllMocks();
});

it("captures deterministic canonical bytes and detached immutable original identities", () => {
  const f = fixture(),
    first = f.captured,
    { source, ...other } = f.input,
    second = createCloudRunManifest({
      ...other,
      source: {
        lockSha256: source.lockSha256,
        tree: source.tree,
        commit: source.commit,
      },
    });
  expect(second).toEqual(first);
  expect(first.pin).toEqual({
    sha256: hash(first.json),
    profile: "synthetic-dev",
    accountId: "111122223333",
    region: "us-east-1",
    runId: f.input.inventory.runId,
    source,
    planSha256: f.input.planSha256,
    templatesSha256: hash(f.input.templates),
    inventorySha256: f.expected.inventorySha256,
  });
  f.input.source.commit = "9".repeat(40);
  f.input.inventory.accountId = "222233334444";
  f.input.templates = "private mutation";
  expect(first.pin.source.commit).toBe("1".repeat(40));
  expect(first.pin.accountId).toBe("111122223333");
  frozen(first);
});

it("reads original recipe bytes after expiry and factory/source changes without invoking today's factory or clock", () => {
  const f = fixture();
  factory.disabled = true;
  const calls = factory.calls,
    clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw Error("current clock must not gate recovery");
    });
  let result: ReturnType<typeof readCloudRunManifest>;
  try {
    result = readCloudRunManifest(f.captured.json, f.captured.pin);
  } finally {
    clock.mockRestore();
  }
  expect(factory.calls).toBe(calls);
  expect(result.templates).toBe(f.input.templates);
  expect(result.inventoryJson).toBe(JSON.stringify(f.expected));
  expect(result.source).toEqual(f.input.source);
  expect(result).toMatchObject({
    format: 1,
    inventorySha256: f.expected.inventorySha256,
    manifestSha256: f.captured.pin.sha256,
    ownership: "unproven",
    resourceWrites: 0,
  });
  frozen(result);
  refused(() => createCloudRunManifest(f.input));
});

it("refuses any independently pinned identity/hash drift instead of substituting current selectors", () => {
  const f = fixture(),
    p = f.captured.pin;
  for (const change of [
    { sha256: "9".repeat(64) },
    { profile: "foreign" },
    { accountId: "222233334444" },
    { region: "us-west-2" },
    { runId: "00000000-0000-4000-8000-000000000002" },
    { planSha256: "9".repeat(64) },
    { templatesSha256: "9".repeat(64) },
    { inventorySha256: "9".repeat(64) },
    ...["commit", "tree", "lockSha256"].map((key) => ({
      source: {
        ...p.source,
        [key]: "9".repeat(key === "lockSha256" ? 64 : 40),
      },
    })),
  ])
    refused(() =>
      readCloudRunManifest(f.captured.json, { ...p, ...change } as typeof p),
    );
});

it("rejects unknown envelope versions/keys, noncanonical encoding and malformed retained data even with a recomputed outer hash", () => {
  const { captured } = fixture(),
    envelope = JSON.parse(captured.json);
  for (const change of [
    { format: 2 },
    { format: "1" },
    { kind: "foreign" },
    { Extra: "private payload" },
    { source: { ...envelope.source, token: "private payload" } },
    { inventoryJson: "private malformed" },
    { templates: envelope.templates + " " },
  ])
    refused(modified(captured, JSON.stringify({ ...envelope, ...change })));
  for (const encoded of [
    "null",
    "[]",
    "private malformed",
    captured.json + "\n",
    JSON.stringify(envelope, null, 2),
    JSON.stringify({ ...envelope, format: 1 }, ["kind", "format"]),
  ])
    refused(modified(captured, encoded));
  refused(() => readCloudRunManifest(captured.json + " ", captured.pin));
});

it("binds the original inventory header and complete opaque graph digest without interpreting it as ownership", () => {
  const { captured } = fixture(),
    envelope = JSON.parse(captured.json),
    inventory = JSON.parse(envelope.inventoryJson);
  for (const change of [
    { format: 2 },
    { kind: "observed" },
    { accountId: "222233334444" },
    { region: "us-west-2" },
    { runId: "00000000-0000-4000-8000-000000000002" },
    { templatesSha256: "9".repeat(64) },
    { inventorySha256: "9".repeat(64) },
    { Private: "payload" },
    { stacks: [] },
    { lease: { startedAt: "changed", expiresAt: "changed" } },
  ]) {
    const altered = JSON.stringify({ ...inventory, ...change });
    refused(
      modified(
        captured,
        JSON.stringify({ ...envelope, inventoryJson: altered }),
      ),
    );
  }
  for (const inventoryJson of [
    "null",
    "[]",
    JSON.stringify(inventory, null, 2),
  ])
    refused(modified(captured, JSON.stringify({ ...envelope, inventoryJson })));
});

it("enforces byte limits without returning oversize or provider/private payloads", () => {
  const f = fixture(),
    envelope = JSON.parse(f.captured.json);
  for (const change of [
    { inventoryJson: "x".repeat(64 * 1024 + 1) },
    { inventoryJson: "é".repeat(32 * 1024 + 1) },
    { templates: "x".repeat(128 * 1024 + 1) },
    { templates: "é".repeat(64 * 1024 + 1) },
  ])
    refused(modified(f.captured, JSON.stringify({ ...envelope, ...change })));
  refused(modified(f.captured, "x".repeat(512 * 1024 + 1)));
  refused(() =>
    createCloudRunManifest({
      ...f.input,
      templates: "é".repeat(64 * 1024 + 1),
    }),
  );
});

it("rejects accessors, custom records, extra fields and invalid capture selectors without evaluating getters", () => {
  const f = fixture(),
    getter = vi.fn(() => "private payload");
  for (const input of [
    null,
    { ...f.input, token: "private" },
    { ...f.input, profile: "bad\nprofile" },
    { ...f.input, planSha256: "bad" },
    { ...f.input, source: { ...f.input.source, commit: "bad" } },
    { ...f.input, source: { ...f.input.source, token: "private" } },
    { ...f.input, inventory: { ...f.input.inventory, region: "us-west-2" } },
    Object.assign(Object.create({ private: true }), f.input),
    Object.defineProperty({ ...f.input }, "templates", { get: getter }),
    {
      ...f.input,
      source: Object.defineProperty({ ...f.input.source }, "tree", {
        get: getter,
      }),
    },
  ])
    refused(() => createCloudRunManifest(input as typeof f.input));
  expect(getter).not.toHaveBeenCalled();
});

it("captures fresh pin records before reading and never retains pin references or getter payloads", () => {
  const { captured } = fixture(),
    getter = vi.fn(() => "private payload");
  for (const pin of [
    null,
    { ...captured.pin, token: "private" },
    { ...captured.pin, [Symbol("private")]: "payload" },
    { ...captured.pin, accountId: 111122223333 },
    Object.defineProperty({ ...captured.pin }, "sha256", { get: getter }),
    {
      ...captured.pin,
      source: Object.defineProperty({ ...captured.pin.source }, "commit", {
        get: getter,
      }),
    },
  ])
    refused(() =>
      readCloudRunManifest(captured.json, pin as typeof captured.pin),
    );
  expect(getter).not.toHaveBeenCalled();
  const pin = { ...captured.pin, source: { ...captured.pin.source } },
    result = readCloudRunManifest(captured.json, pin);
  pin.source.commit = "9".repeat(40);
  expect(result.source.commit).toBe("1".repeat(40));
  frozen(result);
});
