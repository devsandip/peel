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
