# Reopen a retained Cloud upload owner

[Issue176](https://github.com/devsandip/peel/issues/176) follows verified PR172 (source40921131306/main40923169809 all3 first attempts, proof6504154806) and PR175 (proof6503676649). This plan precedes code. SPEC FR-02/04/05/14 and AC-02/04/13 prerequisites, [upload](cloud-note-upload.md), [draft retention](cloud-draft-session.md) and [workspace](cloud-workspace.md) control this slice.

## One delivery purpose

The authenticated parent retains upload owners after views close. A locally closed draft session cannot edit again; constructing another upload owner while an old acknowledgement is held can produce competing applications of the same durable operation. Demonstrate that existing composition with actual owned SQLite/service controls before changing runtime. Preserve the diagnostic outcome separately.

Add an explicit instance reopen() that returns the same CloudNoteUpload owner after reading a fresh editable draft session from its original captured store/scope/signal. Keep session read-only to callers (a getter may replace the constructor property). Coalesce concurrent reopen attempts, require the previous local session to be closed, and check cancellation before/after asynchronous storage reads. No network wait/send or storage lifetime ownership is added. Failed/aborted reads leave the original closed session intact; an untouched empty capture cannot create a row. The parent calls reopen only after its prior view/Put-away callback is settled; no workspace callback shape changes.

Keep existing upload pause/immutable operation state while replacing only the closed editing session. Incidental initial editor mounting must not automatically retry an already failed/auth-paused/conflicted owner; the existing explicit Retry remains available. Preserve established Put-away/retention behavior and all existing assertions/defaults. New automatic edits retain immediately and keep fixed200ms upload batching; Saved still requires matching latest server confirmation.

## Evidence before integration

Use actual SQLite/service cases for held old ACK/reopen/newer typing/single owner and immutable operation, concurrent reopen, original scope/cancellation/read failure, untouched empty capture and paused status. Fresh explicit M0 IndexedDB/browser HTTP cases should close/reopen while the old reply is held, avoid duplicate requests, preserve Pending for newer text and confirm the final source independently; paused remount must keep its message/request count until explicit recovery. No blind database name/key lookup.

Run focused relevant suites, sequential original Node24 Cloud then shared, browser/static/build/default bundle equality; retain all failures distinctly. Explicit owned staging/scans/no-reply author AND committer, focused exact-source review/all3 hosted gates, normal merge and separate main/closure/Project proof precede owned-only cleanup. Backfill175 proof6503676649 and172 proof6504154806 in WORKLOG/new immutable journal/INDEX; preserve frozen2233.

## Ownership and acceptance boundaries

Root posted the compatible API decision before implementation in [issue169 comment6504200320](https://github.com/devsandip/peel/issues/169#issuecomment-6504200320); handle any peer compatibility feedback there. Root owns the upload owner/existing uploading-editor/shared fixtures. No peer-owned workspace UI/CSS/plan/tests, public UI prop or callback, wire protocol/schema/dependency/default-route changes. Peer source/checkout100153 stays preserved; no new UI assignment yet.

Default Cloud remains unavailable. This is a lifecycle primitive, not authenticated parent/registry composition or real Cognito/paid activation/full web/live/reconnect/native/iPhone/performance/M2.2 managed teardown. No actual/default user/operator DB/profile/credentials/provider/native launch/stopped probe/expired allowance or unrelated-process changes. Only owned synthetic stores and explicit fixtures; no council or spawned agents.
