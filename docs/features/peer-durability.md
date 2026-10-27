# Durable peer state experiment

## Requirements and boundary

FR-02/13/14/17/19 and AC-02/09/10/12/21/25. Build an isolated M0 store before connecting [the peer reducer](peer-sync-protocol.md) or [session proofs](peer-authentication.md) to the application. No production database migration, pairing, network transfer or app sync is authorized by a successful store experiment alone.

## Plan

1. Store the device clock, immutable winning edit, per-edit digest, local recovery versions, permanent deletion marker, locally projected note revision and pending delivery reference in one atomic compare-and-swap commit. Keep records separate; do not rewrite the whole library as one JSON snapshot.
2. Translate received revisions into the receiving device's own monotonically increasing note revision. Preserve the signed/hashed input snapshot unchanged. Compare local expected revisions inside the same serialized transition.
3. Coalesce pending delivery to the current head or purge marker, retain a target list on the device, and reject an old acknowledgement that would clear a newer generation. This is a store contract, not a transport acknowledgement implementation.
4. Persist consumed local session challenges with a session claim in one transaction, after a future caller verifies the proof and current trust. A stored claim never reactivates a connection on restart. Reject reused challenges across new store/engine instances. Keep this boundary explicit; it does not replace cryptographic verification or active-channel revocation.
5. Exercise real SQLite and IndexedDB transactions with synthetic fixtures: failed commit, reopen/reload, simultaneous writers, duplicate delivery, revision translation, seven-day cleanup, purge and old acknowledgements. Return an edit acknowledgement only after commit. No acknowledgement on quarantine or failure.

## Isolation and limits

Use an explicitly selected fresh SQLite path or a browser database name beginning `peel-m0-peer-`. Refuse the existing app schema and default database name. The SQLite experiment uses Node's SQLite binding, not the native Rust repository; native integration and a tested migration remain separate gates. Browser experiments use a temporary isolated profile. No real notes, accounts or keys are read.

The adapter assumes an already authenticated and author-verified input boundary. The lower-level durable session claim helper assumes a verified, locally reconstructed transcript and current pairing registry. The scoped current-trust follow-up below coordinates that registry with commits; production pairing/migration remains open. A successful claim is not permission to open a channel without rechecking expiry and current trust. Session challenges are retained without pruning for this experiment, with a fail-closed 4,096-claim capacity limit and a monotonic wall-time floor. Production cleanup, authenticated clock repair, bounded history/seen growth, a per-peer anti-entropy inventory and wire validation remain gates. A pending delivery reference is local-only and never a server queue.

The legacy local stamped-write helper can refuse a clock that needs repair. It is not the app capture path. The [clock-independent draft follow-up](peer-local-drafts.md) now adds saveDraft/publishDraft with local commit before stamping, projection protection and generation/revision checks. Logical identity version 2 prevents older experiment engines from overwriting this state; the generic table layout remains version 1. Production clock calibration/repair, app migration and publication policy remain gates. Note-scoped history/seen records are read for each transition; sustained write cost and storage growth have not been measured or accepted.

## Evidence

The [inventory follow-up](peer-inventory.md) now adds logical identity version 4 with explicit 1/2/3 upgrades, separate head/delivery generations and bounded metadata scans. Eleven inventory scenarios and eleven current-trust scenarios pass on both adapters, with 75 shared cases and the existing crash/reload contracts. Production repositories remain unchanged. Earlier version/count observations below are historical.

The [current-trust follow-up](peer-current-trust.md) adds logical identity version 3, confirmed public keys/generations, opaque active handles and commit-time trust checks. Ten shared authorization scenarios pass on both adapters alongside the eleven original store scenarios and four SQLite crash boundaries. The native app repository remains unchanged; this is isolated protocol evidence.

Current follow-up evidence extends the original seven scenarios below to eleven on both adapters, adds two more SIGKILL boundaries (four total), verifies pending-draft reload and brings the shared suite to 59 cases. [peer-local-drafts.md](peer-local-drafts.md) records those cases and their separate synthetic report. The original dated report remains unchanged. No native/app integration or full acceptance is claimed.

The original shared seven-scenario contract passed on Node 26.4 / SQLite 3.53.2 and Chrome 155 IndexedDB: atomic note/clock/history/projection/pending persistence across reopen; injected edit/purge rollback without acknowledgement; simultaneous writers and conditional local revisions; old delivery acknowledgements versus new edits/purges; seven-day history expiry and permanent tombstones; quarantine/library/author/edit-identity boundaries; and consumed session challenges/claims across restart, commit failure and concurrent replay. A receiving device maps remote revision 900 to its own revision 2 while preserving the immutable input snapshot.

The original two subprocess SIGKILL checks passed on SQLite: a kill after the acknowledged commit preserves the note/head/pending generation, and a kill after replacement writes inside an uncommitted transaction restores the previous complete state. Browser page reload preserves the committed projection. The isolated experiment observes no page errors and opens zero application databases. Raw synthetic metadata is in [the report](../experiments/peer-durability-2026-10-26.json).

At that initial stage the shared unit suite had 58 passing cases, including the SQLite contract and rejection of a synthetic existing app schema, future M0 schema and default browser database name. Acknowledgements match both operation kind and generation; the contracts reject an edit acknowledgement for a same-ID purge. The seven-scenario browser contract and SQLite crash subprocesses also run in CI. [Bound channel composition](peer-wire-session.md) separately checks commit acknowledgements on a same-page host channel. No native Rust crash, Safari/iPhone, trust-registry transaction, cross-network acknowledgement or full acceptance criterion is claimed. The earlier seven production-app browser flows cover the unchanged app, not this isolated adapter.

## Reproduce

```bash
pnpm check
pnpm test
node scripts/experiment-peer-durability.mjs
```

The script builds its isolated fixture modules, creates fresh temporary SQLite paths and a temporary browser profile, and writes boolean/environment metadata under ignored scratch/. It supports PEEL_BROWSER_PATH and otherwise uses installed Chrome on Mac or Playwright Chromium on Linux. It never reads existing app notes or credentials.
