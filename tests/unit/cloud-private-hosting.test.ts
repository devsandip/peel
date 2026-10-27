import { expect, it, vi } from "vitest";
import {
  cloudArtifactBootstrapTemplate,
  cloudPrivateHostingTemplate,
  type CloudHostingInput,
} from "../../infra/cloud/private-hosting";
import { parseCloudDevConfig } from "../../infra/cloud/runtime";

const run = "00000000-0000-4000-8000-000000000001";
const input = (): CloudHostingInput => ({
  runId: run,
  artifact: { sha256: "a".repeat(64), bytes: 1024 },
  lease: {
    startedAt: "2026-10-27T12:00:00.000Z",
    expiresAt: "2026-10-27T13:00:00.000Z",
  },
});
it("rejects malformed or oversized code and noncanonical/unbounded leases before rendering", () => {
  for (const artifact of [
    { sha256: "A".repeat(64), bytes: 1024 },
    { sha256: "a".repeat(64) + "\n", bytes: 1024 },
    { sha256: "a".repeat(64), bytes: 0 },
    { sha256: "a".repeat(64), bytes: 1.5 },
    { sha256: "a".repeat(64), bytes: 20 * 1024 * 1024 + 1 },
  ])
    expect(() => cloudPrivateHostingTemplate({ ...input(), artifact })).toThrow(
      "Invalid Cloud hosting artifact",
    );
  const toString = vi.fn(() => input().lease.startedAt);
  for (const lease of [
    { startedAt: input().lease.startedAt, expiresAt: input().lease.startedAt },
    { startedAt: input().lease.expiresAt, expiresAt: input().lease.startedAt },
    { startedAt: "2026-10-27T12:00:00Z", expiresAt: input().lease.expiresAt },
    {
      startedAt: input().lease.startedAt,
      expiresAt: "2026-10-27T13:30:00.001Z",
    },
    { startedAt: { toString }, expiresAt: input().lease.expiresAt },
  ])
    expect(() =>
      cloudPrivateHostingTemplate({
        ...input(),
        lease: lease as CloudHostingInput["lease"],
      }),
    ).toThrow("Invalid Cloud hosting lease");
  expect(toString).not.toHaveBeenCalled();
  expect(() => cloudArtifactBootstrapTemplate("unowned")).toThrow();
});
it("keeps the artifact bootstrap private/encrypted and out of the function creation graph", () => {
  const bootstrap = cloudArtifactBootstrapTemplate(run),
    main = cloudPrivateHostingTemplate(input()),
    bucket = bootstrap.Resources.ArtifactBucket.Properties,
    policy =
      bootstrap.Resources.ArtifactBucketPolicy.Properties.PolicyDocument
        .Statement;
  expect(
    Object.values(bucket.PublicAccessBlockConfiguration).every(Boolean),
  ).toBe(true);
  expect(
    bucket.BucketEncryption.ServerSideEncryptionConfiguration[0]
      .ServerSideEncryptionByDefault.SSEAlgorithm,
  ).toBe("AES256");
  expect(bucket.OwnershipControls.Rules[0].ObjectOwnership).toBe(
    "BucketOwnerEnforced",
  );
  expect(bucket).not.toHaveProperty("VersioningConfiguration");
  expect(bucket.LifecycleConfiguration.Rules[0].Prefix).toBe("cloud-lambda/");
  expect(
    bucket.LifecycleConfiguration.Rules[0].ExpirationInDays,
  ).toBeLessThanOrEqual(1);
  expect(policy.every((statement) => statement.Effect === "Deny")).toBe(true);
  expect(policy[0].Condition.Bool).toEqual({
    "aws:SecureTransport": "false",
    "aws:PrincipalIsAWSService": "false",
  });
  expect(main.Resources).not.toHaveProperty("ArtifactBucket");
  expect(main.Resources.CloudFunction.Properties.Code.S3Bucket).toBe(
    bucket.BucketName,
  );
  expect(main.Resources.CloudFunction.Properties.Code.S3Key).toBe(
    "cloud-lambda/" + input().artifact.sha256 + ".zip",
  );
});
it("grants only exact-table reads and the actual service transaction writes, with no public/logging capability", () => {
  const template = cloudPrivateHostingTemplate(input()),
    role = template.Resources.CloudExecutionRole.Properties,
    statements = role.Policies[0].PolicyDocument.Statement,
    allowed = statements.flatMap((statement) => statement.Action).sort();
  expect(allowed).toEqual(
    [
      "dynamodb:ConditionCheckItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
    ].sort(),
  );
  expect(
    statements.every(
      (statement) =>
        JSON.stringify(statement.Resource) ===
        JSON.stringify({ "Fn::GetAtt": ["CloudTable", "Arn"] }),
    ),
  ).toBe(true);
  expect(statements[1]).toHaveProperty("Condition.ForAnyValue:StringEquals", {
    "dynamodb:EnclosingOperation": ["TransactWriteItems"],
  });
  expect(role).not.toHaveProperty("ManagedPolicyArns");
  expect(role.AssumeRolePolicyDocument.Statement[0].Principal).toEqual({
    Service: "lambda.amazonaws.com",
  });
  const types = Object.values(template.Resources).map(
    (resource) => resource.Type,
  );
  for (const unexpected of [
    "AWS::Lambda::Url",
    "AWS::Lambda::Permission",
    "AWS::Lambda::EventSourceMapping",
    "AWS::ApiGatewayV2::Api",
    "AWS::Logs::LogGroup",
  ])
    expect(types).not.toContain(unexpected);
  const fn = template.Resources.CloudFunction.Properties;
  expect(fn).toMatchObject({
    MemorySize: 256,
    Timeout: 30,
    EphemeralStorage: { Size: 512 },
    ReservedConcurrentExecutions: 1,
    TracingConfig: { Mode: "PassThrough" },
  });
  expect(fn).not.toHaveProperty("VpcConfig");
});
it("resolves only the secret into environment and wires the fixed lease into the real parser", () => {
  const template = cloudPrivateHostingTemplate(input()),
    key = Buffer.alloc(32, 7).toString("base64"),
    fn = template.Resources.CloudFunction.Properties,
    references: Record<string, string> = {
      CloudTable: template.Resources.CloudTable.Properties.TableName,
      CloudUserPool: "us-east-1_synthetic",
      CloudClient: "syntheticclient",
    };
  expect(template.Parameters.CursorKey).toMatchObject({
    NoEcho: true,
    MinLength: 44,
    MaxLength: 44,
  });
  expect(template.Parameters.CursorKey).not.toHaveProperty("Default");
  expect(
    new RegExp(template.Parameters.CursorKey.AllowedPattern).test(key),
  ).toBe(true);
  expect(JSON.stringify(template)).not.toContain(key);
  const parameterRefs: string[] = [];
  const walk = (value: unknown, path: string[]) => {
    if (!value || typeof value !== "object") return;
    if ((value as { Ref?: string }).Ref === "CursorKey")
      parameterRefs.push(path.join("."));
    for (const [name, entry] of Object.entries(value))
      walk(entry, [...path, name]);
  };
  walk(template, []);
  expect(parameterRefs).toEqual([
    "Resources.CursorSecret.Properties.SecretString",
  ]);
  const environment = Object.fromEntries(
    Object.entries(fn.Environment.Variables).map(([name, value]) => {
      if (typeof value === "string") return [name, value];
      if ("Ref" in value) return [name, references[value.Ref]];
      expect(value["Fn::Sub"]).toBe(
        "{{resolve:secretsmanager:${CursorSecret}:SecretString}}",
      );
      return [name, key];
    }),
  );
  const config = parseCloudDevConfig({
    ...environment,
    AWS_REGION: "us-east-1",
  });
  expect(config.cursorKey).toEqual(Buffer.alloc(32, 7));
  expect(config.startedAt).toBe(Date.parse(input().lease.startedAt));
  expect(config.expiresAt).toBe(Date.parse(input().lease.expiresAt));
  expect(fn.Runtime).toBe("nodejs24.x");
  expect(fn.Handler).toBe("handler.handler");
});
