# Local Mac app

## Authorization and scope

On 26 October 2026 Sandip authorized implementation and autonomous work until the following morning. Start with M0 and M1, then continue the remaining milestones in SPEC order. The existing mockup gallery remains a review artifact. Do not substitute a browser simulation for native window behavior.

## Requirements and gates

FR-01, FR-02, FR-03 local, FR-05 Mac, FR-06 words, FR-07 through FR-16 local behavior. AC-01, AC-02, AC-05, AC-07, AC-08, AC-11 local transfer, AC-14 native budgets, AC-15 Mac accessibility, AC-16 disk recovery, AC-17 through AC-20. Cloud and meaning-search acceptance remain separate.

## Plan

1. Establish the pnpm TypeScript workspace and the Tauri 2 Mac feasibility shell. Verify independent decorated library and undecorated note windows, native dragging, global shortcuts, resident tray/menu, close interception, and SQLite commit.
2. Implement portable note validation, restricted Markdown/tag parsing, search ranking, lifecycle commands, layout, and export/import contracts with synthetic fixtures.
3. Add transactional SQLite persistence with WAL and FULL synchronous commits, schema checks, deletion markers, and device-local window geometry. Add the equivalent IndexedDB repository for the browser.
4. Build the note editor and Notes Library to the approved visual baseline. Save every edit locally, close only after commit, preserve failed drafts, and separate pinning from Keep on top.
5. Verify native pinning/drag-out, all four arrangements, Undo, close/quit/relaunch and display clamping. Run local recovery, parser, search, lifecycle, and transfer checks; record partial acceptance honestly.
6. Produce a runnable local app bundle and a browser development server, then continue M2 using a separate requirement-linked feature plan. Do not enable an unimplemented cloud destination.

## Decisions

- Begin with Tauri as proposed in SPEC 0.4, with a Rust-owned SQLite connection and narrow typed commands. The native process acknowledges durable saves; JavaScript does not execute arbitrary SQL.
- No telemetry, hosted AI, credentials, or note content in logs. Local mode makes no cloud calls.
- Keep editor source lossless. Formatting is a restricted rendered mode plus an always-available source editor; supported formatting actions edit the Markdown source.
- The app bundle is a development dogfood build until signing, update, accessibility and release gates are separately verified.
- Overnight continuation stops at 08:00 Asia/Kolkata on 27 October. Do not claim 14-day dogfooding or public readiness during one build session.

## Evidence

Current supplementary evidence: [native-shortcuts.md](native-shortcuts.md) and [native-login-item.md](native-login-item.md) cover device-local shortcut configuration and explicit launch-at-login controls. At the login-control batch, the rebuilt bundle was 14.85 MiB, with 28 native cases and 11 browser flows passing; four browser flows mock IPC. Actual native keyboard, picker/login and accessibility/performance gates remain open. The foundation measurements below are historical, not current performance acceptance.

[Native repository durability](native-durability.md) adds five cases, bringing the native suite to 33 passing cases plus one ignored child-fixture entry that the parent cases launch explicitly. Three actual SIGKILL boundaries, SQLite page-limit failure/retry and 100 repository reopen cycles pass. Native editor-close cycles and physical storage failures remain separate gates.

[Native peer runtime](native-peer-runtime.md) records one successful basic Tauri/WebKit capability and host-channel observation, followed by two watchdog failures with a diagnostic stall in the ephemeral CryptoKey IndexedDB phase. That runtime gate remains open. The experiment never starts the production library or replaces native SQLite saving.

The initial foundation release-mode Tauri build produced a 14.27 MiB development app on this Mac. Shared checks cover 35 cases for grammar/tags, source ZIP round trips, search/index invalidation, retention and one/three/ten/thirty-note layout. Three SQLite tests cover reopen durability, conditional revisions/tombstones, query-only write failure and future-schema rejection. Seven browser flows cover immediate Close/reload, task toggling, archive/Trash/restore, export, empty draft dismissal, source safety at a 390px viewport, failed-write Close/retry, a deliberately held final commit that freezes editing until acknowledged, paged worker search with a long note, and index failure/retry. TypeScript, production web build, formatting and Rust Clippy pass. The foundation commit also passed both GitHub CI jobs.

These are partial requirement evidence. Native drag-out/shortcuts/relaunch, injected native-close failure, full crash/performance/accessibility suites and the supported device matrix remain unverified. Startup exposes the note window immediately and shows local-load errors rather than leaving it hidden; single-note retrieval avoids loading the library on capture. Do not mark AC-01/02/17/18/19/20 fully passed from browser checks. The worker search package builds into the Mac bundle, but its native runtime check is pending because the Mac is locked. Production Chrome measurements are recorded separately in [local-search-performance.md](local-search-performance.md).

The local-only implementation is an intermediate On-device build. SPEC 0.7 requires remote periodic peer sync, latest-edit convergence and paid whole-library live Cloud; none is implemented by SQLite/IndexedDB alone. The required PRD/SPEC/mockup update completed before implementation resumed.

The browser production build now has a verified offline application-shell cache, separate from IndexedDB note storage. Eleven production Chrome checks cover offline reload/capture/search, installation failure/repair, capability status and safe waiting updates; [browser-offline-shell.md](browser-offline-shell.md) records limits. Native/dev registration is disabled. These checks do not verify native window behavior or remote sync.

Native startup and Settings now use the verified local-folder manager with reconnect/retry and an all-window save barrier. Sixteen Rust checks and two additional mocked native-bridge browser flows pass; [native-local-folder.md](native-local-folder.md) distinguishes those contracts from unverified real picker, drive and window interaction. The SPEC clarifies inactive recovery copies and restart-only handling of uncertain selection.

## Put away appearance

Sandip requested a green circle with a minus while implementation was underway. It replaces the red/cross visual but retains the same save-and-close behavior. SPEC and PRFAQ 0.6 record the current contract. The native editor and every floating-note mockup use this control; actual macOS minimization is not the action.

## Native interaction evidence and save barriers

A real packaged native note accepted a synthetic Markdown fixture, displayed an acknowledged local save, put away its window with the green minus, and reopened from Notes Library with exactly matching source in SQLite. Closing the library left the floating note open. A native Window menu arrangement changed its persisted geometry, and Undo restored the previous geometry. These are observed individual flows, not the 100-run or multi-display release suites.

The initial title-bar drag and global arrangement shortcut check did not change geometry. The drag path now calls the native window API explicitly; it must be re-tested after rebuilding. The menu route works. The layout policy now avoids growing a note that already fits and uses minimum-sized cascades when it cannot fit.

Save barriers freeze document transactions synchronously before final Close/quit writes. Native quit waits for every window, including an editor inside the library, and uses a unique round ID so stale acknowledgements cannot complete a later quit. A failed window cancels the quit and re-enables all affected editors. Native library closure also waits for its drafts. Browser regression checks inject a local quota error and hold IndexedDB completion to exercise the shared editor's failure and pending-close states.

Native test storage under scratch/native-m0 contains an unrecognized user-entered note as well as synthetic fixtures. Preserve it. Do not purge it, publish it, export it with fixtures, or enable sync for that directory. Further isolated sync/performance tests must use a new synthetic-only directory.

The rebuilt library has been visually checked in dark appearance after correcting inherited text color. A native archived-note editor inside Notes Library was edited and Quit was invoked; the process exited and SQLite retained the exact latest fixture source. This verifies that individual path, without replacing forced-termination/disk-failure stress tests. The explicit native title-bar drag check still did not change recorded geometry; keep that M0 issue open rather than claiming dragging passed.

The lock-release follow-up in [native-local-folder.md](native-local-folder.md) now has 34 passing native cases plus the parent-launched child fixture. An owner-drop guard releases duplicated-descriptor locks explicitly; the identified regression fails before the fix and passes afterward. The native release rebuild remains 14.85 MiB. CI at the fix head remains required.

## Current local verification and CI availability

At d969dde, local TypeScript/formatting and 74 shared cases pass; the bound host-channel harness passes 27 checks. The production web build, eleven browser flows (four mock native IPC), eleven production offline checks, 34 native cases plus the parent-launched child fixture, Rust formatting/Clippy and a 14.85 MiB native release rebuild pass. No stopped WebKit probe, real-note data or OS login setting was used. [Local verification metadata](../experiments/local-verification-2026-10-27.json).

Both hosted Actions runs failed before executing any step because GitHub reported an account billing/spending restriction. This is separate from test failure; no hosted pass is claimed at this head. Account Billing and plans needs Sandip's review. No payment/spending settings or automatic reruns were changed. [Dispatch metadata](../experiments/github-actions-2026-10-27.json).
