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
