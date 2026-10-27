import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  createCloudAuthorizationHandshake,
  type CloudAuthorizationConfig,
  type CloudAuthorizationGrant,
} from "../../packages/cloud-protocol/src/pkce";

const BASE = 1800000000321;
const config = (): CloudAuthorizationConfig => ({
  providerOrigin: "https://login.peel.example",
  clientId: "syntheticclient",
  callbackUri: "https://peel.example/auth/callback",
  scopes: ["openid", "peel/sync"],
  lifetimeMs: 300000,
});
const state = (start: { authorizationUrl: string }) =>
  new URL(start.authorizationUrl).searchParams.get("state")!;
const callback = (value: string, extra = "code=synthetic-code") =>
  `${config().callbackUri}?state=${value}&${extra}`;
const sha = (value: string) =>
  createHash("sha256").update(value).digest("base64url");

it("pins public-client S256 requests, derives actual challenges and keeps verifier material private", async () => {
  const input = config();
  const flow = createCloudAuthorizationHandshake(input, () => BASE);
  input.providerOrigin = "https://untrusted.example";
  input.scopes.push("untrusted/scope");
  const first = flow.begin(),
    url = new URL(first.authorizationUrl);
  expect(url.origin).toBe(config().providerOrigin);
  expect(url.pathname).toBe("/oauth2/authorize");
  expect(first.expiresAt).toBe(BASE + 300000);
  expect(url.searchParams.get("response_type")).toBe("code");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("scope")).toBe("openid peel/sync");
  expect(url.searchParams.get("client_id")).toBe(config().clientId);
  expect(url.searchParams.get("redirect_uri")).toBe(config().callbackUri);
  expect(url.searchParams.has("client_secret")).toBe(false);
  let grant!: Readonly<CloudAuthorizationGrant>;
  expect(
    await flow.complete(callback(state(first)), async (value) => {
      grant = value;
      expect(Object.isFrozen(value)).toBe(true);
      return "synthetic-candidate";
    }),
  ).toBe("synthetic-candidate");
  expect(grant.tokenEndpoint).toBe(`${config().providerOrigin}/oauth2/token`);
  expect(grant.clientId).toBe(config().clientId);
  expect(grant.redirectUri).toBe(config().callbackUri);
  expect(grant.code).toBe("synthetic-code");
  expect(grant.codeVerifier).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  expect(state(first)).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  expect(grant.expectedNonce).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  expect(
    new Set([state(first), grant.codeVerifier, grant.expectedNonce]).size,
  ).toBe(3);
  expect(url.searchParams.get("nonce")).toBe(grant.expectedNonce);
  expect(url.searchParams.get("code_challenge")).toBe(sha(grant.codeVerifier));
  expect(JSON.stringify(first)).not.toContain(grant.codeVerifier);
  const second = flow.begin();
  expect(state(second)).not.toBe(state(first));
  expect(new URL(second.authorizationUrl).searchParams.get("nonce")).not.toBe(
    grant.expectedNonce,
  );
});

it("rejects unsafe or ambiguous configuration with private errors and accepts explicit native callbacks", async () => {
  const invalid: unknown[] = [
    null,
    { ...config(), clientId: 123 },
    { ...config(), clientId: "bad client" },
    { ...config(), providerOrigin: "http://login.peel.example" },
    { ...config(), providerOrigin: "https://login.peel.example/path" },
    {
      ...config(),
      providerOrigin: "https://private:secret@login.peel.example",
    },
    { ...config(), callbackUri: "https://peel.example/auth/callback?" },
    { ...config(), callbackUri: "https://peel.example/auth/callback#" },
    {
      ...config(),
      callbackUri: "https://private:secret@peel.example/callback",
    },
    { ...config(), callbackUri: "http://peel.example/callback" },
    { ...config(), callbackUri: "javascript:private-secret" },
    { ...config(), callbackUri: "peel://auth/callback" },
    { ...config(), callbackUri: "com.peelnotes.desktop://auth/callback" },
    { ...config(), callbackUri: "com.peelnotes.desktop:////auth/callback" },
    { ...config(), scopes: ["openid", "openid"] },
    { ...config(), scopes: ["peel/sync"] },
    { ...config(), scopes: ["openid", "bad scope"] },
    { ...config(), lifetimeMs: 59999 },
    { ...config(), lifetimeMs: 600001 },
    { ...config(), clientSecret: "private-secret" },
  ];
  for (const value of invalid)
    expect(() =>
      createCloudAuthorizationHandshake(value as CloudAuthorizationConfig),
    ).toThrow("Invalid Cloud authorization configuration");
  const nativeConfig = {
    ...config(),
    callbackUri: "com.peelnotes.desktop:/auth/callback",
  };
  const native = createCloudAuthorizationHandshake(nativeConfig, () => BASE);
  const start = native.begin(),
    exchange = vi.fn(async () => "candidate");
  await expect(
    native.complete(callback(state(start)), exchange),
  ).rejects.toMatchObject({ status: 400 });
  expect(exchange).not.toHaveBeenCalled();
  expect(
    await native.complete(
      `${nativeConfig.callbackUri}?code=synthetic&state=${state(start)}`,
      exchange,
    ),
  ).toBe("candidate");
  expect(exchange).toHaveBeenCalledTimes(1);
});

it("rejects destination, state, parameter and code ambiguities before exchange without consuming another attempt", async () => {
  const flow = createCloudAuthorizationHandshake(config(), () => BASE);
  const start = flow.begin(),
    value = state(start);
  const exchange = vi.fn(async () => "candidate");
  const invalid = [
    callback(value).replace("peel.example/auth", "other.example/auth"),
    callback(value).replace("/auth/callback", "/auth/other"),
    callback(value).replace("https:", "http:"),
    callback(value) + "#",
    callback(value) + "#private-fragment",
    callback(value) + "\n",
    callback("x".repeat(43)),
    callback(value) + `&state=${value}`,
    callback(value) + `&%73tate=${value}`,
    callback(value) + "&code=another",
    callback(value) + "&redirect_uri=https://other.example",
    callback(value, "code="),
    callback(value, "code=bad%0Acode"),
    callback(value, "code=" + "x".repeat(4097)),
    callback(value, "error="),
    callback(value, "code=synthetic&error=access_denied"),
    callback(value, "code=synthetic&error_description=private-detail"),
    `${config().callbackUri}?code=synthetic`,
    `${config().callbackUri}?state=${value}`,
    "x".repeat(8193),
  ];
  for (const uri of invalid)
    await expect(flow.complete(uri, exchange)).rejects.toMatchObject({
      message: "Cloud server: authorization-callback-rejected",
      status: 400,
    });
  expect(exchange).not.toHaveBeenCalled();
  expect(await flow.complete(callback(value), exchange)).toBe("candidate");
  await expect(flow.complete(callback(value), exchange)).rejects.toMatchObject({
    status: 400,
  });
  expect(exchange).toHaveBeenCalledTimes(1);
});

it("replaces, cancels and loses attempts on process-context recreation", async () => {
  const flow = createCloudAuthorizationHandshake(config(), () => BASE);
  const old = flow.begin(),
    current = flow.begin();
  const exchange = vi.fn(async () => "candidate");
  await expect(
    flow.complete(callback(state(old)), exchange),
  ).rejects.toMatchObject({ status: 400 });
  const otherInitiator = createCloudAuthorizationHandshake(
    config(),
    () => BASE,
  );
  otherInitiator.begin();
  await expect(
    otherInitiator.complete(callback(state(current)), exchange),
  ).rejects.toMatchObject({ status: 400 });
  flow.cancel();
  await expect(
    flow.complete(callback(state(current)), exchange),
  ).rejects.toMatchObject({ status: 400 });
  const restarted = createCloudAuthorizationHandshake(config(), () => BASE);
  await expect(
    restarted.complete(callback(state(current)), exchange),
  ).rejects.toMatchObject({ status: 400 });
  expect(exchange).not.toHaveBeenCalled();
});

it("rejects exact expiry, backward/invalid clocks and clears unsafe attempts", async () => {
  let time = BASE;
  const flow = createCloudAuthorizationHandshake(config(), () => time);
  const exchange = vi.fn(async () => "candidate");
  for (const invalid of [BASE + 300000, BASE - 1, NaN, Infinity, -1, 1.5]) {
    time = BASE;
    const start = flow.begin();
    time = invalid;
    await expect(
      flow.complete(callback(state(start)), exchange),
    ).rejects.toMatchObject({
      status: Number.isSafeInteger(invalid) && invalid >= 0 ? 400 : 503,
    });
    time = BASE;
    await expect(
      flow.complete(callback(state(start)), exchange),
    ).rejects.toMatchObject({ status: 400 });
  }
  expect(exchange).not.toHaveBeenCalled();
  const throwing = createCloudAuthorizationHandshake(config(), () => {
    throw Error("private clock");
  });
  expect(() => throwing.begin()).toThrow(
    "Cloud server: authorization-clock-unavailable",
  );
});

it("consumes provider rejection and failed exchange without disclosing callback or upstream secrets", async () => {
  const flow = createCloudAuthorizationHandshake(config(), () => BASE);
  const denied = flow.begin(),
    exchange = vi.fn(async () => "candidate");
  await expect(
    flow.complete(
      callback(
        state(denied),
        "error=access_denied&error_description=private-detail&error_uri=https%3A%2F%2Fprivate.example",
      ),
      exchange,
    ),
  ).rejects.toMatchObject({
    message: "Cloud server: authorization-denied",
    status: 400,
  });
  await expect(
    flow.complete(callback(state(denied)), exchange),
  ).rejects.toMatchObject({ status: 400 });
  expect(exchange).not.toHaveBeenCalled();
  const next = flow.begin(),
    failed = vi.fn(async () => {
      throw Error("private verifier/token/code detail");
    });
  const error = await flow
    .complete(callback(state(next)), failed)
    .catch((value) => value);
  expect(error).toMatchObject({
    message: "Cloud server: authorization-unavailable",
    status: 503,
  });
  expect(JSON.stringify(error)).not.toContain("private");
  await expect(
    flow.complete(callback(state(next)), failed),
  ).rejects.toMatchObject({ status: 400 });
  expect(failed).toHaveBeenCalledTimes(1);
});

it("consumes synchronously before overlapping callbacks and rejects results cancelled or replaced during exchange", async () => {
  for (const change of ["none", "cancel", "replace"]) {
    const flow = createCloudAuthorizationHandshake(config(), () => BASE);
    const start = flow.begin();
    let release!: (value: string) => void;
    const exchange = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const pending = flow.complete(callback(state(start)), exchange);
    await expect(
      flow.complete(callback(state(start)), exchange),
    ).rejects.toMatchObject({ status: 400 });
    if (change === "cancel") flow.cancel();
    if (change === "replace") flow.begin();
    release("synthetic-candidate");
    if (change === "none") expect(await pending).toBe("synthetic-candidate");
    else await expect(pending).rejects.toMatchObject({ status: 400 });
    expect(exchange).toHaveBeenCalledTimes(1);
  }
});
