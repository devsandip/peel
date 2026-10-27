# Paginated Cloud bootstrap and atomic local pull

## Requirements and plan

FR-04/13/14/20 and AC-04/09/10/12/13/23/24 require complete paginated download, durable cursors and preservation of local drafts. Build the service and local transaction contract against the isolated SQLite/IndexedDB stores before app or AWS integration.

1. Bootstrap captures server sequence S and bounded note/tombstone key ranges. Enumerate current heads in key order, then replay changes after S through a captured upper sequence U. Later rounds start from the completed checkpoint and use a stable U. Limit both item count and response bytes; never skip an unreturned record when a byte limit ends a page.
2. Sign purpose-specific cursors with an injected nonextractable HMAC key. Bind account/library/mode, round, phase, bounds, progress and expiry. Check current account/entitlement after asynchronous work. Reject tampering, foreign scope, wrong route, expiry and clock rollback. Missing or logically expired change sequences require a new snapshot even if physical TTL cleanup has not run.
3. Add local protocol/adapter version 2 before storing pull metadata. Upgrade only recognized M0 version-1 stores and preserve their drafts. Old adapters must refuse version 2. Capture current note state and pull progress together, then commit all changed notes and the next cursor atomically with generation checks.
4. Preserve monotonic remote revisions. Clean notes adopt a newer head; unsent local drafts become conflicts. An immutable in-flight operation retains a durable observed remote head until its receipt/conflict settles, then reconciles that head without losing later local text. No note becomes Synced just because a collection cursor advanced.
5. Verify byte/item pagination, empty pages, duplicate/reordered pages, interrupted bootstrap, concurrent server edits/deletes, local-save races, failed page commits, scope isolation, expired history and migrations on actual SQLite and Chrome IndexedDB. Exercise a full loopback HTTP bootstrap/change round with durable clients. Record exact limits and remaining gates.

## Decisions and limits

M0 page bounds are 32 records and a 512 KiB aggregate head budget, with a 640 KiB wire limit; page tokens last 15 minutes and completed checkpoints last 90 days. These are provisional operational limits, not performance acceptance. Opaque signed tokens contain no bodies or credentials. A physical history gap or expired needed change rejects rather than advancing a cursor.

Bootstrap preserves local-only notes and unresolved drafts. A local store can resume a change round only from its own completed sequence, including restarting an interrupted round from its retained checkpoint; a new store must bootstrap first. It does not silently erase a previously known local note absent from a damaged/restored server snapshot; restore/absence policy remains an explicit production gate. Synthetic identity/entitlement records and SQLite pagination are not Cognito/DynamoDB acceptance. No public beta, app integration, AWS provisioning or real note data is included.

## Evidence

The [synthetic report](../experiments/cloud-paginated-pull-2026-10-27.json) records the final passing run. TypeScript, formatting and all 111 shared cases across 22 files pass. Six server-pull cases cover concurrent creation before/after captured key bounds, edits/purges during bootstrap, writes after stable U, byte-limited pages, empty phases, signed foreign/tampered/wrong-purpose/expired/rotated-key cursors, policy revocation during real asynchronous signing, missing physical history and logically expired rows still present. The loopback HTTP flow bootstraps its second durable client and later catches both clients up using their own checkpoints.

Four shared pull scenario groups pass on actual Node SQLite and Chrome IndexedDB: atomic multi-note page/cursor failure and reopen, duplicate/stale rejection and checkpoint ownership; unsent/in-flight source preservation including deferred purge and 409 settlement; a concurrent local save winning the page's first CAS; and monotonic revision/content integrity with whole-page rejection. Browser reload retains the next page, downloaded source and deferred remote head. Recognized version-1 SQLite/IndexedDB stores preserve source on failed upgrade and successfully upgrade to version 2; opening the upgraded browser database with the old version refuses.

Six actual local SQLite SIGKILL boundaries pass, including two new page/checkpoint boundaries. Killing an open terminal-page transaction retains the old cursor and draft with neither downloaded note nor conflict partly committed; killing after commit retains both note states and the completed checkpoint. The three existing server SQLite process boundaries pass again. The first browser experiment exposed two unhandled rejections on intentional migration aborts; handling the upgrade transaction's rejection fixed them, and the final run reports zero page errors or external/unexpected requests. Hosted workflow steps now include both Cloud experiments; hosted execution remains unverified under the previously observed account restriction.

Reproduce with `pnpm check`, `pnpm test`, `node scripts/experiment-cloud-durability.mjs` and `node scripts/experiment-cloud-server-crash.mjs`. The experiment uses fresh synthetic stores and deletes them after the run. It does not measure app performance or physical power-loss behavior.

## Remaining gates

The DynamoDB adapter still needs consistent account/scan bounds, real Query continuation and transaction/cost evidence. Production cursor key management, Cognito/session authorization, mode migration and native Rust/store integration are open. So are live push/reconnect scheduling, restored-server absence policy, immediate local deletion of retained bodies/derived data and app conflict/recovery UI. No listed public acceptance criterion is complete solely from this isolated evidence.
