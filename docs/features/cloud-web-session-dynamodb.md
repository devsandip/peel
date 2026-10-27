# Durable DynamoDB browser sessions

## Requirement and PR boundary

[Issue 11](https://github.com/devsandip/peel/issues/11) in [Cloud sync foundations](https://github.com/devsandip/peel/milestone/1) implements the existing CloudWebSessionStore for FR-04/14 and AC-12/13. This is only durable session lookup, insert and revocation. It does not expose login routes, store provider tokens, provision a table or activate Cloud in the app.

## Plan before implementation

1. Accept an explicit server SDK client/table. Keep a validated record under SESSION#<digest>/META with only session/CSRF digests, verified subject, issue/expiry times and revoked state. Strongly consistent base-table lookup ensures completed revocation defeats later authorization reads. No raw browser credential or refresh token is stored.
2. Atomically insert the session and an owner-scoped, body-free USER#<subject>/WEBSESSION#<digest> directory reference, both absent-only. This allows future account erasure to enumerate its sessions without a table Scan. The directory is not a second authorization source. Same-ID collisions must preserve both records and never change ownership or reactivate a revoked session.
3. Revoke by comparing the exact observed record and writing only revoked=true. Bound contention retries, treat already revoked/missing IDs as idempotent, and never recreate a record removed by TTL. Keep the original expiry, rounding physical TTL up to seconds. The request boundary still enforces logical expiry before asynchronous TTL cleanup.
4. Verify actual DynamoDB Local with disposable tables and synthetic sessions: reopen/client restart, digest-only persisted records and directory, same-ID owner collisions, concurrent revocation, missing/physically deleted IDs, logical expiry, malformed records and private transport/throttling failures. A failed persistence operation cannot issue a cookie. No real credential or app database is used.
5. Run TypeScript, formatting, all shared/session/DynamoDB tests and the production web build, then review and merge one focused PR after hosted gates. Record actual evidence and remaining managed-service/login gates.

## Storage and remaining gates

The lookup is authoritative; the owner directory supports future authenticated account cleanup. Directory and lookup TTL are expendable after logical expiry; account-wide revocation/erasure and provider logout remain separate work. Account/paid policy still gates every Cloud data request after session resolution. The adapter owns no SDK client lifetime.

[Strong reads](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html), [conditional replacement](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html), [atomic writes](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html) and [TTL eligibility](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html) follow AWS's contracts. Local tests are not managed IAM, cost, backup, network or production login acceptance.

## Evidence

Six focused groups pass against checksum-verified DynamoDB Local 3.3.2, using a fresh disposable table per case and explicit loopback clients with dummy credentials. All 22 DynamoDB cases in three files pass. The new cases verify a fresh SDK/store instance and a separate Node process can read committed state; raw session/CSRF credentials do not occur in the lookup or directory; collisions roll back both writes; logout survives reopen and preserves another owner's session; competing revocation and physical deletion do not reactivate authority; logical expiry precedes cleanup; malformed records stay untouched; and ambiguous commit/throttling failures withhold cookies or successful logout.

TypeScript, source formatting, all 123 shared cases in 24 files and the production web build pass. Hosted Linux/Mac checks remain pending. The browser bundle stays unchanged and retains its existing size warning. No AWS resource or real credential was accessed. Fresh-process reads prove persisted engine state, not a deployed Lambda or browser login. TTL eligibility is asserted from stored values and simulated physical deletion; asynchronous managed TTL timing is not established locally.
