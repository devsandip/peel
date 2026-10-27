# Bounded Lambda HTTP sync entry point

## Requirement and PR boundary

[Issue 13](https://github.com/devsandip/peel/issues/13) in [Cloud sync foundations](https://github.com/devsandip/peel/milestone/1) connects FR-04/14/20 and AC-10/12/13 prerequisites. One purpose: translate a bounded API Gateway HTTP payload-v2 event into the existing authenticated Fetch sync service backed by explicit DynamoDB adapters. This adds no listener, deployed resource, login route, entitlement administration, live push or application activation.

## Plan before implementation

Review-size decomposition: [issue 21](https://github.com/devsandip/peel/issues/21) first owns payload-v2 transport and its independent failure tests. This issue then adds only authenticated DynamoDB composition and integration tests in a dependent PR. The original combined draft exceeded a comfortable review size; no product requirement changed.

1. Require a pinned HTTPS origin/table, explicit SDK client and nonextractable cursor-signing key. Build mutation/pull services once per handler. Select bearer Cognito verification or durable browser-session/CSRF verification explicitly per handler; reject mixed credentials and never fall back to event authorizer/owner/paid metadata. Synthetic JWKS injection tests the same verifier without real accounts.
2. Accept only API Gateway HTTP payload version 2.0. Bound path/query, header count/bytes, cookies and body before constructing Fetch objects. Reject malformed destinations, duplicate case-insensitive headers, conflicting cookie sources, invalid base64/UTF-8, mismatched content length and GET/HEAD bodies. Pin the request origin from trusted configuration, preserving raw query duplicates for the existing route validator. Ignore forwarded host/identity and combined query maps.
3. Use existing mutation, note-read and signed bootstrap/change routes. A configured browser handler resolves preexisting sessions only; it does not expose issuance/logout or provider login. Normalize cookies without losing duplicate-session detection. Authentication still precedes JSON/body consumption in the existing Fetch handler after bounded transport decoding.
4. Emit explicit payload-v2 JSON responses with no-store and private errors. Bound response reading, preserve status and safe service headers, and support the v2 cookie response field rather than folding Set-Cookie. No request/body/token or upstream error logging. SDK client/key provisioning and lifetime remain the caller's responsibility.
5. Unit-test invalid/oversized event conversion with zero SDK access and no real credentials. Disposable DynamoDB tests compose actual RSA access-token verification or durable cookie/CSRF sessions with mutations, note reads and signed pull routes; verify owner isolation, conflicts/purge, duplicate raw queries, credential rejection and current paid policy. Separate issue 14 expands the composed recovery/failure matrix.
6. Run TypeScript, source formatting, shared tests, all actual DynamoDB Local tests and web build, then focused review and hosted Linux/Mac gates. Merge this one-purpose PR only after those pass.

## Platform and deployment gates

[AWS payload-v2 documentation](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html) defines raw query strings, combined headers, cookies and explicit responses. This handler intentionally rejects v1 and assumes root-mounted API routes; stage/API mapping, proxy trust, CORS/CSP, throttling, managed authentication/IAM, signing-key persistence/rotation, account administration, hosting cost/budget/IaC and live delivery remain deployment gates. Local signed synthetic tokens do not establish real Cognito issuance. No app feature or acceptance criterion is completed by this entry point alone.

## Evidence

Implementation and verification pending.
