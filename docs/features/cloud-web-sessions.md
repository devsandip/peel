# Browser Cloud sessions and CSRF boundary

## Requirements and PR boundary

Tracked by [issue 10](https://github.com/devsandip/peel/issues/10) in the current [Cloud sync foundations milestone](https://github.com/devsandip/peel/milestone/1).

FR-04/14 and AC-12/13 require authenticated, account-isolated browser access without exposing refresh credentials to JavaScript. This PR implements only the server-side cookie/session request boundary. Managed login/code exchange, credential refresh, durable session storage, hosted routes and browser UI remain separate slices. No authentication shortcut or app Cloud mode is enabled.

## Plan before implementation

1. Issue opaque 256-bit random session IDs and independent anti-CSRF tokens only after an injected trusted access-token resolver succeeds. Never accept an owner/paid flag from request JSON. Store only the ID digest, subject, CSRF digest, issue/expiry time and revoked state through an explicit persistence interface. Token material for eventual Cognito refresh remains server-only and is not implemented in this PR.
2. Use a __Host- cookie with Path=/, Secure, HttpOnly and SameSite=Lax. Lifetime is required server configuration, bounded from one minute to 24 hours; this is a provisional technical cap, not published subscription/session terms. JavaScript receives only the anti-CSRF token, never the session ID or refresh credentials.
3. For session-backed API calls, require the configured HTTPS origin in the request URL, parse exactly one well-formed session cookie, reject expired/revoked/future-issued/malformed records and derive only the stored verified subject. Unsafe requests additionally require exact Origin, an anti-CSRF header and compatible Fetch Metadata when supplied. Do not read untrusted bodies or note stores on rejection.
4. Rotate on sign-in/account switch: persist a fresh session before revoking the previous cookie's session, and withhold the new cookie if either storage step fails. Logout is POST with the same CSRF checks, revokes server state and clears the cookie. Storage failures return private retryable errors. Current Cloud account and paid policy still gate note access after session authentication.
5. Test real Fetch requests and cryptography against the existing HTTP/mutation service, using synthetic upstream authentication and isolated SQLite note data. Cover cookie flags/opaque credentials, rotation/revocation, expiry/clock errors, cross-origin and malformed/duplicate cookies, CSRF/Fetch Metadata, failure before body consumption, account isolation, current paid policy and persistence failure. Run all shared regressions and hosted checks.

## Sources and remaining gates

Use [OWASP's CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) and the [browser __Host-/HttpOnly/Secure cookie rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie). SameSite is an additional control, not the only CSRF defense. Durable session storage, identity-provider login/refresh/logout, rate limits, deployment headers/proxy trust and real browser integration remain explicit follow-on gates. Sessions do not grant paid entitlement or authorize uploading an On-device library.

## Evidence

Seven focused groups pass, with all 123 shared cases in 24 files passing. They exercise actual Fetch requests, random 256-bit IDs and SHA-256 digests, cookie flags, credential non-disclosure, same-origin/Fetch Metadata rejection, strict duplicate/malformed cookies, independent CSRF tokens, session rotation/logout, logical expiry/revocation, malformed persisted records and private persistence failures. The existing HTTP service plus isolated SQLite proves two account sessions write/read only their own notes and that a valid cookie still cannot bypass inactive paid policy. An invalid CSRF request leaves its body unread and never enters the note store.

TypeScript, repository source formatting and production web build pass. The browser bundle is unchanged in size and retains its previous warning. Hosted Linux/Mac checks remain pending. Upstream authentication and session persistence are synthetic injected fixtures in these cases; this is not real Cognito issuance, durable session-store or browser-cookie interaction evidence.

Issuance is a server helper, not an exposed route. It requires a protected same-origin POST and a successful trusted authentication resolver before generating credentials. It never consumes owner/paid flags from JSON. A failed new-session insert or old-session revocation withholds the new cookie; an unreturned orphan record can expire, but its raw ID is never stored. Logout revokes an active session and clears the cookie only after the persistence step succeeds. A revocation protects later authorization reads; cancellation of already authenticated in-flight requests is not established here.

Current account/entitlement checks remain in the Cloud service and its transaction conditions. Refresh tokens, provider logout, account-wide session invalidation, managed-login/code exchange, rate limits, production session policy, durable storage, route/proxy headers and app integration remain acceptance gates. Expired authentication never changes any local note/outbox in this implementation.
