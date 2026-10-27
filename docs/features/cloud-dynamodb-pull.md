# DynamoDB paginated Cloud download

## Requirements and PR boundary

FR-04/13/14/20 and AC-04/09/10/12/13/23 require complete current-state bootstrap and ordered catch-up without dropping local work. This PR adds DynamoDB Query support to the existing signed pull service, building on the conditional mutation adapter. It does not add hosted infrastructure, live push or application activation.

## Plan before implementation

1. Capture META and the maximum NOTE/TOMB IDs using strongly consistent key queries. Bracket the bound queries with metadata reads and accept only identical metadata, since all supported mutations advance META atomically. Retry a bounded number of times on contention; do not invent a snapshot from inconsistent bounds.
2. Query only the authenticated owner's partition, with bounded sort-key ranges and no table Scan. Project note/tombstone keys during enumeration. Follow LastEvaluatedKey, including short/empty pages, until the requested limit plus one lookahead is collected or the query ends. Never advance a public cursor past an unreturned key.
3. Decode and validate ordered CHANGE records with their key/sequence/expiry fields. Preserve the existing service's logical-expiry and gap rejection. Recheck account policy after asynchronous queries. Bound per-call requests and reject non-progressing continuations rather than looping forever.
4. Verify actual pagination beyond DynamoDB's documented 1 MiB pre-projection boundary, stable bootstrap during edits/creation/purge, stable change upper bounds, interrupted signed continuation, owner isolation, history expiry/gaps and revocation during a query. Use the same isolated runtime and disposable tables as the mutation suite.
5. Run TypeScript, formatting, shared tests, full DynamoDB suite and production web build. Keep this separate from the mutation PR; merge only after its dependency and focused validation pass.

## Sources and limits

AWS documents [Query pagination](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html) and [read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html). DynamoDB Local does not establish hosted account/authentication, IAM, capacity, cost, backup/restore or network acceptance. Existing signed cursor/pull semantics remain in SPEC and cloud-paginated-pull.md; this adds a storage adapter, not a new public conflict or retention policy.

## Evidence

All six pull cases now pass on actual DynamoDB Local 3.3.2, alongside all nine mutation cases. The large-library case stores seven 200,000-byte notes. Its initial Query limit exceeds the whole fixture's item count, yet the engine returns a partial page with a real LastEvaluatedKey. The next request follows that key and returns every remaining note. Public response-byte limits split the same library into bounded pages without skipping keys.

The earlier six-note fixture ended exactly on the local engine's size-crossover record. Inspection of the checksum-pinned runtime showed that it includes the crossing record before stopping; because the fixture was already exhausted, no continuation was necessary. The test's assumption was wrong. A seventh real record leaves work after that crossover and exercises the existing continuation path without removing projection, injecting a response or weakening the completeness assertion. Temporary diagnostic inputs remain ignored and are not part of this change.

Other passing cases apply actual pages to a durable SQLite client while notes are created before/after captured bounds, edited and purged. They reopen the server adapter and resume from the signed completed checkpoint, preserving a stable upper sequence and fetching later edits in the next round. They also cover metadata-bound retry and bounded continuous contention, account-scoped/tampered cursors, paid revocation during Query, missing history, checkpoint expiry, and explicitly injected empty/non-progressing SDK pages. The injected cases are separate from the real byte-limit case.

TypeScript, all 116 shared tests in 23 files, source formatting and the production web build pass. The existing browser bundle-size warning remains. Hosted Linux/Mac checks are pending. No hosted table, real credentials, note data or app Cloud activation is involved. Reproduce with `pnpm test:dynamodb`; the same command runs in Linux CI.

## Consistency and remaining gates

All supported mutations update META monotonically in the same transaction. Capturing unchanged metadata around strongly consistent bound queries detects completed interleaving writes; it is not a claim that Query becomes a transactional snapshot. The existing bootstrap protocol replays changes after S through captured U and applies heads monotonically. Continuous contention returns a retryable error rather than publishing guessed bounds. Per-range requests are capped at 64, and metadata capture retries eight times.

The adapter queries the base table only, not a GSI or table Scan. Key projections reduce response bodies, not managed-service read charges. DynamoDB Local differs from hosted consistency, transaction conflicts, IAM, capacity and backups. Managed-service race/cost/restore evidence, production cursor key management, account administration, scheduled cleanup, hosting, live push and app integration remain gates. No public acceptance criterion is complete solely from these local cases.
