const ref = (name: string) => ({ Ref: name });
const attr = (name: string, key: string) => ({ "Fn::GetAtt": [name, key] });
const sub = (value: string) => ({ "Fn::Sub": value });

export const cloudDevCallback = "https://callback.peel.example/auth/callback";
export const cloudDevScope = "peel-dev/sync";
/** Data/identity only. Calling this pure factory creates no AWS resource or user. */
export function cloudDataIdentityTemplate(runId: string) {
  if (
    typeof runId !== "string" ||
    runId.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      runId,
    )
  )
    throw Error("Invalid Cloud development run identity");
  const name = "peel-cloud-dev-" + runId,
    tags = {
      PeelProject: "peel",
      PeelEnvironment: "synthetic-cloud-dev",
      PeelRun: runId,
    };
  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "Peel disposable synthetic Cloud data and identity; no data API or deployment command",
    Resources: {
      CloudTable: {
        Type: "AWS::DynamoDB::Table",
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
        Properties: {
          TableName: name,
          TableClass: "STANDARD",
          BillingMode: "PAY_PER_REQUEST",
          OnDemandThroughput: {
            MaxReadRequestUnits: 20,
            MaxWriteRequestUnits: 20,
          },
          AttributeDefinitions: [
            { AttributeName: "PK", AttributeType: "S" },
            { AttributeName: "SK", AttributeType: "S" },
          ],
          KeySchema: [
            { AttributeName: "PK", KeyType: "HASH" },
            { AttributeName: "SK", KeyType: "RANGE" },
          ],
          TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
          // False still encrypts at rest with an AWS-owned key, without paid KMS use.
          SSESpecification: { SSEEnabled: false },
          PointInTimeRecoverySpecification: {
            PointInTimeRecoveryEnabled: false,
          },
          DeletionProtectionEnabled: false,
          Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
        },
      },
      CloudUserPool: {
        Type: "AWS::Cognito::UserPool",
        DeletionPolicy: "Delete",
        UpdateReplacePolicy: "Delete",
        Properties: {
          UserPoolName: name,
          UserPoolTier: "ESSENTIALS",
          AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
          AccountRecoverySetting: {
            RecoveryMechanisms: [{ Name: "admin_only", Priority: 1 }],
          },
          MfaConfiguration: "OFF",
          UserPoolAddOns: { AdvancedSecurityMode: "OFF" },
          UsernameConfiguration: { CaseSensitive: true },
          Policies: {
            PasswordPolicy: {
              MinimumLength: 20,
              RequireLowercase: true,
              RequireUppercase: true,
              RequireNumbers: true,
              RequireSymbols: true,
              TemporaryPasswordValidityDays: 1,
            },
          },
          DeletionProtection: "INACTIVE",
          UserPoolTags: tags,
        },
      },
      CloudSyncScope: {
        Type: "AWS::Cognito::UserPoolResourceServer",
        Properties: {
          UserPoolId: ref("CloudUserPool"),
          Identifier: "peel-dev",
          Name: "Peel synthetic development sync",
          Scopes: [
            {
              ScopeName: "sync",
              ScopeDescription: "Access the isolated synthetic Cloud library",
            },
          ],
        },
      },
      CloudClient: {
        Type: "AWS::Cognito::UserPoolClient",
        DependsOn: "CloudSyncScope",
        Properties: {
          UserPoolId: ref("CloudUserPool"),
          ClientName: name,
          GenerateSecret: false,
          AllowedOAuthFlowsUserPoolClient: true,
          AllowedOAuthFlows: ["code"],
          AllowedOAuthScopes: ["openid", cloudDevScope],
          CallbackURLs: [cloudDevCallback],
          DefaultRedirectURI: cloudDevCallback,
          SupportedIdentityProviders: ["COGNITO"],
          ExplicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
          EnableTokenRevocation: true,
          PreventUserExistenceErrors: "ENABLED",
          AuthSessionValidity: 3,
          AccessTokenValidity: 15,
          IdTokenValidity: 15,
          RefreshTokenValidity: 60,
          TokenValidityUnits: {
            AccessToken: "minutes",
            IdToken: "minutes",
            RefreshToken: "minutes",
          },
        },
      },
      CloudDomain: {
        Type: "AWS::Cognito::UserPoolDomain",
        Properties: {
          UserPoolId: ref("CloudUserPool"),
          Domain: name + "-auth",
          ManagedLoginVersion: 2,
        },
      },
      CloudBranding: {
        Type: "AWS::Cognito::ManagedLoginBranding",
        DependsOn: "CloudDomain",
        Properties: {
          UserPoolId: ref("CloudUserPool"),
          ClientId: ref("CloudClient"),
          UseCognitoProvidedValues: true,
        },
      },
    },
    Outputs: {
      TableName: { Value: ref("CloudTable") },
      TableArn: { Value: attr("CloudTable", "Arn") },
      UserPoolId: { Value: ref("CloudUserPool") },
      UserPoolArn: { Value: attr("CloudUserPool", "Arn") },
      ClientId: { Value: ref("CloudClient") },
      ProviderOrigin: {
        Value: sub(
          "https://${CloudDomain}.auth.${AWS::Region}.amazoncognito.com",
        ),
      },
      Issuer: {
        Value: sub(
          "https://cognito-idp.${AWS::Region}.amazonaws.com/${CloudUserPool}",
        ),
      },
      Scope: { Value: cloudDevScope },
      Callback: { Value: cloudDevCallback },
      ServiceOrigin: { Value: "https://cloud.peel.example" },
    },
  };
}
