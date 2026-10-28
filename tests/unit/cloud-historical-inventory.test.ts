import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import frozenRecipe from "../fixtures/cloud-inventory-v1-recipe.json";
import { cloudStackFixture } from "../fixtures/cloud-stack-pages.ts";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import {
  createCloudRunManifest,
  normalizeCloudRunManifestPin,
  readCloudRunManifest,
} from "../../infra/cloud/run-manifest.ts";
import {
  expectedInventoryV1,
  inventoryV1Rules,
} from "../../infra/cloud/inventory-v1.ts";
import { readHistoricalCloudInventory } from "../../infra/cloud/historical-inventory.ts";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const pin = () =>
  normalizeCloudRunManifestPin(structuredClone(frozenRecipe.pin));
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
function refused(work: () => unknown) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Historical Cloud inventory unavailable",
    );
    expect((error as Error).cause).toBeUndefined();
    expect(Object.isFrozen(error)).toBe(true);
    return;
  }
  throw Error("Expected historical inventory refusal");
}
// Deliberately recompute synthetic integrity fields so deep schema checks must run.
// Re-signing a test mutation is not independent provenance or AWS authority.
function changed(edit: (snapshot: any) => void) {
  const envelope = JSON.parse(frozenRecipe.json),
    snapshot = JSON.parse(envelope.inventoryJson);
  edit(snapshot);
  const { inventorySha256: _old, ...payload } = snapshot;
  snapshot.inventorySha256 = hash(JSON.stringify(payload));
  envelope.inventoryJson = JSON.stringify(snapshot);
  const json = JSON.stringify(envelope),
    original = pin();
  return {
    json,
    pin: {
      ...original,
      sha256: hash(json),
      inventorySha256: snapshot.inventorySha256,
    },
  };
}
function capture(
  edit: (input: current.CloudInventoryInput) => void = () => {},
) {
  const f = cloudStackFixture(),
    inventory = structuredClone(f.input.inventory);
  edit(inventory);
  const templates = JSON.stringify({
    "data-identity": data.cloudDataIdentityTemplate(inventory.runId),
    "artifact-bootstrap": hosting.cloudArtifactBootstrapTemplate(
      inventory.runId,
    ),
    "cleanup-guard": cleanup.cloudCleanupGuardTemplate(inventory),
    "cleanup-sentinel": cleanup.cloudCleanupSentinelTemplate(inventory.runId),
    "private-hosting": hosting.cloudPrivateHostingTemplate(inventory),
  });
  inventory.templatesSha256 = hash(templates);
  return createCloudRunManifest({
    profile: "synthetic-dev",
    source: {
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      lockSha256: "3".repeat(64),
    },
    planSha256: "4".repeat(64),
    inventory,
    templates,
  });
}
afterEach(() => vi.restoreAllMocks());

it("keeps the pre-extraction v1 recipe, every current factory byte and inventory digest unchanged", () => {
  expect(frozenRecipe.pin.sha256).toBe(
    "ba4ce28aec4c0cf3628177f54c52d9a0b35bee0fae5641c493bc3c1ba803f282",
  );
  expect(frozenRecipe.pin.inventorySha256).toBe(
    "27453ae0a08220da4f44b023da0258403205f324c47333d9a593a403dbbc052b",
  );
  expect(frozenRecipe.pin.templatesSha256).toBe(
    "e7aab2a4b387858f92f396e4471aeae64420b1b4b09f8962fb5191f4d708c2a8",
  );
  expect(hash(frozenRecipe.json)).toBe(frozenRecipe.pin.sha256);
  expect(capture()).toEqual(frozenRecipe);
  const expected = cloudStackFixture().expected,
    decoded = readHistoricalCloudInventory(frozenRecipe.json, pin());
  expect(decoded.inventory).toEqual(expected);
  expect(JSON.stringify(decoded.inventory)).toBe(
    readCloudRunManifest(frozenRecipe.json, pin()).inventoryJson,
  );
  expect(decoded).toMatchObject({
    kind: "decoded",
    profile: "synthetic-dev",
    planSha256: "4".repeat(64),
    manifestSha256: frozenRecipe.pin.sha256,
    ownership: "unproven",
    resourceWrites: 0,
  });
  frozen(decoded);
  frozen(inventoryV1Rules);
});

it("decodes the frozen expired recipe while every current factory/writer/name helper and clock is unavailable", () => {
  const unavailable = () => {
    throw Error("private current source unavailable");
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
  ];
  const clock = vi.spyOn(Date, "now").mockImplementation(unavailable);
  let result: ReturnType<typeof readHistoricalCloudInventory>;
  try {
    result = readHistoricalCloudInventory(frozenRecipe.json, pin());
  } finally {
    clock.mockRestore();
  }
  expect(result.inventory.stacks).toHaveLength(4);
  expect(result.inventory.stacks.flatMap((s) => s.resources)).toHaveLength(17);
  expect(result.inventory.lease.expiresAt).toBe("2026-10-27T13:30:00.000Z");
  expect(result.source.commit).toBe("1".repeat(40));
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});

it("rejects self-consistent but wrong catalog/name/type/tag/resolve/parent/dependency graphs", () => {
  const edits: ((s: any) => void)[] = [
    (s) => s.stacks.pop(),
    (s) => s.stacks.push(s.stacks[0]),
    (s) => s.stacks.reverse(),
    (s) => (s.stacks[0].name += "-foreign"),
    (s) => (s.stacks[0].kind = "data"),
    (s) => s.stacks[0].resources.pop(),
    (s) => s.stacks[0].resources.push(s.stacks[0].resources[0]),
    (s) => s.stacks[3].resources.reverse(),
    (s) => (s.stacks[3].resources[0].logicalId = "Foreign"),
    (s) => (s.stacks[3].resources[0].type = "AWS::Lambda::Url"),
    (s) => (s.stacks[3].resources[0].identity.kind = "provider"),
    (s) => (s.stacks[3].resources[0].identity.name.value += "-foreign"),
    (s) => (s.stacks[3].resources[0].resolve.kind = "observed-owned"),
    (s) => (s.stacks[3].resources[0].resolve.stackName = "foreign"),
    (s) => (s.stacks[3].resources[0].resolve.logicalId = "Foreign"),
    (s) => (s.stacks[3].resources[0].ownership.tags.values.PeelRun = "foreign"),
    (s) => (s.stacks[3].resources[1].ownership.tags.property = "Tags"),
    (s) => (s.stacks[0].resources[1].ownership.parents = []),
    (s) =>
      (s.stacks[0].resources[1].ownership.parents[0].logicalId =
        "CloudUserPool"),
    (s) => (s.stacks[0].resources[1].ownership.parents[0].stack = "data"),
    (s) =>
      (s.stacks[1].resources[3].ownership.parents[0].property = "ForeignGroup"),
    (s) => (s.stacks[3].resources[3].dependsOn = ["CloudDomain"]),
    (s) => (s.stacks[3].resources[5].dependsOn = []),
    (s) => (s.stacks[3].resources[0].physicalId = "private-provider-id"),
    (s) => (s.stacks[3].resources[0].ownership.private = "payload"),
    (s) => (s.stacks[3].resources[0] = null),
  ];
  for (const edit of edits) {
    const mutation = changed(edit);
    expect(readCloudRunManifest(mutation.json, mutation.pin).ownership).toBe(
      "unproven",
    );
    refused(() => readHistoricalCloudInventory(mutation.json, mutation.pin));
  }
});

it("binds exact artifact object and execution-role wiring even when test hashes are recomputed", () => {
  for (const edit of [
    (s: any) => {
      s.artifactObject.bucketName = "foreign";
    },
    (s: any) => {
      s.artifactObject.key = "unreviewed.zip";
    },
    (s: any) => {
      s.artifactObject.sha256 = "b".repeat(64);
    },
    (s: any) => {
      s.artifactObject.bytes += 1;
    },
    (s: any) => {
      s.artifactObject.stack = "data";
    },
    (s: any) => {
      s.functionRole.roleLogicalId = "ForeignRole";
    },
    (s: any) => {
      s.functionRole.functionLogicalId = "ForeignFunction";
    },
    (s: any) => {
      s.functionRole.stack = "guard";
    },
  ]) {
    const mutation = changed(edit);
    expect(
      readCloudRunManifest(mutation.json, mutation.pin).inventorySha256,
    ).toBe(mutation.pin.inventorySha256);
    refused(() => readHistoricalCloudInventory(mutation.json, mutation.pin));
  }
});

it("validates original header shapes and v1 lease/artifact bounds without consulting current time", () => {
  for (const edit of [
    (s: any) => {
      s.artifact.bytes = 0;
    },
    (s: any) => {
      s.artifact.bytes = 20 * 1024 * 1024 + 1;
    },
    (s: any) => {
      s.artifact.bytes = 1.5;
    },
    (s: any) => {
      s.artifact.bytes = "1024";
    },
    (s: any) => {
      s.artifact.sha256 = "invalid";
    },
    (s: any) => {
      s.artifact.private = "payload";
    },
    (s: any) => {
      s.lease.startedAt = "2026-02-30T12:00:00.000Z";
    },
    (s: any) => {
      s.lease.expiresAt = "2026-10-27T13:30:00.001Z";
    },
    (s: any) => {
      s.lease.expiresAt = "2026-10-27T13:30:01.000Z";
    },
    (s: any) => {
      s.lease.expiresAt = "2026-10-27T12:59:59.000Z";
    },
    (s: any) => {
      s.lease.expiresAt = s.lease.startedAt;
    },
    (s: any) => {
      s.lease.private = "payload";
    },
    (s: any) => {
      s.lease = null;
    },
  ]) {
    const mutation = changed((snapshot) => {
      edit(snapshot);
      snapshot.artifactObject.bytes = snapshot.artifact.bytes;
      snapshot.artifactObject.sha256 = snapshot.artifact.sha256;
      snapshot.artifactObject.key =
        "cloud-lambda/" + snapshot.artifact.sha256 + ".zip";
    });
    expect(readCloudRunManifest(mutation.json, mutation.pin).ownership).toBe(
      "unproven",
    );
    refused(() => readHistoricalCloudInventory(mutation.json, mutation.pin));
  }
});

it("accepts exact valid historical boundary captures and keeps provider IDs unresolved", () => {
  for (const minutes of [60, 90])
    for (const bytes of [1, 20 * 1024 * 1024]) {
      const actual = capture((input) => {
        input.artifact.bytes = bytes;
        input.lease.expiresAt = new Date(
          Date.parse(input.lease.startedAt) + minutes * 60000,
        ).toISOString();
      });
      const decoded = readHistoricalCloudInventory(actual.json, actual.pin);
      expect(decoded.inventory.artifact.bytes).toBe(bytes);
      expect(decoded.inventory.artifactObject.key).toBe(
        "cloud-lambda/" + "a".repeat(64) + ".zip",
      );
      expect(
        decoded.inventory.stacks
          .flatMap((s) => s.resources)
          .filter((r) => r.identity.kind === "provider")
          .map((r) => r.logicalId),
      ).toEqual([
        "CloudUserPool",
        "CloudClient",
        "CloudBranding",
        "CursorSecret",
      ]);
      decoded.inventory.stacks
        .flatMap((s) => s.resources)
        .forEach((r) => expect(r).not.toHaveProperty("physicalId"));
      expect(decoded.ownership).toBe("unproven");
      frozen(decoded);
    }
});

it("rejects version/scope/pin drift and malformed inputs with only a frozen private failure", () => {
  for (const edit of [
    (s: any) => {
      s.format = 2;
    },
    (s: any) => {
      s.kind = "observed";
    },
    (s: any) => {
      s.region = "us-west-2";
    },
    (s: any) => {
      s.accountId = "222233334444";
    },
    (s: any) => {
      s.runId = "00000000-0000-4000-8000-000000000002";
    },
    (s: any) => {
      s.extra = "private";
    },
  ]) {
    const mutation = changed(edit);
    refused(() => readHistoricalCloudInventory(mutation.json, mutation.pin));
  }
  const getter = vi.fn(() => "private");
  for (const value of [
    null,
    { ...pin(), sha256: "9".repeat(64) },
    { ...pin(), source: { ...pin().source, commit: "9".repeat(40) } },
    { ...pin(), private: "payload" },
    Object.defineProperty({ ...pin() }, "source", { get: getter }),
  ])
    refused(() =>
      readHistoricalCloudInventory(
        frozenRecipe.json,
        value as ReturnType<typeof pin>,
      ),
    );
  for (const json of [
    null,
    "[]",
    "private malformed",
    frozenRecipe.json + " ",
    "x".repeat(512 * 1024 + 1),
  ])
    refused(() => readHistoricalCloudInventory(json as string, pin()));
  expect(getter).not.toHaveBeenCalled();
});

it("copies and freezes original selectors and protects the legacy catalog from caller mutation", () => {
  const original = pin(),
    mutable = { ...original, source: { ...original.source } },
    result = readHistoricalCloudInventory(frozenRecipe.json, mutable);
  mutable.source.commit = "9".repeat(40);
  mutable.runId = "00000000-0000-4000-8000-000000000002";
  expect(result.source.commit).toBe(original.source.commit);
  expect(result.inventory.runId).toBe(original.runId);
  frozen(result);
  frozen(inventoryV1Rules);
  const header = JSON.parse(
      readCloudRunManifest(frozenRecipe.json, original).inventoryJson,
    ),
    getter = vi.fn(() => "private");
  expect(() =>
    expectedInventoryV1(
      Object.defineProperty(
        {
          accountId: header.accountId,
          region: header.region,
          runId: header.runId,
          artifact: header.artifact,
          lease: header.lease,
          templatesSha256: header.templatesSha256,
        },
        "artifact",
        { get: getter },
      ),
    ),
  ).toThrow("Cloud inventory format one unavailable");
  expect(getter).not.toHaveBeenCalled();
});
