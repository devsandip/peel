# DynamoDB paginated Cloud download

## Requirements and PR boundary

FR-04/13/14/20 and AC-04/09/10/12/13/23 require complete current-state bootstrap and ordered catch-up without dropping local work. This PR adds DynamoDB Query support to the existing signed pull service, building on the conditional mutation adapter. It does not add hosted infrastructure, live push or application activation.

## Plan before implementation

1. Capture META and the maximum NOTE/TOMB IDs using strongly consistent key queries. Bracket the bound queries with metadata reads and accept only identical metadata, since all supported mutations advance META atomically. Retry a bounded number of times on contention; do not invent a snapshot from inconsistent bounds.
2. Query only the authenticated owner's partition, with bounded sort-key ranges and no table Scan. Project note/tombstone keys during enumeration. Follow LastEvaluatedKey, including short/empty pages, until the requested limit plus one lookahead is collected or the query ends. Never advance a public cursor past an unreturned key.
3. Decode and validate ordered CHANGE records with their key/sequence/expiry fields. Preserve the existing service's logical-expiry and gap rejection. Recheck account policy after asynchronous queries. Bound per-call requests and reject non-progressing continuations rather than looping forever.
4. Verify actual DynamoDB Local pagination beyond the engine's 1 MiB pre-projection limit, stable bootstrap during edits/creation/purge, stable change upper bounds, interrupted signed continuation, owner isolation, history expiry/gaps and revocation during a query. Use the same isolated runtime and disposable tables as the mutation suite.
5. Run TypeScript, formatting, shared tests, full DynamoDB suite and production web build. Keep this separate from the mutation PR; merge only after its dependency and focused validation pass.

## Sources and limits

AWS documents [Query pagination](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html) and [read consistency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html). DynamoDB Local does not establish hosted account/authentication, IAM, capacity, cost, backup/restore or network acceptance. Existing signed cursor/pull semantics remain in SPEC and cloud-paginated-pull.md; this adds a storage adapter, not a new public conflict or retention policy.

## Evidence

Work in progress, not ready to merge. TypeScript passes. The combined actual DynamoDB Local suite passes 14 of 15 cases: all nine mutation cases and five new pull cases. One large-library pagination case fails because the six 200,000-byte synthetic notes do not produce an engine LastEvaluatedKey, both with the ordinary projected request and with projection removed at the test transport. The initial assumption that projection alone explained the result is unsupported. Do not count the 1 MiB gate as passed or weaken its assertion.

The five passing pull cases exercise durable SQLite application of bootstrap pages during creation/edit/purge and a later resumed round; metadata-bound retry and bounded continuous contention; foreign/tampered cursor rejection and mid-query paid-policy revocation; missing change/expired checkpoint rejection; and injected empty/non-progressing SDK continuation behavior. This is partial local evidence, not hosted DynamoDB acceptance.

The byte-limit experiment was stopped after two attempted approaches in accordance with the Developer-folder instruction. Investigate Local's precise Query limit behavior or choose an isolated managed-service test only after IaC/account/region/cost gates. The failing branch remains local and unmerged. Do not publish or merge it as verified. No hosted table, actual credentials or user notes were used.
