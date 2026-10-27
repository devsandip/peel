import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SimpleJwksCache, type Jwk, type Jwks } from "aws-jwt-verify/jwk";
import { FetchError } from "aws-jwt-verify/error";
import { createCognitoCallerResolver } from "../../packages/cloud-protocol/src/cognito-auth";
import { CloudMutationService } from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";

const config = {
  userPoolId: "us-east-1_Synthetic",
  clientIds: ["syntheticNative", "syntheticWeb"],
  requiredScope: "peel/sync",
};
const issuer =
  "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic";
const jwksUri = `${issuer}/.well-known/jwks.json`;
function key(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid,
    use: "sig",
  } as Jwk;
  return { kid, privateKey, jwk };
}
const first = key("synthetic-first"),
  second = key("synthetic-second");
function token(
  overrides: Record<string, unknown> = {},
  signing = first,
  alg = "RS256",
  extraHeader = {},
) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  const source = `${encode({ alg, kid: signing.kid, ...extraHeader })}.${encode({ iss: issuer, sub: "synthetic-owner-a", client_id: config.clientIds[0], token_use: "access", scope: "openid peel/sync", iat: now - 1, exp: now + 300, ...overrides })}`;
  return `${source}.${sign(alg === "RS384" ? "RSA-SHA384" : "RSA-SHA256", Buffer.from(source), signing.privateKey).toString("base64url")}`;
}
const request = (jwt: string, init: RequestInit = {}) =>
  new Request("https://peel.invalid/v1/notes/synthetic-note", {
    ...init,
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-peel-collection": "synthetic-library",
      "x-peel-mode-generation": "1",
      ...init.headers,
    },
  });
function cache() {
  const fetcher = {
    fetch: vi.fn(async (uri: string) => {
      if (uri !== jwksUri) throw Error("Unexpected key destination");
      return new TextEncoder().encode(
        JSON.stringify({ keys: [first.jwk, second.jwk] }),
      ).buffer as ArrayBuffer;
    }),
  };
  const jwksCache = new SimpleJwksCache({ fetcher });
  jwksCache.addJwks(jwksUri, { keys: [first.jwk] } as Jwks);
  return { jwksCache, fetcher };
}

it("uses real RSA verification, derives only the signed subject, and reuses configured keys", async () => {
  const { jwksCache, fetcher } = cache();
  const resolve = createCognitoCallerResolver(config, { jwksCache });
  expect(
    await resolve(
      request(token(), { headers: { "x-peel-subject": "forged-owner" } }),
    ),
  ).toBe("synthetic-owner-a");
  expect(
    await resolve(
      request(token({ sub: "synthetic-owner-b", client_id: "syntheticWeb" })),
    ),
  ).toBe("synthetic-owner-b");
  expect(fetcher.fetch).not.toHaveBeenCalled();
  expect(
    await resolve(
      request(
        token({}, first, "RS256", { jku: "https://attacker.invalid/keys" }),
      ),
    ),
  ).toBe("synthetic-owner-a");
  expect(fetcher.fetch).not.toHaveBeenCalled();
  expect(await resolve(request(token({}, second)))).toBe("synthetic-owner-a");
  expect(fetcher.fetch).toHaveBeenCalledExactlyOnceWith(jwksUri);
  await resolve(request(token({}, second)));
  expect(fetcher.fetch).toHaveBeenCalledTimes(1);
});

it("rejects invalid signatures, token types, scope, issuer, client, times and subject", async () => {
  const { jwksCache } = cache(),
    resolve = createCognitoCallerResolver(config, { jwksCache });
  const now = Math.floor(Date.now() / 1000);
  for (const claims of [
    { token_use: "id", aud: "syntheticNative" },
    { client_id: "unrelatedClient" },
    { iss: "https://attacker.invalid/pool" },
    { scope: "openid peel/sync-other" },
    { exp: now - 1 },
    { exp: undefined },
    { exp: "9999999999" },
    { iat: undefined },
    { iat: now + 5 },
    { nbf: now + 500 },
    { sub: undefined },
    { sub: "" },
    { sub: { owner: "synthetic-owner-a" } },
  ])
    await expect(resolve(request(token(claims)))).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  await expect(
    resolve(request(token({}, first, "RS384"))),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    resolve(request(token({}, second, "RS256", { kid: first.kid }))),
  ).rejects.toMatchObject({ status: 401 });
});

it("bounds authorization and does not accept cookies, forwarded identities or combined credentials", async () => {
  const { jwksCache, fetcher } = cache(),
    resolve = createCognitoCallerResolver(config, { jwksCache });
  const jwt = token();
  for (const authorization of [
    "",
    "Basic synthetic",
    `Bearer ${jwt}, Bearer ${jwt}`,
    `Bearer ${"x".repeat(8193)}`,
    "Bearer a.b.c.extra",
    "Bearer a.b.c?token=other",
  ])
    await expect(
      resolve(
        new Request("https://peel.invalid/v1/mutations", {
          headers: {
            authorization,
            cookie: "peel=synthetic",
            "x-peel-subject": "synthetic-owner-a",
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  expect(
    await resolve(
      request(jwt, { headers: { authorization: `bearer ${jwt}` } }),
    ),
  ).toBe("synthetic-owner-a");
  expect(fetcher.fetch).not.toHaveBeenCalled();
  expect(() =>
    createCognitoCallerResolver({ ...config, requiredScope: "" }),
  ).toThrow();
  expect(() =>
    createCognitoCallerResolver({ ...config, clientIds: [] }),
  ).toThrow();
});

it("fails closed for unknown keys and unavailable key retrieval with private errors", async () => {
  const unknown = key("unknown"),
    { jwksCache, fetcher } = cache();
  const resolve = createCognitoCallerResolver(config, { jwksCache });
  await expect(resolve(request(token({}, unknown)))).rejects.toMatchObject({
    code: "unauthorized",
    status: 401,
  });
  expect(fetcher.fetch).toHaveBeenCalledExactlyOnceWith(jwksUri);
  const outage = new SimpleJwksCache({
    fetcher: {
      fetch: async () => {
        throw new FetchError(
          "https://private.invalid",
          "Synthetic upstream detail",
        );
      },
    },
  });
  const handler = createCloudMutationHandler(
    {
      get: async () => {
        throw Error("Must not read store");
      },
    } as unknown as CloudMutationService,
    createCognitoCallerResolver(config, { jwksCache: outage }),
  );
  const response = await handler(request(token()));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: "authentication-unavailable",
  });
});

it("authenticates before reading a body/store and retains current owner and entitlement gates", async () => {
  const { jwksCache } = cache(),
    resolve = createCognitoCallerResolver(config, { jwksCache });
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-token-auth-")),
    store = new SQLiteCloudServerStore(join(folder, "server.sqlite3"));
  try {
    for (const [ownerSubject, entitlement] of [
      ["synthetic-owner-a", "active"],
      ["synthetic-owner-b", "inactive"],
    ] as const)
      await store.seedAccount({
        version: 1,
        ownerSubject,
        collectionId: "synthetic-library",
        modeGeneration: 1,
        status: "active",
        entitlement,
        revision: 1,
        sequence: 0,
        wall: 0,
      });
    const handler = createCloudMutationHandler(
        new CloudMutationService(store),
        resolve,
      ),
      read = vi.spyOn(store, "read");
    const bad = new Request("https://peel.invalid/v1/mutations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token({ client_id: "wrong" })}`,
      },
      body: "Synthetic unread body",
    });
    const denied = await handler(bad);
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: "unauthorized" });
    expect(bad.bodyUsed).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect((await handler(request(token()))).status).toBe(200);
    expect(read.mock.calls.at(-1)?.[0]).toBe("synthetic-owner-a");
    const unpaid = await handler(request(token({ sub: "synthetic-owner-b" })));
    expect(unpaid.status).toBe(403);
    expect(await unpaid.json()).toEqual({
      error: "cloud-entitlement-inactive",
    });
    expect(read.mock.calls.at(-1)?.[0]).toBe("synthetic-owner-b");
    await store.setPolicy("synthetic-owner-a", "deleted", "inactive");
    expect((await handler(request(token()))).status).toBe(410);
  } finally {
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
