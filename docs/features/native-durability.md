# Native repository durability checks

## Requirements and plan

FR-02/07/13, AC-02/16 and the local Mac milestone require acknowledged saves to survive failure and failed writes to retain the previous committed content. The existing peer-store SIGKILL experiment uses a different database adapter and is not evidence for the shipped Rust repository.

1. Exercise the actual native Database implementation in child processes against fresh temporary synthetic-only directories. Require a fixture marker before any child opens a path; never read default data or scratch/native-m0.
2. Kill the child after an explicit stdout marker that follows successful native save/placement/settings calls, then reopen and verify exact acknowledged source, revision and device-local metadata. Separately kill with a large replacement transaction still open and verify rollback to the prior acknowledged state, including placement/settings/tombstone rows.
3. Kill after a successful native permanent purge and verify the tombstone prevents stale resurrection. Bound child waits, always reap a child on failure and run SQLite integrity checks after reopen.
4. Add a deterministic SQLite page-limit failure to exercise an actual storage-full error without filling the host drive. Failed save must retain the previous revision/source, and retry must work after removing the fixture limit. Distinguish simulated SQLite limits from a real full filesystem or physical drive loss.
5. Reopen/edit/close a synthetic library for 100 cycles and compare exact content/revisions. Record wall-clock environment and limits without treating repository timings as editor focus/save-UI targets.

## Decisions and evidence limits

Use the existing Rust test binary as an explicitly ignored child fixture, launched only by parent cases with marker-verified temporary paths. No app window, real note data, OS login item or cloud service is needed. Production code remains untouched unless a failure reveals a defect. These checks cover repository/process recovery; they do not establish native UI close barriers, power-loss durability, physical disk/permission faults, multiwindow stress or target-device latency.

## Evidence

Five new native cases pass against the shipped Rust Database on this Mac. Three children are terminated by SIGKILL after the required marker: acknowledged save/placement/settings, uncommitted replacement and acknowledged permanent purge. Each reopen passes SQLite integrity_check. A large uncommitted transaction uses a four-page cache and must grow the WAL before the marker, so rollback exercises spilled pages rather than only untouched process memory. The restored snapshot, revision and local metadata match exactly; the uncommitted tombstone disappears, and a committed purge rejects both stale revision and new-revision resurrection attempts.

The storage-limit case confirms SQLite's DiskFull error using max_page_count, then verifies the native save fails, the previously acknowledged source/revision remains and a retry persists after restoring the limit. It does not fill the host disk. The cycle case performs 100 native repository open/read/edit/save/close cycles and verifies every exact source/revision, followed by an integrity check. These are repository cycles, not 100 native editor close/focus flows.

The child fixture is ignored when invoked alone in the normal suite, but three parent cases execute it explicitly with marker-verified temporary roots, a ten-second boundary timeout and kill/wait cleanup. The native suite now has 33 passing cases plus this one fixture entry. Rust formatting and Clippy pass. No real/default database, window, OS login item or AWS resource was accessed. The prior production/native bundle remains unchanged by test-only code.

AC-02/16 remain open for actual native close/failure UI, unacknowledged drafts, physical full-disk/permission/drive loss, power loss, iPhone termination and the full supported-device matrix. A successful process recovery experiment does not replace those gates.
