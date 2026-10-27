import { createCloudLambdaAdapter } from "./lambda-event";
export type { CloudLambdaResponse } from "./lambda-event";
import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import type { JwksCache } from "aws-jwt-verify/jwk";
import {
  createCognitoCallerResolver,
  type CloudAccessTokenConfig,
} from "./cognito-auth";
import { DynamoDBCloudPullStore } from "./pull-dynamodb";
import { CloudCursorSigner, CloudPullService } from "./pull";
import { CloudMutationService, CloudServerError } from "./server";
import { createCloudMutationHandler } from "./server-http";
import { createCloudWebSessionBoundary } from "./web-session";
import { DynamoDBCloudWebSessionStore } from "./web-session-dynamodb";

export interface CloudLambdaConfig {
  origin: string;
  tableName: string;
  authentication:
    | { kind: "bearer"; cognito: CloudAccessTokenConfig }
    | { kind: "web-session"; lifetimeMs: number };
}
/** Data routes only. Caller supplies the SDK client/key; this creates no AWS resources. */
export function createCloudLambdaHandler(
  input: CloudLambdaConfig,
  dependencies: {
    client: DynamoDBClient;
    cursorKey: CryptoKey;
    clock?: () => number;
    jwksCache?: JwksCache;
  },
) {
  const config = structuredClone(input);
  try {
    const origin = new URL(config.origin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== config.origin ||
      typeof config.tableName !== "string" ||
      !["bearer", "web-session"].includes(config.authentication.kind)
    )
      throw Error();
  } catch {
    throw Error("Invalid Cloud Lambda configuration");
  }
  const clock = dependencies.clock ?? (() => Date.now());
  const store = new DynamoDBCloudPullStore(
    dependencies.client,
    config.tableName,
  );
  const resolver =
    config.authentication.kind === "bearer"
      ? createCognitoCallerResolver(
          config.authentication.cognito,
          dependencies.jwksCache
            ? { jwksCache: dependencies.jwksCache }
            : undefined,
        )
      : createCloudWebSessionBoundary(
          {
            origin: config.origin,
            lifetimeMs: config.authentication.lifetimeMs,
          },
          new DynamoDBCloudWebSessionStore(
            dependencies.client,
            config.tableName,
          ),
          async () => {
            throw Error("Session issuance is not exposed");
          },
          clock,
        ).resolveCaller;
  const service = createCloudMutationHandler(
    new CloudMutationService(store, clock),
    async (request) => {
      if (
        config.authentication.kind === "bearer"
          ? request.headers.has("cookie")
          : request.headers.has("authorization")
      )
        throw new CloudServerError("ambiguous-credentials", 401);
      return resolver(request);
    },
    new CloudPullService(
      store,
      new CloudCursorSigner(dependencies.cursorKey, clock),
      clock,
    ),
  );
  return createCloudLambdaAdapter(config.origin, service);
}
