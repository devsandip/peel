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

## Demonstrated boundary and compatibility feedback

Before runtime changes, actual owned SQLite/service controls reproduce the two-owner composition failure:16 existing cases pass and the new reopened-view case receives paused instead of idle after the earlier owner consumes the held ACK first (issue176-competing-owner-red.log). Its duplicate requests carry the same durable operation. The counterexample source is retained in ignored scratch; permanent positive tests will exercise the explicit same-owner API rather than require changing the static factory into a global registry.

Peer compatibility feedback6504276630 confirms the workspace needs no edits. Account for direct uploading-editor callers that keep a component mounted across same-owner/session replacement: track the session identity as well as upload identity so editing/undo state mounts fresh. Keep the established explicit Put-away flush behavior separate from incidental mount pause preservation; no additional close-time policy change is intended.

## Renderer review refinement

Initial49 focused cases,7 upload browser cases and a full sequential558/39 Cloud,773/77 shared,66 browser/static/build/default-bundle run pass. Those full logs are preserved as issue176-before-selector-review-*. A stronger actual still-mounted browser case then fails: after reopening and editing, an unrelated parent render disconnects the current editor, resetting its current undo state. The candidate outer session selector had not observed the inner owner's notifications, so its stale session reference caused a second, late remount (issue176-selector-review-red.log).

Keep the outer selector keyed only by owner, as before. The existing CloudNoteEditor already owns session identity and history reset; the inner upload effect follows the current session and owner notifications, with an after-subscribe session check for a missed render/effect gap. This avoids duplicated session selection state. The strengthened case now requires both a fresh editor on reopen and an unchanged current editor/history across later parent render. Repeat final relevant validation for this material renderer correction; do not replace the earlier evidence or weaken any old assertion.

## Final local validation

After the renderer correction, final49 focused model cases, sequential Node24 Cloud558/39 then shared773/77, all66 browser cases, type/full checked-source format/whitespace/build and unchanged default-bundle hashes pass. Source/runtime is unchanged after this full run; later edits record evidence only. The earlier full positives and both actual red controls remain separately retained. The stronger still-mounted case checks the old editor disconnects on reopen, the current editor survives an unrelated parent render, and Undo automatically retains/uploads the intended current-session text. Peer workspace files and all original assertions/defaults remain unchanged.

The coordinated window6504621636/review extension6504810725 is released after final validation. Exact public-source review/all3 hosted gates/normal integration/separate actual-main proof still follow; no real authentication/activation/provider or whole-product acceptance is implied.
