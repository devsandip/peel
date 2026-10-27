# Reconcile an accepted write with a newer server head

## Requirements and plan

FR-04/13/14 and AC-09/12/13 require lost-response recovery without overwriting newer local text. The mutation API can return an original success receipt with a newer current head. Complete that per-note transition using the durable client; full paginated pull remains separate.

1. Require an authenticated response whose receipt matches the exact current in-flight operation, collection and mode generation. Its accepted revision must be the operation's base plus one, and the returned head must be strictly newer. A permanent purge cannot later advance to another head under that identity.
2. If no later pending local action exists, atomically retire the accepted operation and adopt the current remote snapshot or permanent tombstone. The old local operation is known accepted; it is not an unresolved offline branch.
3. If a later local action exists, atomically retire the accepted operation and preserve the latest local text as a conflict against the current head. Retain the previous acknowledged base rather than inventing a historical server snapshot that the body-free receipt does not contain.
4. Compare-and-swap the generation and retry against a competing local save. Reject stale/foreign receipts, failed commits and repeated replies without replacing saved work. Verify clean/pending/purged heads, restart, rollback and a concurrent save on SQLite and IndexedDB, then exercise the HTTP client flow.

## Limits

This is authenticated per-note response reconciliation. It does not implement bootstrap, paginated changes, a collection cursor, push gaps, production authentication or app integration. Conflicts whose server head is missing still require a complete resnapshot decision. No real notes or AWS resources are used.

## Evidence

The pure `reconcileAcceptedCloudHead` transition and durable `acceptedHead` method now enforce the exact accepted operation/base and atomically handle a newer authenticated head. A clean client adopts it; a later local action becomes a conflict while its previous base remains intact. The portable response adapter routes this case without inventing the unavailable historical snapshot. A purported permanent-purge success cannot advance to content under the same identity.

The [synthetic report](../experiments/cloud-head-reconciliation-2026-10-27.json) records four shared scenarios passing on actual SQLite and Chrome IndexedDB: clean adoption/reopen/stale reply, failed commit and preserved later draft, a concurrent save changing clean adoption into conflict, and remote purge with or without a newer unsynced branch. Wrong hashes/revisions and impossible post-purge advancement reject. Chrome page reload retains both clean adoption and its local/remote conflict branches. The loopback HTTP client flow now adopts the newer head after recovering the original success receipt.

TypeScript, formatting and all 103 shared top-level cases pass. The existing eight store scenarios and four local SQLite process-kill boundaries also pass after this change. This does not establish paginated pull/cursor completeness, live push, production authentication, native Rust, Safari/iPhone, app UI or public acceptance. Unsynced text kept against a remote purge can only be copied/recovered as a new identity; physical erasure and full deletion policy remain separate gates.
