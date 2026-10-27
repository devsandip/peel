# Cloud access-token authentication

## Scope and plan

FR-04/14 and AC-09/12/13 require a verified caller before Cloud data access. This PR has one purpose: resolve a bearer access token to its verified Cognito subject for the existing HTTP handler. It does not build login, web sessions, infrastructure or the DynamoDB adapter.

1. Use AWS's recommended `aws-jwt-verify`, pinned to 5.2.1 for this Node experiment. Configure an explicit user pool, allowed client IDs and one required sync scope. Require an access token, RS256, valid signature and expiration. Reject ID tokens, wrong issuer/client/scope, malformed/missing subjects and oversized/ambiguous authorization headers. Ignore request-supplied owner fields.
2. Keep the verifier/cache outside individual requests. Default key retrieval uses only the configured Cognito issuer; request headers/claims cannot choose a JWKS URL. Permit an injected JWKS cache for synthetic RSA signing and rotation/failure tests. Never log/return token or verification exception details.
3. Connect it to the existing HTTP handler in tests. Verify actual RSA signatures and claim failures, expiry, unknown keys/key rotation, unavailable keys, isolation of two subjects and current entitlement rejection after valid authentication. Invalid authentication must not read the request body or account store.
4. Run focused tests, TypeScript and existing shared regressions. Review and open this as its own small PR. Real Cognito account/managed-login, production HTTP/session controls and hosted integration remain acceptance gates.

## Follow-on PR boundaries

Separate work will implement native authorization-code/PKCE login, same-origin web sessions/CSRF, DynamoDB conditional mutations, and DynamoDB pagination. Each gets its own plan, tests and PR. No live resources or real tokens are needed here.

## Sources and decisions

AWS recommends `aws-jwt-verify` for Node verification, including token type, issuer, client and scope checks: [Cognito validation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html). Its Cognito verifier uses a reusable JWKS cache with unknown-key refresh: [library documentation](https://github.com/awslabs/aws-jwt-verify). Pinning the server-only dependency does not put token handling in the UI or enable Cloud mode. Valid authentication never confers a paid entitlement; current server account policy still gates reads/writes.

## Evidence

Five focused cases pass with actual ephemeral 2048-bit RSA signatures and injected public-key retrieval. They verify configured key reuse and rotation, ignored token-selected key URLs/forwarded identities, wrong signatures/algorithms/issuers/clients/types/scopes, missing or invalid lifetime/subject claims, not-before, oversized/combined headers, private 401/503 errors and failure before body/store consumption. An existing HTTP handler with isolated SQLite derives two distinct subjects and still rejects an unpaid or deleted account.

`pnpm check`, changed-source Prettier, `pnpm build` and all 116 shared cases in 23 files pass. The production bundle retains its existing chunk-size warning; no application code imports this server module. All keys/tokens are generated synthetic fixtures in memory, with no live issuer or real account used. Hosted CI remains blocked by the previously confirmed account payment/spending restriction and is not counted as passing. Real Cognito issuance, network JWKS behavior, gateway/session integration and deployment remain open.
