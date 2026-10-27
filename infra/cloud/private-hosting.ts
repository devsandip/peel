import { cloudDataIdentityTemplate, cloudDevScope } from "./data-identity.ts";

const ref = (name: string) => ({ Ref: name });
const attr = (name: string, key: string) => ({ "Fn::GetAtt": [name, key] });
const sub = (value: string) => ({ "Fn::Sub": value });

export interface CloudHostingInput {
  runId: string;
  artifact: { sha256: string; bytes: number };
  lease: { startedAt: string; expiresAt: string };
}
function leaseTime(value: unknown): number {
  if (typeof value !== "string") throw Error("Invalid Cloud hosting lease");
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== value)
    throw Error("Invalid Cloud hosting lease");
  return time;
}
export function cloudHostingLease(lease: CloudHostingInput["lease"]) {
  const started = leaseTime(lease?.startedAt),
    expires = leaseTime(lease?.expiresAt);
  if (expires <= started || expires - started > 90 * 60000)
    throw Error("Invalid Cloud hosting lease");
  return { started, expires };
}
/** Artifact storage must exist before uploading code and creating the main stack. No apply. */
export function cloudArtifactBootstrapTemplate(runId: string) {
  const base = cloudDataIdentityTemplate(runId),
    table = base.Resources.CloudTable.Properties;
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "Peel synthetic Cloud artifact bootstrap; cleanup authority is a separate prerequisite",
    Resources: {
      ArtifactBucket: {
        Type: "AWS::S3::Bucket",
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
        Properties: {
          BucketName: table.TableName,
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
            ],
          },
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
          OwnershipControls: {
            Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }],
          },
          LifecycleConfiguration: {
            Rules: [
              {
                Id: "ExpireDisposableCode",
                Prefix: "cloud-lambda/",
                Status: "Enabled",
                ExpirationInDays: 1,
                AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
              },
            ],
          },
          Tags: table.Tags,
        },
      },
      ArtifactBucketPolicy: {
        Type: "AWS::S3::BucketPolicy",
        Properties: {
          Bucket: ref("ArtifactBucket"),
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "RequireTLS",
                Effect: "Deny",
                Principal: "*",
                Action: "s3:*",
                Resource: [
                  attr("ArtifactBucket", "Arn"),
                  sub("${ArtifactBucket.Arn}/*"),
                ],
                Condition: {
                  Bool: {
                    "aws:SecureTransport": "false",
                    "aws:PrincipalIsAWSService": "false",
                  },
                },
              },
            ],
          },
        },
      },
    },
    Outputs: {
      ArtifactBucketName: { Value: ref("ArtifactBucket") },
      ArtifactBucketArn: { Value: attr("ArtifactBucket", "Arn") },
    },
  };
}
/** Pure private-hosting definition. Deployment still requires independent cleanup/guard tooling. */
export function cloudPrivateHostingTemplate(input: CloudHostingInput) {
  const base = cloudDataIdentityTemplate(input.runId),
    name = base.Resources.CloudTable.Properties.TableName,
    tags = base.Resources.CloudTable.Properties.Tags;
  if (
    !input.artifact ||
    typeof input.artifact.sha256 !== "string" ||
    input.artifact.sha256.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(input.artifact.sha256) ||
    !Number.isSafeInteger(input.artifact.bytes) ||
    input.artifact.bytes <= 0 ||
    input.artifact.bytes > 20 * 1024 * 1024
  )
    throw Error("Invalid Cloud hosting artifact");
  cloudHostingLease(input.lease);
  const artifactKey = "cloud-lambda/" + input.artifact.sha256 + ".zip";
  return {
    ...base,
    Description:
      "Peel synthetic private Lambda and data; no public ingress or deployment command",
    Parameters: {
      CursorKey: {
        Type: "String",
        NoEcho: true,
        MinLength: 44,
        MaxLength: 44,
        AllowedPattern: "^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$",
        ConstraintDescription:
          "A canonical base64 encoding of 32 random bytes is required",
      },
    },
    Resources: {
      ...base.Resources,
      CursorSecret: {
        Type: "AWS::SecretsManager::Secret",
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
        Properties: {
          Name: name + "-cursors",
          SecretString: ref("CursorKey"),
          Tags: tags,
        },
      },
      CloudExecutionRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          RoleName: name + "-exec",
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: { Service: "lambda.amazonaws.com" },
                Action: "sts:AssumeRole",
              },
            ],
          },
          Policies: [
            {
              PolicyName: "SyntheticCloudData",
              PolicyDocument: {
                Version: "2012-10-17",
                Statement: [
                  {
                    Effect: "Allow",
                    Action: ["dynamodb:GetItem", "dynamodb:Query"],
                    Resource: attr("CloudTable", "Arn"),
                  },
                  {
                    Effect: "Allow",
                    Action: [
                      "dynamodb:PutItem",
                      "dynamodb:DeleteItem",
                      "dynamodb:ConditionCheckItem",
                    ],
                    Resource: attr("CloudTable", "Arn"),
                    Condition: {
                      "ForAnyValue:StringEquals": {
                        "dynamodb:EnclosingOperation": ["TransactWriteItems"],
                      },
                    },
                  },
                ],
              },
            },
          ],
          Tags: tags,
        },
      },
      CloudFunction: {
        Type: "AWS::Lambda::Function",
        Properties: {
          FunctionName: name,
          PackageType: "Zip",
          Runtime: "nodejs24.x",
          Handler: "handler.handler",
          Architectures: ["x86_64"],
          MemorySize: 256,
          Timeout: 30,
          EphemeralStorage: { Size: 512 },
          ReservedConcurrentExecutions: 1,
          Role: attr("CloudExecutionRole", "Arn"),
          Code: { S3Bucket: name, S3Key: artifactKey },
          TracingConfig: { Mode: "PassThrough" },
          Environment: {
            Variables: {
              PEEL_CLOUD_DEV_ENABLED: "1",
              PEEL_CLOUD_ORIGIN: "https://cloud.peel.example",
              PEEL_CLOUD_SCOPE: cloudDevScope,
              PEEL_CLOUD_TABLE: ref("CloudTable"),
              PEEL_CLOUD_USER_POOL: ref("CloudUserPool"),
              PEEL_CLOUD_CLIENT_ID: ref("CloudClient"),
              PEEL_CLOUD_CURSOR_KEY: sub(
                "{{resolve:secretsmanager:${CursorSecret}:SecretString}}",
              ),
              PEEL_CLOUD_LEASE_STARTED_AT: input.lease.startedAt,
              PEEL_CLOUD_LEASE_EXPIRES_AT: input.lease.expiresAt,
            },
          },
          Tags: tags,
        },
      },
    },
    Outputs: {
      ...base.Outputs,
      FunctionName: { Value: ref("CloudFunction") },
      FunctionArn: { Value: attr("CloudFunction", "Arn") },
      ExecutionRoleArn: { Value: attr("CloudExecutionRole", "Arn") },
      CursorSecretArn: { Value: ref("CursorSecret") },
      ArtifactBucketName: { Value: name },
      ArtifactKey: { Value: artifactKey },
    },
  };
}
