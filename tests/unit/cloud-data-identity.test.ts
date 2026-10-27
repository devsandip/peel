import { expect, it, vi } from "vitest";
import { cloudDataIdentityTemplate } from "../../infra/cloud/data-identity";
import { parseCloudDevConfig } from "../../infra/cloud/runtime";
import { createCloudAuthorizationHandshake } from "../../packages/cloud-protocol/src/pkce";

const runA = "00000000-0000-4000-8000-000000000001",
  runB = "00000000-0000-4000-8000-000000000002";

it("rejects noncanonical identities before string coercion and isolates names across runs", () => {
  const toString = vi.fn(() => runA);
  for (const value of [
    "",
    "production",
    runA + "\n",
    "../" + runA,
    null,
    { toString },
  ]) {
    expect(() => cloudDataIdentityTemplate(value as string)).toThrow(
      "Invalid Cloud development run identity",
    );
  }
  expect(() =>
    cloudDataIdentityTemplate("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
  ).toThrow();
  expect(toString).not.toHaveBeenCalled();
  const names = (id: string) => {
    const resources = cloudDataIdentityTemplate(id).Resources;
    return [
      resources.CloudTable.Properties.TableName,
      resources.CloudUserPool.Properties.UserPoolName,
      resources.CloudClient.Properties.ClientName,
      resources.CloudDomain.Properties.Domain,
    ];
  };
  expect(names(runA).filter((name) => names(runB).includes(name))).toEqual([]);
  expect(
    names(runA).every(
      (name) => name.startsWith("peel-cloud-dev-") && name.length <= 63,
    ),
  ).toBe(true);
});

it("limits the resource and delivery policy to disposable synthetic data and sign-in", () => {
  const template = cloudDataIdentityTemplate(runA),
    resources = template.Resources,
    table = resources.CloudTable.Properties,
    pool = resources.CloudUserPool.Properties,
    client = resources.CloudClient.Properties;
  expect(
    Object.values(resources)
      .map((resource) => resource.Type)
      .sort(),
  ).toEqual(
    [
      "AWS::Cognito::ManagedLoginBranding",
      "AWS::Cognito::UserPool",
      "AWS::Cognito::UserPoolClient",
      "AWS::Cognito::UserPoolDomain",
      "AWS::Cognito::UserPoolResourceServer",
      "AWS::DynamoDB::Table",
    ].sort(),
  );
  expect(table.BillingMode).toBe("PAY_PER_REQUEST");
  expect(table.OnDemandThroughput.MaxReadRequestUnits).toBeLessThanOrEqual(20);
  expect(table.OnDemandThroughput.MaxWriteRequestUnits).toBeLessThanOrEqual(20);
  expect(table.TimeToLiveSpecification).toEqual({
    AttributeName: "ttl",
    Enabled: true,
  });
  for (const field of [
    "StreamSpecification",
    "GlobalSecondaryIndexes",
    "LocalSecondaryIndexes",
    "KinesisStreamSpecification",
  ])
    expect(table).not.toHaveProperty(field);
  expect(table.SSESpecification).toEqual({ SSEEnabled: false });
  expect(
    table.PointInTimeRecoverySpecification.PointInTimeRecoveryEnabled,
  ).toBe(false);
  expect(resources.CloudTable.DeletionPolicy).toBe("Delete");
  expect(resources.CloudUserPool.DeletionPolicy).toBe("Delete");
  expect(pool.AdminCreateUserConfig.AllowAdminCreateUserOnly).toBe(true);
  expect(
    pool.AccountRecoverySetting.RecoveryMechanisms.map((entry) => entry.Name),
  ).toEqual(["admin_only"]);
  expect(pool.MfaConfiguration).toBe("OFF");
  expect(pool.UserPoolTier).toBe("ESSENTIALS");
  for (const field of [
    "AutoVerifiedAttributes",
    "AliasAttributes",
    "UsernameAttributes",
    "SmsConfiguration",
    "EmailConfiguration",
    "LambdaConfig",
  ])
    expect(pool).not.toHaveProperty(field);
  expect(client.GenerateSecret).toBe(false);
  expect(client.AllowedOAuthFlows).toEqual(["code"]);
  expect(client.ExplicitAuthFlows).toEqual(["ALLOW_REFRESH_TOKEN_AUTH"]);
  expect(client.SupportedIdentityProviders).toEqual(["COGNITO"]);
  expect(client).not.toHaveProperty("AnalyticsConfiguration");
  expect(JSON.stringify(template)).not.toMatch(
    /(SecretString|AWS::Cognito::UserPoolUser|AWS::Lambda::|AWS::ApiGateway|AWS::IAM::)/,
  );
});

function resolve(value: unknown, references: Record<string, string>): string {
  if (typeof value === "string") return value;
  const input = value as Record<string, unknown>;
  if (typeof input.Ref === "string" && references[input.Ref])
    return references[input.Ref];
  if (typeof input["Fn::Sub"] === "string")
    return input["Fn::Sub"].replace(/\$\{([^}]+)\}/g, (_match, name) => {
      if (!references[name]) throw Error("Unresolved fixture reference");
      return references[name];
    });
  throw Error("Unsupported fixture intrinsic");
}
it("wires generated outputs to the actual runtime and private code/S256 authorization initiator", () => {
  const template = cloudDataIdentityTemplate(runA),
    references = {
      CloudTable: template.Resources.CloudTable.Properties.TableName,
      CloudUserPool: "us-east-1_synthetic",
      CloudClient: "syntheticclient",
      CloudDomain: template.Resources.CloudDomain.Properties.Domain,
      "AWS::Region": "us-east-1",
    },
    output = (key: keyof typeof template.Outputs) =>
      resolve(template.Outputs[key].Value, references),
    start = Date.parse("2026-10-27T12:00:00.000Z");
  const config = parseCloudDevConfig({
    PEEL_CLOUD_DEV_ENABLED: "1",
    AWS_REGION: "us-east-1",
    PEEL_CLOUD_TABLE: output("TableName"),
    PEEL_CLOUD_USER_POOL: output("UserPoolId"),
    PEEL_CLOUD_CLIENT_ID: output("ClientId"),
    PEEL_CLOUD_SCOPE: output("Scope"),
    PEEL_CLOUD_ORIGIN: output("ServiceOrigin"),
    PEEL_CLOUD_CURSOR_KEY: Buffer.alloc(32, 7).toString("base64"),
    PEEL_CLOUD_LEASE_STARTED_AT: new Date(start).toISOString(),
    PEEL_CLOUD_LEASE_EXPIRES_AT: new Date(start + 60 * 60000).toISOString(),
  });
  expect(config.tableName).toBe(
    template.Resources.CloudTable.Properties.TableName,
  );
  expect(config.userPoolId).toBe(references.CloudUserPool);
  const attempt = createCloudAuthorizationHandshake(
      {
        providerOrigin: output("ProviderOrigin"),
        clientId: output("ClientId"),
        callbackUri: output("Callback"),
        scopes: template.Resources.CloudClient.Properties.AllowedOAuthScopes,
        lifetimeMs: 120000,
      },
      () => start,
    ).begin(),
    url = new URL(attempt.authorizationUrl);
  expect(url.origin).toBe(output("ProviderOrigin"));
  expect(url.searchParams.get("client_id")).toBe(config.clientId);
  expect(url.searchParams.get("scope")?.split(" ")).toContain(output("Scope"));
  expect(url.searchParams.get("response_type")).toBe(
    template.Resources.CloudClient.Properties.AllowedOAuthFlows[0],
  );
  expect(template.Resources.CloudClient.Properties.CallbackURLs).toEqual([
    url.searchParams.get("redirect_uri"),
  ]);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toMatch(/^[a-zA-Z0-9_-]{43}$/);
});
