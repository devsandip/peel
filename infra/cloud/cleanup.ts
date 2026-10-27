import { cloudDataIdentityTemplate } from "./data-identity.ts";
import {
  cloudHostingLease,
  type CloudHostingInput,
} from "./private-hosting.ts";

const ref = (name: string) => ({ Ref: name });
const attr = (name: string, key: string) => ({ "Fn::GetAtt": [name, key] });
const sub = (value: string) => ({ "Fn::Sub": value });

export function cloudDevStackNames(runId: string) {
  const name =
    cloudDataIdentityTemplate(runId).Resources.CloudTable.Properties.TableName;
  return {
    guard: name + "-guard",
    artifacts: name + "-artifacts",
    sentinel: name + "-sentinel",
    data: name + "-data",
  };
}

/** Outside-stack authority and schedules only. Calling this does not arm anything. */
export function cloudCleanupGuardTemplate(input: {
  runId: string;
  lease: CloudHostingInput["lease"];
}) {
  const table = cloudDataIdentityTemplate(input.runId).Resources.CloudTable
      .Properties,
    name = table.TableName,
    stacks = cloudDevStackNames(input.runId),
    { started, expires } = cloudHostingLease(input.lease);
  if (started % 1000 || expires % 1000 || expires - started < 60 * 60000)
    throw Error("Invalid Cloud cleanup lease");
  const arn = (service: string, resource: string) =>
    sub(
      `arn:\${AWS::Partition}:${service}:\${AWS::Region}:\${AWS::AccountId}:${resource}`,
    );
  const schedule = (kind: "sentinel" | "data", at: number) => ({
    Type: "AWS::Scheduler::Schedule",
    Properties: {
      Name: name + "-" + kind,
      GroupName: ref("CleanupGroup"),
      ScheduleExpression: "at(" + new Date(at).toISOString().slice(0, 19) + ")",
      ScheduleExpressionTimezone: "UTC",
      FlexibleTimeWindow: { Mode: "OFF" },
      State: "ENABLED",
      Target: {
        Arn: sub(
          "arn:${AWS::Partition}:scheduler:::aws-sdk:cloudformation:deleteStack",
        ),
        RoleArn: attr("CleanupScheduleRole", "Arn"),
        Input: sub(
          JSON.stringify({
            StackName: stacks[kind],
            RoleARN: "${CloudDeletionRole.Arn}",
            ClientRequestToken: input.runId + "-" + kind + "-expiry",
            DeletionMode: "STANDARD",
          }),
        ),
        RetryPolicy: { MaximumRetryAttempts: 3, MaximumEventAgeInSeconds: 900 },
      },
    },
  });
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "Peel independent synthetic cleanup; no deployment command or note access",
    Resources: {
      CloudDeletionRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: name + "-delete",
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "cloudformation.amazonaws.com" },
                Action: "sts:AssumeRole",
              },
            ],
          },
          Tags: table.Tags,
          Policies: [
            {
              PolicyName: "DeleteOwnedSyntheticInventory",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Effect: "Allow",
                    Action: [
                      "dynamodb:DeleteTable",
                      "dynamodb:DescribeTable",
                      "dynamodb:DescribeContinuousBackups",
                      "dynamodb:DescribeTimeToLive",
                      "dynamodb:ListTagsOfResource",
                    ],
                    Resource: [
                      arn("dynamodb", "table/" + name),
                      arn("dynamodb", "table/" + name + "-sentinel"),
                    ],
                  },
                  {
                    Effect: "Allow",
                    Action: [
                      "lambda:DeleteFunction",
                      "lambda:GetFunction",
                      "lambda:GetFunctionConfiguration",
                      "lambda:ListTags",
                    ],
                    Resource: arn("lambda", "function:" + name),
                  },
                  {
                    Effect: "Allow",
                    Action: [
                      "secretsmanager:DeleteSecret",
                      "secretsmanager:DescribeSecret",
                    ],
                    Resource: arn(
                      "secretsmanager",
                      "secret:" + name + "-cursors-??????",
                    ),
                  },
                  {
                    Effect: "Allow",
                    Action: [
                      "iam:GetRole",
                      "iam:GetRolePolicy",
                      "iam:ListRolePolicies",
                      "iam:ListAttachedRolePolicies",
                      "iam:DeleteRolePolicy",
                      "iam:DeleteRole",
                    ],
                    Resource: sub(
                      `arn:\${AWS::Partition}:iam::\${AWS::AccountId}:role/${name}-exec`,
                    ),
                  },
                  {
                    Effect: "Allow",
                    Action: [
                      "cognito-idp:DeleteUserPool",
                      "cognito-idp:DeleteUserPoolClient",
                      "cognito-idp:DeleteUserPoolDomain",
                      "cognito-idp:DeleteResourceServer",
                      "cognito-idp:DeleteManagedLoginBranding",
                      "cognito-idp:DescribeUserPool",
                      "cognito-idp:DescribeUserPoolClient",
                      "cognito-idp:DescribeResourceServer",
                      "cognito-idp:DescribeManagedLoginBranding",
                      "cognito-idp:DescribeManagedLoginBrandingByClient",
                      "cognito-idp:ListTagsForResource",
                    ],
                    Resource: arn("cognito-idp", "userpool/*"),
                    Condition: {
                      StringEquals: Object.fromEntries(
                        table.Tags.map(({ Key, Value }) => [
                          "aws:ResourceTag/" + Key,
                          Value,
                        ]),
                      ),
                    },
                  },
                  {
                    Effect: "Allow",
                    Action: ["cognito-idp:DescribeUserPoolDomain"],
                    Resource: "*",
                    Condition: {
                      StringEquals: { "aws:RequestedRegion": "us-east-1" },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      CleanupGroup: {
        Type: "AWS::Scheduler::ScheduleGroup",
        Properties: { Name: name + "-group", Tags: table.Tags },
      },
      CleanupScheduleRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: name + "-schedule",
          Tags: table.Tags,
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "scheduler.amazonaws.com" },
                Action: "sts:AssumeRole",
                Condition: {
                  StringEquals: {
                    "aws:SourceAccount": ref("AWS::AccountId"),
                    "aws:SourceArn": attr("CleanupGroup", "Arn"),
                  },
                },
              },
            ],
          },
          Policies: [
            {
              PolicyName: "DeleteOnlyRunTargets",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Effect: "Allow",
                    Action: ["cloudformation:DeleteStack"],
                    Resource: [
                      arn("cloudformation", "stack/" + stacks.data + "/*"),
                      arn("cloudformation", "stack/" + stacks.sentinel + "/*"),
                    ],
                  },
                  {
                    Effect: "Allow",
                    Action: ["iam:PassRole"],
                    Resource: attr("CloudDeletionRole", "Arn"),
                    Condition: {
                      StringEquals: {
                        "iam:PassedToService": "cloudformation.amazonaws.com",
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
      SentinelCleanup: schedule("sentinel", started + 15 * 60000),
      DataCleanup: schedule("data", expires),
    },
    Outputs: {
      DeletionRoleArn: { Value: attr("CloudDeletionRole", "Arn") },
      ScheduleRoleArn: { Value: attr("CleanupScheduleRole", "Arn") },
      ScheduleGroupName: { Value: ref("CleanupGroup") },
      SentinelScheduleArn: { Value: attr("SentinelCleanup", "Arn") },
      DataScheduleArn: { Value: attr("DataCleanup", "Arn") },
      SentinelStackName: { Value: stacks.sentinel },
      DataStackName: { Value: stacks.data },
    },
  };
}

/** Empty owned resource for later observed deletion; not a managed rehearsal result. */
export function cloudCleanupSentinelTemplate(runId: string) {
  const table = cloudDataIdentityTemplate(runId).Resources.CloudTable;
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "Peel empty synthetic cleanup sentinel; no notes or public ingestion",
    Resources: {
      SentinelTable: {
        ...table,
        Properties: {
          ...table.Properties,
          TableName: table.Properties.TableName + "-sentinel",
        },
      },
    },
    Outputs: {
      TableName: { Value: ref("SentinelTable") },
      TableArn: { Value: attr("SentinelTable", "Arn") },
    },
  };
}
