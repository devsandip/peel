# Native local library folder

## Requirements and plan

FR-02/03/13/14, AC-02/11/16 and the local Mac milestone. The approved SPEC requires a user-chosen local directory, durable saves, interrupted-operation recovery and no silent fallback when a drive disappears. This does not change the whole-library On-device/Cloud modes or enable sync.

1. Add native storage guards: bind an open database to its selected file, reject writes if that file disappears/is replaced, and distinguish opening an existing selected database from creating the default one.
2. Build and test a local library manager with an atomic app-managed selection file, exclusive process locks, a small relocation journal and SQLite online backup. Create a destination file exclusively; never overwrite another database. Compare all canonical table rows and schema before selecting the copy. Flush files and directory entries before acknowledging the selection.
3. Exercise temporary synthetic roots through each failure/restart stage. Before selection publication, the source remains active. If publication durability is uncertain, block further writes until restart instead of allowing the two copies to diverge. A completed selection keeps the source as an inactive recovery copy; no future edits are written back to it.
4. Integrate a native folder picker and an all-window save/freeze barrier, using unique operation IDs and cancellation/release behavior. Reject capture, window changes and competing Quit/relocation operations during the barrier. Apply selection only after every live editor acknowledges its durable save. Keep user text available on any failure.
5. Expose the active location and recovery-copy consequences in Settings. Verify real selection/cancel, reopened location, revoked permissions, disconnected drive and failed draft saves on Mac when UI access is available. Never use the default library or scratch/native-m0 for tests.

## Isolation and implementation decisions

Start with the manager contract and fresh temporary databases before exposing relocation in the app. PEEL_DATA_DIR must isolate both the database and selection/journal metadata from real app data. Selection metadata stores paths and a library identity, not note content. Source copies are preserved; cleanup of an inactive copy is a separate explicit action. No directory-picker action runs automatically.

Use the already pinned rusqlite backup feature and standard filesystem APIs. No ordinary copying of an open SQLite file. Crash recovery follows the last durably published selection; a partial destination is never adopted merely because a file exists. Refuse missing selected databases instead of creating an empty replacement. Native runtime and external-drive tests remain gates even after synthetic contracts pass.

Standard file locks coordinate cooperating manager instances; they do not make older builds honor the new protocol. Quit older Peel builds before testing the integrated manager. [Rust file locking](https://doc.rust-lang.org/std/fs/struct.File.html#method.try_lock). The pinned Rust toolchain supports these APIs without another lock crate.

## Evidence

The production database now checks the selected file before repository operations. A missing file produces a recoverable error instead of writing through a stale connection; Unix device/inode identity rejects a replaced file. Two synthetic checks cover missing/reconnected storage, no creation of a missing selected file, and replacement rejection.

The manager in native src/local_library.rs is now used at startup and by Settings relocation. Six contract checks cover verified full-table backup/reopen, preservation of notes/placements/settings/tombstones, a source that stays inactive after selection, failures before publication, uncertain publication blocking further access until restart, exclusive open, refusal to overwrite unknown destination data, no fallback for missing selected storage, and preservation of malformed metadata/identity/schema. Faults are injected at planned, copied and published stages. No real note folder or default database is opened by these tests.

All 16 native tests and Rust formatting/Clippy pass. Five added controller/coordinator checks cover cold recovery/retry without default fallback, concurrent window changes, all-participant acknowledgements, stale/foreign/duplicate acknowledgement rejection, failed saves, timeout/window loss, competing operations, and restart-only recovery. Permission checks and save commits share one controller lock. A window that acknowledged can no longer write during that round, and window changes cannot race the participant snapshot. Copying cannot be canceled by the waiting-barrier timeout.

The native bridge now freezes/flushes every window before relocation, releases a canceled/finished round by its unique ID, and retains the freeze on uncertain publication. Native startup shows recovery controls before mounting the repository/editor when selected storage is unavailable. Settings shows the active location and explains inactive copies before opening the native folder picker. The SPEC's storage contract now records those copy/recovery consequences; the 0.7 mode/screen baseline is preserved.

Nine browser flows pass, including two explicitly mocked native-IPC flows. They check startup retry with no premature repository access, picker cancellation retaining the location, a held durable commit delaying acknowledgement, stale completion not clearing the current freeze/status, failed saves retaining text and releasing on cancellation, and restart-required editors staying read-only with Quit available. These are bridge/UI contract checks, not real macOS picker or cross-window interaction evidence. The unchanged production browser still passes its 11 offline checks and 58 shared cases.

The native release rebuild passes. Real picker/Cancel, multi-window native acknowledgements, cold recovery UI, physical drive/permission changes, 100-cycle stress and performance remain unverified while the Mac is locked. No local-folder acceptance criterion is marked complete. Failed destinations are retained without being selected or automatically removed; a retry currently needs another empty folder.

## Operation and recovery contract

One native operation coordinator handles Quit, folder selection and relocation, with unique IDs and per-window durable acknowledgements. Writes remain allowed only for windows still flushing; the coordinator stays locked while checking a write and committing it so an acknowledged window cannot race the copy. New note/window/lifecycle changes are rejected while frozen. Unexpected window loss, failed save or timeout cancels the waiting barrier and releases all editors; once copying begins, the waiting timeout cannot release them.

Startup shows a reconnect/retry recovery window when the selected library cannot open. Manager errors do not become a storage-startup panic or an empty default fallback. A controller with an optional library and a checked guard returns errors through IPC until Retry succeeds. The picker is wired after those controller and bridge contracts pass. PEEL_DATA_DIR isolates all metadata. Real Mac interaction checks remain required.

When selection publication is uncertain, retain the relocation freeze and offer Quit/reopen. Every editor has already flushed before the copy, so a normal Quit can preserve its acknowledged text without allowing a new unsaved draft against the blocked database. Before-publication failures release editors to the original selected library. Do not strand an editable dirty draft behind a restart-only error.

## Lock release follow-up plan

At head 32a1361, CI run 40405158967 failed native cold-recovery retry with a library-lock error after the previous controller had dropped; the parallel run 40405164934 passed. The new crash tests spawn child processes in the same test binary. A possible route is a duplicated/inherited lock descriptor keeping the open-file-description lock alive after the manager closes its own descriptor.

First reproduce that route deterministically with a duplicated descriptor held across owner drop, without forking or using real data. If confirmed, make the manager own an explicit unlock-on-drop guard so its lock lifetime follows the manager rather than incidental descriptor copies. Preserve exclusive rejection while the owner lives and reject unsafe library access as before. Verify controller recovery and the concurrent native suite, then await CI before calling the observed failure resolved. Do not mask the failure with sleeps, retries or serial-only testing.

The descriptor-clone regression reproduced the same lock error before the fix. Root/folder locks now have a sole-owner guard that calls unlock before closing its File. The regression passes with an old duplicate still alive; closing that duplicate cannot release the new owner's lock. Active owners still exclude other managers. [Rust's File lock contract](https://doc.rust-lang.org/std/fs/struct.File.html#method.unlock) describes descriptor duplication/inheritance and explicit unlock. This demonstrates a concrete failure route; descriptor inheritance in the specific failed CI process remains an inference. All 34 native cases pass locally with the crash fixtures and recovery tests running concurrently; one child-fixture entry remains deliberately ignored/parent-launched. Formatting/Clippy pass. CI at the fix head is still required.

Both CI runs at fix head 3add50d passed, including the concurrent native suite and release build: [run 40407947123](https://github.com/devsandip/peel-private-archive/actions/runs/40407947123) and [run 40407941945](https://github.com/devsandip/peel-private-archive/actions/runs/40407941945). This confirms the regression/fix batch on CI without establishing the separate native UI/drive acceptance matrix.

## Reproduce

```bash
cargo test --locked --manifest-path apps/native/src-tauri/Cargo.toml
cargo clippy --locked --manifest-path apps/native/src-tauri/Cargo.toml --all-targets -- -D warnings
```
