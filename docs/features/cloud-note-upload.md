# Connect editing to server confirmation

[Issue162](https://github.com/devsandip/peel/issues/162) connects the existing [capture/session](cloud-new-note-capture.md) and [editor](cloud-note-editor.md) to an actual mutation sender. This plan precedes code. [SPEC](../SPEC.md) FR-02/04/08/11/13/14 and AC-02/04/09/12/13/20 remain the contract. Sandip's latest feedback prioritizes a working save-and-read path over further isolated components or documentation chores.

## One working slice

Add a scoped upload owner that constructs its own draft session and durable client from the same captured scope/store. Accept an explicitly authenticated sender and an account-context AbortSignal; neither cache scope nor a client flag grants authentication/entitlement. Retain before preparing, reuse immutable in-flight requests after lost responses, validate status/receipt/scope before dispatch, and refresh the original session only from the durable result. Older receipts cannot save newer typing. Coalesce requested uploads while one is active, and stop automatic draining on authentication/network/conflict/local failure. No automatic failed-request retry or account retargeting.

Cancellation prevents queued sends and late responses from starting acknowledgement writes. Guard local client commits too, so an abort during an acknowledgement read cannot start a subsequent commit. An already-started local transaction may finish in its original scoped store; it cannot be recalled or redirected. Caller owns storage and authenticated context lifetime.

Wire this owner to the existing Markdown editor. Retention triggers upload; mount resumes a retained pending/in-flight operation. Put away still waits only for local retention and initiates upload without awaiting the network. Generic upload recovery may offer Retry; keep one normal titlebar control, original session/undo/dismissal guards and truthful Pending/Saved status. No default app activation, login shortcut or Local/native change.

## Evidence and limits

Use focused actual Node24 SQLite/service tests for commit-before-Saved, newer typing, immutable retry after a lost successful response/reopen, real 401/conflict responses, scope/cancellation and abort during a held acknowledgement read. Extend the actual browser editor path with an owned loopback HTTP server backed by fresh SQLite and the real mutation handler. Synthetic authentication is confined to test fixtures. Verify typed text becomes confirmed only after server acknowledgement; a separate client reads that committed copy while newer unconfirmed text stays local. Verify failure/retry and close without waiting for a held network response. New Cloud IndexedDB names are explicit M0; no real/default user/operator DB, native app, provider/account or OS clipboard.

Run focused runtime/browser/type/format/build checks; hosted gates cover the complete prescribed suites. Review scope/lifecycle/authenticated dispatch, scan/verify no-reply author AND committer before every push, require all exact-source gates and normal integration/main/tracking proof. Preserve prior161 finalproof6495297819 in WORKLOG/new immutable journal/INDEX. Reuse already-loaded unchanged instruction/canonical context rather than repeatedly reading it.

This is a runnable synthetic save-to-server/read-back integration, not Cognito login, enabled paid Cloud, complete web inventory/live delivery, native/iPhone or M2.2 managed/teardown acceptance. No expired allowance or stopped31/51/72 probe is revived. The old hosting plan's v0.7 sentence is historical; canonical v0.8 controls this slice, and this work performs no deployment or cost observation.
