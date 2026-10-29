## 2026-10-26 — Specification baseline and storage recommendation

**Did:**
- Wrote the canonical PRFAQ and SPEC, including 14 requirements and 16 acceptance criteria.
- Evaluated Google Drive and AWS storage and documented an illustrative S3 cost model.
- Created and pushed the private devsandip/stickies GitHub repository.
- Verified GitHub and AWS access. Confirmed iPhone first with Android browser access.

**State now:**
- Specifications are proposed and versioned. No application code or AWS resources exist.
- Google Cloud OAuth and Apple distribution access remain unverified.

**Next:**
- Create the complete screen mockups from docs/SPEC.md, including Mac, iPhone, browser, and recovery states. Sandip requested mockups only.

**Decisions:**
- Recommend local persistence, optional user Google Drive sync, and AWS web hosting.
- Use # Heading for the sole Markdown heading level and ##tag for inline tags.
- Deliver a local Mac dogfood build before cloud/web/iPhone and local semantic retrieval.

## 2026-10-26 — Peel naming, DynamoDB design, and screen mockups

**Did:**
- Renamed the product to Peel and the private GitHub repository to devsandip/peel.
- Rewrote PRFAQ and SPEC as version 0.2 around local storage or DynamoDB-backed Peel Cloud.
- Specified SQLite/IndexedDB persistence, Cognito identity, conditional revisions, sync pagination, retention, and a database cost model.
- Created 74 screen mockups, 78 PNG exports including dark variants, an overview, a full contact sheet, and a local gallery.
- Rendered every screen, checked navigation and layout, and visually reviewed core native, mobile, account, and recovery screens.

**State now:**
- The mockup gallery is in docs/mockups/index.html, with the inventory in docs/ui-spec.md.
- All mockup render checks pass. These are visual artifacts only; no production app or AWS infrastructure exists.
- The original Drive recommendation above is superseded by Sandip's explicit choice of DynamoDB or local storage.

**Next:**
- Review docs/mockups/index.html and collect visual feedback. Keep changes limited to specs/mockups until Sandip asks to move into M0 application experiments.

**Decisions:**
- The app is Peel. Google Drive is excluded. Cloud storage belongs to the app's AWS account behind an authenticated API.
- Local mode needs no account. Local notes do not upload on sign-in. Native local persistence uses a small SQLite database.
- Preserve unresolved local drafts on revision conflict. Never label a conflicted draft as synced.

## 2026-10-26 — Floating desktop notes and library pinning

**Did:**
- Updated PRFAQ and SPEC to version 0.3, making floating Mac notes the primary experience with a separate Notes Library.
- Added drag-out/right-click pinning, independent Keep on top, local placement restoration, and four edge arrangement commands.
- Added ten mockup scenes and desktop interaction previews; the gallery now has 84 canonical screens and five dark exports.
- Verified title-bar dragging, pin/cancel flows, duplicate prevention, four keyboard arrangements, and Undo last arrangement.
- Regenerated the overview/contact sheet and documented the desktop feature and native feasibility gate.

**State now:**
- The local browser gallery simulates movement and pinning inside the depicted Mac desktop.
- All mockup render and interaction checks pass. No native app or global OS shortcuts have been implemented.

**Next:**
- Review docs/mockups/index.html#mac-library-desktop and the four mac-arrange scenes. Keep further work in mockups/specs until Sandip requests native implementation.

**Decisions:**
- Pinning preserves one note identity and storage destination; the note remains draggable and stays in the library.
- Proposed shortcuts are Control Option Command plus arrows for arrangement and Command Shift L for the library.
- Arrangement targets the active display and supports restoring prior geometry without undoing text.

## 2026-10-26 — Independent desktop note windows and one Close control

**Did:**
- Updated PRFAQ and SPEC to version 0.4, defining floating notes outside the separate Notes Library window.
- Replaced floating-note window controls with one top-left Close button and moved other actions to menus.
- Removed the outer app frame, added desktop wallpaper/Dock context, and added a library-closed scene.
- Verified that library closure preserves the same notes/positions, note closure retains its library entry, and save-failure presentation keeps the note open.
- Regenerated 85 canonical screens, five dark exports, overview images, and the screen inventory. All render and interaction checks pass.

**State now:**
- The mockups depict independent note windows with save-and-close behavior. The browser preview simulates these interactions without actual persistence or native windows.
- Canonical docs and visual artifacts agree. No production app or AWS infrastructure exists.

**Next:**
- Review docs/mockups/index.html#mac-library-desktop and #mac-library-closed. Keep work in mockups/specs until Sandip requests M0 implementation.

**Decisions:**
- Closing or minimizing Notes Library leaves desktop notes visible. It never owns, clips, or moves them.
- Close saves locally and closes only its note, retaining the library entry. A failed local save keeps that note open.
- Normal floating notes have one title-bar button, no persistent formatting toolbar, and noninteractive save/destination status.

## 2026-10-26 — Mac capture screens share the floating desktop design

**Did:**
- Replaced the older Mac capture/desktop rendering path with the shared desktop presentation across all six Mac capture screens.
- Made quick capture, formatted notes, and Markdown source draggable with the same single Close control, wallpaper, Dock, and menus.
- Updated note actions and the resident menu bar scene, which now shows capture available with all note/library windows closed.
- Regenerated all 85 screens, five dark exports, and overview images. All presentation checks and documentation-link checks pass.

**State now:**
- Mac capture and Mac desktop sections share window chrome and interactions. The work remains mockups only.
- Empty-draft Close, save-failure recovery, right-click actions, menu bar capture, pinning, and arrangements have passing presentation checks.

**Next:**
- Review docs/mockups/index.html#mac-capture, #mac-source, #mac-note-menu, and #mac-menu-bar. Keep work limited to visual feedback until M0 is requested.

**Decisions:**
- Apply the independent floating-window design throughout capture, rather than maintaining a second Mac presentation.
- Show resident menu capture with all note windows closed to illustrate the existing FR-01 behavior.

## 2026-10-26 — Two library-wide saving modes and green Put away

**Did:**
- Captured the confirmed free remote periodic peer sync and paid live Cloud requirements in PRD, PRFAQ and SPEC version 0.7.
- Replaced per-note storage choices with whole-library modes, added pairing/latest-edit rules and safe mode transitions, and specified paid entitlement/live delivery gates.
- Changed floating note controls to a green minus with the existing save-and-close behavior.
- Expanded and verified 110 canonical mockups plus five dark exports, including remote devices, automatic latest-edit recovery, billing, cancellation, downgrade and separate cloud-data removal.

**State now:**
- Documents and visual baseline are aligned before application work resumes.
- The local native/browser development work started earlier is incomplete; remote peer sync, billing, live Cloud and iPhone are not implemented.

**Next:**
- Resume native window/save verification in docs/features/local-mac-app.md against SPEC 0.7, then validate remote direct/relayed peer transport before building the new sync engines.

**Decisions:**
- Free sync must work across different networks. Encrypted transient relays may transport packets, but free-mode note content has no server storage or offline server queue.
- The latest edit wins for On-device sync, with optional seven-day local recovery. Cloud offline concurrent drafts retain explicit conflict resolution until Sandip changes that rule.
- The green minus puts the note away and keeps its library entry. Cloud subscription pricing/provider/retention remain launch decisions.

## 2026-10-26 — First local Mac and browser implementation

**Did:**
- Built the pnpm/Tauri/React workspace, source-preserving Markdown editor, shared tags/search/lifecycle/transfer, SQLite repository and browser IndexedDB repository.
- Produced a native development bundle and verified a real typed note survives Put away/reopen with matching persisted source; library closure leaves it open and native menu arrangement/Undo changes and restores geometry.
- Added final-save editing barriers, library-close flushing and round-scoped quit acknowledgement across all native windows.
- Passed 23 core checks, three SQLite checks and five browser flows, including failed local writes and a held final commit. Added pinned GitHub CI actions for web/core and native checks.

**State now:**
- The app is a local development foundation; peer sync, live Cloud, billing, iPhone and meaning search are not implemented.
- Native title-bar drag, global shortcuts, folder relocation, shortcut configuration, full recovery/accessibility and performance targets still need work. The native Window menu route works.
- Preserve all existing local test-directory data. Future sync fixtures must use a fresh synthetic-only directory.

**Next:**
- Rebuild and re-test the explicit native title-bar drag, final-save/quit barriers and global shortcuts, then finish M0/local Mac gaps and remote peer transport experiments from SPEC 0.7.

**Decisions:**
- Native persistence owns durable acknowledgements; UI never treats a cloud response as local-save success.
- Freeze document transactions at a close/quit boundary and retain the editor on failure. Preserve version-0.7 two-mode requirements while continuing the local milestone.

## 2026-10-26 - Indexed word search and production browser experiment

**Did:**
- Added an incremental word index and a per-library worker, bounded corpus transfer, paged results, stale-response rejection, and explicit rebuild after a worker failure.
- Kept shared word/phrase/prefix/tag ranking semantics and added update, purge, in-place source, long-note and worker recovery checks.
- Passed 35 shared unit cases and seven browser flows; TypeScript, formatting and the 14.27 MiB native release build pass. The earlier foundation commit passed both GitHub CI jobs.
- Recorded 100 production Chrome offline searches over 10,000 synthetic notes: 32.6 ms p50, 33.6 ms p95, 49.2 ms maximum. Raw synthetic results are versioned under docs/experiments/.

**State now:**
- Search no longer rescans every body on the UI thread. The local foundation remains a draft in PR 1.
- Native worker/UI verification is pending because the Mac is locked. Drag/global shortcut, baseline-device, sustained typing, memory, accessibility and recovery gates remain open.
- Free remote peer sync, paid live Cloud, billing, iPhone and meaning search remain unimplemented.

**Next:**
- Start with docs/features/local-search-performance.md and local-mac-app.md. Verify the packaged worker on the unlocked Mac using a fresh synthetic directory. Continue remote peer transport and clock/convergence experiments under a separate requirement-linked plan while native UI access is unavailable.

**Decisions:**
- Destroy private derived indexes when their library closes. Transfer only changed records after initial indexing and return one result page with a complete count.
- Treat the M4 Chrome experiment as partial evidence; it does not satisfy the M1 Air, Safari, native, iPhone or full AC-14 release matrix.

## 2026-10-26 - Remote peer protocol and local transport experiments

**Did:**
- Added a requirement-linked peer feasibility plan with primary WebRTC, Apple, Coturn and hybrid-clock references.
- Built an application-independent latest-edit model with hybrid stamps, deterministic ordering, seven-day recovery, body-free edit deduplication and permanent tombstones.
- Passed eight protocol checks within the 43-case shared suite, including reordered three-replica delivery, one-year clock skew, restart snapshots, repeated old edits and edit/purge races.
- Transferred a synthetic 252,025-byte Unicode payload over a Chrome host/host DTLS channel in 16 bounded frames; a relay-only negative control did not fall back to host connectivity. Versioned the metadata report.

**State now:**
- The model is not integrated into the app and assumes a future authenticated boundary. Remote free sync is still unimplemented.
- Both GitHub CI runs for the search foundation passed. No infrastructure was provisioned. The Mac remains unavailable for native UI checks.

**Next:**
- Read docs/features/peer-sync-protocol.md. Add authenticated pairing/session binding and a serialized durable adapter before acknowledging real edits; then prove direct and forced-relay paths on different networks and on native/iPhone.

**Decisions:**
- Keep a provisional five-minute future-stamp quarantine in the model; do not finalize the clock policy or enable sync before local clock repair and authenticated calibration are proven.
- Deduplicate expired recovery versions with body-free local edit IDs/digests so retries cannot recreate removed history. Permanent purge dominates every stamp and clears retained content.

## 2026-10-26 - Peer identity and session-binding primitives

**Did:**
- Added a requirement-linked authentication plan and standard Web Crypto P-256/SHA-256 session proofs bound to library, both identities/challenges, description hashes and expiry.
- Added explicit confirmed-key trust, revocation checks and bounded single-use challenge tracking. Importing a key never trusts it automatically.
- Passed seven new authentication checks, bringing the shared suite to 50. TypeScript and formatting pass.
- Verified Node/Chrome signatures in both directions and a non-extractable browser CryptoKey surviving IndexedDB commit/reload with stable identity. Reports contain only synthetic boolean/environment metadata.

**State now:**
- These are M0 primitives, not a deployed pairing or sync feature. No application code imports them.
- Both CI runs for the prior peer-model head passed. No AWS resources, account changes or real keys were used.

**Next:**
- Read docs/features/peer-authentication.md. Add serialized durable replica/replay state and real signaling/session binding before enabling peer transfer. Native Keychain, browser eviction, pairing confirmation and different-network relay checks remain open.

**Decisions:**
- Use platform Web Crypto for the experiment, with non-extractable private keys and public SPKI-derived identifiers. Native production identity must still use Keychain storage.
- Reject concurrent replay and registry changes during crypto verification. Persist challenge consumption atomically with session activation before production use.

## 2026-10-26 - Durable peer store and crash experiments

**Did:**
- Added a requirement-linked isolated adapter for normalized clock, head, history, edit digest, local projection, tombstone and per-target delivery state on SQLite and IndexedDB.
- Translated received revisions into local revisions, serialized concurrent writers, coalesced delivery generations and rejected stale acknowledgements.
- Persisted consumed challenges and session claims atomically, with replay rejection after reopen. Kept trust/signature verification and active-channel integration explicitly outside this experiment.
- Passed 52 shared cases and the same seven-scenario contract on real Chrome IndexedDB and Node SQLite. SQLite SIGKILL after acknowledgement preserved the committed state; SIGKILL during replacement rolled back all state. Added the experiment to CI.

**State now:**
- The application remains unchanged. No peer sync is enabled and no real/default note database was opened. Docs/mockups remain at the approved 0.7 baseline.
- Both CI runs for authentication head 405139a passed. The durable adapter batch will run CI again. Native UI checks remain pending while the Mac is locked.

**Next:**
- Read docs/features/peer-durability.md. Design clock-independent local draft persistence, bounded inventory/seen/history growth and atomic trust/replay coordination before production integration. Then bind a real WebRTC transcript to paired keys, with direct and forced-relay cross-network evidence still required.

**Decisions:**
- Use note-scoped normalized records and whole-store compare-and-swap transactions for this M0 experiment; do not rewrite the entire library as one JSON value.
- A durable session claim never restores an active connection after restart. Production activation must recheck expiry/current trust and handle revocation atomically. Native Rust migration, Safari/iPhone and clock repair remain separate gates.

## 2026-10-26 - Bound peer channel and commit acknowledgements

**Did:**
- Added a strict note/purge/acknowledgement wire codec with bounded frames, one bounded assembly, UTF-8 validation and metadata limits.
- Bound real installed WebRTC offer/answer descriptions to both devices' proofs in an isolated same-page Chrome harness, then committed session claims before permitting note transfer.
- Passed 15 channel checks across 11 host/host DTLS sessions, including a 252,026-byte Unicode note, failed commit/quarantine without acknowledgement, dropped acknowledgement/reopen/retry, purge and revocation.
- Passed six new wire tests, bringing the shared suite to 58. Added the channel experiment to CI and recorded only synthetic counters/boolean metadata.

**State now:**
- No app sync is enabled and no app databases or AWS resources were used. Both CI jobs passed for the prior durable-store head 32bcd34.
- Cross-network direct/relay, production pairing/signaling, native/iPhone and clock repair remain open. The harness controls both endpoints in one page and is not production security evidence.

**Next:**
- Read docs/features/peer-wire-session.md. Continue native/local requirements when UI is available; otherwise establish clock-independent drafts, bounded inventory/growth and durable trust before production integration. Prepare the remote connectivity infrastructure/cost plan before any provisioning.

**Decisions:**
- Include operation kind in delivery acknowledgements so an edit cannot acknowledge a same-ID purge. Include recognized import-origin fields in immutable edit digests.
- Restrict this composition experiment to direct authors. Production needs mutually acknowledged readiness, full-duplex flow control, current-trust transactions, reconnect/renegotiation and third-party author proofs before forwarding.

## 2026-10-27 - Offline browser capture and safe shell updates

**Did:**
- Added a production service worker generated from hashed public app assets, including the local search worker. Installation verifies every digest; note/query/API responses never enter its cache.
- Added offline setup/status/repair, waiting updates and scope-limited cache cleanup. Updates do not replace a live editor or reload it. Browser persistence denial now has a handled recovery message.
- Passed eleven isolated production Chrome checks for offline reload/create/edit/search, failed install/update, cache repair, draft safety during updates, activation after tab closure, unrelated-cache preservation and missing API capability.
- Passed TypeScript, formatting, 58 shared cases, seven browser regression flows and the native release rebuild. Added the production check to CI and documented a separate preview origin on port4322.

**State now:**
- Local browser capture works after a completed online shell installation, including subsequent offline reloads. Browser storage can still be cleared or evicted; exports remain necessary.
- The approved 0.7 docs/mockup baseline remains. Native UI/runtime, remote sync, Cloud, iPhone and meaning search remain open. Both CI jobs passed for the prior bound-channel head296a345.

**Next:**
- Read docs/features/browser-offline-shell.md and the latest ignored resume. Continue native/local requirements when the Mac is available; otherwise work on clock-independent drafts, native settings or the isolated remote-connectivity infrastructure/cost plan before provisioning.

**Decisions:**
- Use existing Vite/Oxc tools and no new runtime dependency. Cache only verified public files and follow the browser's normal waiting lifecycle.
- Keep production preview on4322 and development on4320, so an installed production worker cannot mask development changes. Each origin has its own IndexedDB library.

## 2026-10-27 - Native storage guards and staged relocation contract

**Did:**
- Added a requirement-linked local-folder plan before implementation. Native repository operations now reject missing or replaced database files instead of continuing through a stale connection.
- Built a test-only local library manager with private atomic selection metadata, cooperating process locks, relocation journal, SQLite backup, complete canonical-row verification and checkpoint/fsync before selection.
- Tested failures before publication and uncertain publication, preserving both copies and blocking further access until restart when selection durability is uncertain. Unknown metadata/destination data is preserved.
- Passed 11 Rust cases, formatting, Clippy and the native release rebuild. Tests use only fresh temporary roots. Both CI runs for the prior offline-browser head2eb15b9 passed.

**State now:**
- Storage-file guards are in the app; relocation remains staged in the test build. No picker or startup manager is enabled, and no default/user database was opened.
- Cross-window save barriers, picker/cancel, startup reconnect/retry, physical external-drive and permission tests remain open. No local-folder acceptance gate is marked complete.

**Next:**
- Read docs/features/native-local-folder.md. Integrate one operation coordinator for Quit/relocation and an optional-library startup recovery path, then wire the picker and Settings only after cancellation and durable-ack behavior are verified.

**Decisions:**
- Keep the source as an inactive recovery copy after a verified selection. Never overwrite an existing destination or silently create an empty selected library.
- Treat uncertain metadata publication as a reason to stop access until restart, preventing later writes from diverging between two possible selected copies.

## 2026-10-27 - Native folder selection and recovery integration

**Did:**
- Enabled the verified local library manager at native startup and added reconnect/retry before mounting editors when selected storage is unavailable.
- Added a shared Quit/relocation coordinator, native folder picker and Settings location controls. Every open editor freezes and flushes before the copy; acknowledgements, writes and window changes are serialized.
- Added waiting-barrier failure/timeout/window-loss cancellation, stale-message rejection and read-only restart handling for uncertain selection. The SPEC and Settings explain retained inactive source copies.
- Passed 16 native cases, 58 shared cases, nine browser flows and 11 production offline checks, with Rust formatting/Clippy and a rebuilt native bundle. Two browser flows use mocked IPC and do not claim real OS interaction.

**State now:**
- Folder selection is implemented in the development app. Real native picker, simultaneous windows, drive/permission faults, stress and latency checks remain pending while the Mac is locked.
- No default library, real note database, cloud account or AWS resource was accessed in this batch. The approved mode/screen baseline remains. Prior native storage CI passed; new integration CI will run after push.

**Next:**
- Start with docs/features/native-local-folder.md and the latest resume. Verify the current native bundle on an unlocked Mac using a fresh PEEL_DATA_DIR and quit older binaries before testing. Continue configurable shortcuts and remaining M1 requirements independently if UI stays unavailable.

**Decisions:**
- An unavailable selected library gets a recoverable startup view. Choosing another folder never silently creates a fallback or overwrites existing data.
- After uncertain publication, retain the freeze and offer normal Quit/reopen. The barrier already saved every draft, so a restart does not require accepting new edits against blocked storage.

## 2026-10-27 - Configurable native global shortcuts

**Did:**
- Added a requirement-linked plan and implemented device-local Capture and four-edge bindings, Disable, Restore defaults and Retry activation in Settings.
- Added registration transactions, normalized-key validation, collision/persistence rollback, uncertain-release status and saved-preference recovery. Window menu labels follow the preference while Command N remains available.
- Passed seven new registration-model cases within 23 native tests, 58 shared cases, ten browser flows and 11 production offline checks. TypeScript, formatting, Clippy and a 14.72 MiB native release bundle pass.
- Updated SPEC behavior and evidence. Both GitHub CI runs passed for the prior folder-integration head b8c4ebf.

**State now:**
- Shortcut configuration is implemented. Actual OS dispatch, keyboard layouts, native picker/window recovery and full acceptance/performance remain unverified while the Mac is locked. Mocked IPC and fake registrations do not establish native keyboard acceptance.
- No real/default note data, AWS resources or billing were used. Approved mode and screen scope remains unchanged.

**Next:**
- Read docs/features/native-shortcuts.md and verify the rebuilt app with a fresh PEEL_DATA_DIR when the Mac is unlocked. Continue the explicit launch-at-login preference and remaining M1 gates independently.

**Decisions:**
- Use modifier controls and named physical keys rather than a live shortcut recorder. Keep route publication separate from OS registration so callbacks cannot activate unsaved action mappings or wait on the settings mutex.

## 2026-10-27 - Explicit native launch-at-login controls

**Did:**
- Added a requirement-linked plan, inspected the Apple documentation/installed SDK and compiled a narrow SMAppService bridge with the existing resolved build helper.
- Added Settings status, explicit on/off, pending approval, System Settings action and refresh after external changes. No duplicate saved Boolean can override the Mac's current choice.
- Blocked development executables and isolated test libraries before OS-setting access. Passed five new native cases, including the compiled bridge guard, within 28 native tests and one new mocked login flow within 11 browser flows.
- Passed TypeScript, formatting/Clippy and a 14.85 MiB production/native build. Updated SPEC behavior and evidence without changing the approved mode/screen baseline.

**State now:**
- Launch-at-login controls are implemented; real signed-app registration, approval and actual login/relaunch remain unverified. Automated checks did not register/unregister an OS login item or open System Settings.
- Native dragging/global dispatch, picker/drive faults, accessibility/performance and full M1 acceptance remain open. No real/default notes or AWS resources were used.

**Next:**
- Verify current CI, then add isolated native durability/crash evidence or continue the remote peer feasibility gates while the Mac remains locked. Use a fresh synthetic data root for every experiment.

**Decisions:**
- Use SMAppService's main application status as the authority. Only an explicit user action changes it; disabling never quits the running app or edits notes.

## 2026-10-27 - Native repository process recovery evidence

**Did:**
- Added a requirement-linked synthetic durability plan for the actual Rust repository, separate from the peer-store adapter experiment.
- Terminated three fixture processes by SIGKILL after acknowledged save/metadata, during a spilled uncommitted replacement and after acknowledged purge. Reopen integrity, exact source/revision/metadata, rollback and purge resurrection checks pass.
- Confirmed a SQLite DiskFull page-limit error, preserved the prior acknowledged revision through a failed native save and successfully retried after restoring the limit.
- Passed 100 repository reopen/edit/save cycles and five new cases within 33 native tests, plus the explicitly parent-launched ignored child fixture. Formatting/Clippy pass; production code and bundle remain unchanged by these test-only additions.

**State now:**
- Native repository process recovery has direct evidence. Actual editor-close barriers, full filesystem/power loss, physical drive/permissions and target-device performance still need verification. No full AC-02/16 acceptance is claimed.
- Every process used a fresh marker-verified temporary directory. No real/default notes, OS login items or AWS resources were accessed.

**Next:**
- Continue production peer clock/trust/bounds gates or the remote connectivity infrastructure plan while native UI stays unavailable. Keep the native UI verification checklist open for the unlocked Mac.

**Decisions:**
- Require an actual WAL-size increase before terminating the uncommitted fixture. Simulate SQLite capacity without filling the user's drive, and always reap child processes on failure.

## 2026-10-27 - Clock-independent local peer draft commits

**Did:**
- Added a requirement-linked plan and isolated saveDraft/publishDraft APIs. Local capture commits without clock/crypto/session/peer dependencies; later publication checks the current generation/revision and preserves display dates and editor revision.
- Protected pending draft projections from remote head receipt/maintenance, retained failed publication drafts and removed all draft content on permanent purge. Logical identity version 2 blocks older experiment engines from silently overwriting the new semantics.
- Passed eleven shared scenarios on SQLite and Chrome IndexedDB, four SQLite SIGKILL boundaries and pending-draft browser reload. A controlled publication/capture race and logical-identity upgrade/future-version preservation pass.
- Passed TypeScript, formatting, 59 shared cases and all 15 bound-channel regression checks. Both GitHub CI runs passed at the prior native durability head 6169561.

**State now:**
- The store prerequisite is implemented outside the application. Clock calibration/repair, publication policy, durable current trust, inventory/growth bounds, pairing and remote direct/relay/native/iPhone remain open. No application sync or full acceptance is claimed.
- The app/default databases, real notes, OS settings and AWS resources were untouched. The native bundle remains 14.85 MiB; this package is not imported by it.

**Next:**
- Read docs/features/peer-local-drafts.md, then continue bounded peer inventory/trust or the isolated remote-connectivity infrastructure/cost plan before provisioning.

**Decisions:**
- A draft marker holds only generation/revision/base-head metadata; the local note projection owns the text. Publication is a separate atomic protocol event and cannot overwrite newer typing.

## 2026-10-27 - Native peer runtime probe and intermittent storage stall

**Did:**
- Added a requirement-linked, separate hidden Tauri example with blank synthetic assets, temporary nonpersistent storage, one result/progress boundary and bounded process cleanup. The production app, databases and plugins never start.
- Observed one basic pass for secure tauri origin, Web Crypto/P-256, non-extractable CryptoKey IndexedDB reopen and connected host/host DTLS transfer of 217,000 synthetic bytes in fourteen bounded frames.
- Attempted shared bound-channel composition, then one diagnostic run. Both reached the watchdog; diagnostics stop in the CryptoKey IndexedDB phase before the bound module was requested. Stopped further execution after two failures.
- Prepared finer progress hooks for an unlocked control run. Rust formatting/Clippy and JavaScript syntax/style pass. Both CI runs passed at prior peer-draft head 194e560.

**State now:**
- Native API availability has one positive observation; repeatability and shared protocol composition remain unverified. The intermittent storage stall has no established cause. Production SQLite capture and the current app bundle are unchanged.
- No real notes, default library/browser profile, OS login item or AWS resource was used. No native peer acceptance gate is complete.

**Next:**
- Keep the native experiment stopped until a controlled unlocked comparison is available. Continue the remote-connectivity infrastructure/cost plan or independent peer trust/inventory work.

**Decisions:**
- Preserve both positive and failed evidence. A hidden ephemeral IndexedDB transaction does not establish native disk durability, and failed composition must not be described as fifteen passing WebKit checks.

## 2026-10-27 - Release native library locks at owner drop

**Did:**
- Investigated a native CI failure at 32a1361: cold-recovery retry reported a held library lock after its previous controller dropped. The parallel run passed.
- Reproduced the same failure deterministically by keeping a duplicated file descriptor alive across lock-owner drop. Added an explicit unlock-on-drop guard for manager/root folder locks.
- Verified active-owner exclusion, reacquisition while an old duplicate remains and continued new-owner exclusion after the old duplicate closes. No sleeps, retries or serial-only test workaround.
- Passed 34 native cases plus the parent-launched child fixture, Rust formatting/Clippy and the native release rebuild. CI at the fix head will verify the concurrent suite again.

**State now:**
- A concrete lock-lifetime failure route is fixed. Inherited descriptors from concurrent crash-fixture spawns are a plausible explanation for that CI failure, not a proven trace of its process state.
- The separate WebKit CryptoKey IndexedDB stall remains open and stopped after two failed attempts. This fix does not claim to address it.

**Next:**
- Check the fix head's CI after completing independent work, then continue the peer/remote feasibility plan. Native picker/drive/focus/drag checks still require an unlocked controlled run.

**Decisions:**
- Lock ownership follows the LocalLibrary guard; incidental descriptor copies cannot keep the manager's lock alive after it releases ownership.

## 2026-10-27 - Disposable relay infrastructure preparation

**Did:**
- Verified the existing AWS admin identity/us-east-1 read-only, current compute/IPv4/disk/transfer rates and the official Canonical ARM64 Ubuntu image. Kept account/address details in private ignored files.
- Added an isolated CloudFormation candidate with one small capped-credit instance, encrypted/deleted root volume, one-client ingress, memory-backed authenticated Coturn configuration, bandwidth/allocation limits, guest expiry and a separately scoped Scheduler termination action.
- Added a read-only prepare script, metadata-only health/HMAC lease helpers and ownership-checked lifecycle contracts covering lost create response, failures, unrelated stacks and checkpoint failures. AWS template validation and 66 shared cases pass.
- Added infra type/style/syntax checks to CI. Both CI runs passed for lock-fix head 3add50d; its release rebuild is 14.85 MiB.

**State now:**
- No AWS resources have been created. Plans are private, time-limited and account/client pinned. Conservative run allowance estimate is USD 0.2286 under a USD 2 experiment allowance; operational termination/quotas/cleanup provide the bounds.
- A real guarded launcher, Coturn runtime/lease negatives, relay routing and verified cleanup still need execution. The native WebKit stall remains stopped/open. No app sync, paid billing or public beta is enabled.

**Next:**
- Implement the bounded disposable launcher using infra/relay/lifecycle.ts, reprepare a fresh plan, verify guest/Scheduler guards before credentials, run synthetic relay-only checks and delete/verify the whole owned stack. Never infer different client networks from two clients on this Mac.

**Decisions:**
- Use a separate experiment VPC and SSM rather than SSH or a general public relay. Keep the master secret on the VM in /run; short-lived lease/state files remain private and outside git.

## 2026-10-27 - Guarded disposable relay runner

**Did:**
- Implemented exact account/client/source/deadline preflight and a separate explicit apply path, with checkpointed creation and ownership-checked finally cleanup by stack ID.
- Added actual Scheduler/runtime readiness verification before credentials, fresh browser relay-only UDP/TCP transfer and bounded invalid/expired credential fixtures. Outputs exclude credentials, SDP, addresses and payload.
- Added conservative unknown-create handling, completed-deletion handling and tagged-instance cleanup verification. Python helper now supports only an explicit expired M0 fixture option.
- Passed TypeScript, 66 shared cases, JavaScript/Python syntax and formatting. No stack has been created during implementation.

**State now:**
- The bounded experiment is ready for a freshly prepared dry run, then authorized isolated execution. Actual Coturn routing/authentication and teardown remain unverified until that execution.
- The normal app, private notes, paid billing and stopped WebKit probe remain untouched.

**Next:**
- Reprepare a fresh plan, run the guarded read-only path, then one bounded apply with the overnight cutoff and inspect its privacy/runtime/connectivity/cleanup evidence. Clean up even on failure.

**Decisions:**
- An unknown create result without a discovered stack stays unconfirmed. It must never be reported as verified cleanup merely because an immediate read was empty.

## 2026-10-27 - First disposable relay execution and diagnostic boundary

**Did:**
- Created one isolated, capped relay stack after fresh account/client/template/deadline checks. Verified Coturn 4.6.1-1build4, active guest expiry and independent Scheduler configuration, memory-backed authentication/runtime, quotas, no swap/core dumps and disabled traffic logging.
- The UDP browser step failed with coarse stage metadata. TCP and credential-negative controls were not reached; no network cause is inferred.
- Deleted the entire owned stack in finally and verified no tagged nonterminated instance remained. Copied only metadata into the experiment report. No application database, private notes or paid app billing was used.
- Added safe phase/candidate/error-code diagnostics and selected local relay candidate, DTLS and actual relay-protocol checks at both endpoints for one controlled second attempt. TypeScript, 66 shared cases and runner syntax pass. Both CI runs passed at 476b948.

**State now:**
- Runtime and ordinary cleanup have actual evidence. Relay transfer, authentication negatives, cross-network clients and Scheduler invocation remain open. The USD 0.2286 estimate is an allowance forecast, not a measured bill.
- Native WebKit probing remains stopped after two failures, independently of this live relay attempt.

**Next:**
- Prepare a fresh plan, run the read-only guard, then the one controlled second relay attempt. Always verify deletion. If it fails, stop this live component and retain its detailed evidence; do not deploy a third blind experiment.

**Decisions:**
- Keep network access unchanged until failure-stage evidence supports a cause. Validate both endpoints using their own selected local relay candidates; preserve remote candidate labels as observations.

## 2026-10-27 - Relay quota evidence and verified teardown

**Did:**
- Reprepared and dry-ran a fresh account/client/deadline-pinned plan, then executed the one controlled second disposable relay run. Runtime safeguards and termination configuration passed again.
- Captured UDP failure diagnostics: one candidate at endpoint A, zero at B, completed gathering, connection phase timeout and ICE error 486. RFC 8656 defines 486 as allocation quota reached. Shared endpoint credentials with the small user quota are a plausible cause, not a proven allocation trace.
- Deleted the second stack in finally and verified no tagged nonterminated instance remained. Both runs are cleaned up; no app database or real note data was used.

**State now:**
- Live relay work is stopped after two failed attempts. TCP, credential-negative controls, successful transfer, different client networks and Scheduler invocation remain unverified. Two conservative allowance forecasts total USD 0.4571; actual billing was not queried.

**Next:**
- Continue independent local protocol work. A later controlled relay plan must review endpoint-specific leases and browser allocation demand against quotas before another deployment. Do not run a third overnight experiment or broaden firewall access without evidence.

**Decisions:**
- Preserve observed quota evidence and stop at the two-failure boundary. No speculative quota or network change was made.

## 2026-10-27 - Durable current trust and scoped peer commits

**Did:**
- Added an isolated confirmed-public-key registry with monotonic trust generations, durable replay claims and instance-local session handles. Reconfirmation invalidates older sessions; received proofs cannot pair a key.
- Scoped direct-author edit, purge and acknowledgement operations recheck current trust/claim/expiry and order their commits against durable revocation/closure. Raised logical identity to version 3, retaining explicit 1/2 upgrade inputs and clock-independent drafts.
- Passed ten shared authorization scenarios on real SQLite and Chrome 156 IndexedDB, including rollback/replay/restart, forged handles, key substitution, malformed metadata and held authorization/edit/purge/ack/closure races. Existing eleven store scenarios, four SQLite SIGKILL boundaries and browser reload checks still pass.
- Composed durable trust into the bound-channel harness. All 15 checks across eleven host/host DTLS sessions pass; TypeScript, formatting and 67 shared cases pass. Recorded synthetic-only metadata and clarified the canonical SPEC transaction requirement.

**State now:**
- A local authorization-ordering prerequisite is implemented and tested outside the app. Production pairing, keystores/trust propagation, clock repair, bounded inventories, ready/credit/reconnect protocol and native/iPhone/remote transport gates remain open.
- Native WebKit probing and live relay execution remain stopped at their two-failure boundaries. Both disposable AWS runs were cleaned up. No private note data, app sync, real app billing or public release was enabled.

**Next:**
- Check this head's CI, then continue bounded inventory or mutually acknowledged ready/full-duplex flow control in the isolated protocol. Keep local capture independent. Do not repeat stopped native/relay experiments overnight.

**Decisions:**
- Use the existing global compare-and-swap revision to order trust and note changes, rather than trusting an earlier in-memory authorization result. Replay/trust capacity bounds are provisional M0 limits, not public quotas.

**Additional verification:**
- Added a current-trust check immediately before each outgoing frame, after any buffer-drain wait. A separate registry instance's committed revocation now blocks the existing channel from sending. The bound harness passes 16 checks across twelve host/host DTLS sessions. Already-sent bytes cannot be recalled; production session propagation remains open.

## 2026-10-27 - Mutual peer readiness and independent duplex credit

**Did:**
- Added a bounded control codec and session state machine: each endpoint sends and acknowledges Ready after its durable verified claim. One credit independently bounds each direction; body-free receipts can progress while the opposite note commit is pending.
- Kept credit until local receipt processing completes, preserved coalesced newer delivery generations and added explicit timeout/installed-description invalidation. Outgoing controls/frames recheck current trust.
- Passed seven new flow cases, TypeScript, formatting and 74 shared cases. Chrome 156 passes 27 checks across nineteen host/host DTLS sessions, including delayed claims, held duplex commits, sender receipt failure/retry, actual receipt timeout, coalescing and wrong-session/renegotiation rejection.
- Corrected a negative fixture that waited on a set-description operation while its own guard closed the connection. The earlier coarse watchdog did not locate a browser cause. Recorded its failed metadata and the subsequent complete passing report; added fixed stages and bounded waits. Both CI runs passed at prior head cf3a79a.

**State now:**
- Local protocol readiness/duplex composition has actual synthetic channel evidence. App integration, production network budgets, inventory/reconnect scheduling, clock repair, pairing/trust propagation and native/iPhone remain open.
- Native WebKit and live relay work remain stopped, and no new AWS resources, real notes or OS settings were used. The approved mockups and local app are unchanged.

**Next:**
- Check the new head's CI after independent work, then add bounded anti-entropy inventory/delivery enumeration. Keep all capture independent of peer/session state and preserve failed delivery until durable acknowledgement.

**Decisions:**
- Use one bounded note credit per direction and a separate receipt-control path. An older in-flight receipt returns credit while leaving a newer durable generation pending. Changed descriptions require fresh binding, not silent reuse of a previous proof.

## 2026-10-27 - Hosted CI account restriction and local verification

**Did:**
- Read both failed d969dde run annotations: GitHub refused to start jobs because of an account billing/spending restriction. There were no checkout or test steps. The exact payment-versus-limit cause is not established.
- Left billing/spending settings unchanged and requested no automatic rerun. Both prior cf3a79a runs had passed.
- Verified locally: production web build, eleven browser flows, eleven production offline checks, 34 native cases plus the parent-launched helper, Rust formatting/Clippy and a 14.85 MiB native release rebuild. TypeScript/formatting, 74 shared and 27 bound-channel checks already passed this source head.
- Recorded metadata and a requirement-linked next plan for bounded inventory/delivery enumeration. No new inventory implementation is claimed.

**State now:**
- Local verification is green; hosted CI is unavailable until Sandip reviews GitHub Billing and plans. Four browser flows mock IPC and native UI/performance gates remain open. No billing change, real-note test or stopped native/relay experiment occurred.

**Next:**
- Continue docs/features/peer-inventory.md locally. After the account restriction is resolved, run hosted verification for the current source head. At the overnight cutoff, finish safely and delete the automation.

**Decisions:**
- Treat an account-level dispatch rejection separately from a code test failure. Continue useful local work without retrying unchanged blocked jobs or changing account spending.

## 2026-10-27 - Bounded metadata inventory and current delivery resolution

**Did:**
- Added normalized primary-key metadata scans on SQLite and IndexedDB, phase/generation-scoped pages and one-peer pending references. SQLite projects heads before the binding; IndexedDB projects one cursor value at a time. Pages expose no note source, draft projection, history or other recipient list.
- Added logical identity4 with explicit1/2/3 upgrades and atomic separate head/delivery generations. Receipt/trust/draft/stale-edit work does not restart head inventory; changed heads/purges and delivery references invalidate the appropriate cursor. Local drafts remain independent even at sync-counter exhaustion.
- Added local HMAC continuation integrity, immutable async inputs and missing/corrupt-key failure handling. The continuation key stays on-device, is not a peer-authentication key and is never reported. Scoped APIs bind recipients and recheck durable trust through completion.
- Passed eleven inventory and eleven trust scenarios on both actual SQLite and Chrome156 IndexedDB, plus the existing eleven store scenarios/four SIGKILL/reload checks. TypeScript, formatting and75 shared cases pass.
- Composed bounded pending discovery with a fresh host session, driving a lost-receipt generation and Archive/Trash notes without manually chosen IDs.29 checks across20 host/host DTLS sessions pass, with exact source/state and deduplicated retry. Recorded synthetic-only metadata.

**State now:**
- Local inventory/delivery discovery is implemented outside the app. A completed inventory pass is a snapshot hint, never Synced or a durable acknowledgement. Network anti-entropy, production reconnect scheduling, author forwarding proofs, clock repair, growth bounds and native/iPhone integration remain open.
- Hosted CI remains blocked before job start by the known account restriction. No repeat polling, billing change, live relay/native probe, app schema change or real note data was used.

**Next:**
- Use remaining overnight time for an independent M0 local meaning-search model/runtime experiment, with pinned public artifacts/license, synthetic retrieval questions and measured local inference. Keep note/query data off servers and do not activate an unverified app feature. Finish the current safe batch and stop the automation at08:00IST.

**Decisions:**
- Derive metadata from existing normalized records, with separate counters rather than another whole-library body snapshot. Integrity-check local cursors so forged phase/position values cannot silently skip a pass. Preserve direct-author refusal until forwarding proofs exist.

## 2026-10-27 - Isolated local meaning-search candidate

**Did:**
- Froze 30 synthetic retrieval questions, expected notes and distractors before inference. Pinned a q8 all-MiniLM-L6-v2 revision, public artifact hashes/license metadata, Transformers.js 4.3.1 and its exact WASM runtime. The inference dependency remains dev-only and outside app imports.
- Added source-complete bounded Unicode chunking, distinct-note ranking and lexical/semantic rank fusion. An isolated worker retrieved 29 of 30 expected notes in the top three; the unchanged q07 miss ranked 22.
- Measured 509.455 ms single cold initialization, 1,879.395 ms indexing for 70 notes/75 chunks and 16.474 ms p95 for 100 resident offline queries over 10,000 copied vector rows. All 20 concurrent word-worker queries completed correctly during indexing. No external inference request or app database was used.
- Verified missing/corrupt artifact failure before readiness, retained the initial and repeated reports and recorded scoped aggregate browser RSS. TypeScript, formatting, 79 shared cases and production web build pass. The shipped app bundle is unchanged.

**State now:**
- The browser candidate is feasible on this M4 synthetic set. App meaning search, persistent offline model installation, native/iPhone inference, memory budgets and held-out dogfood AC-06/14 remain open. Aggregate browser RSS peaked at 1,557,004,288 bytes and is not unique model allocation or a passed RAM target.
- The approved 0.7 documents/mockups remain intact, with SPEC evidence linked. Hosted CI remains blocked by the known account restriction; no stopped native/relay probe, new AWS resource, real note or billing setting was used.

**Next:**
- Prove hash-verified persistent cache readiness and fresh-worker offline inference with cancellation/interrupted-install recovery before app activation. Keep precise memory attribution and native/iPhone compatibility as separate gates. Finish safely and stop the automation at08:00IST.

**Decisions:**
- Keep this as one pinned experimental candidate, not the public model selection. Use immutable public artifacts and local-only inference; do not infer full 10,000-body indexing performance from copied vectors or infer offline restart from a resident worker.

## 2026-10-27 - Verified model cache and fresh offline workers

**Did:**
- Added an isolated public-artifact IndexedDB adapter with exact manifest identity, bounded hash-verified downloads, Web Lock serialization, generation staging and atomic complete-set promotion. Stored artifacts are reverified before promotion and on use. Cancellation, failed replacement and removal retain explicit outcomes.
- Passed eleven actual Chrome lifecycle cases, independent-worker termination/recovery and forced artifact-write/promotion transaction aborts. Both abort boundaries preserve the prior complete set. An initial DevTools quota override did not confirm quota failure, so that acceptance remains open and is recorded separately.
- Closed/reopened a dedicated Chrome profile, disabled networking and created two fresh workers. Both obtained all eight verified artifacts from the cache with zero fallback fetches and retained 29/30 synthetic top-three retrieval. Worker start through first vector measured 550.385 and 488.320 ms, not a p95 claim.
- Identified 72,342,952 bytes of embedded-WASM worker bootstrap. Selecting the pinned runtime's external-WASM export condition reduced the measured bootstrap to 641,638 bytes without changing model/runtime artifacts or retrieval. Repeated the original throughput/RSS workload and preserved its bundled baseline: warm p95 16.964 ms, max27.877 ms; scoped aggregate browser RSS still peaks at1,553,596,416 bytes.
- TypeScript, formatting and81 shared unit cases pass. No inference/cache code enters the app, no native CSP was relaxed, and no stopped native/relay probe, private note, AWS resource or billing change occurred.

**State now:**
- Persistent model artifacts and fresh offline inference have isolated Chrome evidence. Production app shell/CSP, true quota exhaustion, native/iPhone inference, memory budgets, consent/pause UI, private incremental vector deletion and held-out dogfood AC-06/14 remain open. A smaller bootstrap is not a proved RAM reduction.
- Canonical SPEC links the experiment evidence; approved0.7 mockups and production app behavior remain unchanged. Hosted CI remains blocked by the previously reported account restriction.

**Next:**
- Continue a bounded requirement-linked prerequisite before app activation, with native/iPhone/CSP/memory gates kept explicit. Do not rerun stopped WebKit/relay probes or unchanged hosted CI. At08:00IST finish the current safe batch, write the final handoff and delete the overnight automation.

**Decisions:**
- Use the runtime's supported external-WASM export condition and verified cache, rather than shipping redundant embedded binaries. Keep worker bootstrap availability separate from cached model availability. Treat actual storage rollback evidence separately from unconfirmed quota exhaustion.

## 2026-10-27 - OS sentence-model comparison

**Did:**
- Evaluated the already installed Apple NaturalLanguage English sentence embedding revision1 in a standalone serial Swift CLI, with networking denied. No WebView, OS UI, note database or asset download was used.
- Reused the unchanged frozen retrieval corpus. The candidate retrieved only9/30 expected notes in the top three; repeated cosine ranking remained unchanged. Exact-source retrieval and scalar/Accelerate arithmetic checks pass. Recorded an initial distance-control failure and its observed metric relationship separately.
- Measured 55.539 ms model/first-vector time, 621.279 ms indexing for70 notes/92 chunks and6.457 ms warm p95 over100 queries/10,000 copied rows. One-process peak physical footprint was82,739,920 bytes; this excludes full app/system accelerator/iPhone memory.

**State now:**
- This Apple model/cosine configuration fails the synthetic quality gate despite its small measured footprint. It is not chosen or activated. The29/30 all-MiniLM candidate still needs an appropriate measured native runtime; its model choice and public AC-06/14 remain open.
- Existing stopped WebKit/relay components were not retried. Production behavior, approved mockups, cloud resources and billing remain unchanged.

**Next:**
- Evaluate a native host runtime for the same pinned all-MiniLM artifact with the fixed corpus, rather than tuning this failed Apple configuration. Preserve native app/iPhone integration and memory limits as separate gates. Stop at08:00IST after a safe handoff.

**Decisions:**
- Reject this tested configuration on observed retrieval quality. Keep API/revision/OS identity and the unavailable Apple weight hash explicit; do not infer a public platform/model decision from a small standalone process.

## 2026-10-27 - Pinned model in a native CPU host

**Did:**
- Loaded the exact q8 all-MiniLM artifacts through existing Transformers.js4.3.1/ONNX Runtime Node1.30.0 in a fresh network-denied inference child. Pinned native library/binding hashes and license metadata. No new dependency, installer script, app process, OS UI or note database was used.
- Reused token-bounded source-complete chunks and the unchanged question corpus. Both fresh-process runs retrieve28/30 expected notes in the top three for semantic/hybrid ranks. q04 andq07 remain misses; the corpus/ranking was not tuned.
- The repeat records79.793 ms model/first-vector time after module import,262.036 ms indexing70 notes/75 chunks and8.081 ms warm p95 (max32.545) over100 queries/10,000 copied-vector rows. Child final RSS is293,519,360 bytes; parent/bundler and full-app/iPhone memory are outside this boundary.
- Linked the SPEC's derived-index fingerprint/rebuild requirement. Identical model weights yielded different per-case browser/native ranks; no cause or cross-runtime equivalence is assumed.

**State now:**
- The stronger pinned model has browser and native-engine feasibility evidence. The native test is a Node host, not a chosen shipping Mac bridge. Private incremental vector persistence, installer/UI/CSP, app resource limits, iPhone and held-out dogfood gates remain open.
- Approved mockups/current app behavior are preserved. No stopped WebKit/relay attempt, new AWS resource, real app billing or public launch occurred.

**Next:**
- Use a bounded requirement-linked prerequisite that fits the remaining overnight time; preserve native bridge/packaging and platform gates. At08:00IST finish safely, verify cleanup, write the morning handoff and delete the automation.

**Decisions:**
- Investigate a proper native bridge for the pinned model; do not choose the low-quality Apple configuration or assume Node is the final app architecture. Bind derived indexes to runtime/backend configuration and rebuild on changes.

## 2026-10-27 - Signed peer-relative clock diagnostics

**Did:**
- Added a separate signed request/reply diagnostic bound to installed-description transcript hashes, confirmed identities and fresh monotonic challenges. It returns a conservative relative-offset interval, never a corrected clock or permission to publish notes.
- Bounded outstanding/concurrent operations, message size and replay entries. Consumed a local challenge once, rechecked registry state after asynchronous crypto and protected immutable request/binding inputs. No note, store, HLC, session-claim or acknowledgement mutation occurs.
- Passed nine shared scenarios on actual Node and Chrome Web Crypto, including year-forward/back/both-wrong clocks, asymmetry, uncertainty, wall jumps, expiry after verification, forgery/replay/domain separation and revocation during a held verification. Actual concurrent replay-capacity checks do not overshoot512 entries.
- Exchanged public SPKI identities and signed packets across Node/Chrome in both directions through a synthetic RPC. Private keys remain in their originating runtimes; no real DTLS or OS clock change is claimed. TypeScript, formatting and82 shared cases pass.

**State now:**
- Peer-relative diagnosis has isolated evidence. Current durable-trust/wire composition, actual skewed-runtime transport, trusted time/repair, immutable-history repair and uncertain-draft publication policy remain open. Relatively aligned devices may both have incorrect UTC.
- Existing app behavior, five-minute edit quarantine and approved0.7 mockups are unchanged. No stopped WebKit/relay/native UI probe, real notes, AWS resources or billing settings were used.

**Next:**
- Finish the remaining safe overnight batch and prepare the morning handoff. At/after08:00IST verify owned cleanup, save the latest state, delete build-peel-overnight and stop. Do not turn this observation into a safe-time capability or enable peer sync without its remaining gates.

**Decisions:**
- Keep clock diagnostics independent from absolute session expiry and note authorization. Use relative bounds with explicit uncertainty; signatures prove statement authorship, not that a peer knows correct UTC.

## 2026-10-27 - Morning cleanup checkpoint

**Did:**
- Confirmed both prior relay reports still record verified deletion and both private lease files are absent. No AWS resource was provisioned during the search/clock work.
- Attempted a read-only refresh, then one bounded STS diagnostic. AWS CLI reports an expired login; no manual login, account configuration or infrastructure change was attempted. Stopped further AWS queries and kept fresh absence unconfirmed in the metadata.
- Confirmed the owned temporary clock/model-cache build and Chrome profile directories are removed. Preserved public-model/synthetic reproducibility artifacts and all unrecognized user data.

**State now:**
- Historical owned-stack cleanup is verified; today's fresh cloud read is unavailable until AWS login is renewed. This is not evidence of a new live resource or a newly confirmed absence. GitHub hosted CI also remains at the separately recorded account restriction.
- The latest code batch is pushed and local checks pass. The overnight cutoff is still08:00IST; the automation remains active until its final cutoff handoff.

**Next:**
- At/after08:00IST stop new work, write the final handoff/resume and delete build-peel-overnight. Later hosting work needs renewed AWS login; hosted CI needs GitHub Billing and plans review. Do not retry either unchanged block overnight.

## 2026-10-27 - Overnight cutoff and morning handoff

**Did:**
- Stopped new implementation at the 08:00 IST cutoff and deleted the overnight automation. The app confirmed its deletion at 02:30 UTC. No further recurring build wakeup is scheduled by this automation.
- Verified the existing Mac development bundle is present: version 0.1.0, 15,575,773 bytes. Production source paths and runtime dependency declarations are unchanged from its verified d969dde build; its executable hash is recorded in the morning build metadata. No application database was read or app process launched.
- Saved the review description, requirement evidence, cleanup limits and final ignored resume. Changes remain on the feature branch and draft PR 1; main was not merged.

**State now:**
- Local capture/library/word search and storage foundations are implemented. Shared TypeScript checks have 82 passing cases. Peer, meaning-search and clock work has isolated evidence, with its exact runtime/fixture limits in the feature documents.
- App remote sync, paid Cloud, iPhone and app meaning-search integration remain open. Actual native dragging/global dispatch, picker/drive/accessibility and supported-device performance still need controlled verification. No full public acceptance, billing or beta launch is claimed.
- AWS login expired, so fresh resource absence could not be reconfirmed; both prior relay deletions were verified and their leases are absent. No new AWS resource was provisioned afterward. Hosted CI remains at the separately recorded account restriction.

**Next:**
- Resume on Sandip's next request. First use a fresh synthetic data root for controlled unlocked native checks; quit any older Peel build before opening another build on the real root, because older builds ignore the new storage locks. Preserve the real default database and scratch/native-m0's unrecognized note.
- Renew AWS CLI login before later hosting work and review GitHub Billing and plans before hosted CI. Then finish the remaining M1/peer/runtime gates without treating diagnostic or model prototypes as app features.

## 2026-10-27 - Resume current-trust clock protocol work

**Did:**
- Checked the handoff, canonical specs and repo state. The Mac remains locked, and an older Peel process is still open on the real default data directory. Left both untouched.
- Added an isolated pre-session wrapper that loads only durably confirmed peer keys and rechecks the same trust generation after asynchronous clock diagnostic work.
- Verified four synthetic scenarios on actual SQLite and Chrome IndexedDB, including unpaired refusal, no diagnostic store writes, reconfirmation, mutated async input and revocation during signature verification. TypeScript, formatting and 83 shared cases pass.
- Recorded the measured limits in a feature plan, report and SPEC evidence link. No real notes, application database, cloud resource or running Peel window was used.

**State now:**
- Signed peer-relative diagnosis can be gated by current durable trust in the isolated M0 package. It still grants no note session, trusted UTC, clock repair or permission to publish a draft. The app does not import this wrapper.
- Actual Mac drag/shortcut/picker checks remain open while the desktop is locked. AWS login and hosted GitHub CI account restrictions remain unchanged.

**Next:**
- With an unlocked Mac, run controlled native M1 checks using a fresh synthetic `PEEL_DATA_DIR`, without touching the existing real-data process. For free sync, compose diagnostics with an actual installed-description channel and design trusted-time/epoch repair before publishing uncertain drafts.

**Decisions:**
- Keep revocation checks immediately before returning diagnostic output; packets already handed to transport cannot be recalled. Relative alignment alone is never a safe clock or publication authority.

## 2026-10-27 - Exercise signed clock packets on a bound Chrome channel

**Did:**
- Opened a same-page Chrome WebRTC data channel with separate synthetic IndexedDB stores and durably confirmed identities. Each side reconstructed the offer and answer hashes from its installed descriptions.
- Exchanged signed clock packets over connected host DTLS. Ten checks passed, including simulated one-year skew, ordinary session-expiry rejection, replay, wrong binding, malformed traffic, in-flight revocation and changed descriptions after renegotiation.
- Confirmed that diagnostic traffic left no note, session claim, clock or pending-delivery rows. Recorded candidate types and the bounded synthetic interval without SDP, IP addresses, keys or note content.
- Linked the evidence in the feature plan and SPEC. TypeScript, formatting and 83 shared cases still pass.

**State now:**
- The current-trust wrapper has a same-page host-channel composition check. It is still outside the app. The installed-description guard used here is in the fixture, not a production channel manager.
- Different-network direct/relay transfer, actual skewed OS/TLS transport, trusted time repair, native/iPhone runtime and all public peer-sync acceptance remain open.

**Next:**
- Build a production channel state machine around current trust, installed-description freshness and clock diagnostics, then verify it with different devices and network paths. Keep draft publication paused until a trusted-time/epoch policy has evidence. Run native M1 UI checks only after the Mac is unlocked and a fresh synthetic root is selected.

**Decisions:**
- Keep the pre-session diagnostic path body-free and separate from note authorization. A relative interval across DTLS still does not prove correct UTC.

## 2026-10-27 - Prototype paid Cloud client conflict handling

**Did:**
- Added an isolated Cloud client reducer with a strict wire snapshot, fixed-field operation hash, immutable in-flight mutation and local generation token for later transactional use.
- Preserved newer local text across acknowledgement/rebase and repeated 409 conflicts. Explicit resolution starts from the latest remote revision; a permanent purge blocks reuse of the old note ID.
- Verified five focused cases and matching Node/Chrome hash and transition results on synthetic notes. TypeScript, formatting and all 88 shared cases pass.
- Clarified the Cloud mutation wire fields in the SPEC and recorded the M0 limits. No AWS resource, account, entitlement, payment or app database was used.

**State now:**
- Cloud conflict/rebase behavior has a pure prerequisite contract. The app does not import it, and there is no API, DynamoDB transaction, Cognito identity, paid entitlement, live push or durable local integration.
- Native M1 verification is still waiting for an unlocked Mac. The old real-data Peel process remains untouched. AWS login and hosted CI account restrictions remain as previously recorded.

**Next:**
- Implement a failure-injected local repository transaction that atomically saves Cloud note state and pending mutation while rejecting stale asynchronous generations. Then build and test the owner-scoped conditional server mutation/409/idempotency contract before infrastructure deployment.

**Decisions:**
- Cloud request snapshots omit device-local and server-assigned revisions. `baseRevision` is the conditional precondition; device time never chooses the conflict winner. Keep real billing and Cloud activation off until plan terms and entitlement checks exist.

## 2026-10-27 - Make local Cloud state and outbox atomic

**Did:**
- Added a generation-checked durable Cloud repository and isolated SQLite/IndexedDB adapters. The first owning scope and note state commit together; later reads and writes reject another account/library/mode context or malformed schema/state.
- Kept local capture independent of cryptography. Held real hashing cannot overwrite a newer draft, acknowledgement retries preserve concurrent local saves, and failed preparation/ack/conflict/resolution transactions keep the prior complete state.
- Passed eight shared scenarios on both adapters, four actual SQLite SIGKILL boundaries and Chrome page reload recovery of current/pending text, immutable retry and both conflict branches. TypeScript, formatting and all 90 shared cases pass.
- Linked evidence in the SPEC and clarified that a pending permanent purge cannot become a same-ID upsert. Corrected the data-contract prose so peer stamps remain transferable through On-device sync. No app data, AWS resource or billing setting was used.

**State now:**
- Cloud local transaction/restart behavior has isolated evidence. App/native Rust integration, remote pull/cursor commits, account authentication/entitlement, mode migration and server conditional writes remain open.
- Conditional purge clears logical bodies after acknowledgement. Immediate removal of all retained local bodies, derived indexes and physical storage behavior still need the production deletion path; AC-07 is not complete.

**Next:**
- Implement the owner-scoped conditional server mutation/idempotency/409 contract with a failure-injecting store before DynamoDB deployment. Integrate the local repository with app storage after migration, deletion and account/session boundaries are explicit. Native UI checks still require a controlled unlocked Mac and fresh synthetic root.

**Decisions:**
- Store projection, base, pending operation and conflicts in one row. Use per-note generations and synchronous transaction boundaries; duplicate stale responses reject without changing saved work. Scope binding is local segregation and grants no paid entitlement or account authentication.

## 2026-10-27 - Connect conditional Cloud writes through a local HTTP service

**Did:**
- Added the server mutation service, transactional SQLite fixture, bounded Fetch HTTP handler and portable client response adapter. Writes condition on current account/entitlement revision, collection/mode generation and note revision.
- Kept retry receipts body-free and paired stable outcomes with current heads. Added server Trash deadlines, logical receipt expiry, permanent tombstones and private HTTP errors.
- Connected two durable clients over loopback HTTP through repeated conflicts, explicit merges, local restart and lost acknowledgements. A replay paired with a newer head retains the in-flight operation for reconciliation.
- Passed all 102 shared tests, including 12 server/HTTP cases, plus three actual server SQLite SIGKILL boundaries. TypeScript and formatting pass. Updated the SPEC envelope/receipt contract and requirement-linked evidence.

**State now:**
- Cloud writes have local service and client integration evidence using synthetic authentication and isolated SQLite. No hosted API, Cognito verifier, DynamoDB adapter, subscription or app UI is enabled.
- Full pull/bootstrap/cursor reconciliation, live push, production web/native auth, account erasure, mode migration and local deletion remain open. The conservative JSON item budget is not DynamoDB encoding acceptance.

**Next:**
- Implement paginated pull/bootstrap and atomic local cursor/head reconciliation, including newer-head retries that currently return reconciliation required. Then connect the real authentication and DynamoDB adapters through IaC/account/region/cost gates before enabling app Cloud mode.

**Decisions:**
- Include collection and mode generation even when a purge has no snapshot. Preserve receipt classification/revision separately from the current head, so retries never require retaining an old note body. Fixture account policy is server-owned and separate from request JSON.

## 2026-10-27 - Reconcile accepted writes against newer server heads

**Did:**
- Completed the durable per-note transition for a known-accepted operation paired with a newer current head. Clean clients adopt it; clients with newer local work keep that text as a conflict against the remote head.
- Preserved the prior acknowledged base rather than fabricating a historical snapshot. Current-generation CAS retries keep a save made during reconciliation, and permanent-purge success cannot advance back to content.
- Passed four shared scenarios on actual SQLite and Chrome IndexedDB, with clean/conflicted head transitions surviving page reload. The real loopback HTTP flow now adopts its newer head after recovering the earlier receipt.
- Passed TypeScript, formatting and all 103 shared cases, with eight existing store scenarios per adapter and four local SIGKILL boundaries also passing. Updated SPEC and evidence.

**State now:**
- The local HTTP write/retry flow now handles newer heads without leaving the accepted operation stuck. Missing-head conflicts and full collection bootstrap/cursor/push recovery remain open.
- These modules remain outside the app. No production authentication, AWS resource, payment, real note or existing Peel process was used. The Mac was observed locked during this continuation, so no native UI probe ran.

**Next:**
- Add stable paginated bootstrap/change cursors and atomic local page/head application, preserving pending work and handling history expiration. Then integrate real auth and DynamoDB under the existing deployment gates, followed by app mode UI and native/iPhone acceptance.

**Decisions:**
- A matched success receipt proves the old operation was accepted. Only a later local action remains an unsynced branch; preserve it for explicit conflict resolution. Copying text from a conflict with a remote purge requires a new note identity.


## 2026-10-27 - Add paginated Cloud download and atomic local cursors

**Did:**
- Added signed bootstrap/change rounds with bounded key scans, stable sequence limits, byte/item pagination, owner/library/mode binding and explicit snapshot-required errors for expired or missing history.
- Committed downloaded note states and pull progress in one generation-checked transaction. Preserved unsent drafts and immutable retries, including deferred remote deletions and newer heads consumed after acknowledgement or 409.
- Upgraded isolated local stores to schema/state version 2 with legacy-source preservation and failed-migration rollback. Fixed unhandled browser rejections from intentional migration aborts.
- Passed TypeScript, formatting and all 111 shared cases in 22 files. Four pull scenario groups pass on SQLite and Chrome IndexedDB, six local SIGKILL boundaries and three server boundaries pass, and browser reload retains notes, deferred heads and the next cursor.
- Updated SPEC, requirement-linked plan/evidence and future hosted check steps. Synthetic loopback clients now bootstrap and catch up from their own durable checkpoints.

**State now:**
- Cloud writes and collection downloads have isolated local service/recovery evidence. No application mode, Cognito/session verifier, DynamoDB adapter, live push, payment or AWS deployment is enabled.
- Public v1 scope and the v0.7 mockup baseline remain intact. Native UI acceptance, remote peer transport and production deletion/account/mode boundaries remain open. No real notes or existing Peel process were accessed.

**Next:**
- Implement the production authentication/session and DynamoDB adapter contracts under the existing IaC/account/region/cost gates, including cursor key management and consistent Query bounds. Then integrate app mode migration, local body/index deletion and sync/conflict UI. Resume controlled native acceptance only with an unlocked Mac and a fresh synthetic root.

**Decisions:**
- A new local store must bootstrap; a change round can only resume its own completed sequence. Page continuation lasts 15 minutes, completed checkpoints 90 days, with provisional limits of 32 records, 512 KiB heads and 640 KiB serialized pages. Restored-server absence cannot silently erase local-only work.


## 2026-10-27 - Verify Cloud access tokens in a focused PR

**Did:**
- Updated shared agent instructions to merge each ready PR individually, using sprint boundaries for planning/demos/releases. PR 1 is already merged; this change starts on a fresh codex branch.
- Added a server-only Cognito bearer resolver using pinned aws-jwt-verify 5.2.1. It checks token type, configured pool/client/scope, signature, lifetime and subject before resolving authority.
- Kept credentials and verification details out of HTTP errors. Unknown keys fail closed; unavailable key retrieval produces a private retryable error. Existing account and paid-entitlement policy remains authoritative after authentication.
- Passed five synthetic RSA/HTTP cases, TypeScript, formatting, production web build and all 116 shared cases in 23 files. No real token, account, app database or AWS resource was used.

**State now:**
- One standalone access-token boundary is ready for review/integration. Real Cognito login, native PKCE callbacks, web sessions/CSRF, DynamoDB and app Cloud activation remain separate work.
- GitHub's current main jobs ran zero steps and report an account payment/spending restriction. Local verification passes; hosted CI is unavailable, not passing. The production bundle's prior size warning remains.

**Next:**
- Merge this focused PR after its final review and applicable repository gates, then take one separately planned auth/session or DynamoDB slice. Do not append those features to this PR. Verify the account's GitHub Actions billing state before expecting hosted checks to run.

**Decisions:**
- Use the AWS-recommended verifier instead of custom JWT cryptography. A token never chooses a key destination or grants paid entitlement. Individual ready PR merges replace sprint-batched integration globally.


## 2026-10-27 - Prepare a clean public source snapshot

**Did:**
- Reviewed the old remote histories, source, Actions logs and design assets for credentials/private data. Detailed audit inputs stay private.
- Kept personal Git author metadata private by starting a fresh history with GitHub no-reply attribution. The original repository remains a separate private archive.
- Copied all current tracked source/docs and local logo explorations, excluding ignored notes, databases, credentials, exports, dependencies, builds and session state.

**State now:**
- This repository is a source snapshot, not a public-beta release. Earlier commit/run identifiers in evidence belong to the private archive.
- Fresh installation exposed missing pnpm 11 build-script decisions. That fix and CI trigger deduplication will each use a separate small PR before hosted verification.

**Next:**
- Fix the explicit dependency build policy, run fresh checks, publish the clean repository and run CI. Continue one standalone purpose per PR.

**Decisions:**
- A fresh history avoids retaining private email in old PR copies. Existing local/private work stays preserved in the original checkout.


## 2026-10-27 - Make dependency installation reproducible on pnpm 11

**Did:**
- Replaced the old build-script allowlist with explicit allow/deny decisions. esbuild remains allowed; the two reviewed transitive postinstall scripts are denied at their pinned versions.
- Verified frozen installation, TypeScript, 116 shared tests, formatting, web build and the packaged native CPU binding on the fresh checkout.

**State now:**
- Clean installs proceed without permitting optional binary downloads or weakening strict script review. Hosted PR checks still need to run; existing bundle-size warning remains.

**Next:**
- Review and merge this standalone policy fix, then remove duplicate feature-push CI triggers in a separate PR.

**Decisions:**
- The packaged CPU runtime is sufficient for current checks. GPU/platform extras need a separate reviewed decision.


## 2026-10-27 - Run Cloud recovery fixtures from a clean checkout

**Did:**
- Added idempotent scratch-parent creation before the two Cloud scripts allocate owned temporary directories. Assertions, cleanup and application storage are unchanged.
- Reproduced hosted Linux's ENOENT and passed both corrected scripts starting without scratch, including SQLite/IndexedDB recovery and nine total process-kill boundaries. Formatting passes.

**State now:**
- The dependency-policy parent PR has a passing full hosted Mac build/native suite. Its Linux job passed install/tests/build and revealed this independent fixture setup issue.

**Next:**
- Verify the stacked fix in hosted CI, merge the dependency and fixture PRs in order, then deduplicate CI triggers separately.

**Decisions:**
- Fix clean-checkout setup without suppressing recovery experiments or reducing their coverage.


## 2026-10-27 - Avoid duplicate CI on feature branch updates

**Did:**
- Limited push-triggered checks to main. PR events still validate every proposed change; both existing jobs and their commands remain unchanged.
- Parsed and compared old/new YAML to verify that only the push branch list changed.

**State now:**
- Feature branch pushes no longer duplicate a PR's complete suite. Main integration checks still run after applicable merges. Hosted verification is pending.

**Next:**
- Merge the small CI repair stack in dependency order once the combined hosted checks pass, then continue product work in fresh branches.


## 2026-10-27 - Preserve commit privacy after source publication

**Did:**
- Recorded repository instructions for GitHub no-reply commit and merge identities, explicit merge-author selection and post-merge metadata verification.
- Recorded successful anonymous public access, private archive preservation and clean staged/root-history scans without publishing identifying audit values.

**State now:**
- The new public repository has no old private refs, PRs or Actions history. Fresh CI is executing; its setup repairs remain separate focused PRs.

**Next:**
- Complete hosted verification and merge the small repair/documentation stack in order, verifying no-reply metadata after every merge. Continue product work from the new checkout.


## 2026-10-27 - Add conditional DynamoDB Cloud storage

**Did:**
- Implemented the existing Cloud mutation/read contract using the pinned server-only AWS SDK, coherent transaction reads and conditional all-or-nothing writes. Account policy/generation, note revision, receipts and compact change sequence participate in the commit.
- Shared the existing transition invariants with SQLite. Purge replaces note content with a permanent body-free marker; receipt/change TTL is separate from logical expiry. Encoded attribute sizes are checked before submission.
- Passed nine actual DynamoDB Local cases with synthetic data, including concurrency, revocation at commit, lost responses, expiry, isolation, malformed storage, exact size bounds and private retryable failures. Added a checksum-pinned disposable runtime runner to Linux CI.

**State now:**
- TypeScript, all 116 shared tests, source formatting and web build pass. Hosted checks are pending. The app's Cloud mode is not activated and no AWS resources or real credentials were used.

**Next:**
- Finish hosted checks and merge this focused PR, then plan DynamoDB Query pagination separately. Native/web login and sessions, hosted infrastructure, live push and app integration remain distinct work.

**Decisions:**
- Use the same mutation service and invariants on both backends. Keep transactional correctness testable locally without provisioning billable infrastructure. Managed-service costs, IAM, backup and rollout still need hosting evidence.


## 2026-10-27 - Complete DynamoDB paginated Cloud download

**Did:**
- Added bounded, account-scoped base-table Query support to the existing signed bootstrap/change service, with metadata-bound validation, real continuation handling and post-query paid-policy checks.
- Resolved the large-page fixture: DynamoDB Local includes its size-crossover record, so six notes exhausted the data before a continuation was needed. Seven real notes now force a genuine byte-limited second request; completeness assertions and ordinary projections remain intact.
- Passed all 15 actual DynamoDB Local cases, including six pull cases and durable SQLite page application during creates/edits/purges, resumed catch-up, history gaps, policy revocation and empty/non-progressing continuation guards.

**State now:**
- PR 5 is merged after hosted Linux/Mac success; its main integration rerun also passed. This separate pagination branch is undergoing final checks. Hosted DynamoDB and app Cloud activation remain open.

**Next:**
- Merge this focused PR after hosted checks pass, then implement the browser session/CSRF boundary or native authorization handshake in another small PR. Keep login, hosting and live delivery separate.

**Decisions:**
- Fix the evidence rather than relax the pagination contract. Local engine tests remain distinct from managed-service consistency, cost, IAM and restore acceptance.


## 2026-10-27 - Protect browser Cloud requests with sessions and CSRF checks

**Did:**
- Added a server-only session boundary with opaque random host-only cookies, credential digests, explicit expiry/revocation and independent anti-CSRF tokens. Identity is resolved through a trusted issuer and never JSON owner/paid flags.
- Enforced HTTPS origin, optional Fetch Metadata and protected unsafe requests before body/note access. Rotation and logout withhold cookie changes when persistence fails.
- Passed seven focused security/HTTP groups and all 123 shared cases, TypeScript, source formatting and production web build. Two synthetic sessions access isolated SQLite note data and still pass through current paid policy.

**State now:**
- Issue 10 in Cloud sync foundations is ready for focused PR checks; PR 6 pagination is merged after hosted Linux/Mac success. Hosted checks for this session slice are pending. Managed login, durable sessions and app Cloud activation remain open.

**Next:**
- Merge after relevant gates, then pick issue 11 for durable DynamoDB sessions. Keep provider login/refresh and hosted routes in their own issues/PRs.

**Decisions:**
- Separate the cookie/request contract from persistence and identity-provider integration. Its synthetic stores/authentication are partial evidence, not production account acceptance.


## 2026-10-27 - Preserve the full DynamoDB retry-retention deadline

**Did:**
- Added issue 16 for a separately scoped retention bug. Whole-second TTL values now round up instead of down; logical service deadlines remain unchanged.
- Reproduced early loss of a stable receipt at a subsecond deadline with simulated eligible physical cleanup. The regression fails before the fix and passes afterward, including logical expiry with delayed physical cleanup.
- Passed all 16 actual DynamoDB Local cases, all 123 shared cases, TypeScript and changed-source formatting. Permanent markers remain TTL-free.

**State now:**
- The fix is ready for its own PR and hosted checks. No deployed table/user migration or AWS timing behavior is claimed.

**Next:**
- Merge after its dependency and hosted gates, then implement issue 11 for durable browser sessions. Continue the current Cloud foundations milestone one small issue/PR at a time.


## 2026-10-27 - Persist browser sessions and revocation in DynamoDB

**Did:**
- Planned issue 11 as one durable-store slice. Added explicit-client atomic session/directory inserts, strongly consistent digest lookup and bounded conditional revocation, with no raw browser credential storage.
- Verified disposable DynamoDB tables across fresh clients and a separate Node process. Six new groups cover collisions, account isolation, durable logout, concurrent revocation/deletion, logical expiry, malformed state and private failures.
- Passed all 22 DynamoDB cases, all 123 shared cases, TypeScript, source formatting and the production web build. Browser assets remain unchanged; no AWS resources or real notes were used.

**State now:**
- Earlier session and TTL PRs are merged with passing hosted checks, including their main integration runs. This durable-store slice is ready for its own hosted checks; login and app Cloud activation remain disabled.

**Next:**
- Merge the focused issue 11 PR after its gates, then plan issue 12 for the authorization-code PKCE handshake. Keep hosted storage, account-wide cleanup and provider refresh separate from this adapter's evidence.

**Decisions:**
- The global lookup is the single authorization source. A body-free owner directory enables future account cleanup without a table Scan; its presence never grants access. Physical TTL is cleanup only, with deadlines rounded up and logical expiry enforced by the request boundary.


## 2026-10-27 - Bound authorization attempts with PKCE and exact callbacks

**Did:**
- Planned issue 12 as one handshake slice with pinned provider/client/callback and actual S256 challenges. Private per-initiator state, verifier and nonce support one bounded attempt without an embedded secret.
- Rejected malformed, mismatched, duplicated, expired and replayed callbacks before an injected exchange. Consumption precedes asynchronous work; cancellation/replacement also withholds late candidate results.
- Passed seven security/failure groups and all 130 shared cases, TypeScript, source formatting and the production web build. No real provider, token or app login was used.

**State now:**
- PR 19 durable sessions merged with hosted Linux/Mac success; its main integration run also passed. Cloud foundations are 6/9 complete. This handshake is ready for its own focused hosted checks; native execution, provider exchange and browser-bound shared attempt storage remain separate gates.

**Next:**
- Merge issue 12 after hosted gates, then plan issue 13 for a bounded composed Lambda HTTP handler. Preserve the distinction between backend foundation tests and usable app Cloud login.

**Decisions:**
- A private Node instance owns one initiator's attempt. Restart loses it safely. Do not treat a shared singleton as a web login service; browser binding and atomic multi-worker attempt persistence must precede exposed routes.


## 2026-10-27 - Bound Lambda payload-v2 event conversion

**Did:**
- Split issue 13 into transport issue 21 and a dependent authenticated-composition PR after the combined draft exceeded a comfortable review size. Recorded the decomposition in the milestone and issue; no product scope changed.
- Added an isolated trusted-origin event/response adapter with bounded URL, headers, cookies, UTF-8/base64 bodies and response streams. Raw query duplicates and duplicate cookies survive conversion for the service to reject.
- Added focused transport failure and response tests, including cancellation of oversized streams and separate Set-Cookie response entries. No listener or AWS resource is created.

**State now:**
- PRs 19/20 are merged and their main integration checks passed. Transport and authenticated composition are separate review units; local final checks and hosted transport gates are pending.

**Next:**
- Verify and merge the transport PR, then finish issue 13's composed Cognito/session and DynamoDB integration PR. Issue 14 remains the broader recovery/isolation evidence slice.

**Verification:**
- TypeScript, source formatting, all 134 shared cases, all 22 existing DynamoDB Local cases and the unchanged web build pass. Hosted transport checks are pending. The dependent composition draft is committed on its own unpublished branch, keeping transport validation independent.


## 2026-10-27 - Compose verified identity and DynamoDB behind Lambda data routes

**Did:**
- Added a configured service factory over the separate payload-v2 adapter, selecting pinned Cognito bearer verification or durable session/CSRF verification with explicit client/table/cursor key dependencies.
- Exercised actual mutation, conflict, owner-isolated reads, signed pagination/checkpoint and purge catch-up routes with synthetic RSA identities and disposable DynamoDB tables. Browser cases cover current paid policy, unsafe origin/CSRF, cookie ambiguity and exact expiry.
- Passed all 135 shared cases, 24 DynamoDB Local cases, TypeScript, source formatting and the unchanged web build. A private SDK failure returns no details; no real account/token/note or resource was used.

**State now:**
- Transport PR 22 is undergoing hosted gates. This related composition slice is on its own branch and will have separate PR checks after its transport dependency merges. Login routes, real issuance, hosting, live push and app activation remain open.

**Next:**
- Merge the transport and composition PRs in order after their gates. Then implement issue 14's composed recovery/account-isolation evidence before closing M2.1.


## 2026-10-27 - Exercise composed Cloud recovery with durable local clients

**Did:**
- Planned issue 14's exit evidence before implementing three composed local-engine groups with synthetic RSA identities and fresh SQLite stores.
- Verified interrupted/failed page commits and reopen, cursor/owner isolation, identical retry after a lost response, later-draft conflict preservation/resolution and stale purge rejection with new-ID recovery.
- Verified expired/revoked sessions, inactive entitlement and a private SDK failure cannot mutate saved drafts or retries through the reply validator. Reopen preserves them, and restored authorization completes both the original and later work.

**State now:**
- All 27 DynamoDB cases and TypeScript pass; final shared/build/hosted checks are pending. Prior main integration 40535667266 is now successful. M2.1 remains open until this evidence PR passes and merges; no app Cloud login, hosting or live delivery is enabled.

**Next:**
- Finish focused checks/review and merge this issue 14 PR, then close the foundation milestone with explicit remaining gates. Keep the separate public-repository SPEC wording fix in issue 24 out of this test PR.

**Verification:**
- All 135 shared cases, 27 DynamoDB Local cases, TypeScript, source formatting and the unchanged web build pass locally. The existing bundle-size warning remains; hosted checks are pending.


## 2026-10-27 - Align canonical repository references after public migration

**Did:**
- Corrected SPEC's stale private-repository/workspace paragraph to the clean public peel checkout, retaining the private archive boundary and deployment/beta/license distinction.
- Confirmed M2.1's ten deliverables closed after PR 25 passed both hosted jobs and merged. Its main integration also passed; the foundation evidence is 135 shared and 27 local DynamoDB cases, not complete app/M2 acceptance.
- Opened the next controlled-dev-hosting milestone with seven PR-sized issues before implementation. No AWS resource or app feature was enabled.

**State now:**
- This issue 24 change is documentation only. Runtime checks remain unchanged; its PR gates are pending.

**Next:**
- Merge after documentation review/repository gates, then issue 26: verify current official runtime/pricing/permission sources and write the hosting/cost/lease plan before infrastructure code or provisioning.


## 2026-10-27 - Plan a bounded private managed Cloud experiment

**Did:**
- Merged documentation PR 32 after both hosted jobs passed (run 40546710906); GitHub closed issue 24 and recorded merge 6ccb401 with no-reply attribution.
- Wrote issue 26's requirement-linked hosting plan, current us-east-1 price sources, USD 2/run allowance, at most two runs and USD 1 cleanup reserve, with arithmetic checked against a USD 1.488729 conservative forecast.
- Refined the first hosted experiment to operator-only Lambda Invoke with real Cognito/DynamoDB. Best-effort public API throttles do not establish a bounded spend ceiling; actual API Gateway/app/live acceptance stays open.
- Specified independently rehearsed deletion, exact ownership, short lease, synthetic suppressed-delivery users and account/source/cost gates before provisioning. Linked the plan from SPEC without changing public v1 scope.

**State now:**
- No AWS resource, managed user, public endpoint or app feature was enabled. The plan is implementation guidance; artifact/IaC/guard/cleanup/managed evidence remains required.

**Next:**
- Merge this focused documentation PR after its gates, then issue 27's reproducible Node 24 Lambda artifact and offline checks.

**Verification:**
- Reviewed official runtime, regional price-list, Cognito callback/scope/suppression and Scheduler/CloudFormation deletion sources; arithmetic and git diff whitespace checks pass. No runtime change or new runtime test; hosted repository checks remain pending.


## 2026-10-27 - Package the private development Cloud service

**Did:**
- Merged PR 33's bounded hosting plan after both hosted jobs passed (40550678688); issue 26 closed at merge c396538 with no-reply attribution. M2.2 now has two completed planning/documentation items, not completed hosting.
- Added issue 27's development-only server entry with explicit configuration, fixed lease, fail-closed warm expiry, private errors, nonextractable cursor key and bounded SDK retries/timeouts without configured endpoint overrides.
- Added a pinned esbuild 0.28.2 deterministic ZIP build, dependency notices, input/external-module/size checks and artifact hashes. No app or client database enters the bundle.
- Added three actual unpacked-artifact smoke modes under verified Node 24 with synthetic environment, temporary-only filesystem permissions and blocked network entry points, plus a focused hosted artifact job.

**State now:**
- No AWS resource, real identity, public endpoint or app Cloud capability is enabled. The artifact remains a development prerequisite; managed identity/data/IAM/cleanup evidence is open.

**Next:**
- Merge this single-purpose artifact PR after focused review and all three hosted jobs, then issue 28's disposable data/identity IaC. Preserve the private-invoke/no-public-ingress plan and all provisioning gates.

**Verification:**
- 139 shared cases, 27 DynamoDB Local cases, TypeScript, formatting and web build pass locally. Actual Node v24.22.1 packaged smoke passes all three modes with zero network attempts; the 336,713-byte ZIP reproduces across repeated builds and UTC/Asia-Kolkata. Browser bundle-size warning remains. Hosted gates are pending, not claimed passing.


## 2026-10-27 - Define disposable Cloud data and identity

**Did:**
- Confirmed all three postmerge main jobs passed for PR 34 at run 40554519940. No app or hosted resource was activated by that artifact merge.
- Added issue 28's requirement-linked plan and pure six-resource DynamoDB/Cognito template with isolated UUID names, bounded on-demand capacity, AWS-owned encryption, expendable-item TTL configuration and explicit deletion behavior.
- Defined administrator-only synthetic identity configuration, a public code-flow client/custom scope, reserved callback and managed-login domain/branding, without creating users, credentials, roles or a data API.
- Pinned the isolated AWS cfn-lint toolchain and its CI setup code; added offline rendering/schema checks plus runtime/PKCE wiring and policy cases.

**State now:**
- Template and protocol wiring are defined locally. Managed issuance, IAM, hosted storage, secret/lease/deletion controls and app/live acceptance remain open. No AWS account operation or resource creation occurred.

**Next:**
- Merge this focused IaC PR after hosted gates and review, then issue 29's private Lambda/owned-artifact/key/independent-cleanup definitions. Actual provisioning remains gated by issue 30 and the cleanup rehearsal.

**Verification:**
- 142 shared cases, TypeScript, formatting, Node 24 rendering and packaged checks, provider-schema lint and web build pass locally. A malformed table-class control is rejected. The existing browser-size warning remains; the Lambda ZIP/hash is unchanged. Hosted checks are pending.


## 2026-10-28 - Define private Lambda hosting and its artifact dependencies

**Did:**
- Confirmed PR 35's postmerge main run 40559095214 passed all three jobs. The data/identity definitions remain unprovisioned.
- Added issue 29's pre-code plan and pure templates for an owned private encrypted artifact bootstrap and the main data/identity/function stack, avoiding a not-yet-uploaded code dependency in one stack.
- Defined exact-table reads and transaction-only Put/Delete/ConditionCheck permissions, a required NoEcho cursor key stored through Secrets Manager and dynamic environment reference, fixed lease, 30-second/256-MiB limits and reserved concurrency one.
- Kept public ingress, log-write/admin permissions and deployment tooling absent. Updated the canonical hosting breakdown to put independent cleanup/rehearsal in issue 36 before any provision/cleanup runner.

**State now:**
- Hosting/configuration definitions pass local checks. No AWS account operation, resource, user, key, note or public endpoint was created. Actual IAM/reservation/secret/lease/deletion evidence and app Cloud activation remain open.

**Next:**
- Merge this focused definition PR after hosted gates, then implement issue 36's separate outside-stack deletion role, Scheduler and sentinel definitions before issue 30's guarded runner.

**Verification:**
- 146 shared cases, TypeScript, source/script formatting, three provider-schema templates, existing Node 24 packaged checks and web build pass locally. Lambda ZIP/hash is unchanged; the existing browser warning remains. Hosted checks are pending, not claimed passing.


## 2026-10-28 - Define independent Cloud cleanup authority

**Did:**
- Confirmed PR 37's postmerge main run 40563840614 passed all three hosted jobs.
- Added issue 36's pre-code plan and separate guard/sentinel factories. The guard keeps its deletion role and two one-time schedules outside the exact owned data/sentinel stacks.
- Confined Scheduler to those two targets and the dedicated CloudFormation role, with current-account/schedule-group trust. Resource deletion authority excludes notes, key reads, invocation, creation, retagging and guard/artifact deletion.
- Documented the actual scheduled-rehearsal gate, metadata response redaction, minute-level Scheduler precision, asynchronous secret removal and Cognito's 14-day inactive retention.

**State now:**
- Offline definitions and policy checks pass. No AWS account operation or resource creation occurred. Actual rehearsal, provider permissions and teardown remain unproven; app Cloud stays disabled.

**Next:**
- Merge this single-purpose PR after hosted gates and focused review, then split issue 30's pure source/account/cost/ownership guards from lifecycle tooling as needed. No managed data probe before observed cleanup rehearsal.

**Verification:**
- 151 shared cases, TypeScript, formatting, five provider-schema templates and actual Node 24 packaged checks pass locally. The Lambda ZIP/hash is unchanged. Hosted jobs are pending, not claimed passing.


## 2026-10-28 - Validate controlled Cloud deployment plans

**Did:**
- Merged PR 38 after all three jobs passed in run 40566248104; confirmed all three postmerge main jobs passed in run 40568105384. Updated issue 36's evidence and closed status without claiming an actual cleanup rehearsal.
- Split issue 39's pure plan policy from issue 30's preflight/lifecycle/CLI tooling before implementation and wrote its requirement-linked feature plan.
- Added exact-data validation for separately pinned account/profile/region, merged source/artifact/template bindings, successful CI, fresh observations, quota/audit safety, fixed lease, authorization and refreshable credential cleanup runway.
- Bound normalized official-rate observations to a conservative integer-microdollar forecast and a two-run/USD 5 operational envelope. Reject duplicate/unresolved/exhausted run slots, extra sensitive fields, coercion and stale/unsafe inputs with private fixed errors.

**State now:**
- Offline policy validation is implemented; no AWS account operation, resource, key or apply command exists in this slice. Collection, atomic run reservation, owned lifecycle, actual rehearsal and managed acceptance remain open. App Cloud stays disabled.

**Next:**
- Merge this focused policy PR after hosted gates and review. Then create the read-only preflight-adapter issue and collect trusted account/source/price/quota/credential observations without provisioning. Keep issue 30 open for its full lifecycle/cleanup acceptance.

**Verification:**
- 161 shared cases, TypeScript, formatting, web build, five provider-schema templates and actual Node 24 packaged checks pass locally. The Lambda artifact is unchanged; the browser bundle warning remains. Hosted checks for this new PR are pending.


## 2026-10-28 - Verify official Cloud offer dimensions and marginal paid tiers

**Did:**
- Confirmed PR 40's postmerge main run 40572347468 passed all three hosted jobs. Issue 39 has linked integration evidence; account readiness remains unclaimed.
- Inspected the six current official regional offers and separated issue 42's pure parser from issue 41's HTTP collection before opening a PR, with the canonical feature plan and tracker updated.
- Added exact service/region/family/operation/storage/unit/SKU/term/rate validation, continuous paid-tier selection, exact decimal ordering and normalized source/selection provenance using small synthetic identities.
- Verified all six current public inputs through the actual parser under Node 24, including marginal Scheduler and DynamoDB storage rates beyond their leading free ranges.

**State now:**
- Parser checks pass locally. HTTP deadline/cancellation/aggregate collection and its command remain issue 41; private account/source preflight and owned lifecycle/apply remain issue 30. No authenticated AWS operation, hosted resource or app Cloud feature was created.

**Next:**
- Merge the focused parser PR after hosted gates and review, then finish issue 41's separately reviewed HTTP collector. Keep actual managed proof in issue 31.

**Verification:**
- 169 shared cases, TypeScript, formatting, web build, five provider-schema templates and Node 24 focused/packaged checks pass locally. Six public offer bodies total 1,342,298 bytes and reproduce the USD 1.488729 forecast. Lambda ZIP/hash is unchanged; the browser warning remains. Hosted checks are pending.


## 2026-10-28 - Collect bounded public Cloud price observations

**Did:**
- Merged PR 43 after all three jobs passed in run 40576765140 and confirmed all three main jobs passed in run 40578202408. Issue 42 has linked evidence, with HTTP acceptance kept separate until this follow-up.
- Added issue 41's six fixed-origin public HTTPS requests, credential omission, redirect rejection, streamed body bounds, shared deadline and cancellation on any failure.
- Bound the actual parser's immutable source provenance and twelve normalized rates into the existing deployment-plan quote shape, without cached or hardcoded fallback.
- Added a read-only no-argument command that writes public observations to unique ignored restricted files and reports cost/source facts without inspecting an AWS account.

**State now:**
- The actual Node 24 command collects all six current public offers and reproduces the conservative USD 1.488729 forecast. No authenticated AWS operation, hosted resource, customer billing or app Cloud activation occurred. Account/source preflight and lifecycle/apply remain open.

**Next:**
- Merge this focused HTTP-collection PR after hosted gates and review, then plan a separately tracked private account/source/quota/audit/credential preflight boundary. Issue 30 and actual managed proof in issue 31 remain open.

**Verification:**
- 176 shared cases, TypeScript, formatting, web build, five provider-schema templates and Node 24 focused/packaged checks pass locally. The public-only command observes 1,342,298 bytes from six sources, with no account/resource operations. Lambda ZIP/hash is unchanged; the existing browser warning remains. Hosted checks are pending.


## 2026-10-28 - Observe private AWS identity and direct session runway

**Did:**
- Confirmed PR 44's postmerge main run 40580268639 passed all three jobs. Its price collection evidence remains separate from actual account readiness.
- Added issue 45's pre-code plan and bounded read-only collector using an independent existing SSO profile configuration, explicit regional STS and private process-format credential resolution.
- Blocked CLI history, credential/config/endpoint overrides and unsupported profile flows before authentication. Kept exported credentials, raw session ARNs and child error payloads out of normalized output and reports; reported direct expiry without inventing refresh proof.
- Verified a private live Node 24/AWS CLI observation: configured identity/role matched, the session was active and direct runway covered the projected two-hour window. Restricted ignored output contains normalized metadata only.

**State now:**
- Identity/session observation works; no resource/configuration was created or modified, and app Cloud remains disabled. Later runway and source/quota/audit/ownership/lifecycle/managed gates remain open. No real note/default database was accessed.

**Next:**
- Merge this focused credential-boundary PR after hosted gates/review, then implement separately tracked source/artifact attestation and quota/audit observation before owned lifecycle/apply tooling. Recheck actual credentials against the exact lease before any write.

**Verification:**
- 186 shared cases, TypeScript, formatting, web build, five provider-schema templates and Node 24 focused/packaged checks pass locally. A private output-mode/redaction check passed; no account identifiers or credential values enter this log. Lambda ZIP/hash and browser warning are unchanged. Hosted checks are pending.

## 2026-10-28 — Bind Cloud inputs to reviewed public main

**Did:**
- Implemented issue 47's read-only source observation: clean main/origin/remote identity, latest exact workflow attempt and all three successful jobs, with drift rechecks.
- Reused the deterministic in-memory builder twice; bound ZIP, lock and all five run-specific templates to a fresh 90-minute lease. Added a Node 24 command that only creates new ignored restricted artifacts.
- Added eleven focused cases. All 197 shared cases, TypeScript, formatting, web build, five template checks and Node 24 packaged checks pass locally; feature-branch command safely reports not-ready. Hosted review/gates follow before integration.

**State now:**
- PR 46 merged as a8c28266a6ac8e09957dce7f9413718121442098; both its PR and main runs passed all three hosted jobs. A private live identity observation matched configured SSO/account/role, with active direct cleanup runway at collection, no refresh claim and zero resource writes.
- Source observations remain prerequisites, not managed acceptance. App Cloud stays disabled; product v0.7 is unchanged. No AWS resource/configuration, real note/default database or billing access occurred.

**Next:**
- Merge the focused source PR only after hosted gates; verify its clean-main command. Then split issue 30's remaining account quota/audit/ownership inspection and owned lifecycle/recovery work before any apply. Keep issue 31 open for actual managed proof and teardown.

## 2026-10-28 — Observe regional Cloud capacity without changing quotas

**Did:**
- Implemented issue 49's focused read-only capacity collector/command, reusing configured identity verification and rechecking STS after regional Lambda GetAccountSettings.
- Preserved the final 100 unreserved units: a quota below 101 remains not-ready. No reservation/quota/account/billing/resource changes are performed.
- Added eight focused cases under development Node and actual Node 24; all 205 shared cases, TypeScript, formatting and web build pass locally.

**State now:**
- A private live observation matched identity, confirmed capacity and direct cleanup runway, and recorded normalized ignored mode-0600/0700 output without raw identity/credential fields. Refresh stays unproven; later facts require rechecking.
- Source PR 48 merged as 97992b9fe39f6d2accc637c9a036e6c952961ae8 after all three PR jobs passed. Its command correctly refused still-pending main checks. App Cloud remains disabled; no real note/default database or managed resource was accessed.

**Next:**
- Finish hosted capacity gates/review, record clean-main source observation after its gates, then separate audit/ownership metadata and atomic owned lifecycle/recovery work under issue 30. Actual managed proof/teardown remains issue 31.

## 2026-10-28 - Verify complete public audit-region coverage

**Did:**
- Split issue 51's public Lake coverage prerequisite into issue 52 before private account collection, keeping registry and account review separate.
- Implemented a complete-table parser and bounded fixed-source HTTPS collector. Changed/partial registry coverage is not-ready; GovCloud is excluded only after validating the full published set.
- Verified eight focused cases under development Node/actual Node 24, all 213 shared cases, TypeScript, formatting and web build. A live public fetch validated 30 rows and 28 commercial regions with zero account/resource access.

**State now:**
- Capacity PR 50's main run 40590673768 passed all three jobs. App Cloud remains disabled; no new AWS resources or settings, real notes/default database or customer billing were accessed.
- This registry helper proves neither private audit absence nor regional/organization visibility. Hosted gates/review follow before integration.

**Next:**
- Merge the focused registry PR after all hosted gates, then implement issue 51's private hook/audit observer. Treat denied, disabled-region, organization or partial coverage as unknown; preserve every existing account setting. Keep ownership and durable lifecycle/apply separate under issue 30.

## 2026-10-28 - Inspect hook and audit configuration without changing it

**Did:**
- Implemented issue 51 on a dependent branch after PR 53's registry boundary, keeping the two purposes separate.
- Added pinned read-only organization, hook, shadow-trail and regional Lake presence checks, with four-reader bounds, identity recheck, fixed failures and private normalized output.
- Tested complete absence, present/partial/member/denied coverage, privacy and cancellation. Twelve focused cases pass under actual Node 24; all 225 shared cases, TypeScript, formatting and web build pass locally.

**State now:**
- Parent PR 53 has passed all three hosted jobs and can merge first. Private live audit metadata and this branch's hosted gates remain unclaimed at this checkpoint.
- No AWS resources/settings, audit payloads, real notes/default database or customer billing were accessed. Cloud remains disabled; v0.7 is unchanged.

**Next:**
- Integrate PR 53, run one bounded private metadata observation, record any coverage blocker honestly, and finish the focused audit PR gates. Keep target ownership and durable lifecycle/apply/recovery as separate issue 30 work.

## 2026-10-28 - Keep incomplete audit coverage explicit

**Did:**
- Merged registry PR 53 after all hosted PR jobs passed, then made two bounded private audit attempts; both matched identity but could not establish Lake coverage. No absence or regional cause is claimed.
- Verified the installed CLI's enhanced-error default and pinned JSON code-only error classification. Local no-sign skeleton diagnostics made no API request; the current complete observer was not rerun live.
- Thirteen focused Node 24 cases and all 226 shared cases pass, with TypeScript/formatting/web build. Hosted observer gates remain pending.

**State now:**
- Live audit retries stop with issue 51 still open. No resources/settings, audit payloads, real notes/default database or customer billing were accessed or changed. App Cloud stays disabled.

**Next:**
- Integrate the tested observer foundation after hosted gates, preserve the unresolved live gate in issue 51, and continue offline target-ownership/run-ledger/lifecycle prerequisites under issue 30. Do not enable regions or change permissions/audit to force readiness.

## 2026-10-28 - Separate private ledger namespace from run booking

**Did:**
- Split issue 55 before opening a broad PR: issue 56 owns filesystem/SQLite recognition; issue 55 retains atomic run/receipt mutation and process-crash evidence.
- Added an explicit private operator store with ownership/inode/scope binding, restrictive files, known schema/durability settings and rejection of foreign/link/corrupt state.
- Verified nine focused actual Node 24 cases and all 235 shared cases, TypeScript, formatting and web build. Added focused hosted Node 24 coverage; no runtime dependency was added.

**State now:**
- PR 54's main run 40596452313 passed all three jobs. Live audit issue 51 remains unresolved/stopped; app Cloud stays disabled and v0.7 is unchanged.
- Namespace validation used synthetic temporary directories only. No actual operator ledger, AWS resource/settings, real note/default database or billing data was accessed.

**Next:**
- Merge the namespace PR after focused review/hosted gates, then finish issue 55's separately reviewed transactional reservation/receipt layer and independent-process interruption cases. Keep actual inventory/teardown proof separate.

## 2026-10-28 - Reserve run slots before acknowledging a resource attempt

**Did:**
- Implemented issue 55's SQLite compare-and-reserve with the actual stored prior projection, full new-run guard under lock and time/policy recheck before commit.
- Added immutable matching cleanup-receipt accounting, expired-authorization cleanup inspection and fixed failure/uncertain-commit behavior. No delete/refund/reset or apply command was added.
- Verified independent writers and real SIGKILL before commit, after commit before acknowledgement, and after acknowledgement. Twelve ledger cases plus nine namespace cases pass under actual Node 24; all 247 shared cases, TypeScript, formatting and web build pass locally.

**State now:**
- Namespace PR 57 has passed all hosted jobs and must merge first. Counter hosted gates follow before integration. No actual operator authorization ledger, AWS run/resource or real note/default database was created or accessed.
- Receipts record external verifier facts; they do not establish AWS ownership/deletion. Audit issue 51 remains unresolved/stopped, Cloud disabled and v0.7 unchanged.

**Next:**
- Integrate the two focused PRs in order after their hosted gates, then plan exact target ownership and owned lifecycle/recovery under issue 30. Keep actual audit/managed cleanup acceptance open.

## 2026-10-28 - Bind expected inventory to reviewed development templates

**Did:**
- Merged namespace PR 57 and transactional ledger PR 58 after focused review and all three respective hosted PR jobs passed. PR 57's main run also passed; PR 58's main run 40603246378 is still pending at this checkpoint.
- Planned issue 59 and derived one offline four-stack/17-resource inventory from the actual reviewed five-template source bundle, with exhaustive resource mapping, exact names/tags/parents and mandatory owned CloudFormation resolution for generated identifiers.
- Verified six inventory cases plus 11 source cases, all 253 shared cases, TypeScript, formatting and web build. All 38 focused namespace/ledger/inventory/source cases pass under actual Node 24.22.1; added the contract and source composition to that hosted check.

**State now:**
- The frozen expected inventory binds explicit account/region, run, lease, artifact and template digests. It is not observed ownership, absence or deletion authority; no AWS request, actual operator slot or real note/default database was accessed.
- Audit issue 51 remains unresolved and live retries stay stopped. App Cloud stays disabled and v0.7 requirements/mockups are unchanged.

**Next:**
- Complete hosted gates, then merge this focused contract. Plan a separate bounded target/ownership metadata observer before lifecycle/recovery or managed resources; keep issues 30/31 open.

## 2026-10-28 - Keep existing-run identity inspection independent of new-run runway

**Did:**
- Verified PR 60's main run 40604784418 passed all three jobs. Planned stack metadata issue 61 and split credential-boundary prerequisite 62 before opening a broad collector PR.
- Added an explicit current-identity inspection gate using configured SSO account/role, disabled/absent history, unsupported-flow/environment protections and pinned regional STS. It does not export credentials or depend on a new-run cutoff/lease; the existing new-run gate is unchanged.
- Verified nine focused actual Node 24 cases, all 262 shared cases, TypeScript, formatting and web build, with abort/late-reader, private errors and strict optional-setting exit evidence. Added focused hosted Node 24 coverage.

**State now:**
- This is a reusable credential boundary for later owned inspection. It establishes no runway, resource ownership or provisioning authority. No live account/audit probe, operator slot, AWS resource/settings or real note/default database was accessed.
- Audit 51 remains unresolved and live retries stay stopped; app Cloud and v0.7 remain unchanged. The metadata prototype is preserved locally for its separate PR after this prerequisite merges.

**Next:**
- Complete hosted gates and merge this focused identity PR, then compose it before/after the exact stack metadata collector in issue 61. Actual service collision/ownership, lifecycle/recovery and managed teardown remain open under 30/31.

**Validation refinement before integration:**
- Direct Node 24 strip-only import caught a TypeScript parameter property that transformed Vitest tests accepted. Replaced it with erasable declarations and added a hosted direct-import gate; no account command is executed by that check. The reviewed PR must pass its final updated head before merging.

## 2026-10-28 - Collect scoped stack metadata without treating it as ownership

**Did:**
- Kept the identity prerequisite and metadata adapter in separate branches/PR boundaries. Planned ListStacks plus exact-ARN tag and resource metadata to avoid DescribeStacks parameters/outputs.
- Added bounded native pagination, exact reviewed inventory/type checks, tag-before-resource gating, typed physical-ID uniqueness, explicit incomplete/deleted/not-listed states, two stack scans and current-identity checks before/after reads.
- Verified 12 focused actual Node 24 cases and direct module import, all 274 shared cases, TypeScript, formatting and web build. Installed CLI input-model/projection diagnostics pass for all three commands with synthetic IDs/empty configuration and zero API requests.

**State now:**
- PR 63's final direct-runtime-compatible identity head must pass hosted gates and merge first. This collector stays local until then. Hosted collector gates follow separately; no live account/audit probe, operator slot, resource/settings or real note/default database was accessed.
- Stack metadata is explicitly unproven ownership/target absence. Issues 30/31 and unresolved audit 51 remain open; app Cloud and v0.7 remain unchanged.

**Next:**
- Integrate the focused identity prerequisite and then this collector after their respective gates. Plan exact service collision/ownership reconciliation and durable owned lifecycle/recovery before any managed run.

## 2026-10-28 - Keep prospective fixed-name collisions distinct from full absence

**Did:**
- Confirmed PR 64's main run 40609823180 passed all three jobs, then planned issue 65's eight fixed non-bucket metadata selectors against current primary APIs.
- Implemented raw process-response classification with exact structured not-found codes, scope-valid collision checks and current identity before/after. DynamoDB uses DescribeTable; its eventual visibility remains explicit and no not-found result grants full absence or old-run deletion proof.
- Verified 11 focused actual Node 24 cases/direct import, all 285 shared cases, TypeScript, formatting and web build. Five CLI input parsers, bundled Botocore input models and JMESPath projections pass offline with synthetic data/empty configuration and zero API requests.

**State now:**
- This is a partial prospective observation only. No provider payloads are retained, no credential export/live account/audit probe or resource/settings/slot/default note database access occurred. Hosted gates follow before integration.
- Global bucket/Cognito checks, complete ownership/absence, durable lifecycle/recovery and managed proof stay open under 30/31; audit 51 stays unresolved. App Cloud and v0.7 remain unchanged.

**Next:**
- Merge this focused collector after all hosted gates, then plan the next small remaining collision/ownership slice without conflating fixture/model evidence with managed acceptance.

## 2026-10-28 - Bound the artifact-bucket observation at the SDK wire boundary

**Did:**
- Confirmed PR 66's main run 40613478710 passed all three jobs, then planned issue 67 as one owner-bound global bucket metadata observation.
- Stopped the unpublished CLI prototype after inspecting its implicit region-redirect HeadBucket fallback without ExpectedBucketOwner. Replaced it with a pinned dev-only S3/SSO client and one-request method/host/path/query/owner transport guard.
- Added bounded metadata decoding, current configured identity before/after, exact HTTP error classification and late transport/credential rejection. No tags, credentials or raw provider errors enter results.
- Passed ten actual Node 24 wire fixtures/direct import, 295 shared cases, TypeScript, formatting, web build and synthetic IaC/packaged checks. Clean frozen installs reproduce the prior Lambda ZIP with a newly reviewed lock hash; hosted gates follow before integration.

**State now:**
- Global bucket collision/not-found is only a partial prospective observation. Full absence and creation ownership remain explicitly unproven. No real account/default database access, operator slot, infrastructure/settings/billing change or stopped probe retry occurred.
- Audit 51 remains unresolved; Cognito discovery, complete ownership/absence and original-manifest lifecycle/recovery remain under 30/31. App Cloud and canonical v0.7 stay unchanged.

**Next:**
- Integrate this single-purpose PR after all hosted gates. Continue the next separate prerequisite only within the 09:00 IST handoff boundary; do not start a new AWS run after the full-run/cleanup runway cutoff.

## 2026-10-28 - Observe Cognito pool-name collisions without adopting existing identities

**Did:**
- Confirmed PR 68 merged as 7ffac942c3be89254e55e70b55b3c52c4f543883 with all three exact-head gates, no-reply metadata and tested-tree equality. All three postmerge jobs in 40617941004 pass; issue 67 is closed with evidence.
- Split the next prospective Cognito pool-name scan into issue 69 and wrote its requirement-linked plan before code. Native MaxResults/NextToken JSON avoids the CLI paginator's token rewrite.
- Added complete bounded scanning, private exact-name projections, repeated-token/ID and malformed-page rejection, before/after identity and late-page/final-identity cancellation. Multiple matching names are collisions; not-listed is not physical absence or creation ownership.
- Passed ten actual Node 24 cases/direct import, 305 shared cases, TypeScript, formatting and web build. Installed CLI native-input/Botocore/paginator/JMESPath checks pass on the actual derived command with synthetic data and zero API requests.

**State now:**
- This collector is a separate partial prerequisite; hosted gates follow before merge. No dependency, deployed artifact, account/default note database, operator slot or resource/settings/billing change occurred.
- Domain-prefix observation, complete ownership/absence and retained original-manifest lifecycle/recovery remain under 30/31. Audit 51 stays unresolved and stopped. App Cloud/v0.7 remain unchanged.

**Next:**
- Merge the focused pool-name PR only after all hosted gates, then continue the next separately scoped prerequisite within the 09:00 IST handoff boundary. New AWS-run headroom has already expired; no managed run tonight.

## 2026-10-28 - Add a linked GitHub Project for visible delivery tracking

**Did:**
- Confirmed existing tracking used Issues/Milestones with no linked Project. Created private Peel Project 12 and linked it to the clean public repository.
- Backfilled all 38 existing issues and 35 PRs, verified all 73 unique memberships/statuses and configured current-milestone, issues, PR and backlog views. Deliverable issues and implementation PRs stay separate for progress counts.
- Added the board link/upkeep requirements to AGENTS.md and README. Kept the separately committed Cognito-domain feature plan on its own local branch.

**State now:**
- Board metadata and contents are verified through GitHub's API. Visual browser verification is unavailable after a timeout/unattached debugger; no visual pass is claimed. Issue 73's focused documentation PR follows with required gates.
- App code, v0.7 scope, AWS resources and note databases are unchanged. Audit/remote/native gates remain open. Domain 71 is Ready; its plan-only branch is preserved.

**Next:**
- Merge the tracking PR after its checks, synchronize its issue/PR cards to Done, then resume domain 71 within the 09:00 IST handoff boundary.

## 2026-10-28 - Save comprehensive milestone reports as versioned Markdown

**Did:**
- Persisted mandatory milestone completion reports in the shared agent instructions and Peel's repo workflow, with dated canonical files under docs/milestones/ and separate in-progress snapshots.
- Saved the current comprehensive status report and a clearly retrospective M2.1 completion report, using its actual closure, ten deliverables, merged PRs and configured hosted evidence. M2.2 remains open.
- Added the report index/README link and tracked this focused reporting delivery as issue 75 in Project12. No app behavior, dependency, AWS or note-data changes occurred.

**State now:**
- Reports distinguish backend foundations from enabled app features, scope the rough 35 percent estimate and retain failed/unrun acceptance gates. Shared global instructions are local configuration; repository reports/instructions follow the normal PR gates.
- Hosted checks and final report/milestone linkage follow before completion. Domain 71 remains Ready on its separate unpushed plan branch.

**Next:**
- Merge the focused reporting PR after required checks, verify milestone/report links and Project issue/PR Done states, then make the precise 09:00 IST handoff.

## 2026-10-28 - Prepare the next domain observer without a late managed run

**Did:**
- Rebased the owned unpublished domain-plan branch on current main after the reporting PR merged.
- Verified canonical synthetic Domain input and five description/projection/lifecycle shapes against the installed CLI/Botocore/JMESPath with empty configuration and no signing/API call.
- Preserved an initially failed HTTP-status assertion: the installed exception model does not encode status; the corrected diagnostic checks its modeled name and records API documentation separately.

**State now:**
- This is pre-implementation evidence on the feature branch. Domain 71 remains Ready; no observer/runtime/app acceptance or actual AWS/notes/settings/slot work is claimed. Main remains unchanged and working.

**Next:**
- Implement issue 71's bounded current-identity observer from its plan, with actual Node 24/raw-process tests and all required gates in one focused PR. Finish the overnight handoff at 09:00 IST.

## 2026-10-28 - Resume issue 71 with bounded domain-prefix collision observation

**Did:**
- Resumed under Sandip's renewed autonomous authorization after the completed overnight handoff. Moved issue 71 and its Project 12 card to In progress.
- Implemented canonical domain-prefix metadata collection, independent current identity checks, strict private process/error parsing and bounded cancellation. Valid foreign/deleting domains remain collisions; optional empty descriptions stay unknown.
- Passed eleven focused cases/direct import under actual Node 24 and the actual-command unsigned CLI/model/projection diagnostic with zero account calls. All 316 shared cases, TypeScript, formatting and web build pass locally. Added the focused Node 24 hosted gate.

**State now:**
- This single-purpose collector is a partial issue 30 prerequisite. All hosted gates and focused review follow before merge. No AWS/default note database access, resource/settings/billing write, expired lease reuse or app Cloud activation occurred.
- Audit 51 remains blocked and stopped; complete target absence, retained manifest/lifecycle/recovery and managed proof remain open. M2.2 has not met its exit criteria.

**Next:**
- Merge the domain-prefix PR only after exact-head hosted checks and review, verify postmerge CI and synchronize Project issue/PR cards. Continue a separately planned issue 30 slice and save a milestone report when actual exit criteria are met.

## 2026-10-28 - Retain original Cloud recipe bytes before durable lifecycle work

**Did:**
- Confirmed PR 77 merged as c4d4ead with all three source and postmerge checks (40628619582/40629497959) passing. Issue 71 is closed and its issue/PR Project cards are Done.
- Investigated standalone native drag issue 72, then stopped at an unreliable isolated app-control binding before entering test text. Unwired preparation is preserved only on unpublished branch codex/native-titlebar-drag at 40363b4; no physical drag or shipped fix is claimed. Only owned test copies were stopped; unrelated processes/data were preserved. Its issue/Project card is Blocked.
- Created current-milestone issue 78 and planned a pure original-recipe codec before implementation. Capture validates current reviewed factories; read verifies independently retained pins and exact original bytes without today's source/factory/clock or a fresh lease. Inventory remains opaque until a historical interpreter and ownership gate.
- Passed eight actual Node 24 cases/direct import, all 324 shared cases, TypeScript, formatting and web build; added focused hosted coverage.

**State now:**
- The codec establishes an immutable bounded retention/integrity contract. It has no filesystem, ledger, reservation, physical provider ID, ownership or cleanup authority. No AWS resource, billing, default note data or app feature changed in this Cloud slice. Hosted checks/review precede merge.
- M2.2 remains open. Audit 51, durable original-manifest/creation-intent storage, historical inventory interpretation, owned lifecycle/recovery/apply and managed proof remain. Native issue 72 cannot pass until live isolated process selection works reliably; do not blindly retry that stopped UI path.

**Next:**
- Merge the single-purpose recipe PR after all exact-head gates, synchronize Project state and verify postmerge CI. Continue a separately planned durable manifest-storage slice before any owned create/recovery/apply work. Save and send the milestone report only when its actual exit criteria have evidence.

## 2026-10-28 - Persist original run recipes with explicit synchronization and crash boundaries

**Did:**
- Confirmed all three postmerge main checks for PR 79 in 40631601473 pass. Issue 78 and its PR card remain Done; the recipe codec does not establish ownership or durability on its own.
- Planned issue 80 before code and moved its Project card to In progress. Added a separate private immutable manifest/marker namespace with copied pins, file/directory/inode checks, exclusive creation and fixed private failures. Existing note stores and the run-ledger schema are untouched.
- Distinguished read-only inspection from a fresh verified synchronization acknowledgement. Tested actual independent competing writers and three SIGKILL checkpoints, four injected sync failures, identity/link/mode/unknown-content preservation and strict UTF-8 bytes.
- Found and fixed BOM stripping during exact-byte verification, with an actual Node 24 failing negative control and passing restored source. Fourteen storage cases/direct import and 22 combined Node 24 codec/storage cases pass. All 338 shared cases, TypeScript, formatting and web build pass; the existing chunk-size warning remains.

**State now:**
- This is local operator-file persistence, with documented filesystem/power-loss/ACL limits. It creates no run slot, creation ID, physical resource, AWS ownership, billing or app behavior. All relevant local/hosted checks and focused review precede merge.
- M2.2 remains open. Historical inventory interpretation, creation intent/response journaling, complete ownership/absence, lifecycle/apply and actual managed/teardown evidence remain under 30/31. Audit 51 and the native 72 isolation gate stay stopped; no retries occurred.

**Next:**
- Merge the focused storage PR only after exact-head gates, verify main CI separately and synchronize Project state. Continue a separately planned historical inventory/creation-journal slice before any AWS write. Save/send the milestone report only when actual exit criteria pass.

## 2026-10-28 - Decode the original version-one inventory after source changes

**Did:**
- Confirmed all three main jobs40635124866 passed for PR81's exact merge310e7a9 and appended issue80 evidence6461151278. No open PR remained before the next slice.
- Planned issue82 before code, moved its Project card to In progress and captured a frozen synthetic recipe before extracting the existing catalog into an immutable version-one module. Current factory/template/recipe bytes and hashes remain unchanged.
- Added pure historical schema interpretation for the original four stacks/seventeen resources and exact original names/tags/relationships/lease/artifact wiring. Expected selectors retain unproven ownership. No current factory, clock, account, file or policy lookup is performed during decoding.
- Passed eight actual Node24 cases/direct import,22combined with current writer/codec, all346shared cases, TypeScript, formatting and build. A graph-comparison negative control fails without the required check and passes after restoration. Existing browser chunk warning remains.

**State now:**
- This reader produces typed original expectations. Existing metadata collectors still regenerate current factories; wiring their retained-recipe boundary, creation intents/provider IDs, ownership/absence and lifecycle remain separate30work. Hosted gates/review precede merge.
- No dependency/artifact/IaC factory/app behavior or physical AWS resource changed. Audit51, native72 and stopped relay/peer-WebKit gates were not retried. M2.2 and managed31 remain open.

**Next:**
- Merge the focused historical-reader PR after all exact-head gates, update issue/PR cards and separately verify mainCI. Continue one retained-recipe metadata adapter slice before any owned lifecycle/AWS write. Save/send the milestone report only when actual exit criteria pass.

## 2026-10-28 - Observe original Cloud stack recipes independently of current factories

**Did:**
- Verified all three postmerge main jobs40638248654 pass for PR83 merge5a83c7a. No open PR remained before starting issue84, whose Project card moved to In progress after its requirement-linked plan.
- Added a strict retained-recipe stack observer and pure command helper. Both default commands and ARN validation use privately captured original names instead of today's name factory; current prospective factory checks, command bytes and result shape remain compatible.
- Added whole-observation external cancellation, including ignored first/final identity and metadata readers, with prompt private failure, no late reads/publication and timer/listener cleanup.
- Passed13retained+12prospective cases/direct import under actual Node24.22.1, all359shared cases/52files, TypeScript, formatting and build. Frozen expired synthetic recipe/factory-unavailable checks preserve original digests; existing browser chunk warning remains.

**State now:**
- This read-only adapter binds synthetic observations to the original manifest/inventory. Ownership and complete absence remain unproven. No account probe, resource/default database/app/billing change or stopped-component retry occurred. Hosted gates/review precede merge.
- M2.2 stays open; fixed-target/S3/Cognito retained adapters, creation intent/provider-ID provenance, owned lifecycle/recovery/apply and actual managed/teardown evidence remain. Audit51, managed31 and native72 isolation remain blocked.

**Next:**
- Merge this focused observer PR only after all current-commit gates and review, then synchronize Project state and verify main CI separately. Continue one separately scoped current-milestone deliverable; write/send its milestone report only when actual exit criteria pass.

## 2026-10-28 - Observe original fixed Cloud target recipes without current factories

**Did:**
- Verified all three postmerge main jobs40640491565 for PR85 mergeaf4a4dc pass and appended issue84 evidence6462004162. No open PR remained before issue86's requirement-linked plan and In progress transition.
- Added exact retained recipe/pin command and observation entry points for the existing eight fixed non-bucket targets. Private shared capture/collection preserves original selectors and manifest/inventory digests, current identity/role checks and unchanged metadata command/error classification. Results keep ownership/full-target absence unproven.
- Captured the caller's original cancellation signal so cleanup removes its registration after dependency mutation. Shared existing synthetic response fixtures across both APIs.
- Passed13retained+11prospective cases/direct import under actual Node24.22.1, all372shared cases/53files, TypeScript, formatting and browser build. Existing browser chunk warning remains.

**State now:**
- This is another bounded read-only recipe adapter, with no provider call/resource/default database/app/billing change. No stopped-component retry. All relevant hosted gates and focused review follow before merge.
- M2.2 remains open. Retained artifact/S3/Cognito adapters, creation provenance, owned lifecycle and actual managed/teardown evidence remain; audit51/managed31/native72 isolation stay blocked.

**Next:**
- Merge the single-purpose fixed-target PR only after exact-head gates/review, synchronize Project state and verify main separately. Continue one current-milestone slice; save/send the milestone report only when actual exit criteria pass.

## 2026-10-28 - Inspect original Cloud artifact bucket recipes through the guarded SDK

**Did:**
- Verified all three main jobs40643087539 for PR87 mergef273844 pass and appended issue86 evidence6462361828. No open PR remained before issue88's requirement-linked plan and Project In progress transition.
- Added strict original recipe/pin capture for the existing owner-bound bucket observer. Private scope/collection reuse preserves original selectors/digests and prospective factory validation/output; no SDK command, endpoint, retry or service-error classification changed.
- Captured the original cancellation signal for listener cleanup and shared existing synthetic HTTP/XML/fake-credential fixtures across both entry points.
- Passed13retained+10prospective cases/direct import under actual Node24.22.1, all385shared cases/54files, TypeScript, formatting and browser build. Existing browser chunk warning remains.

**State now:**
- Retained metadata is bound to original manifest/inventory with ownership/full-target absence unproven. Current identity, private failures, one owner-bound GET/no implicit HEAD/redirect/retry, bounded streams/credentials/requests and late-result suppression remain required. Hosted gates/review precede merge.
- No actual account/default database/resource/app/billing change or stopped-probe retry. M2.2 remains open with retained Cognito adapters, creation provenance/owned lifecycle and actual managed/teardown evidence still required. Audit51/managed31/native72 remain blocked.

**Next:**
- Merge the focused bucket PR after exact-head checks/review, update Project and verify main separately. Continue one current-milestone slice and save/send its milestone report only when exit criteria have evidence.

## 2026-10-28 - Inspect original Cognito pool recipes through bounded native pagination

**Did:**
- Merged issue88/PR89 as645e873 after all3exact-source jobs40644483497 and focused review, with matching source/merge trees and no-reply/scans. Issue/PR cards Done; fresh main40645523985 was still pending at the last separate observation.
- Created issue90 in M2.2/Project12 and committed its requirement-linked plan before code. Added strict retained-recipe pool scan/command capture through private shared extraction/collection; original profile/name/digests survive current-factory unavailability and mutation.
- Preserved native CLI command bytes, full bounded page scan/classification, current identity/role, private output and unproven ownership/full-target absence. Shared existing synthetic page fixtures; captured original signal for cleanup.
- Passed12retained+10prospective cases/direct import under actual Node24.22.1 and all397shared cases/55files, TypeScript, format/build. Corrected a new test's expected error text to the preserved existing message. Existing browser chunk warning remains.

**State now:**
- This is another original-recipe read-only adapter. No account/default database/resource/app/billing change or stopped-component retry. Hosted gates/focused review precede merge; no managed/provider/app acceptance from fixtures.
- M2.2 remains open. Retained domain inspection, creation receipts/budget linkage, ownership/absence composition, lifecycle and actual managed/teardown evidence remain; audit51/managed31/native72 stay blocked.

**Next:**
- Merge the focused pool PR after exact-head gates/review, update Project and verify main separately. Continue a separately scoped domain/lifecycle prerequisite. Save/send the milestone report only after actual exit criteria pass.

## 2026-10-28 - Inspect original Cognito domain-prefix recipes without current factories

**Did:**
- Verified all three main jobs40646809615 for PR91 merge5bc139d pass. No open PR remained before issue92's requirement-linked plan and In progress transition.
- Added strict original recipe/pin domain command/observation capture through private shared extraction/collection, preserving original profile/prefix/digests and current prospective validation/output.
- Kept exact CLI command/projection, structured error classifier, collision/not-described/not-found semantics and independent identity/role intact. Shared synthetic process fixtures and retained original signal for cleanup.
- Passed13retained+11prospective cases/direct import under actual Node24.22.1, all410shared cases/56files, TypeScript, formatting and browser build. Existing chunk warning remains.

**State now:**
- This completes another read-only adapter foundation, with ownership/full-target absence still unproven. No actual account/default database/resource/app/billing change or stopped-component retry. Hosted gates/review precede merge; no managed acceptance from fixtures.
- M2.2 remains open. Original-manifest-linked creation intents/provider-ID receipts and budget linkage, ownership/absence composition, owned lifecycle/recovery/apply and actual managed/teardown evidence remain. Audit51/managed31/native72 stay blocked.

**Next:**
- Merge the focused domain PR after exact-head checks/review, synchronize Project and verify main separately. Plan one creation-journal/lifecycle prerequisite before implementation. Save/send the milestone report only when its actual exit criteria have evidence.

## 2026-10-28 - Retain original normalized Cloud plan bytes and recipe binding

**Did:**
- Verified all three main jobs40648906480 for PR93 merge345132e pass and appended issue92 evidence6463353787. No open PR remained before issue94's requirement-linked plan and Project In progress transition.
- Generated a new matched synthetic normalized-plan/manifest fixture with actual validators/factories, preserving legacy opaque-plan evidence. Added a separate pure bounded versioned context codec with exact plan digest and fourteen-field/identity/lease/source/artifact/template/stack/derived-field binding.
- Kept current manifest/ledger formats and validator untouched. Expired original reads work with all current factories/writer/validator/cost/name helpers and live clock unavailable. Context authority/ownership remain unproven, with no approved/write permission flag.
- Passed10focused/direct import and38combined legacy cases under actual Node24.22.1, all420shared cases/57files, type/format/build. The direct digest-binding removal control fails and restored source passes; existing browser chunk warning remains.

**State now:**
- This is a local integrity contract, without filesystem writes, canonical ledger provenance, budget reservation, durable intent/client token/provider receipt, AWS action or app activation. Hosted gates/review precede merge.
- M2.2 remains open. Canonical reservation/context binding, durable creation journaling, owned lifecycle/recovery/apply and actual managed/teardown evidence remain; audit51/managed31/native72 stay blocked and no stopped probes were retried.

**Next:**
- Merge the focused context PR after exact-head checks/review, synchronize Project and verify main separately. Plan one canonical-binding/durable-journal slice before code; save/send the milestone report only after actual exit criteria pass.

## 2026-10-28 - Observe actual original-run reservation binding in the selected canonical ledger

**Did:**
- Merged PR95/issue94 asfaffdb7 after all3exact-source jobs40652384865/focused review, matching tested/merge trees and no-reply/scans. Project cards Done; all3main40653688321 now pass independently.
- Created issue96 and committed its requirement-linked plan before code. Added existing-namespace-only context/authority/reservation inspection through public ledger APIs, a narrow pure authority normalizer and no raw SQL or mutation path in the observer.
- Checked original digest/identity/slot/time/margin and first-after-second envelopes, with explicit unproven ownership/run authority and receipt-recorded metadata. Added only optional synthetic fixture inputs; existing formats/APIs remain compatible.
- Passed10focused/direct import and41combined legacy cases under actual Node24.22.1; all430shared cases/58files, type/format/build pass. Fresh synthetic SQLite files prove preservation/no record mutation, actual busy-lock refusal and expired/current-helper-unavailable reads. Existing chunk warning remains.

**State now:**
- This is local observation, not fresh durability, external approval or an atomic future write grant. No actual operator/default database/provider/resource/app/billing or stopped-probe work. Hosted checks/review precede merge.
- M2.2 remains open with durable context/intents/client tokens/provider receipts, execution/rechecks, ownership/lifecycle and managed/teardown proof required. Audit51/managed31/native72 stay blocked.

**Next:**
- Merge the focused binding PR after exact-head gates/review, synchronize Project and verify main separately. Plan one durable journal namespace/intent slice before code; save/send its milestone report only after exit criteria pass.

## 2026-10-28 - Extract immutable Cloud record mechanics without changing the manifest store

**Did:**
- Verified all3main jobs40656778166 for PR97 mergef213ad9 pass and appended issue96 evidence6464479558. Committed issue98's requirement-linked plan before code and moved its Project card In progress.
- Moved only owned-file path/descriptor/publication/inspection mechanics into a trusted internal engine. Kept fixed wrapper API, state/error/result shapes, pin capture, exact manifest/marker bytes and acknowledgement semantics.
- Preserved actual independent writer/SIGKILL/sync-failure cases. Added original-byte/API/sync-order and descriptor-closure/post-commit compatibility cases; all16 pass against both original source and extraction under actual Node24. A sync-order negative control fails; restored source passes.
- Passed actualNode24 direct imports/65combined legacy cases, all432shared cases/58files, TypeScript, formatting and browser build. Existing chunk warning remains.

**State now:**
- This is a behavior-preserving operator persistence refactor, with no new namespace/journal feature, ledger/schema/note-store/API change, actual account/default database/resource/app/billing or stopped-probe work. Hosted gates/review precede merge.
- M2.2 remains open. Bound journal/context durability, intents/client tokens/provider receipts, execution/rechecks, owned lifecycle and actual managed/teardown evidence remain; audit51/managed31/native72 stay blocked.

**Next:**
- Merge this focused refactor after exact-head gates/review, update Project and verify main separately. Scope one bound journal/context persistence deliverable before code; save/send the milestone report only after actual exit criteria pass.

## 2026-10-28 - Persist original Cloud context against actual selected recipe and reservation stores

**Did:**
- Verified all3main jobs40659752979 for PR99 merge567ccde pass; appended issue98 evidence6464963552. Committed issue100's requirement-linked plan before code and moved its Project card In progress.
- Added a fixed immutable context wrapper with strict detached pre-I/O pins/digest/authority/path bounds, canonical source selection, actual manifest/ledger source checks before publication and on every readback/open/inspection. Reused the immutable engine; existing source formats/APIs remain unchanged.
- Preserved first-run readability after actual cleanup/second reservation, context-only synchronization acknowledgements and unknown/source-damage preservation. Actual independent creators/SIGKILL cases prove process interruption behavior. Source-check removal and marker-source-binding negative controls fail; restored source passes.
- Passed13focused/direct import and78combined cases under actualNode24.22.1; all445shared cases/59files, type/format/build pass. Corrected initial test-input type annotations before final checks; existing chunk warning remains.

**State now:**
- This is private local context persistence, not an appendable creation journal, atomic cross-store future-write authorization, recipe-store re-sync or spending/provider authority. No actual operator/default note DB, AWS/account/resource/app/billing or stopped-probe work. Hosted exact-head checks and focused review precede merge.
- M2.2 stays open. Durable intents/client tokens/provider IDs, execution/rechecks, ownership/lifecycle and actual managed/teardown evidence remain; audit51/managed31/native72 stay Blocked.

**Next:**
- Merge the focused context-store PR after exact-head gates/review, update Project and verify main separately. Scope a durable creation-intent/client-token deliverable before code, retaining every execution/cleanup gate. Save/send the milestone report only after actual exit criteria pass.

## 2026-10-28 - Define original stack and client-token creation identity

**Did:**
- Verified all3main jobs40663584712 for PR101 merge6436731 pass; appended issue100 evidence6465531322. Isolated work in a public-only Git worktree, preserving unrelated primary-checkout drafts unread. Rechecked primary AWS CreateStack token/error semantics and committed issue102's plan before code.
- Added one pure bounded original descriptor codec/pin normalizer, binding original context/recipe/plan/inventory identity, one original stack/name/template SHA and a supplied scoped v4 nonce token. Current factories/policy/clock and token generation are not recovery dependencies; all authority stays unproven.
- Pinned four template hashes independently from the frozen original, tested altered/rehashed identities/bundles/tokens/private inputs and exact recovery. Semantic-comparison omission fails the negative control; restored source passes.
- Passed11focused/direct import and89combined legacy cases under actualNode24.22.1; all456shared cases/60files, type/format/build. Fixed initial field naming/builtin ESM test harness issues before final checks; existing chunk warning remains.

**State now:**
- Pure identity bytes only, without filesystem/token generation, complete wire request, durable uniqueness/submission or execution/spending/provider authority. No actual operator/default notes, AWS/account/resource/app/billing or stopped-probe work. Exact-head hosted jobs/focused review precede merge.
- M2.2 remains open. Recoverable durable intent/request state, provider receipts, current execution/rechecks, ownership/lifecycle and managed/teardown evidence remain; audit51/managed31/native72 stay Blocked.

**Next:**
- Merge the focused identity PR after exact-head gates/review, update Project and verify main separately. Plan recoverable creation journaling, including trusted pin/bootstrap and lost-ack token recovery, before implementing persistence. Save/send the milestone report only after actual exit criteria pass.

## 2026-10-28 - Specify durable journal trust and restart behavior before persistence

**Did:**
- Verified all3main jobs40669051542 for PR103 mergef6b65f3 pass; appended issue102 evidence6466562508. Isolated work in a public-only worktree, preserving unrelated primary drafts/assets unread.
- Compared immutable directories with an owned transactional journal, chose a separate bounded SQLite store and defined independently anchored genesis/pin recovery, immutable tokens, one-use dispatch fencing, uncertainty and cleanup receipt boundaries.
- Resolved a concrete NoEcho constraint: complete secret-bearing wire requests stay transient; persist only a safe projection/commitment, never a key/value checkpoint or replacement-secret replay after process loss. Recovery cannot mint create permission.
- Rechecked primary Node/SQLite/CloudFormation sources and actual ledger/hosting/cleanup contracts, documented pending failure vectors and small implementation boundaries, and linked the protocol from the hosting plan. Focused review required fresh same-coordinator reservation acknowledgement plus separate recipe/context sync acknowledgements; an existing row or storage bootstrap alone cannot mint execution permission.

**State now:**
- Documentation only. No journal/schema/API/runtime behavior, new test, actual database, secret, account/resource/billing, app or stopped-probe action. Existing ledger/create/inspection compatibility is explicitly retained for a later extraction.
- Relative links, explicit Markdown formatting and diff/scans are checked; all required exact-head hosted jobs and focused review precede merge. Acceptance vectors are unrun, not evidence. M2.2/audit51/managed31/native72 remain open/blocked as applicable.

**Next:**
- Merge the focused protocol PR after its hosted gates/review, update Project and record docs-only main CI filtering honestly. Start only the next ready shared SQLite mechanics extraction with a requirement-linked plan and original compatibility/process evidence; do not bundle journal features. Save/send the milestone report only after actual exit criteria pass.


## 2026-10-28 - Checkpoint work and select Synkies Folded Horizon identity

**Did:**
- Paused issue106 at Sandip's explicit request. Committed its plan5ba230b, baseline compatibility tests19852f7 and unpushed mechanics extraction1b90de0 on the isolated feature branch. The same25 actualNode24 namespace/ledger cases pass before and after extraction; type checks pass. Final review, broader checks and hosted gates remain pending.
- Saved an immutable ignored resume and preserved all primary unknown drafts/assets. Read only the explicitly requested private-archive logo directory, found Antigravity v2 Folded Horizon and inspected its supplied light lockup and SVG/token source.
- Bootstrapped the curated project journal from README/canonical docs/public history/WORKLOG and recorded the Synkies name/selected logo decision. Added the requirement-linked branding plan before app changes.

**State now:**
- Main still has the existing app identity until the separate branding slice. No WIP extraction is pushed/merged, no journal runtime is implemented and no product milestone is newly accepted. M2.2 and its audit/managed/teardown gates stay open; stopped probes remain stopped.
- Synkies is the authorized app name. Persistent repository/storage/protocol/Cloud identities remain compatible to protect existing data and reviewed resource bindings. Historical evidence remains unchanged.

**Next:**
- Merge the focused checkpoint after review/required checks. Adopt only Folded Horizon across current app/native icons/docs and canonical mockups in small PRs, then resume issue106's unfinished validation and gated merge. Continue without waiting for routine input.

**Decisions:**
- Use Antigravity v2 directions/01-folded-horizon exactly as supplied. No new logo generation or unrelated design work.
- Keep name/logo adoption distinct from SQLite refactoring and actual milestone/release acceptance.


## 2026-10-28 - Adopt Synkies name and Antigravity Folded Horizon in the app

**Did:**
- Copied only the selected user-provided Antigravity v2 Folded Horizon masters, preserving bytes and recording SHA provenance. Adopted its light/dark outlined logo and favicon, regenerated the existing native icon family and changed product/menu/window/UI/export display names to Synkies.
- Updated current README/PRFAQ/PRD/SPEC/visual naming and Project12 title. Preserved functional v0.7 and all existing repository, package, bundle, database, cache, export-schema, protocol and Cloud resource identities. Existing Peel libraries/exports remain compatible.
- Included both logo variants in the integrity-checked public offline shell. Visually inspected fresh synthetic desktop light/dark and mobile browser renders, plus compact layout; logo selection/loading and no horizontal overflow passed, including dark logo switching offline.
- Passed456shared tests, TypeScript, formatting,11browser tests on an owned isolated server and the production offline-shell checks. Native format/Clippy and34tests passed; the existing ignored crash child is invoked only by its parent harness. Existing browser chunk warning remains.

**State now:**
- Branding is one standalone requested app slice. Native release build passed; inspected Synkies.app name, unchanged bundle ID and exact bundled ICNS bytes without launching it. Focused review and final-head hosted gates precede merge. No stopped native controller launch, actual/default notes, AWS, billing or public-release change. Canonical mockup exports are the next separately tracked branding slice.
- PR108 checkpoint is merged at85629d6 after all3source checks passed. Docs-only main checks were path-filtered, not passing runtime evidence. Issue106 stays saved/unpublished for resumption after branding.

**Next:**
- Finish the native bundle/asset checks and exact-head hosted gates, merge this app-brand PR, align canonical mockups in their own focused PR, then resume issue106. Keep Project/issues and immutable resumes current.


## 2026-10-28 - Align Synkies presentation gallery and resume build checkpoint

**Did:**
- Regenerated all110canonical mockups and five dark variants, inventory and three summary images using the selected Folded Horizon icon/outlined light-dark logo. Updated visible naming including Mac menu/Dock and mock browser domains; preserved stable IDs/platforms/kinds/variants/requirement mappings.
- Used exact canonical SVG copies in the self-contained gallery and generated the overview logo from that source. All existing render/navigation/green-minus/drag/pinning/arrangement/Undo checks pass with no browser errors; added actual image decoding before capture. Visually inspected representative Mac library/desktop, dark web, iPhone and overview exports.
- Updated the journal with the adopted identity and explicit remaining106/M2.2 work. App-brand PR110 is merged at0013803 with all3source checks40680869302 passing; actual main checks are tracked separately.

**State now:**
- This is presentation alignment, not functional sync, native interaction, managed-service or release acceptance. No product scope/behavior or stopped gates changed. The gallery remains110canonical screens plus five dark exports. Focused review and final-head hosted gates precede integration.

**Next:**
- Merge the focused mockup PR after gates, then resume issue106 from codex/cloud-owned-sqlite-engine. Preserve its original compatibility baseline and finish remaining code review/local/hosted validation before a separate merge. No user input is required for routine work.


## 2026-10-28 - Resume compatible owned SQLite mechanics extraction after Synkies branding

**Did:**
- Completed the requested checkpoint/app/mockup Synkies work in PR108/110/112 and resumed issue106 on current main. Kept its pre-code plan and baseline compatibility history while rebasing only the unpublished owned branch.
- Shared existing filesystem/SQLite initialization/validation mechanics through fixed internal repository configuration. Kept ledger schema/marker bytes, public wrapper/error/authority APIs and mutability, create/open/error ordering, recovery behavior and actual legacy limitations; run-ledger policy/transactions are unchanged.
- Passed26 actualNode24 namespace/ledger cases against the original implementation and the extracted implementation, including original competing writers/SIGKILL/commit-ack/expired-cleanup behavior and five compatibility cases. Added actual connection-failure handle-close observation without replacing real SQL or process tests.
- Verified five filesystem helpers match baseline ignoring whitespace. Omitting the delegated metadata validator fails the intended changed-authority refusal assertion; restored exact source passes. ActualNode24 direct imports and246focused Cloud consumer cases/22files pass, as do461shared cases/60files, type/format and web build. Existing chunk warning remains.

**State now:**
- This reuses internal mechanics; it adds no journal namespace/genesis/token/fence/receipt, spending authority, default database access, enabled app feature, AWS operation or stopped-probe retry. Final-source hosted gates and focused review precede integration. M2.2/audit51/managed31/native72 remain open/blocked as applicable.

**Next:**
- Finish this standalone PR after all required exact-head checks, merge normally, update Project and record main checks separately. Then scope only the next fixed journal-genesis/bootstrap deliverable from the canonical protocol; retain independent funding/source anchors and all current provisioning/cleanup gates.


## 2026-10-28 - Verify fail-closed ledger contention without a progress assumption

**Did:**
- Verified PR113's exact main477 all3checks40686197747 passing before starting pure genesis issue115. Saved its plan/code locally after13focused/direct Node24 checks; the259consumer run exposed one unchanged ledger test requiring exactly one successful concurrent writer.
- Investigated without rerunning away the failure: eight observed unblocked pairs yielded one success/busy, but a controlled real SQLite shared-reader barrier deterministically yielded busy+uncertain, zero stored rows and the original reserve. The original uninstrumented failure's exact interleaving remains unproven.
- Corrected that verification assumption in standalone issue116. Uncoordinated processes now prove at most one acknowledgement/committed slot, with acknowledgement identity bound to actual row/envelope and uncertain committed slots preserved. Added the real held-reader case proving zero acknowledged/consumed slots under blocked commits.
- Passed27actualNode24 namespace/ledger cases and247Cloud consumer cases/22files;462shared/60files, type/format/build pass. All production infra/cloud modules are byte-unchanged, with no new timeout/retry/funding behavior. Existing chunk warning remains.

**State now:**
- This is test verification only, with original real independent writers/SIGKILL cases retained. No actual/default note/operator DB, provider/AWS/budget change or stopped probe. Focused review and all3required exact-head hosted gates precede merge.
- Issue115 is saved unpublished on its own branch, not fully validated or merged. Issue114's pure format, hardened namespace/bootstrap and actual bound-source persistence remain separate; no milestone/app acceptance follows from this correction.

**Next:**
- Merge the focused116fix after gates, update Project and verify main separately. Rebase the pure genesis branch, rerun its relevant combined checks and finish that standalone PR before actual journal storage. Keep audit51/managed31 and M2.2 exit gates open.


## 2026-10-28 - Define the original journal genesis data contract

**Did:**
- Split parent114 into independently reviewable pure format/binding, hardened namespace/bootstrap and actual source-acknowledged persistence boundaries; committed the plan before code. Only the pure first slice is in this PR.
- Added a fixed canonical genesis envelope and independent workspace/global-funding reservation anchor. It derives one journal location, binds original authority/run/slot/plan/time/recipe/context/pins, keeps source namespaces separate and returns detached frozen unproven data. No physical path lookup, source acknowledgement, storage, RNG, current policy or provider call.
- Tested independently serialized golden original bytes, closed-schema/UTF8/bounds/paths, altered/rehashed semantic bindings, original expiry with current factories/clock/stores unavailable, and private errors. Omitting the independent plan comparison fails the intended coherent-rehash assertion; exact source restored before positive checks.
- Isolated the initial broader-run ledger assertion failure in separate issue116/PR117. Its required source checks40691759603 and reviews passed; merged9f22776 before this PR. The exact locally tested combined tree survives the post-dependency rebase. All260actualNode24 consumers/23files,475shared/61files, type/format/build and actualNode24direct roundtrip pass. Existing chunk warning remains.

**State now:**
- This is pure data integrity, not an authenticated journal, actual funding observation, durable bootstrap, source-sync proof, spending or execution capability. Unknown self-consistent JSON is not provenance. All required exact-head hosted gates and focused review precede integration. No actual/default notes/operator DB, account/resource/billing, stopped probe or product-v0.7 change.
- Parent114/M2.2/audit51/managed31/native72 remain open/blocked as applicable. Synkies branding and compatible existing storage/protocol identities are preserved.

**Next:**
- Finish the standalone pure-codec PR after gates and update Project; keep114open. Then scope only the next hardened namespace/bootstrap deliverable, preserving legacy ledger semantics and the later actual-source-acknowledgement/persistence boundary. Record exact main checks separately before any future provisioning gate.


## 2026-10-28 - Verify pure genesis integration and guard strict journal files

**Did:**
- Resumed the public checkout from the immutable1848/1846 handoff, preserved unrelated primary drafts unread and reused the owned worktree. Verified PR118 unchanged49835b9 with all3source checks40694109991, merged normally as95d11ba and confirmed115closed/ProjectDone. All3merged-main checks40695742833 separately pass; issue115 proof6470345891. Parent114 remains open.
- Created issue119/ProjectInprogress and committed its requirement-linked plan before code. Added a fixed internal canonical/private file boundary with no-follow held descriptors, workspace/directory/database identity binding, strict marker/modes/links/bounds and exclusive creation that always refuses existing paths. Partial state is preserved; open is file inspection only. Existing ledger/immutable production mechanics remain byte-unchanged.
- Passed14focused cases including real independent creators, copied/replaced paths, alias/UID/mode/link/header/size refusal, failed synchronization/descriptor closure and partial creation. Removing the inode comparison fails the intended assertion; exact restored source passes.
- Passed actualNode24.22.1 direct import/274Cloud consumers across24files and489shared/62files, TypeScript, formatting and web build. Initial library-target type mismatch was corrected without changing configuration; existing chunk warning remains.

**State now:**
- Files and namespace synchronization only, with an empty database explicitly incomplete. No SQL/schema/genesis commit, actual funding/source acknowledgement or execution capability is added. All3required final-head hosted checks and focused review precede merge.
- No actual/default operator/note DB, AWS/account/resource/budget/billing, app activation, private history or stopped probe changed. M2.2/audit51/managed31/native72 retain their open/stopped gates.

**Next:**
- Merge only this file-boundary PR after review/exact-head gates, update Project and verify main separately. Then plan fixed transactional journal header/schema/genesis bootstrap before actual source-bound storage; parent114 closes only with its original evidence. Keep immutable resumes current and write the milestone report only after actual exit.


## 2026-10-28 - Persist fixed original genesis without source or execution authority

**Did:**
- Verified PR120sourcef620734 all3checks40697495282, merged normally ascdd4537 and confirmed119closed/ProjectbothDone. All3actual merged-main40698773476 separately pass; issue119proof6470793422. Reused the clean owned worktree for121 and committed its requirement-linked plane3cefee before code.
- Added a fixed appID0x53594a31/version1/one STRICT genesis table with atomic schema+original-byte commit, held-descriptor header checks before SQLite, fixed durability settings/readback,512pages/2MiB and4MiB rollback bounds. Exclusive bootstrap never adopts an existing path; open/recovery never initializes or returns a capability. No generic SQL/callback/schema API or future tables.
- Passed10focused storage cases and14file cases, actual independent creators and SIGKILL before/after commit, lost-ack/failed-sync recovery and closed handle observations. Omitting application-ID checking fails the intended refusal assertion; restored exact source passes. Actual capacity verifies a1536KiB deliberately nonsemantic payload and bounded rollback, with actual SQLITE_FULL on excess growth; it is not semantic/source acceptance.
- Passed actualNode24.22.1 direct imports/284Cloud consumers25files. Initial simultaneous shared run498/499 with unchanged peer-inventory5000ms timeout is preserved; isolated unchanged test passes299ms and separate full run without competing consumer suite passes499/63files. Precise timeout cause unproven, with no peer or timeout changes. Type/format/build pass; existing chunk warning. Corrected initial busy_timeout column readback and fixture literal types before final checks.

**State now:**
- This internal persistence primitive validates supplied anchors/original bytes, not actual funding/source provenance or separate recipe/context synchronization acknowledgements. Returned authority stays unproven. Required exact-head hosted gates and focused review precede merge.
- Parent114/M2.2 stay open; no actual/default operator/note DB, provider/account/budget/billing/app activation, private history or stopped probe. Native72/audit51/managed31/relay/peer-WebKit stay stopped.

**Next:**
- Merge the focused persistence PR after all3exact-head gates/review, update Project and verify main separately. Then implement actual canonical funding/original source selection and distinct acknowledged source opens in one small requirement-linked slice. Do not close114 until all original criteria have evidence, or report M2.2 complete without managed/teardown proof.


## 2026-10-28 - Bind genesis to actual original funding and separate source acknowledgements

**Did:**
- Verified PR122source3f54cf5 all3checks40701061350, merged normally asa6061ab and confirmed121closed/ProjectbothDone. All3actual merged-main40702504975 pass; issue121proof6471460086. Reused the owned worktree for issue123 and committed requirement-linked pland4ffd9a before code.
- Added a fixed source wrapper deriving the anchor from actual canonical recognized funding state. It separately opens/re-syncs the original recipe/context with independent pins, checks exact original bytes and stable tuple before creation, before commit and after readback, and preserves uncertain committed state on later source failure. No caller reservation/owned flag, raw genesis, default DB, alternate journal path, repair or permission.
- Added normal source-bound open/read plus explicit actual-anchored historical inspection with retained pins when sources disappeared. Stable original identity survives actual synthetic cleanup/second reservation; current helpers and caller pin memory are not recovery requirements. All provider/run authority stays unproven.
- Passed14focused actual source cases, including distinct recipe/context descriptor-sync failures, canonical/authority/run/pin/tuple changes, source disappearance, real independent creators/SIGKILL and preservation. Replacing recipe open with inspection fails the intended refusal assertion despite actual context acknowledgement; exact source restored.
- Passed actualNode24 direct import/298Cloud consumers26files, then513shared64files sequentially, plus type/format/build. No failed positive source run. Existing chunk warning remains. Existing ledger/immutable/source APIs are unchanged. Added parent114 acceptance trace and scoped follow-up links without rewriting historical journal entries.

**State now:**
- Actual local source/genesis binding is implemented; final-head hosted gates and focused review precede merge. Parent114 closes only after that final slice passes/integrates; M2.2 stays open. No provider provenance, fresh-coordinator funding ACK, create permit or app/release acceptance is implied.
- No actual/default operator/note DB, account/resource/lease/budget/billing/app activation, private history or stopped probe. Native72/audit51/managed31/relay/peer-WebKit remain stopped.

**Next:**
- Finish focused review/all3exact-head gates, merge normally and update issue123/parent114/Project with accumulated evidence. Verify main separately. Then scope only the next original complete-request/secret-binding slice from the protocol before code. Keep WORKLOG/journal/immutable resumes current and wait for actual milestone exit before its completion report.


## 2026-10-28 - Isolate a bounded test-worker budget before request integration

**Did:**
- Verified PR124source9d18e68 all3checks40706925842, merged normally as6bb9025 and confirmed123/114closed/ProjectDone. All3actual merged-main40708704764 pass; parentclosure6472266194/mainproof6472435262. M2.2 remains open.
- Saved unpublished request125branchdc211ee after13focused/independent Python golden/negative-secret-binding cases and type checks. Its first default Node24 consumer run310PASS/1 unchanged context-storage5000ms timeout (5604ms observed) is retained as failed evidence. Same isolated casePASS1.15s total; explicit4worker prospective311Cloud/526shared runsPASS. Exact external CPU/I/O contributor unproven.
- Created issue126/ProjectInprogress and committed planc337819 before changing only Vitest maxWorkers4. No production/test module, assertion, timeout, retry, isolation or include changes. Actual writer/SIGKILL/barrier processes remain unchanged.125isBlocked on this short dependency, with public evidence6473348370 and its own local source preserved.
- Passed actual configured-default298Node24 Cloud consumers26files and513shared64files, type/format/build. Existing browser chunk warning remains. These main-only checks are separate from saved125's larger prospective cohort.

**State now:**
- One verification scheduling change; focused review and all3required final-head hosted gates precede merge. No runtime/data/account/provider/app change or stopped probe. M2.2/managed/teardown/app acceptance remain open.

**Next:**
- Merge this small fix after exact-head gates/review, update126/Project and verify main. Rebase/resume125, rerun its actual defaults and remaining validation/review, then finish its separate request PR. Preserve failed runs and actual process evidence. Keep immutable resumes current; no milestone report until actual exit.


## 2026-10-28 - Bind complete original requests and transient material

**Did:**
- Confirmed PR 127 merged as ec1cbca after all three source checks 40719525523 passed, issue 126 closed and both Project cards Done. Rebased saved issue 125 plan/source onto that main and resumed its Project status. Preserved the earlier failed run and separate prospective CLI-worker evidence.
- Added a pure complete unsigned CreateStack contract for all four original stack kinds, canonical safe projection and opaque full-input digest. Strict original template/graph/tag/capability/role/parameter/NoEcho bounds, fixed standard rollback policy and original deadlines remain non-authoritative. No key/token generation, storage, network or SDK evidence claim.
- Kept transient data material in a private active-handle map with explicit sensitive retrieval/discard. Enumeration, JSON, readback, copies and actual process loss cannot reconstruct it. Independent Python commitments and omitted-secret negative control validate exact binding; no secret checkpoint was written.
- Passed configured-default actual Node 24 direct import and 311 Cloud cases / 27 files, then 526 shared cases / 65 files, type/format/build sequentially. No concurrency CLI override, timeout increase, retry, skip or legacy test change. Existing browser chunk warning remains.

**State now:**
- Pure request contract implemented locally; final-head hosted gates and focused review precede merge. Provider ownership/run authority remain unproven and resourceWrites is zero. All funding/source/genesis stores and app behavior are unchanged.
- No actual/default operator/note DB, AWS/account/resource/budget/billing/app activation, private history or stopped probe. M2.2/managed/teardown/app acceptance remain open.

**Next:**
- Finish request issue 125 review, all three exact-head checks and normal integration; update issue/Project and verify main separately. Scope the next fresh same-process reserve/bootstrap preparation-session proof before immutable preparation. Existing rows or recovered genesis cannot substitute for the same coordinator's actual acknowledgements. Keep journal and immutable ignored resumes current.


## 2026-10-28 - Retain fresh preparation-session acknowledgement lineage

**Did:**
- Confirmed PR 128 merged as eae63ed after all three exact-source checks 40720939496 passed. Issue 125 closed and both Project cards Done verified, old owned branches cleaned. All three exact-main checks 40722632541 pass; main proof comment 6474436692. Primary safely advanced with unknown drafts preserved unread.
- Created issue 129 / Project In progress and committed plan 09fd874 before implementation d7fd75d. The initializer exclusively acknowledges a new private workspace before its own actual reserve call, actual source publication and exclusive source-bound genesis bootstrap. Existing rows, snapshots, callbacks, copied metadata and process restart cannot mint the runtime-private lineage. Post-start failures preserve files/slots; no automatic retry/refund.
- Retained/checks parent/workspace/funding directory identities and exact source/genesis/reservation state. Safe read makes no fresh-sync/current approval claim; validation failure or explicit discard permanently removes private state. No token/key generation, durable request preparation, dispatch or provider permission.
- Passed final actual Node 24 direct/334 Cloud cases / 28 files, then 549 shared cases / 66 files, type/format/build sequentially. Actual first/second slots, busy/uncertain/source-sync/closure failures, writers and SIGKILL before/after reserve/genesis commits are covered. An ACK-loss read fallback fails the intended negative control; exact source restored.
- Kept initial harness typing/stdin corrections and failed runs visible. A first shared run had unchanged context-sync 5133 ms and new four-namespace 9656 ms timeouts at the existing 5000 ms limit. Unchanged case alone passes in 1.56 seconds. Independent new variants now have separate cases/cleanup, retaining assertions and deadlines. Final passing results are new evidence; complete external timing causes remain unproven. No legacy tests, timeout/retry/isolation/worker configuration changed.

**State now:**
- Local session-lineage prerequisite implemented; focused review and all three final-head hosted gates precede merge. Every provider/current authority remains unproven, with zero provider resource writes. Existing store/schema/error contracts and app behavior are unchanged. Browser chunk warning remains.
- No actual/default operator/note DB, real credentials, account/resource/budget/billing/app activation, private history or stopped probe. M2.2/managed/teardown/app gates remain open.

**Next:**
- Finish issue 129 focused review, exact-head gates and normal merge; verify actual closure/Project and merged main separately. Plan already-reserved current safety/collector-provenance requirements before trusted immutable preparation; no existing row, source snapshot or caller boolean supplies approval. Keep journal and immutable ignored resumes current.


## 2026-10-28 - Close nested policy input before preparation path access

**Did:**
- During PR 130 review, moved closed nested policy-field shape checks ahead of application path access. Semantic policy remains validated against the actual existing ledger, never a fabricated prior. Added synthetic nested token/refund refusal cases with zero path-access assertions.
- Omitting the new structural check fails the intended zero-access assertion; exact source restored. Revised actual Node 24 direct/334 Cloud cases, 549 shared cases, type/format/build pass under unchanged configured defaults. Older failures remain recorded separately.

**State now:**
- Only the new initializer and its own tests changed. PR 130 needs focused review and all three checks on the revised final head; previous-head checks are not merge authority. No current/provider permission, app or operational change.

**Next:**
- Finish revised PR 130 review/gates, normal integration and actual GitHub/Project/main proof. Plan already-reserved policy and collector provenance before trusted preparation; stopped gates remain stopped.


## 2026-10-28 - Define current phase evidence for a consumed run

**Did:**
- Confirmed PR 130 revised source70b5645 / run40728464433 all three PASS, normal merge2b4a761, actual129closure/ProjectDone and safe primary advancement. All three merged-main checks40729915232 pass separately. Old owned source/merge/remote branches were cleaned only after actual closure.
- Created issue131 / ProjectInprogress and committed plan8e11189 before canonical protocol refinement. Distinguished local lineage/integrity/source sync from actual current collector and phase-specific provider evidence. Initial absence cannot repeat once expected owned guard/sentinel/artifact resources exist.
- Defined original operation/ownership/settlement, actual scheduled rehearsal, quote/provenance and original absolute deadline requirements. Fresh-reservation 30-second start/15-minute plan age cannot be replayed after reserve. Unknown or late current evidence stops creation and preserves independently proven-owned cleanup. No scalar verified flag or copied DTO becomes permission.
- Checked changed Markdown formatting and relative links; runtime, tests, workflow and dependencies compare byte-identical with base. No new runtime tests or local full-suite rerun for prose. Exact-head hosted PR checks and focused review precede merge; a docs-only main path filter must be reported as not run, never passing.

**State now:**
- Documentation only, no current gate implementation, key/token generation, preparation/fence/transport or provider call. Product v0.7 unchanged. M2.2/managed/teardown/app gates remain open; actual budget/window is not renewed and stopped probes remain stopped.

**Next:**
- Finish issue131 focused review/all required source checks and normal integration, actual GitHub/Project verification and honest main-path-filter evidence. Then scope only the next non-executable initial-guard policy contract, keeping actual private collector provenance and later phase proofs separate.


## 2026-10-28 - Separate preparation assessment from request-bound fencing

**Did:**
- Clarified issue131's protocol ordering during PR132 review. Before preparation, actual private current evidence binds original run/kind/source/genesis and journal revision. The winning transaction then captures token/request digest; only after its acknowledgement can a refreshed fence assessment bind that exact tuple. Network collection stays outside journal transactions.
- Removed the ambiguous dependency on a request digest before the request exists. Runtime code/tests remain unchanged; revised documentation and exact-head checks require fresh review before merge.

**State now:**
- Documentation only. Neither assessment is implemented or supplied by caller flags, copied metadata or the local session alone. No token/key generation or provider action.

**Next:**
- Verify revised PR132 documentation/gates and normal integration, then scope the non-executable initial-guard facts contract separately from actual private provenance and fencing.


## 2026-10-28 - Check supplied initial-guard facts without permission

**Did:**
- Confirmed PR 132 revised sourcef02bdbd / run40733775116 all three PASS, normal mergee772b77, actual131closure/ProjectDone and safe primary advancement. The docs-only main push triggered no new workflow; tested-tree equality/unchanged runtime were verified, not called passing tests. Proof6475838858; old owned branches cleaned after actual closure.
- Created issue133 / ProjectInprogress and committed planb958226 before generating safe first/second-slot metadata with actual public APIs in a fresh temporary ledger, removed afterward. Independent Python projection commitments were generated before the checker existed; both actual Node24 outputs match at1204bytes.
- Implemented pure supplied original/ledger/current-data checks for the initial guard only, preserving consumed accounting, original birth/deadline/quote bindings and strict privacy/shape. Every current/run/ownership authority stays unproven. No actual source sync, current journal/intent inspection, adequate runway proof, key/token generation or permission.
- Passed27focused cases with filesystem/SQL/process/network/RNG effects denied, plus actualNode24direct/361Cloud29files then576shared67files/type/format/build under unchanged defaults. Omitting the active-pending requirement fails the coherently rehashed cleaned-run refusal; exact source restored. No failed positive run in this slice. Existing chunk warning remains.

**State now:**
- One pure facts contract; final-head hosted gates and focused review precede merge. Existing stores/schema/error/app behavior, dependencies and test scheduling/deadlines are unchanged. No actual/default operator/note data, credentials, AWS/account/resource/budget/billing/app activation or stopped retry.

**Next:**
- Finish issue133 review/all exact-head checks and normal integration, actual issue/Project/main proof. Keep actual private current provenance/source ACK/journal-state/runway requirements separate before trusted preparation/fencing. Preserve all stopped M2.2/managed/teardown/app gates and keep immutable resumes current.


## 2026-10-29 - Check original Query serialization offline

**Did:**
- Finished PR134/source8133936 after all three exact-source gates and focused review6486811416; normal merge b4179c5, actual issue133/ProjectDone, safe primary advancement and owned-branch cleanup. All three actual main gates40810555610 pass; proof6486959232. No actual/provider/app authority follows.
- Created issue135/current Project item and committed requirement-linked plan15b2ab0 before adding only dev-only CF SDK3.1157.0 and implementing the pure original unsigned Query checker653819b. Existing request goldens/APIs remain compatible; no dependency upgrades or runtime SDK runner.
- Used actual SDK outputs for all four originals in12 isolated synthetic child scenarios. File/network guards and checker RNG remain zero; bodies/headers/NoEcho stay in memory, public output contains original commitments/counts/unproven authority only. Wrong material/copies/recovery/discard, every actual field mutation/deletion, absent fields, duplicates, indexes, encoding/bounds/destination and privacy cases pass.
- Omitted only duplicate-name rejection for a meaningful negative control, observed intended refusal-test failure and restored exact source hash before final checks. Actual Node24 direct/373Cloud30files then588shared68/type/format/build PASS sequentially; unchanged defaults and existing chunk warning. No failed positive run.

**State now:**
- Offline unsigned consistency only. Review/exact-head hosted gates precede normal merge; actual main proof follows separately. No actual/default note/operator data, credentials, account/resource/billing/app activation or stopped retry. Current provenance/private assessments/preparation/fence/real transport/owned teardown remain.

**Next:**
- Finish issue135 focused review/scans/hosted gates and normal integration, then scope the next independent prerequisite under30. Keep original phase/source/authorization/time/budget/provenance gates explicit and M2.2 open. Update ignored immutable resume with actual state.
