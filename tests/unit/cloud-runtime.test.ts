import { expect, it, vi } from "vitest";
import {
  createCloudDevRuntime,
  parseCloudDevConfig,
} from "../../infra/cloud/runtime";

const start = Date.parse("2026-10-27T12:00:00.000Z");
const environment = () => ({
  PEEL_CLOUD_DEV_ENABLED: "1",
  AWS_REGION: "us-east-1",
  PEEL_CLOUD_ORIGIN: "https://cloud.peel.example",
  PEEL_CLOUD_SCOPE: "peel-dev/sync",
  PEEL_CLOUD_TABLE: "peel-cloud-dev-synthetic-fixture",
  PEEL_CLOUD_USER_POOL: "us-east-1_synthetic",
  PEEL_CLOUD_CLIENT_ID: "syntheticclient",
  PEEL_CLOUD_CURSOR_KEY: Buffer.alloc(32, 7).toString("base64"),
  PEEL_CLOUD_LEASE_STARTED_AT: new Date(start).toISOString(),
  PEEL_CLOUD_LEASE_EXPIRES_AT: new Date(start + 60 * 60000).toISOString(),
});
it("requires complete isolated configuration, canonical key and a bounded UTC lease", () => {
  const env = environment();
  expect(parseCloudDevConfig(env).cursorKey).toEqual(Buffer.alloc(32, 7));
  for (const name of Object.keys(env)) {
    const missing = { ...env };
    delete missing[name as keyof typeof missing];
    expect(() => parseCloudDevConfig(missing)).toThrow(
      "Invalid Cloud development configuration",
    );
  }
  for (const changes of [
    { AWS_REGION: "eu-west-1" },
    { PEEL_CLOUD_DEV_ENABLED: "true" },
    { PEEL_CLOUD_ORIGIN: "https://cloud.peel.example/" },
    { PEEL_CLOUD_SCOPE: "openid" },
    { PEEL_CLOUD_TABLE: "production-table" },
    { PEEL_CLOUD_USER_POOL: "eu-west-1_synthetic" },
    { PEEL_CLOUD_CLIENT_ID: "ambiguous client" },
    { PEEL_CLOUD_CURSOR_KEY: Buffer.alloc(31).toString("base64") },
    { PEEL_CLOUD_CURSOR_KEY: env.PEEL_CLOUD_CURSOR_KEY.slice(0, -2) + "d=" },
    { PEEL_CLOUD_LEASE_STARTED_AT: "2026-02-31T12:00:00.000Z" },
    { PEEL_CLOUD_LEASE_STARTED_AT: "2026-10-27T12:00:00Z" },
    { PEEL_CLOUD_LEASE_EXPIRES_AT: env.PEEL_CLOUD_LEASE_STARTED_AT },
    {
      PEEL_CLOUD_LEASE_EXPIRES_AT: new Date(
        start + 90 * 60000 + 1,
      ).toISOString(),
    },
  ])
    expect(() => parseCloudDevConfig({ ...env, ...changes })).toThrow(
      "Invalid Cloud development configuration",
    );
});
it("captures configuration once, shares initialization and checks warm-worker lease boundaries", async () => {
  let now = start;
  const env = environment(),
    reply = {
      statusCode: 200,
      headers: {},
      body: "synthetic-result",
      isBase64Encoded: false as const,
    },
    delegate = vi.fn(async () => reply),
    initialize = vi.fn(
      async (_config: ReturnType<typeof parseCloudDevConfig>) => delegate,
    ),
    handler = createCloudDevRuntime(env, { clock: () => now, initialize });
  env.PEEL_CLOUD_TABLE = "changed-after-construction";
  expect(await Promise.all([handler({ a: 1 }), handler({ b: 2 })])).toEqual([
    reply,
    reply,
  ]);
  expect(initialize).toHaveBeenCalledTimes(1);
  expect(initialize.mock.calls[0][0].tableName).toBe(
    "peel-cloud-dev-synthetic-fixture",
  );
  now += 60 * 60000;
  expect((await handler({})).statusCode).toBe(503);
  now = start + 1;
  expect((await handler({})).statusCode).toBe(503);
  now = start - 1;
  expect((await handler({})).statusCode).toBe(503);
  now = NaN;
  expect((await handler({})).statusCode).toBe(503);
  expect(delegate).toHaveBeenCalledTimes(2);
});
it("does not initialize invalid or expired configurations and keeps errors private", async () => {
  const initialize = vi.fn(async () => {
    throw Error("synthetic-private-password-or-provider-error");
  });
  for (const [env, now] of [
    [{}, start],
    [environment(), start - 1],
    [environment(), start + 60 * 60000],
    [environment(), NaN],
    [environment(), Infinity],
    [environment(), start + 0.5],
  ] as const) {
    const result = await createCloudDevRuntime(env, {
      clock: () => now,
      initialize,
    })({ privateEvent: "synthetic-private-token" });
    expect(result.statusCode).toBe(503);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body).toBe('{"error":"service-unavailable"}');
  }
  expect(initialize).not.toHaveBeenCalled();
  const handler = createCloudDevRuntime(environment(), {
    clock: () => start,
    initialize,
  });
  expect((await handler({})).body).toBe('{"error":"service-unavailable"}');
  expect((await handler({})).statusCode).toBe(503);
  expect(initialize).toHaveBeenCalledTimes(1);
});
it("rechecks expiry after initialization and composes the real authenticated transport", async () => {
  let now = start;
  const delegate = vi.fn(),
    delayed = createCloudDevRuntime(environment(), {
      clock: () => now,
      initialize: async () => {
        now += 60 * 60000;
        return delegate;
      },
    });
  expect((await delayed({})).statusCode).toBe(503);
  expect(delegate).not.toHaveBeenCalled();
  const handler = createCloudDevRuntime(environment(), { clock: () => start });
  expect((await handler({})).statusCode).toBe(400);
  const rejected = await handler({
    version: "2.0",
    rawPath: "/v1/notes/synthetic-note",
    rawQueryString: "",
    requestContext: { http: { method: "GET" } },
    isBase64Encoded: false,
    headers: {},
  });
  expect(rejected.statusCode).toBe(401);
  expect(rejected.body).toBe('{"error":"unauthorized"}');
});
