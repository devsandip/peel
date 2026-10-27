import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import { cloudDataIdentityTemplate } from "../../infra/cloud/data-identity.ts";
import {
  cloudExpectedInventory,
  type CloudInventoryInput,
} from "../../infra/cloud/expected-inventory.ts";

const runId = "00000000-0000-4000-8000-000000000001",
  base = "peel-cloud-dev-" + runId,
  hash = (value: string) => createHash("sha256").update(value).digest("hex"),
  message = "Cloud expected inventory unavailable";
function fixture() {
  const input: CloudInventoryInput = {
    accountId: "111122223333",
    region: "us-east-1",
    runId,
    artifact: { sha256: "a".repeat(64), bytes: 1024 },
    lease: {
      startedAt: "2026-10-27T12:00:00.000Z",
      expiresAt: "2026-10-27T13:30:00.000Z",
    },
    templatesSha256: "",
  };
  const templates = () =>
    JSON.stringify({
      "data-identity": cloudDataIdentityTemplate(input.runId),
      "artifact-bootstrap": hosting.cloudArtifactBootstrapTemplate(input.runId),
      "cleanup-guard": cleanup.cloudCleanupGuardTemplate(input),
      "cleanup-sentinel": cleanup.cloudCleanupSentinelTemplate(input.runId),
      "private-hosting": hosting.cloudPrivateHostingTemplate(input),
    });
  const json = templates();
  input.templatesSha256 = hash(json);
  return { input, json, templates };
}
afterEach(() => vi.restoreAllMocks());

it("covers exactly four actual stacks and all 17 logical resources without duplicating data-identity", () => {
  const f = fixture(),
    inventory = cloudExpectedInventory(f.input, f.json);
  expect(inventory.kind).toBe("expected");
  expect(
    inventory.stacks.map((s) => [
      s.kind,
      s.name,
      s.resources.map((r) => [r.logicalId, r.type]),
    ]),
  ).toEqual([
    [
      "artifacts",
      base + "-artifacts",
      [
        ["ArtifactBucket", "AWS::S3::Bucket"],
        ["ArtifactBucketPolicy", "AWS::S3::BucketPolicy"],
      ],
    ],
    [
      "guard",
      base + "-guard",
      [
        ["CloudDeletionRole", "AWS::IAM::Role"],
        ["CleanupGroup", "AWS::Scheduler::ScheduleGroup"],
        ["CleanupScheduleRole", "AWS::IAM::Role"],
        ["SentinelCleanup", "AWS::Scheduler::Schedule"],
        ["DataCleanup", "AWS::Scheduler::Schedule"],
      ],
    ],
    [
      "sentinel",
      base + "-sentinel",
      [["SentinelTable", "AWS::DynamoDB::Table"]],
    ],
    [
      "data",
      base + "-data",
      [
        ["CloudTable", "AWS::DynamoDB::Table"],
        ["CloudUserPool", "AWS::Cognito::UserPool"],
        ["CloudSyncScope", "AWS::Cognito::UserPoolResourceServer"],
        ["CloudClient", "AWS::Cognito::UserPoolClient"],
        ["CloudDomain", "AWS::Cognito::UserPoolDomain"],
        ["CloudBranding", "AWS::Cognito::ManagedLoginBranding"],
        ["CursorSecret", "AWS::SecretsManager::Secret"],
        ["CloudExecutionRole", "AWS::IAM::Role"],
        ["CloudFunction", "AWS::Lambda::Function"],
      ],
    ],
  ]);
  expect(inventory.stacks.flatMap((s) => s.resources)).toHaveLength(17);
  expect(inventory.artifactObject).toEqual({
    stack: "artifacts",
    bucketLogicalId: "ArtifactBucket",
    bucketName: base,
    key: "cloud-lambda/" + "a".repeat(64) + ".zip",
    bytes: 1024,
    sha256: "a".repeat(64),
  });
  expect(inventory.functionRole).toEqual({
    stack: "data",
    functionLogicalId: "CloudFunction",
    roleLogicalId: "CloudExecutionRole",
  });
  // This five-template serialization is the existing source collector's exact format.
  expect(inventory.templatesSha256).toBe(hash(f.json));
  const { inventorySha256, ...payload } = inventory;
  expect(inventorySha256).toBe(hash(JSON.stringify(payload)));
  expect(cloudExpectedInventory(f.input, f.json)).toEqual(inventory);
});

it("requires exact owned stack/logical-ID resolution and carries every untagged child's parent proof", () => {
  const f = fixture(),
    inventory = cloudExpectedInventory(f.input, f.json),
    resources = inventory.stacks.flatMap((s) => s.resources),
    get = (id: string) => resources.find((r) => r.logicalId === id)!;
  for (const stack of inventory.stacks)
    for (const r of stack.resources) {
      expect(r.resolve).toEqual({
        kind: "owned-cloudformation-resource",
        stackName: stack.name,
        logicalId: r.logicalId,
      });
      expect(r).not.toHaveProperty("physicalId");
      if (r.ownership.tags)
        expect(r.ownership.tags.values).toEqual({
          PeelProject: "peel",
          PeelEnvironment: "synthetic-cloud-dev",
          PeelRun: runId,
        });
      else {
        expect(r.ownership.parents.length).toBeGreaterThan(0);
        for (const parent of r.ownership.parents)
          expect(
            stack.resources.some((p) => p.logicalId === parent.logicalId),
          ).toBe(true);
      }
    }
  expect(
    resources
      .filter((r) => r.identity.kind === "provider")
      .map((r) => r.logicalId),
  ).toEqual(["CloudUserPool", "CloudClient", "CloudBranding", "CursorSecret"]);
  expect(get("CloudUserPool").identity.name).toEqual({
    property: "UserPoolName",
    value: base,
  });
  expect(get("CloudBranding").identity.name).toBeNull();
  expect(get("CloudBranding").ownership.parents).toEqual([
    { property: "UserPoolId", stack: "data", logicalId: "CloudUserPool" },
    { property: "ClientId", stack: "data", logicalId: "CloudClient" },
  ]);
  expect(get("DataCleanup").ownership.parents).toEqual([
    { property: "GroupName", stack: "guard", logicalId: "CleanupGroup" },
  ]);
  expect(get("ArtifactBucketPolicy").ownership.parents).toEqual([
    { property: "Bucket", stack: "artifacts", logicalId: "ArtifactBucket" },
  ]);
  expect(get("CloudClient").dependsOn).toEqual(["CloudSyncScope"]);
  expect(get("CloudBranding").dependsOn).toEqual(["CloudDomain"]);
});

it("binds scope, artifact, run and lease while preserving old expectations for later cleanup inspection", () => {
  const first = fixture(),
    a = cloudExpectedInventory(first.input, first.json);
  expect(
    cloudExpectedInventory(
      { ...first.input, accountId: "222233334444" },
      first.json,
    ).inventorySha256,
  ).not.toBe(a.inventorySha256);
  for (const change of [
    (i: CloudInventoryInput) => {
      i.runId = "00000000-0000-4000-8000-000000000002";
    },
    (i: CloudInventoryInput) => {
      i.artifact.sha256 = "b".repeat(64);
    },
    (i: CloudInventoryInput) => {
      i.artifact.bytes = 2048;
    },
    (i: CloudInventoryInput) => {
      i.lease.expiresAt = "2026-10-27T13:00:00.000Z";
    },
  ]) {
    const f = fixture();
    change(f.input);
    const json = f.templates();
    // Byte size is source metadata, not a CloudFormation property; bind it in the inventory.
    if (json !== f.json)
      expect(() => cloudExpectedInventory(f.input, f.json)).toThrow(message);
    f.input.templatesSha256 = hash(json);
    const b = cloudExpectedInventory(f.input, json);
    expect(b.inventorySha256).not.toBe(a.inventorySha256);
  }
  // No clock or fresh-new-run policy: expired expectations still identify cleanup targets.
  expect(cloudExpectedInventory(first.input, first.json).lease).toEqual(
    first.input.lease,
  );
});

it("refuses changed source bytes, including duplicate keys, unknown stacks/resources and broadened references", () => {
  const f = fixture();
  expect(() =>
    cloudExpectedInventory(
      { ...f.input, templatesSha256: "0".repeat(64) },
      f.json,
    ),
  ).toThrow(message);
  const edits: ((bundle: any) => void)[] = [
    (b) => {
      delete b["data-identity"];
    },
    (b) => {
      b["unknown-stack"] = b["data-identity"];
    },
    (b) => {
      delete b["private-hosting"].Resources.CloudClient;
    },
    (b) => {
      b["private-hosting"].Resources.Unowned = { Type: "AWS::S3::Bucket" };
    },
    (b) => {
      b["private-hosting"].Resources.CloudTable.Properties.Tags[2].Value =
        "foreign";
    },
    (b) => {
      b["private-hosting"].Resources.CloudClient.Properties.UserPoolId = {
        Ref: "ForeignPool",
      };
    },
    (b) => {
      b["cleanup-guard"].Resources.DataCleanup.Properties.GroupName = "default";
    },
    (b) => {
      b["private-hosting"].Resources.CloudFunction.Properties.Code.S3Bucket =
        "foreign";
    },
    (b) => {
      b["private-hosting"].Resources.CloudFunction.Properties.Role =
        "arn:aws:iam::111122223333:role/foreign";
    },
    (b) => {
      b[
        "private-hosting"
      ].Resources.CloudExecutionRole.Properties.Policies[0].PolicyDocument.Statement[0].Resource =
        "*";
    },
  ];
  for (const edit of edits) {
    const bundle = JSON.parse(f.json);
    edit(bundle);
    const json = JSON.stringify(bundle);
    expect(() =>
      cloudExpectedInventory({ ...f.input, templatesSha256: hash(json) }, json),
    ).toThrow(message);
  }
  for (const json of [
    f.json + "\n",
    f.json.replace(
      '{"data-identity":',
      '{"extra":{},"extra":{},"data-identity":',
    ),
    "x".repeat(128 * 1024 + 1),
  ])
    expect(() =>
      cloudExpectedInventory({ ...f.input, templatesSha256: hash(json) }, json),
    ).toThrow(message);
});

it("fails closed on future actual-factory inventory, type, name, tag, parent and dependency drift", () => {
  const actual = hosting.cloudPrivateHostingTemplate;
  const edits: ((template: any) => void)[] = [
    (t) => {
      t.Resources.NewResource = { Type: "AWS::S3::Bucket", Properties: {} };
    },
    (t) => {
      delete t.Resources.CursorSecret;
    },
    (t) => {
      t.Resources.CloudFunction.Type = "AWS::Lambda::Url";
    },
    (t) => {
      t.Resources.CloudFunction.Properties.FunctionName += "-foreign";
    },
    (t) => {
      t.Resources.CloudUserPool.Properties.UserPoolTags.PeelRun = "foreign";
    },
    (t) => {
      t.Resources.CloudClient.Properties.UserPoolId = { Ref: "ForeignPool" };
    },
    (t) => {
      t.Resources.CloudClient.DependsOn = "CloudDomain";
    },
    (t) => {
      t.Resources.CloudFunction.Properties.Code.S3Key = "unreviewed.zip";
    },
    (t) => {
      t.Resources.CloudFunction.Properties.Role = {
        "Fn::GetAtt": ["ForeignRole", "Arn"],
      };
    },
  ];
  for (const edit of edits) {
    const f = fixture();
    vi.spyOn(hosting, "cloudPrivateHostingTemplate").mockImplementation(
      (input) => {
        const t = actual(input);
        edit(t);
        return t;
      },
    );
    const json = f.templates();
    expect(() =>
      cloudExpectedInventory({ ...f.input, templatesSha256: hash(json) }, json),
    ).toThrow(message);
    vi.restoreAllMocks();
  }
  const f = fixture(),
    names = cleanup.cloudDevStackNames(runId);
  vi.spyOn(cleanup, "cloudDevStackNames").mockReturnValue({
    ...names,
    data: "foreign",
  });
  expect(() => cloudExpectedInventory(f.input, f.json)).toThrow(message);
});

it("rejects malformed input without coercion, caller mutation, private detail or template content in output", () => {
  const f = fixture(),
    getter = vi.fn(() => "private-secret"),
    bad: unknown[] = [
      null,
      { ...f.input, region: "us-west-2" },
      { ...f.input, region: "us-gov-west-1" },
      { ...f.input, accountId: "111122223333\n" },
      { ...f.input, accountId: 111122223333 },
      { ...f.input, runId: "A" + runId.slice(1) },
      { ...f.input, runId: runId + "\n" },
      { ...f.input, accountId: { toString: getter } },
      { ...f.input, extra: true },
      { ...f.input, artifact: { ...f.input.artifact, bytes: 0 } },
      {
        ...f.input,
        artifact: { ...f.input.artifact, bytes: 20 * 1024 * 1024 + 1 },
      },
      { ...f.input, artifact: { ...f.input.artifact, bytes: NaN } },
      {
        ...f.input,
        lease: { ...f.input.lease, expiresAt: "2026-10-27T13:30:00.001Z" },
      },
      {
        ...f.input,
        lease: { ...f.input.lease, expiresAt: "2026-10-27T12:30:00.000Z" },
      },
      Object.defineProperty({ ...f.input }, "accountId", { get: getter }),
    ];
  for (const value of bad)
    expect(() =>
      cloudExpectedInventory(value as CloudInventoryInput, f.json),
    ).toThrow(message);
  expect(getter).not.toHaveBeenCalled();
  const result = cloudExpectedInventory(f.input, f.json),
    digest = result.inventorySha256;
  const checkFrozen = (v: unknown) => {
    if (v && typeof v === "object") {
      expect(Object.isFrozen(v)).toBe(true);
      Object.values(v).forEach(checkFrozen);
    }
  };
  checkFrozen(result);
  f.input.accountId = "222233334444";
  f.input.lease.expiresAt = "changed";
  f.input.artifact.bytes = 999;
  expect(result.accountId).toBe("111122223333");
  expect(result.artifact.bytes).toBe(1024);
  expect(result.lease.expiresAt).toBe("2026-10-27T13:30:00.000Z");
  expect(result.inventorySha256).toBe(digest);
  const json = JSON.stringify(result);
  for (const forbidden of [
    "SecretString",
    '"Environment":',
    "PolicyDocument",
    "Parameters",
    "arn:aws:",
    "PEEL_CLOUD_CURSOR_KEY",
  ])
    expect(json).not.toContain(forbidden);
});
