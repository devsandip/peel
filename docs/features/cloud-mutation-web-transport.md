# Bounded web Cloud mutation sender

[Issue171](https://github.com/devsandip/peel/issues/171) follows fully verified PR170 (source40895731617, actual-main40896979983, all three first attempts; proof6500447037). This requirement-linked plan precedes code. SPEC FR-02/04/05/08/13/14 and AC-02/04/09/12/13 prerequisites and the existing [upload](cloud-note-upload.md), [download transport](cloud-download-web-transport.md) and [web sessions](cloud-web-sessions.md) plans control this slice.

## One delivery purpose

Provide createCloudMutationWebSender with the existing CloudMutationSender signature. It captures trusted canonical origin/issued CSRF and sends only POST /v1/mutations. Validate exact envelope, positive scope identifiers, matching snapshot collection and actual verifyMutationHash before I/O. Clone before asynchronous validation so later typing/caller mutation cannot retarget an immutable operation. The authenticated parent still owns session issuance/identity/entitlement/account lifetime; a token-shaped string is not a grant.

Extract only the existing bounded JSON request/configuration/reader/deadline machinery into an internal browser helper shared with the download wrapper. Keep createCloudDownloadWebSender/CLOUD_DOWNLOAD_DEADLINE_MS API, synchronous download dispatch semantics, request policy and all39 existing tests unchanged. Do not duplicate cancellation/security logic or perform unrelated cleanup. Use the existing2MiB request limit and640KiB response bound (a service-validated head is at most400KiB plus a bounded receipt), fixed10s through asynchronous preparation/headers/body, same-origin mode/credentials, no-store/no-referrer/redirect refusal, generic errors, no retries and bounded abort-handler/reader/timer cleanup.

## Evidence before integration

Verify outgoing scope/schema/hash/body refusal, captured inputs, preserved operation ID/hash, account abort during asynchronous preflight and bounded/auth failure behavior. Reuse all existing transport cases to protect the extracted download path. An explicit fresh M0 IndexedDB browser fixture and owned real HTTP/SQLite service behind the same clearly synthetic origin proxy prove held-ACK/newer-typing isolation, real401/no automatic retry/explicit recovery and lost successful response/reload/identical durable retry. It is a transport/service composition, not Antigravity's UI workspace or real login/provider/hosting.

Run relevant actual Node24 Cloud list then shared sequentially, full browser, type/full format/whitespace/build and default-bundle equality. Record failures distinctly. Stage explicit owned files, scan staged/ranges and verify no-reply author AND committer; exact-head focused review and all required hosted gates precede normal merge, separate actual-main/closure/Project proof and only root-owned cleanup. Append170 final proof/owned cleanup into WORKLOG/new immutable journal/INDEX; preserve frozen2020.

## Boundaries

No existing note upload/draft/editor/library contract, protocol/schema/reducer/write path/default application route/dependency or legacy assertion/default/worker/timeout/retry/isolation change. Antigravity169 owns its workspace paths and active checkout; continue communicating there without editing its files. Default Cloud remains unavailable. Actual authentication/paid activation/whole-library consent/full web/live/reconnect/native/iPhone/performance and M2.2 managed/independent teardown remain unmet. No actual/default user/operator database/profile/native launch/provider/credentials, expired allowance, stopped probe, provisioning, production/public beta/billing or further delegation.

## Interim local evidence (before peer review)

Focused57/2 (18new mutation cases and39 unchanged download cases), three actual browser/HTTP/SQLite flows, type/full checked-source format/whitespace/build pass. Static build hashes remain equal to the previous default bundle. First full Node24 run failed4 existing cases with538/542 passing: three5000ms timeouts in journal-sources/preparation-session/run-context-storage and one offline SDK child (existing4000ms SIGKILL bound) returning null exit code. Those test files and all timeout/worker/retry/isolation controls are unchanged. Host load was high on ten logical CPUs; contention is an inference, not a proven cause. The stopped pipeline did not run shared/full-browser stages. Initial failures remain in issue171-final-cloud-node24.log.

Codex requested a separate test window in issue169 comment6501339422 without stopping any peer/unrelated process or weakening defaults. Local controlled follow-up and exact-head hosted gates remain required. Root work is checkpointed locally so the already-open peer PR172 can be reviewed first; this checkpoint is not Ready or a claim that the failed suite passed.

## Coordinated local validation and focused review

After the peer explicitly released its test window, one unchanged sequential run passed Node24 Cloud542/39, shared757/77, all54 browser cases, type/full checked-source format/whitespace/build and default-bundle hash equality. Original maxWorkers4/timeouts/retries/isolation remain. Both initial four failures and the stopped pipeline's unrun stages remain distinct evidence; this success does not prove their cause. Issue169 comments6502084667/6502201974 claim/release the coordinated window. Logs issue171-coordinated-*.log and issue171-final-validation.json retain actual results on checkpoint c299a27.

Focused review covered cloned input before asynchronous hash work, abort before fetch, whole-operation timer/body cleanup, strict request scope/hash/size and preserved download dispatch behavior. Existing download39 cases are unchanged. Real browser service flows confirm current-generation Saved,401 pause and identical durable retry after lost acknowledgement. No source changes followed that validation; remaining edits record evidence only. Exact public source/hosted gates and normal integration with separate main proof still follow.

Separately, peer PR172's frozen c5 head passed its hosted checks but two controlled review cases exposed duplicate parent Put-away notification and duplicate-title wrong-note focus. Review5701065953 and issue169 revision6502084667 request owned-file fixes/new Ready head. This PR does not change or integrate the peer workspace.
