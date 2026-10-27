# Cloud authorization-attempt and callback handshake

## Requirement and PR boundary

[Issue 12](https://github.com/devsandip/peel/issues/12) in [Cloud sync foundations](https://github.com/devsandip/peel/milestone/1) supplies FR-04/05/14 and AC-12/13 prerequisites. One trusted initiator owns one bounded authorization attempt. This is the PKCE/state/callback gate before an injected token exchange, not managed login, token validation/storage, a callback route or app Cloud activation.

## Plan before implementation

1. Pin an explicit HTTPS provider origin, public client, scopes and exact registered HTTPS or reverse-domain native callback. Reject callback queries/fragments, credentials and ambiguous configuration. Use authorization code flow with S256, fresh independent 256-bit state, verifier and OpenID nonce. Never embed a client secret.
2. Hold at most one private in-memory attempt per handshake instance, with a required one-to-ten-minute lifetime. Starting again replaces the prior attempt; cancel/restart loses authority. Keep only a state digest and the private verifier/expected nonce. Configuration is cloned and cannot be changed by callback parameters.
3. Check exact callback destination, bounded unique allowed query parameters, state, time and an unambiguous code-or-provider-error before exchange. Consume a matching valid attempt synchronously before invoking asynchronous exchange so concurrent callbacks or failed exchanges cannot replay it. Cancel/replacement also rejects an old exchange result that arrives afterward; already-started network work cannot be recalled. Reject provider errors without repeating their descriptions. Do not log or attach URL, state, code, verifier or upstream exceptions to public errors.
4. An injected trusted exchanger receives only a pinned token endpoint/client/callback and the validated code, verifier and expected nonce. It must validate returned tokens/nonce and secure credentials before establishing a session. This PR never performs network exchange or treats its return value as authenticated identity.
5. Test actual SHA-256 challenge derivation, independent random material, pinned destinations, replaced/cancelled/restarted attempts, expiry/clock failures, malformed/duplicate/mismatched/ambiguous callbacks, provider errors, overlapping callbacks, failed exchange and private errors. Run shared checks/build and hosted Linux/Mac gates in one focused PR.

## Platform and storage gates

The helper executes in Node and each instance is private to a trusted initiating context. Native URI tests establish a callback contract, not native-runtime execution. A single shared instance is not a multi-user web login service. A future web route must bind its pending attempt to that browser with a Secure/HttpOnly cookie and provide an atomic shared attempt store for multi-worker callbacks. Native implementation/system-browser ownership, registered callbacks, OS keychain, provider token exchange/validation/refresh and real Cognito issuance remain separate integration gates. No pending secret is serialized to browser storage. A process restart safely rejects callbacks because the attempt is gone; durable login continuation is not implemented. The exchanger returns a candidate value; it must not commit login/session side effects before this gate returns successfully.

The contract follows [Cognito authorization parameters](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html), [PKCE](https://www.rfc-editor.org/rfc/rfc7636.html), [OAuth security guidance](https://www.rfc-editor.org/rfc/rfc9700.html) and [native OAuth callbacks](https://www.rfc-editor.org/rfc/rfc8252.html). A private native URI uses a reverse-domain scheme with a single slash and no authority; its actual domain/OS registration/ownership still requires validation. Multiple providers must have separately bound initiators and callbacks; a callback cannot choose the issuer.

## Evidence

Seven focused groups pass with real random bytes and SHA-256 challenge derivation. They exercise cloned/pinned public-client configuration, independent state/verifier/nonce, HTTPS and reverse-domain callback contracts, replaced/cancelled/recreated contexts, exact expiry and unsafe clocks, duplicate/unknown/mismatched/ambiguous parameters, bounded code/URL input, private provider/exchange errors and overlapping callbacks. A callback is consumed before a held asynchronous exchange; another callback cannot enter it, and cancellation/replacement rejects its late result.

TypeScript, source formatting, all 130 shared cases in 25 files and the production web build pass. The browser assets stay unchanged with the existing size warning. Hosted checks remain pending. Exchanges return synthetic candidates only; no provider request, real token, persistent browser login context, system browser, native runtime or account acceptance is established here.
