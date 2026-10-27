import { generateKeyPairSync, sign } from "node:crypto";
import { SimpleJwksCache, type Jwk } from "aws-jwt-verify/jwk";

export const syntheticCognito = {
  userPoolId: "us-east-1_Synthetic",
  clientIds: ["syntheticNative"],
  requiredScope: "peel/sync",
};
const issuer =
  "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Synthetic";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
export function syntheticJwks() {
  const cache = new SimpleJwksCache({
    fetcher: {
      fetch: async () => {
        throw Error("Live key retrieval forbidden in synthetic fixture");
      },
    },
  });
  cache.addJwks(issuer + "/.well-known/jwks.json", {
    keys: [
      {
        ...pair.publicKey.export({ format: "jwk" }),
        kid: "synthetic-key",
        use: "sig",
      } as Jwk,
    ],
  });
  return cache;
}
export function syntheticAccessToken(
  subject = "synthetic-owner-a",
  extra = {},
) {
  const time = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const input =
    encode({ alg: "RS256", kid: "synthetic-key" }) +
    "." +
    encode({
      iss: issuer,
      sub: subject,
      client_id: syntheticCognito.clientIds[0],
      token_use: "access",
      scope: "openid peel/sync",
      iat: time - 1,
      exp: time + 300,
      ...extra,
    });
  return (
    input +
    "." +
    sign("RSA-SHA256", Buffer.from(input), pair.privateKey).toString(
      "base64url",
    )
  );
}
