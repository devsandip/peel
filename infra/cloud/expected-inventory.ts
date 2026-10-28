import { createHash } from "node:crypto";
import {
  inventoryV1Rules as rules,
  type InventoryV1Stack as Stack,
} from "./inventory-v1.ts";
import {
  cloudCleanupGuardTemplate,
  cloudCleanupSentinelTemplate,
  cloudDevStackNames,
} from "./cleanup.ts";
import { cloudDataIdentityTemplate } from "./data-identity.ts";
import {
  cloudArtifactBootstrapTemplate,
  cloudPrivateHostingTemplate,
  type CloudHostingInput,
} from "./private-hosting.ts";

export interface CloudInventoryInput extends CloudHostingInput {
  accountId: string;
  region: "us-east-1";
  templatesSha256: string;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const fail = (): never => {
  throw Error("Cloud expected inventory unavailable");
};
function record(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length) return fail();
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const d = descriptors[key];
    if (!d?.enumerable || !("value" in d)) return fail();
    result[key] = d.value;
  }
  return result;
}
function equal(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) return fail();
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
function normalized(value: unknown): CloudInventoryInput {
  const input = record(value, [
      "accountId",
      "region",
      "runId",
      "artifact",
      "lease",
      "templatesSha256",
    ]),
    artifact = record(input.artifact, ["sha256", "bytes"]),
    lease = record(input.lease, ["startedAt", "expiresAt"]);
  if (input.region !== "us-east-1" || !Number.isSafeInteger(artifact.bytes))
    return fail();
  return {
    accountId: text(input.accountId, /^\d{12}$/, 12),
    region: "us-east-1",
    runId: text(
      input.runId,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      36,
    ),
    artifact: {
      sha256: text(artifact.sha256, /^[a-f0-9]{64}$/, 64),
      bytes: artifact.bytes as number,
    },
    lease: {
      startedAt: text(
        lease.startedAt,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        24,
      ),
      expiresAt: text(
        lease.expiresAt,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        24,
      ),
    },
    templatesSha256: text(input.templatesSha256, /^[a-f0-9]{64}$/, 64),
  };
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Offline expectation only. No AWS reader, reservation, observed ownership or deletion authority. */
export function cloudExpectedInventory(
  value: CloudInventoryInput,
  reviewedTemplates: string,
) {
  try {
    const input = normalized(value);
    if (
      typeof reviewedTemplates !== "string" ||
      Buffer.byteLength(reviewedTemplates) > 128 * 1024 ||
      hash(reviewedTemplates) !== input.templatesSha256
    )
      return fail();
    // Keep this exact bundle/order compatible with the source collector's five-template hash.
    const bundle = {
      "data-identity": cloudDataIdentityTemplate(input.runId),
      "artifact-bootstrap": cloudArtifactBootstrapTemplate(input.runId),
      "cleanup-guard": cloudCleanupGuardTemplate(input),
      "cleanup-sentinel": cloudCleanupSentinelTemplate(input.runId),
      "private-hosting": cloudPrivateHostingTemplate(input),
    };
    if (reviewedTemplates !== JSON.stringify(bundle)) return fail();
    const templates = {
        artifacts: bundle["artifact-bootstrap"],
        guard: bundle["cleanup-guard"],
        sentinel: bundle["cleanup-sentinel"],
        data: bundle["private-hosting"],
      },
      names = cloudDevStackNames(input.runId),
      base = "peel-cloud-dev-" + input.runId,
      tags = {
        PeelProject: "peel",
        PeelEnvironment: "synthetic-cloud-dev",
        PeelRun: input.runId,
      };
    equal(names, {
      guard: base + "-guard",
      artifacts: base + "-artifacts",
      sentinel: base + "-sentinel",
      data: base + "-data",
    });
    const stacks = (Object.keys(rules) as Stack[]).map((stack) => {
      const resources = templates[stack].Resources as Record<
        string,
        {
          Type: string;
          Properties: Record<string, unknown>;
          DependsOn?: string;
        }
      >;
      equal(
        Object.keys(resources).sort(),
        rules[stack].map((rule) => rule.id).sort(),
      );
      const entries = rules[stack].map((rule) => {
        const resource = resources[rule.id],
          properties = resource.Properties;
        if (
          resource.Type !== rule.type ||
          resource.DependsOn !== rule.dependsOn
        )
          return fail();
        const name = rule.name
          ? { property: rule.name[0], value: base + rule.name[1] }
          : rule.constantName
            ? { property: rule.constantName[0], value: rule.constantName[1] }
            : null;
        if (name) equal(properties[name.property], name.value);
        if (rule.tags)
          equal(
            properties[rule.tags],
            rule.tags === "UserPoolTags"
              ? tags
              : Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
          );
        else if (
          Object.hasOwn(properties, "Tags") ||
          Object.hasOwn(properties, "UserPoolTags")
        )
          return fail();
        const parents = (rule.parents ?? []).map(([property, logicalId]) => {
          if (!resources[logicalId]) return fail();
          equal(properties[property], { Ref: logicalId });
          return { property, stack, logicalId };
        });
        if (!rule.tags && !parents.length) return fail();
        return {
          logicalId: rule.id,
          type: resource.Type,
          identity: { kind: rule.identifier, name },
          resolve: {
            kind: "owned-cloudformation-resource" as const,
            stackName: names[stack],
            logicalId: rule.id,
          },
          ownership: {
            tags: rule.tags
              ? { property: rule.tags, values: { ...tags } }
              : null,
            parents,
          },
          dependsOn: rule.dependsOn ? [rule.dependsOn] : [],
        };
      });
      return { kind: stack, name: names[stack], resources: entries };
    });
    const functionProperties =
      bundle["private-hosting"].Resources.CloudFunction.Properties;
    equal(functionProperties.Code, {
      S3Bucket: base,
      S3Key: "cloud-lambda/" + input.artifact.sha256 + ".zip",
    });
    equal(functionProperties.Role, {
      "Fn::GetAtt": ["CloudExecutionRole", "Arn"],
    });
    const expectation = {
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
        key: functionProperties.Code.S3Key,
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
      ...expectation,
      inventorySha256: hash(JSON.stringify(expectation)),
    });
  } catch {
    return fail();
  }
}
