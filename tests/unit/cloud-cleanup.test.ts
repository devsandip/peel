import { expect, it, vi } from "vitest";
import {
  cloudCleanupGuardTemplate,
  cloudCleanupSentinelTemplate,
  cloudDevStackNames,
} from "../../infra/cloud/cleanup";
import { cloudPrivateHostingTemplate } from "../../infra/cloud/private-hosting";

const run = "00000000-0000-4000-8000-000000000001";
const name = "peel-cloud-dev-" + run;
const lease = {
  startedAt: "2026-10-27T12:00:00.000Z",
  expiresAt: "2026-10-27T13:30:00.000Z",
};
const arn = (service: string, resource: string) =>
  `arn:aws:${service}:us-east-1:111122223333:${resource}`;
const roleArn = (suffix: string) =>
  `arn:aws:iam::111122223333:role/${name}-${suffix}`;
const symbols: Record<string, string> = {
  "AWS::Partition": "aws",
  "AWS::Region": "us-east-1",
  "AWS::AccountId": "111122223333",
  "CloudDeletionRole.Arn": roleArn("delete"),
  "CleanupScheduleRole.Arn": roleArn("schedule"),
  CleanupGroup: name + "-group",
  "CleanupGroup.Arn": arn("scheduler", "schedule-group/" + name + "-group"),
};
// Resolve this template's subset of intrinsics with synthetic symbols only.
function resolve(value: unknown): any {
  if (Array.isArray(value)) return value.map(resolve);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, any>;
  if (object.Ref || object["Fn::GetAtt"]) {
    const symbol = object.Ref ?? object["Fn::GetAtt"].join(".");
    if (!(symbol in symbols)) throw Error("Unknown fixture symbol");
    return symbols[symbol];
  }
  if (object["Fn::Sub"])
    return object["Fn::Sub"].replace(
      /\$\{([^}]+)\}/g,
      (_: string, key: string) => {
        if (!(key in symbols)) throw Error("Unknown fixture substitution");
        return symbols[key];
      },
    );
  return Object.fromEntries(
    Object.entries(object).map(([key, entry]) => [key, resolve(entry)]),
  );
}
type Statement = {
  Effect: string;
  Action: string[];
  Resource: string | string[];
  Condition?: { StringEquals: Record<string, string> };
};
const matches = (pattern: string, value: string) =>
  new RegExp(
    "^" +
      pattern
        .split("*")
        .map((part) =>
          part
            .split("?")
            .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("."),
        )
        .join(".*") +
      "$",
  ).test(value);
const conditionMatches = (
  condition: Statement["Condition"],
  context: Record<string, string>,
) =>
  Object.entries(condition?.StringEquals ?? {}).every(
    ([key, expected]) => context[key] === expected,
  );
// Contract assertions for this small Allow/StringEquals subset, not an AWS IAM simulator.
const allows = (
  statements: Statement[],
  action: string,
  resource: string,
  context: Record<string, string> = {},
) =>
  statements.some(
    (s) =>
      s.Effect === "Allow" &&
      s.Action.includes(action) &&
      [s.Resource].flat().some((r) => matches(r, resource)) &&
      conditionMatches(s.Condition, context),
  );
const roles = () => {
  const resources = resolve(
    cloudCleanupGuardTemplate({ runId: run, lease }).Resources,
  );
  return {
    resources,
    deletion: resources.CloudDeletionRole.Properties.Policies[0].PolicyDocument
      .Statement as Statement[],
    schedule: resources.CleanupScheduleRole.Properties.Policies[0]
      .PolicyDocument.Statement as Statement[],
  };
};

it("rejects unowned/coerced identities and leases that cannot fit the rehearsal and cleanup margin", () => {
  for (const bad of [
    run.toUpperCase().replace("00000000", "AAAAAAAA"),
    run + "\n",
    "unowned",
  ])
    for (const render of [cloudCleanupSentinelTemplate, cloudDevStackNames])
      expect(() => render(bad)).toThrow();
  const toString = vi.fn(() => lease.startedAt);
  for (const badLease of [
    { ...lease, startedAt: { toString } },
    { ...lease, startedAt: "2026-10-27T12:00:00Z" },
    { ...lease, expiresAt: "2026-10-27T12:59:59.000Z" },
    { ...lease, expiresAt: "2026-10-27T13:30:00.001Z" },
    { ...lease, startedAt: "2026-10-27T12:00:00.001Z" },
    { ...lease, expiresAt: lease.startedAt },
  ])
    expect(() =>
      cloudCleanupGuardTemplate({
        runId: run,
        lease: badLease as typeof lease,
      }),
    ).toThrow();
  expect(toString).not.toHaveBeenCalled();
  expect(() =>
    cloudCleanupGuardTemplate({
      runId: run,
      lease: { ...lease, expiresAt: "2026-10-27T13:00:00.000Z" },
    }),
  ).not.toThrow();
});

it("permits owned resource deletion without granting note/key access, creation or self-deletion", () => {
  const { resources, deletion, schedule } = roles();
  for (const table of [name, name + "-sentinel"])
    expect(
      allows(
        deletion,
        "dynamodb:DeleteTable",
        arn("dynamodb", "table/" + table),
      ),
    ).toBe(true);
  expect(
    allows(deletion, "dynamodb:DeleteTable", arn("dynamodb", "table/unowned")),
  ).toBe(false);
  expect(
    allows(
      deletion,
      "lambda:DeleteFunction",
      arn("lambda", "function:" + name),
    ),
  ).toBe(true);
  expect(
    allows(
      deletion,
      "secretsmanager:DeleteSecret",
      arn("secretsmanager", "secret:" + name + "-cursors-Ab12Cd"),
    ),
  ).toBe(true);
  for (const suffix of ["Ab12Cd-extra", "", "Ab12C"])
    expect(
      allows(
        deletion,
        "secretsmanager:DeleteSecret",
        arn("secretsmanager", "secret:" + name + "-cursors-" + suffix),
      ),
    ).toBe(false);
  expect(allows(deletion, "iam:DeleteRole", roleArn("exec"))).toBe(true);
  for (const suffix of ["delete", "schedule", "unknown"])
    expect(allows(deletion, "iam:DeleteRole", roleArn(suffix))).toBe(false);
  for (const action of [...deletion, ...schedule].flatMap((s) => s.Action))
    expect(action).toMatch(
      /:(Delete|Describe|GetFunction|GetRole|ListTags|ListRolePolicies|ListAttachedRolePolicies|PassRole)/,
    );
  for (const action of [
    "dynamodb:GetItem",
    "dynamodb:Query",
    "dynamodb:Scan",
    "secretsmanager:GetSecretValue",
    "lambda:InvokeFunction",
    "cognito-idp:AdminGetUser",
    "cognito-idp:TagResource",
    "iam:CreateRole",
    "iam:PutRolePolicy",
    "iam:PassRole",
    "s3:DeleteBucket",
  ])
    expect(deletion.some((s) => s.Action.includes(action))).toBe(false);
  expect(
    resources.CloudDeletionRole.Properties.AssumeRolePolicyDocument.Statement,
  ).toEqual([
    {
      Effect: "Allow",
      Principal: { Service: "cloudformation.amazonaws.com" },
      Action: "sts:AssumeRole",
    },
  ]);
  for (const role of [
    resources.CloudDeletionRole,
    resources.CleanupScheduleRole,
  ])
    expect(role.Properties).not.toHaveProperty("ManagedPolicyArns");
  expect(
    Object.values(resources)
      .map((resource: any) => resource.Type)
      .sort(),
  ).toEqual(
    [
      "AWS::IAM::Role",
      "AWS::IAM::Role",
      "AWS::Scheduler::Schedule",
      "AWS::Scheduler::Schedule",
      "AWS::Scheduler::ScheduleGroup",
    ].sort(),
  );
});

it("requires all pool ownership tags and the correct account/region, with only a regional domain-read exception", () => {
  const { deletion } = roles(),
    pool = arn("cognito-idp", "userpool/us-east-1_fixture");
  const context = {
    "aws:ResourceTag/PeelProject": "peel",
    "aws:ResourceTag/PeelEnvironment": "synthetic-cloud-dev",
    "aws:ResourceTag/PeelRun": run,
  };
  for (const action of [
    "cognito-idp:DeleteUserPool",
    "cognito-idp:DeleteUserPoolDomain",
    "cognito-idp:DeleteUserPoolClient",
    "cognito-idp:DeleteResourceServer",
    "cognito-idp:DeleteManagedLoginBranding",
  ]) {
    expect(allows(deletion, action, pool, context)).toBe(true);
    for (const key of Object.keys(context)) {
      expect(
        allows(deletion, action, pool, { ...context, [key]: "wrong" }),
      ).toBe(false);
      const missing = { ...context };
      delete missing[key as keyof typeof context];
      expect(allows(deletion, action, pool, missing)).toBe(false);
    }
    expect(
      allows(
        deletion,
        action,
        pool.replace("111122223333", "222233334444"),
        context,
      ),
    ).toBe(false);
    expect(
      allows(
        deletion,
        action,
        pool.replaceAll("us-east-1", "us-west-2"),
        context,
      ),
    ).toBe(false);
  }
  expect(deletion.filter((s) => s.Resource === "*")).toEqual([
    {
      Effect: "Allow",
      Action: ["cognito-idp:DescribeUserPoolDomain"],
      Resource: "*",
      Condition: { StringEquals: { "aws:RequestedRegion": "us-east-1" } },
    },
  ]);
  expect(
    allows(deletion, "cognito-idp:DescribeUserPoolDomain", "*", {
      "aws:RequestedRegion": "us-east-1",
    }),
  ).toBe(true);
  expect(
    allows(deletion, "cognito-idp:DescribeUserPoolDomain", "*", {
      "aws:RequestedRegion": "us-west-2",
    }),
  ).toBe(false);
});

it("binds Scheduler trust to the group and passes only the deletion role for the two exact target stacks", () => {
  const { resources, schedule } = roles(),
    stacks = cloudDevStackNames(run);
  const trust =
    resources.CleanupScheduleRole.Properties.AssumeRolePolicyDocument
      .Statement[0];
  expect(trust.Principal).toEqual({ Service: "scheduler.amazonaws.com" });
  const context = {
    "aws:SourceAccount": symbols["AWS::AccountId"],
    "aws:SourceArn": symbols["CleanupGroup.Arn"],
  };
  expect(conditionMatches(trust.Condition, context)).toBe(true);
  for (const delta of [
    { "aws:SourceAccount": "222233334444" },
    {
      "aws:SourceArn": arn(
        "scheduler",
        "schedule/" + name + "-group/" + name + "-data",
      ),
    },
    { "aws:SourceArn": context["aws:SourceArn"] + "-other" },
  ])
    expect(conditionMatches(trust.Condition, { ...context, ...delta })).toBe(
      false,
    );
  for (const stack of [stacks.data, stacks.sentinel])
    expect(
      allows(
        schedule,
        "cloudformation:DeleteStack",
        arn("cloudformation", "stack/" + stack + "/fixture"),
      ),
    ).toBe(true);
  for (const stack of [
    stacks.guard,
    stacks.artifacts,
    stacks.data + "-other",
    "unowned",
  ])
    expect(
      allows(
        schedule,
        "cloudformation:DeleteStack",
        arn("cloudformation", "stack/" + stack + "/fixture"),
      ),
    ).toBe(false);
  expect(
    allows(schedule, "iam:PassRole", roleArn("delete"), {
      "iam:PassedToService": "cloudformation.amazonaws.com",
    }),
  ).toBe(true);
  expect(
    allows(schedule, "iam:PassRole", roleArn("delete"), {
      "iam:PassedToService": "lambda.amazonaws.com",
    }),
  ).toBe(false);
  expect(
    allows(schedule, "iam:PassRole", roleArn("exec"), {
      "iam:PassedToService": "cloudformation.amazonaws.com",
    }),
  ).toBe(false);
});

it("uses the same isolated inventory and absolute expiry as hosting, with separate one-time sentinel deletion", () => {
  const template = cloudCleanupGuardTemplate({ runId: run, lease }),
    { resources } = roles(),
    stacks = cloudDevStackNames(run),
    main = cloudPrivateHostingTemplate({
      runId: run,
      lease,
      artifact: { sha256: "a".repeat(64), bytes: 1024 },
    }),
    sentinel = cloudCleanupSentinelTemplate(run);
  expect(
    main.Resources.CloudFunction.Properties.Environment.Variables
      .PEEL_CLOUD_LEASE_EXPIRES_AT,
  ).toBe(lease.expiresAt);
  for (const [logical, kind, time] of [
    ["DataCleanup", "data", "2026-10-27T13:30:00"],
    ["SentinelCleanup", "sentinel", "2026-10-27T12:15:00"],
  ] as const) {
    const schedule = resources[logical].Properties;
    expect(schedule).toMatchObject({
      State: "ENABLED",
      GroupName: name + "-group",
      ScheduleExpression: "at(" + time + ")",
      ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
    });
    expect(schedule.Target).toMatchObject({
      Arn: "arn:aws:scheduler:::aws-sdk:cloudformation:deleteStack",
      RoleArn: roleArn("schedule"),
      RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 900 },
    });
    expect(JSON.parse(schedule.Target.Input)).toEqual({
      StackName: stacks[kind],
      RoleARN: roleArn("delete"),
      ClientRequestToken: run + "-" + kind + "-expiry",
      DeletionMode: "STANDARD",
    });
    expect(schedule).not.toHaveProperty("StartDate");
    expect(schedule).not.toHaveProperty("EndDate");
  }
  expect(sentinel.Resources.SentinelTable.Properties.TableName).toBe(
    name + "-sentinel",
  );
  expect(sentinel.Resources.SentinelTable.Properties).toMatchObject({
    DeletionProtectionEnabled: false,
    SSESpecification: { SSEEnabled: false },
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
  });
  expect(sentinel.Resources.SentinelTable.DeletionPolicy).toBe("Delete");
  expect(Object.values(sentinel.Resources)).toHaveLength(1);
  for (const type of [
    "AWS::DynamoDB::Table",
    "AWS::S3::Bucket",
    "AWS::Lambda::Function",
    "AWS::Cognito::UserPool",
  ])
    expect(Object.values(template.Resources).some((r) => r.Type === type)).toBe(
      false,
    );
});
