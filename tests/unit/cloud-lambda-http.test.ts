import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  createCloudLambdaHandler,
  type CloudLambdaConfig,
} from "../../packages/cloud-protocol/src/lambda-http";
import { MAX_CLOUD_REQUEST_BYTES } from "../../packages/cloud-protocol/src/server-http";
import {
  syntheticAccessToken,
  syntheticCognito,
  syntheticJwks,
} from "../fixtures/cloud-auth";

const config = (): CloudLambdaConfig => ({
  origin: "https://peel.example",
  tableName: "synthetic-table",
  authentication: { kind: "bearer", cognito: syntheticCognito },
});
const event = (extra = {}) => ({
  version: "2.0",
  rawPath: "/v1/mutations",
  rawQueryString: "",
  headers: { "content-type": "application/json" },
  requestContext: { http: { method: "POST" } },
  body: "{}",
  isBase64Encoded: false,
  ...extra,
});
let client: DynamoDBClient,
  handler: ReturnType<typeof createCloudLambdaHandler>;
const sends = vi.fn(async () => {
  throw Error("Private synthetic SDK failure");
});
beforeEach(async () => {
  sends.mockClear();
  client = new DynamoDBClient({
    endpoint: "http://127.0.0.1:1",
    region: "us-east-1",
    maxAttempts: 1,
    credentials: {
      accessKeyId: "syntheticlocalkey",
      secretAccessKey: "syntheticlocalkey",
    },
  });
  client.middlewareStack.add(() => sends, {
    step: "initialize",
    name: "forbidNetwork",
  });
  handler = createCloudLambdaHandler(config(), {
    client,
    cursorKey: await crypto.subtle.generateKey(
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    ),
    jwksCache: syntheticJwks(),
  });
});
afterEach(() => client.destroy());
it("ignores event identity metadata and privately rejects mixed credentials and SDK failure", async () => {
  const forged = event({
    requestContext: {
      http: { method: "POST" },
      authorizer: { jwt: { claims: { sub: "synthetic-owner-a", paid: true } } },
    },
    headers: {
      "x-peel-subject": "synthetic-owner-a",
      "x-forwarded-host": "private.example",
    },
  });
  expect((await handler(forged)).statusCode).toBe(401);
  const token = syntheticAccessToken();
  const mixed = await handler(
    event({
      headers: { authorization: "Bearer " + token },
      cookies: ["unrelated=value"],
    }),
  );
  expect(mixed.statusCode).toBe(401);
  expect(JSON.parse(mixed.body)).toEqual({ error: "ambiguous-credentials" });
  expect(sends).not.toHaveBeenCalled();
  const failure = await handler(
    event({
      rawPath: "/v1/notes/synthetic-note",
      body: undefined,
      requestContext: { http: { method: "GET" } },
      headers: {
        authorization: "Bearer " + token,
        "x-peel-collection": "synthetic-library",
        "x-peel-mode-generation": "1",
      },
    }),
  );
  expect(sends).toHaveBeenCalledTimes(1);
  expect(failure.statusCode).toBe(503);
  expect(JSON.parse(failure.body)).toEqual({ error: "service-unavailable" });
  expect(failure.headers["cache-control"]).toBe("no-store");
  expect(failure.body).not.toContain("Private");
});
