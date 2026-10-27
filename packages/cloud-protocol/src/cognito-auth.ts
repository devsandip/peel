import { CognitoJwtVerifier } from "aws-jwt-verify";
import { FetchError, JwksValidationError } from "aws-jwt-verify/error";
import type { JwksCache } from "aws-jwt-verify/jwk";
import { CloudServerError, validateServerSubject } from "./server";
import type { CloudCallerResolver } from "./server-http";

export interface CloudAccessTokenConfig {
  userPoolId: string;
  clientIds: string[];
  requiredScope: string;
}

/** Server-only access-token boundary. Create once per worker, never per request. */
export function createCognitoCallerResolver(
  input: CloudAccessTokenConfig,
  dependencies?: { jwksCache: JwksCache },
): CloudCallerResolver {
  const config = structuredClone(input);
  if (
    !config ||
    typeof config.userPoolId !== "string" ||
    !Array.isArray(config.clientIds) ||
    !config.clientIds.length ||
    config.clientIds.length > 8 ||
    new Set(config.clientIds).size !== config.clientIds.length ||
    config.clientIds.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9]{1,128}$/.test(id),
    ) ||
    typeof config.requiredScope !== "string" ||
    !/^[a-zA-Z0-9._:/-]{1,256}$/.test(config.requiredScope)
  )
    throw Error("Invalid Cloud access-token configuration");
  const verifier = CognitoJwtVerifier.create(
    {
      userPoolId: config.userPoolId,
      clientId: config.clientIds,
      tokenUse: "access",
      scope: config.requiredScope,
      graceSeconds: 0,
      includeRawJwtInErrors: false,
      customJwtCheck: ({ header, payload }) => {
        const now = Math.floor(Date.now() / 1000);
        if (
          header.alg !== "RS256" ||
          !Number.isSafeInteger(payload.exp) ||
          Number(payload.exp) <= now ||
          !Number.isSafeInteger(payload.iat) ||
          Number(payload.iat) > now ||
          Number(payload.iat) < 0 ||
          Number(payload.iat) >= Number(payload.exp) ||
          typeof payload.sub !== "string"
        )
          throw Error("Invalid access-token claims");
        validateServerSubject(payload.sub);
      },
    },
    dependencies,
  );
  return async (request) => {
    const header = request.headers.get("authorization");
    if (
      !header ||
      header.length > 8192 ||
      !/^Bearer [a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/i.test(header)
    )
      throw new CloudServerError("unauthorized", 401);
    try {
      const payload = await verifier.verify(header.slice(7));
      return payload.sub;
    } catch (error) {
      // Never attach the credential, claims, upstream URL or library error.
      if (error instanceof FetchError || error instanceof JwksValidationError)
        throw new CloudServerError("authentication-unavailable", 503);
      throw new CloudServerError("unauthorized", 401);
    }
  };
}
