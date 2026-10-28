import { createHash } from "node:crypto";

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Frozen format-one catalog. Future inventory formats must not mutate this legacy contract.
export type InventoryV1Stack = "artifacts" | "guard" | "sentinel" | "data";
type Rule = {
  id: string;
  type: string;
  identifier: "name" | "provider" | "parent";
  name?: [property: string, suffix: string];
  constantName?: [property: string, value: string];
  tags?: "Tags" | "UserPoolTags";
  parents?: [property: string, logicalId: string][];
  dependsOn?: string;
};
// Exhaustive, separately reviewed coverage: a new factory resource cannot be ignored.
export const inventoryV1Rules = freeze<Record<InventoryV1Stack, Rule[]>>({
  artifacts: [
    {
      id: "ArtifactBucket",
      type: "AWS::S3::Bucket",
      identifier: "name",
      name: ["BucketName", ""],
      tags: "Tags",
    },
    {
      id: "ArtifactBucketPolicy",
      type: "AWS::S3::BucketPolicy",
      identifier: "parent",
      parents: [["Bucket", "ArtifactBucket"]],
    },
  ],
  guard: [
    {
      id: "CloudDeletionRole",
      type: "AWS::IAM::Role",
      identifier: "name",
      name: ["RoleName", "-delete"],
      tags: "Tags",
    },
    {
      id: "CleanupGroup",
      type: "AWS::Scheduler::ScheduleGroup",
      identifier: "name",
      name: ["Name", "-group"],
      tags: "Tags",
    },
    {
      id: "CleanupScheduleRole",
      type: "AWS::IAM::Role",
      identifier: "name",
      name: ["RoleName", "-schedule"],
      tags: "Tags",
    },
    {
      id: "SentinelCleanup",
      type: "AWS::Scheduler::Schedule",
      identifier: "name",
      name: ["Name", "-sentinel"],
      parents: [["GroupName", "CleanupGroup"]],
    },
    {
      id: "DataCleanup",
      type: "AWS::Scheduler::Schedule",
      identifier: "name",
      name: ["Name", "-data"],
      parents: [["GroupName", "CleanupGroup"]],
    },
  ],
  sentinel: [
    {
      id: "SentinelTable",
      type: "AWS::DynamoDB::Table",
      identifier: "name",
      name: ["TableName", "-sentinel"],
      tags: "Tags",
    },
  ],
  data: [
    {
      id: "CloudTable",
      type: "AWS::DynamoDB::Table",
      identifier: "name",
      name: ["TableName", ""],
      tags: "Tags",
    },
    {
      id: "CloudUserPool",
      type: "AWS::Cognito::UserPool",
      identifier: "provider",
      name: ["UserPoolName", ""],
      tags: "UserPoolTags",
    },
    {
      id: "CloudSyncScope",
      type: "AWS::Cognito::UserPoolResourceServer",
      identifier: "parent",
      constantName: ["Identifier", "peel-dev"],
      parents: [["UserPoolId", "CloudUserPool"]],
    },
    {
      id: "CloudClient",
      type: "AWS::Cognito::UserPoolClient",
      identifier: "provider",
      name: ["ClientName", ""],
      parents: [["UserPoolId", "CloudUserPool"]],
      dependsOn: "CloudSyncScope",
    },
    {
      id: "CloudDomain",
      type: "AWS::Cognito::UserPoolDomain",
      identifier: "name",
      name: ["Domain", "-auth"],
      parents: [["UserPoolId", "CloudUserPool"]],
    },
    {
      id: "CloudBranding",
      type: "AWS::Cognito::ManagedLoginBranding",
      identifier: "provider",
      parents: [
        ["UserPoolId", "CloudUserPool"],
        ["ClientId", "CloudClient"],
      ],
      dependsOn: "CloudDomain",
    },
    {
      id: "CursorSecret",
      type: "AWS::SecretsManager::Secret",
      identifier: "provider",
      name: ["Name", "-cursors"],
      tags: "Tags",
    },
    {
      id: "CloudExecutionRole",
      type: "AWS::IAM::Role",
      identifier: "name",
      name: ["RoleName", "-exec"],
      tags: "Tags",
    },
    {
      id: "CloudFunction",
      type: "AWS::Lambda::Function",
      identifier: "name",
      name: ["FunctionName", ""],
      tags: "Tags",
    },
  ],
});

const fail = (): never => {
  throw Object.freeze(new Error("Cloud inventory format one unavailable"));
};
function record(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  return Object.fromEntries(
    keys.map((key) => {
      if (!d[key]?.enumerable || !("value" in d[key])) return fail();
      return [key, d[key].value];
    }),
  );
}
function text(value: unknown, pattern: RegExp, length: number): string {
  if (
    typeof value !== "string" ||
    value.length !== length ||
    pattern.exec(value)?.[0] !== value
  )
    return fail();
  return value;
}
function timestamp(value: unknown) {
  const encoded = text(
      value,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/,
      24,
    ),
    time = Date.parse(encoded);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== encoded)
    return fail();
  return encoded;
}
function header(value: unknown) {
  const r = record(value, [
      "accountId",
      "region",
      "runId",
      "artifact",
      "lease",
      "templatesSha256",
    ]),
    artifact = record(r.artifact, ["sha256", "bytes"]),
    lease = record(r.lease, ["startedAt", "expiresAt"]);
  if (
    r.region !== "us-east-1" ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes <= 0 ||
    artifact.bytes > 20 * 1024 * 1024
  )
    return fail();
  const startedAt = timestamp(lease.startedAt),
    expiresAt = timestamp(lease.expiresAt),
    duration = Date.parse(expiresAt) - Date.parse(startedAt);
  if (duration < 60 * 60000 || duration > 90 * 60000) return fail();
  return {
    accountId: text(r.accountId, /^[0-9]{12}$/, 12),
    region: "us-east-1" as const,
    runId: text(
      r.runId,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      36,
    ),
    artifact: {
      sha256: text(artifact.sha256, /^[a-f0-9]{64}$/, 64),
      bytes: artifact.bytes as number,
    },
    lease: { startedAt, expiresAt },
    templatesSha256: text(r.templatesSha256, /^[a-f0-9]{64}$/, 64),
  };
}

/** Fixed v1 description, not a current IaC renderer, observation or deletion authority. */
export function expectedInventoryV1(value: unknown) {
  try {
    const input = header(value),
      base = "peel-cloud-dev-" + input.runId,
      names = {
        artifacts: base + "-artifacts",
        guard: base + "-guard",
        sentinel: base + "-sentinel",
        data: base + "-data",
      },
      tags = {
        PeelProject: "peel",
        PeelEnvironment: "synthetic-cloud-dev",
        PeelRun: input.runId,
      };
    const stacks = (Object.keys(inventoryV1Rules) as InventoryV1Stack[]).map(
      (stack) => ({
        kind: stack,
        name: names[stack],
        resources: inventoryV1Rules[stack].map((rule) => ({
          logicalId: rule.id,
          type: rule.type,
          identity: {
            kind: rule.identifier,
            name: rule.name
              ? { property: rule.name[0], value: base + rule.name[1] }
              : rule.constantName
                ? {
                    property: rule.constantName[0],
                    value: rule.constantName[1],
                  }
                : null,
          },
          resolve: {
            kind: "owned-cloudformation-resource" as const,
            stackName: names[stack],
            logicalId: rule.id,
          },
          ownership: {
            tags: rule.tags
              ? { property: rule.tags, values: { ...tags } }
              : null,
            parents: (rule.parents ?? []).map(([property, logicalId]) => ({
              property,
              stack,
              logicalId,
            })),
          },
          dependsOn: rule.dependsOn ? [rule.dependsOn] : [],
        })),
      }),
    );
    const description = {
      format: 1 as const,
      kind: "expected" as const,
      accountId: input.accountId,
      region: input.region,
      runId: input.runId,
      lease: input.lease,
      artifact: input.artifact,
      templatesSha256: input.templatesSha256,
      artifactObject: {
        stack: "artifacts" as const,
        bucketLogicalId: "ArtifactBucket",
        bucketName: base,
        key: "cloud-lambda/" + input.artifact.sha256 + ".zip",
        bytes: input.artifact.bytes,
        sha256: input.artifact.sha256,
      },
      functionRole: {
        stack: "data" as const,
        functionLogicalId: "CloudFunction",
        roleLogicalId: "CloudExecutionRole",
      },
      stacks,
    };
    return freeze({
      ...description,
      inventorySha256: createHash("sha256")
        .update(JSON.stringify(description))
        .digest("hex"),
    });
  } catch {
    return fail();
  }
}
