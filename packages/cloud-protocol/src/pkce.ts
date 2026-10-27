import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CloudServerError } from "./server";

export interface CloudAuthorizationConfig {
  providerOrigin: string;
  clientId: string;
  callbackUri: string;
  scopes: string[];
  lifetimeMs: number;
}
export interface CloudAuthorizationGrant {
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  expectedNonce: string;
}
const fail = (code: string, status = 400): never => {
  throw new CloudServerError(code, status);
};
const digest = (value: string) => createHash("sha256").update(value).digest();
const random = () => randomBytes(32).toString("base64url");
const validTime = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** One trusted initiator only. No routes, persistent attempt store or token validation. */
export function createCloudAuthorizationHandshake(
  input: CloudAuthorizationConfig,
  clock = () => Date.now(),
) {
  let config: CloudAuthorizationConfig;
  try {
    config = structuredClone(input);
    const provider = new URL(config.providerOrigin);
    const callback = new URL(config.callbackUri);
    if (
      Object.keys(config).length !== 5 ||
      typeof config.providerOrigin !== "string" ||
      config.providerOrigin.length > 2048 ||
      typeof config.callbackUri !== "string" ||
      config.callbackUri.length > 2048 ||
      provider.protocol !== "https:" ||
      provider.origin !== config.providerOrigin ||
      callback.href !== config.callbackUri ||
      (callback.protocol === "https:"
        ? !callback.hostname
        : callback.host ||
          !callback.pathname.startsWith("/") ||
          callback.pathname.startsWith("//")) ||
      callback.username ||
      callback.password ||
      callback.href.includes("?") ||
      callback.href.includes("#") ||
      !(
        callback.protocol === "https:" ||
        /^[a-z][a-z0-9+-]*(?:\.[a-z0-9+-]+)+:$/.test(callback.protocol)
      ) ||
      typeof config.clientId !== "string" ||
      !/^[a-zA-Z0-9]{1,128}$/.test(config.clientId) ||
      !Array.isArray(config.scopes) ||
      !config.scopes.includes("openid") ||
      config.scopes.length > 16 ||
      new Set(config.scopes).size !== config.scopes.length ||
      config.scopes.some(
        (scope) =>
          typeof scope !== "string" || !/^[a-zA-Z0-9._:/-]{1,256}$/.test(scope),
      ) ||
      !Number.isSafeInteger(config.lifetimeMs) ||
      config.lifetimeMs < 60000 ||
      config.lifetimeMs > 600000
    )
      throw Error();
  } catch {
    throw Error("Invalid Cloud authorization configuration");
  }
  let pending: {
    stateHash: Buffer;
    verifier: string;
    nonce: string;
    issuedAt: number;
    expiresAt: number;
  } | null = null;
  let generation = 0;
  const cancel = () => {
    pending = null;
    generation++;
  };
  const now = () => {
    try {
      const value = clock();
      if (!validTime(value)) throw Error();
      return value;
    } catch {
      cancel();
      return fail("authorization-clock-unavailable", 503);
    }
  };
  return {
    cancel,
    begin(): { authorizationUrl: string; expiresAt: number } {
      cancel();
      const issuedAt = now(),
        expiresAt = issuedAt + config.lifetimeMs;
      if (!validTime(expiresAt))
        return fail("authorization-clock-unavailable", 503);
      try {
        const state = random(),
          verifier = random(),
          nonce = random();
        const url = new URL("/oauth2/authorize", config.providerOrigin);
        url.search = new URLSearchParams({
          response_type: "code",
          client_id: config.clientId,
          redirect_uri: config.callbackUri,
          scope: config.scopes.join(" "),
          state,
          nonce,
          code_challenge_method: "S256",
          code_challenge: digest(verifier).toString("base64url"),
        }).toString();
        pending = {
          stateHash: digest(state),
          verifier,
          nonce,
          issuedAt,
          expiresAt,
        };
        return { authorizationUrl: url.href, expiresAt };
      } catch {
        cancel();
        return fail("authorization-unavailable", 503);
      }
    },
    async complete<T>(
      callbackUri: string,
      exchange: (grant: Readonly<CloudAuthorizationGrant>) => Promise<T>,
    ): Promise<T> {
      let url: URL;
      try {
        if (
          typeof callbackUri !== "string" ||
          callbackUri.length > 8192 ||
          /[\u0000-\u0020\u007f]/.test(callbackUri)
        )
          throw Error();
        url = new URL(callbackUri);
        if (
          url.href.includes("#") ||
          url.href.split("?")[0] !== config.callbackUri
        )
          throw Error();
        const allowed = [
          "state",
          "code",
          "error",
          "error_description",
          "error_uri",
        ];
        for (const name of url.searchParams.keys())
          if (
            !allowed.includes(name) ||
            url.searchParams.getAll(name).length !== 1
          )
            throw Error();
      } catch {
        return fail("authorization-callback-rejected");
      }
      const state = url.searchParams.get("state"),
        attempt = pending;
      if (
        !state ||
        !/^[a-zA-Z0-9_-]{43}$/.test(state) ||
        !attempt ||
        !timingSafeEqual(digest(state), attempt.stateHash)
      )
        return fail("authorization-callback-rejected");
      const current = now();
      if (current < attempt.issuedAt || current >= attempt.expiresAt) {
        cancel();
        return fail("authorization-attempt-expired");
      }
      const code = url.searchParams.get("code"),
        error = url.searchParams.get("error");
      if (
        (code === null) === (error === null) ||
        (code !== null &&
          (!/^[\x21-\x7e]{1,4096}$/.test(code) ||
            url.searchParams.has("error_description") ||
            url.searchParams.has("error_uri"))) ||
        (error !== null && !/^[a-zA-Z0-9_]{1,128}$/.test(error))
      )
        return fail("authorization-callback-rejected");
      pending = null; // Consume before calling any asynchronous or injected code.
      const startedGeneration = generation;
      if (error !== null) return fail("authorization-denied");
      let result: T;
      try {
        result = await exchange(
          Object.freeze({
            tokenEndpoint: `${config.providerOrigin}/oauth2/token`,
            clientId: config.clientId,
            redirectUri: config.callbackUri,
            code: code!,
            codeVerifier: attempt.verifier,
            expectedNonce: attempt.nonce,
          }),
        );
      } catch {
        return fail("authorization-unavailable", 503);
      }
      if (generation !== startedGeneration)
        return fail("authorization-callback-rejected");
      return result;
    },
  };
}
