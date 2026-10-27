import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { createCloudLambdaHandler } from "../../packages/cloud-protocol/src/lambda-http";
import type { CloudLambdaResponse } from "../../packages/cloud-protocol/src/lambda-event";

export interface CloudDevConfig {
  tableName: string;
  userPoolId: string;
  clientId: string;
  cursorKey: Uint8Array;
  startedAt: number;
  expiresAt: number;
}
const invalid = (): never => {
  throw Error("Invalid Cloud development configuration");
};
function timestamp(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return invalid();
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== value)
    return invalid();
  return time;
}
export function parseCloudDevConfig(
  environment: Readonly<Record<string, string | undefined>>,
): CloudDevConfig {
  const tableName = environment.PEEL_CLOUD_TABLE ?? "",
    userPoolId = environment.PEEL_CLOUD_USER_POOL ?? "",
    clientId = environment.PEEL_CLOUD_CLIENT_ID ?? "",
    key = environment.PEEL_CLOUD_CURSOR_KEY ?? "";
  if (
    environment.PEEL_CLOUD_DEV_ENABLED !== "1" ||
    environment.AWS_REGION !== "us-east-1" ||
    environment.PEEL_CLOUD_ORIGIN !== "https://cloud.peel.example" ||
    environment.PEEL_CLOUD_SCOPE !== "peel-dev/sync" ||
    !/^peel-cloud-dev-[a-z0-9-]{8,48}$/.test(tableName) ||
    !/^us-east-1_[a-zA-Z0-9]{1,55}$/.test(userPoolId) ||
    !/^[a-zA-Z0-9]{1,128}$/.test(clientId) ||
    !/^[a-zA-Z0-9+/]{43}=$/.test(key)
  )
    return invalid();
  const cursorKey = Buffer.from(key, "base64"),
    startedAt = timestamp(environment.PEEL_CLOUD_LEASE_STARTED_AT),
    expiresAt = timestamp(environment.PEEL_CLOUD_LEASE_EXPIRES_AT);
  if (
    cursorKey.length !== 32 ||
    cursorKey.toString("base64") !== key ||
    expiresAt <= startedAt ||
    expiresAt - startedAt > 90 * 60000
  )
    return invalid();
  return { tableName, userPoolId, clientId, cursorKey, startedAt, expiresAt };
}
type Handler = (event: unknown) => Promise<CloudLambdaResponse>;
async function initialize(config: CloudDevConfig): Promise<Handler> {
  const cursorKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(config.cursorKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const client = new DynamoDBClient({
    region: "us-east-1",
    ignoreConfiguredEndpointUrls: true,
    maxAttempts: 2,
    requestHandler: {
      connectionTimeout: 1000,
      requestTimeout: 5000,
      throwOnRequestTimeout: true,
    },
  });
  return createCloudLambdaHandler(
    {
      origin: "https://cloud.peel.example",
      tableName: config.tableName,
      authentication: {
        kind: "bearer",
        cognito: {
          userPoolId: config.userPoolId,
          clientIds: [config.clientId],
          requiredScope: "peel-dev/sync",
        },
      },
    },
    { client, cursorKey },
  );
}
const unavailable = (): CloudLambdaResponse => ({
  statusCode: 503,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
  body: '{"error":"service-unavailable"}',
  isBase64Encoded: false,
});
/** Development-only entry. Configuration is captured once; every call checks its fixed lease. */
export function createCloudDevRuntime(
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: {
    clock?: () => number;
    initialize?: (config: CloudDevConfig) => Promise<Handler>;
  } = {},
): Handler {
  let config: CloudDevConfig;
  try {
    config = parseCloudDevConfig(environment);
  } catch {
    return async () => unavailable();
  }
  const clock = dependencies.clock ?? Date.now;
  let worker: Promise<Handler> | undefined,
    stopped = false;
  const checkLease = (value: CloudDevConfig) => {
    const now = clock();
    if (
      stopped ||
      !Number.isSafeInteger(now) ||
      now < value.startedAt ||
      now >= value.expiresAt
    ) {
      stopped = true;
      invalid();
    }
  };
  return async (event) => {
    try {
      checkLease(config);
      worker ??= (dependencies.initialize ?? initialize)(config);
      const handler = await worker;
      checkLease(config);
      return await handler(event);
    } catch {
      // Provider/configuration errors and event credentials must never enter logs or responses.
      return unavailable();
    }
  };
}
