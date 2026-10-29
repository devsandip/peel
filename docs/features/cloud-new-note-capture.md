# New Cloud notes begin as pending drafts

[Issue160](https://github.com/devsandip/peel/issues/160) adds fresh-note capture to the disabled [Cloud draft session](cloud-draft-retention.md) and existing [editor](cloud-note-editor.md). This plan precedes code. It implements [SPEC](../SPEC.md) FR-01/02/08/11/13/14 and AC-02/08/12/13/20 prerequisites under the [v0.8 contract](two-tier-cloud-first.md); default Cloud remains unavailable.

## Scope and decisions

Add synchronous `CloudDraftSession.capture(store, scope)` with a generated client UUID, current UTC metadata and an empty active draft. Validate and capture the supplied account/library/mode scope. Expose the note ID as a frozen snapshot scalar so the owner can reopen the retained note. Do not open a default database, wait for storage/auth/network, allocate an operation or grant Cloud access. The caller owns storage and authenticated composition.

An untouched capture has nothing to retain. Refresh/flush/Put away perform no store read or write and never manufacture an empty row. The first actual edit immediately enters the existing retention drain, inserting only against an absent row. Editing then clearing the body still retains the touched note. Concurrent typing, close locks, failure/copy/retry and exact attempted-write reconciliation reuse the existing session mechanics. A collision or competing generation must preserve the other row and this session's copyable draft. A missing previously retained row remains an error, not permission to recreate it.

No local write or dismissal means Saved in Cloud. New drafts remain Pending upload until an actual matching server response reaches their original scoped client; newer typing remains pending after an older receipt. Existing cached-note open behavior, protocol/store/schema/dependencies, Local/native/default routes, authentication/entitlement and transport are unchanged. No new-note toolbar or second titlebar control is added.

## Verification and boundaries

Use fresh synthetic SQLite client/server stores to cover distinct UUIDs/immutable scope, no I/O for untouched close, first edit/actual reopen, touched-empty retention, held first write/newer typing/Put away, failed and lost first-write replies, collision/competing generation and missing retained rows. Exercise actual service receipts and newer typing; no fixture acknowledgement is provider evidence.

Extend only the existing explicit M0 IndexedDB/React/CodeMirror fixture with fresh capture/reopen controls. Verify empty Put away, typed pending reload and first-retention recovery while preserving legacy browser assertions/defaults. Use test-stubbed clipboard only; close/delete owned namespaces. No actual/default note/operator DB, native app, provider/account/credentials or stopped probe is used.

As a negative control, permit an initial capture to adopt an existing row rather than require absence. Its collision regression must fail because it overwrites the pre-existing draft. Restore/hash exact source before positive focused actual Node24, sequential Cloud/shared suites, browser/type/format/build checks. Review capture/insert/async/privacy and scope; verify no-reply author AND committer, staged/range scans, all3 exact-source gates, normal integration and actual main/closure/Project proof. Keep ignored immutable resumes current.

Append prior159 integration proof6494678079, source40858493017/main40859641351 all3 PASS and owned cleanup to WORKLOG/new immutable journal/INDEX. Preserve the original157 failed attempt and unobserved exact schedule; no prior passing rerun erases it.

This is a disabled local-pending capture prerequisite, not enabled Cloud login/activation, authenticated parent loading, upload/reconnect, complete web inventory/live, actual Mac/iPhone or M2.2 managed/independent teardown acceptance. Stopped31/51/72 and expired allowances remain unchanged. No milestone exit is claimed.

## Validation evidence

Seven new actual SQLite/service cases pass: synchronous distinct IDs/no I/O for untouched captures, held first retention/newer typing/close/reopen and actual service receipts, touched-empty retention, failed/lost first insert replies, collision and competing insertion, scope capture/foreign refusal, and refusal to recreate a previously retained missing row. Actual Node24 focused25/4 and the exact existing Cloud consumer list428/34 pass, followed sequentially by shared643/72 under unchanged defaults.

Three new real IndexedDB/React/CodeMirror flows pass with all34 earlier browser cases (37 total): untouched dismissal without a row, immediate typed dismissal/actual reload as pending, and failed first retention with Retry/test-stubbed Copy. The initial focused browser run had9 passes/1 failure because the new empty-DOM matcher counted CodeMirror's existing placeholder widget. Inspection of that implementation led to a visible-placeholder plus empty-source assertion; only this new assertion changed. The failure remains recorded. No positive backend test failed, and all legacy unit/browser assertion tails remain byte-identical.

The negative adoption control lets a colliding capture resolve instead of refusing, failing the intended refusal assertion (1 failed/16 skipped). Exact session SHA256 `d0b1e902f9a77006959e2bdfda84607b3f5adefd262bc20686a2bbeae8662c24` was restored before the full positive suites. Type/full checked-source formatting/whitespace/build pass. Default bundle hashes and580kB warning are unchanged. Protocol/store/schema/workflow/dependencies/native/default app/editor bytes are unchanged. All owned test stores/namespaces/browser/server resources are closed or removed; no actual OS clipboard/default DB/provider/native action occurs. Exact-source hosted review/gates and normal integration/main proof still follow.

## Previous integration proof

[PR159](https://github.com/devsandip/peel/pull/159) merged source6682a482d6dca6d680b0a5d03da3ac62257c10f9 after all3 source40858493017 gates, focused review6494369816 and ready6494501409 as98eb188409cd322788119595d1669e432badeac6. All3 separate actual-main40859641351 jobs passed; [proof6494678079](https://github.com/devsandip/peel/pull/159#issuecomment-6494678079) records source/main first attempts and no159 rerun. Actual158closure/ProjectDone/label removal, guarded primary advancement/unknown path preservation and only owned159 ref cleanup were verified before starting160. The original157 main attempt1 failure remains failed historical evidence with an unobserved exact schedule, not erased by later passes or assigned a retrospective trace. No production guard policy or app acceptance changed.
