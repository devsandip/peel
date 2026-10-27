# Cloud client conflict and rebase contract

## Requirements and plan

FR-03/04/13/18/20 and AC-04/09/11/12/13/23/24 require durable local edits, conditional cloud mutations, and explicit offline conflicts. AWS login and paid terms are not available for deployment. Build an isolated client-state contract only, without an API, DynamoDB table, account token, entitlement flag or app import.

1. Define a strict, versioned Cloud wire snapshot that excludes device-local revision and geometry. Keep the owner out of the request body; production owner will come from verified auth. Validate collection/note IDs, state, dates and the 256 KiB body limit before preparing a mutation.
2. Treat a local edit as the newest pending whole-note snapshot. Starting an operation freezes its opId, base revision, kind, snapshot and content hash. More local edits retain the same acknowledged base until the in-flight operation is acknowledged. Retry returns the identical immutable operation.
3. On a matching acknowledgement, advance the base and rebase a later pending draft without changing its text. A 409 keeps the latest local branch and the remote version, marks Conflict and blocks automatic sends. Explicit resolution creates a fresh operation from the latest remote revision; another 409 preserves the chosen merged text.
4. Model purge as a distinct conditional action. Reject wrong acknowledgement identity/hash, changed note/collection, unsupported schema and invalid revision. Do not use device time to choose an offline winner.
5. Verify synthetic interrupted/reordered flows and source preservation. Keep the production local transaction boundary, server conditional transaction, account isolation, pagination, push, billing and mode transitions open in the feature evidence.

## Decisions and limits

This package is a pure M0 client reducer. It never reports Synced because a network request was sent; only an acknowledged operation can clear Waiting. It has no storage or authentication and cannot activate paid Cloud. The caller must atomically persist each state transition with local note edits and compare the source generation across asynchronous hash preparation. The server must independently recompute the hash and enforce owner/revision/idempotency in DynamoDB.

## Evidence

`packages/cloud-protocol/src/index.ts` now has a strict wire draft, fixed-field operation hash, and a pure client state reducer. The reducer freezes an in-flight operation and retains a later local draft; acknowledgement advances the base without changing that later text. A 409 preserves both local and remote branches and blocks automatic sends. A chosen merge starts a new operation from the latest remote revision, and another 409 retains that merge. A remote permanent purge cannot be resolved by reusing the old note ID. Only a matching acknowledgement can clear Waiting. These are in-memory transitions with explicit generations, not durable app commits.

Five focused unit cases cover in-flight retry after JSON restart, later-edit rebase, repeated conflicts, editing a conflict branch, explicit remote acceptance, purge/tombstone behavior, wrong acknowledgements, strict fields, invalid revisions, foreign note IDs, the 256 KiB body bound and hash tampering. The [cross-runtime synthetic report](../experiments/cloud-client-2026-10-27.json) uses the same compiled fixture in Node and Chrome. Its operation hash and state-transition result match exactly. Browser requests stay on the loopback fixture origin; no application database or real note is opened. Full shared-suite count is recorded in the report after final verification.

The [isolated server service](cloud-server-mutations.md) now verifies conditional writes, hashes, body-free retry receipts, retention and tombstones on SQLite, with an injected authentication resolver. Verified production auth, DynamoDB transactions and paginated delivery remain open. The [isolated local repository](cloud-local-durability.md) verifies generation-checked transactions on SQLite and IndexedDB; application storage adoption, push/cursor reconciliation, authenticated account isolation, Cloud entitlement, mode transitions and UI remain open. Queued permanent deletion rejects later upserts under the old identity. No AWS resource, billing setting or running app was changed.
