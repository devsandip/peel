# Clock-independent peer draft commits

## Requirements and plan

FR-02/13/17/19, AC-02/09/21/25. The current isolated peer engine stamps local writes before committing; a bad saved clock can reject them. The shipped app still saves independently of sync. Close this integration prerequisite in the M0 store without enabling app sync or claiming clock repair is solved.

1. Add an atomic device-local draft commit with no wall clock, cryptography, session, peer list or network requirement. Store the note projection plus a small generation/revision/base-head marker. Conditional revisions protect concurrent editors; an identical retry may return the already-committed revision.
2. Keep receiving verified remote heads durably while a local draft awaits safe stamping, without replacing the saved local projection. Maintenance cannot discard a draft with no stamped head. Permanent purge removes draft bodies/markers along with all other note content and prevents resurrection.
3. Publish only the exact current draft generation/revision after a future caller establishes clock safety. Commit the immutable stamped head, history, seen digest and pending delivery reference atomically with clearing the draft marker. Publication itself does not increment the local editor revision or change original display timestamps. A stale publish cannot replace a newer local draft. Failed stamping/commit retains the saved draft.
4. Bump the logical store identity to version 2 on writes, accepting version 1 as an upgrade input. Older experiment engines must reject version 2 instead of silently overwriting draft projections. The generic adapter table layout stays version 1; no app database migration.
5. Extend the shared real SQLite/IndexedDB contract with future-clock capture/restart, failed draft/publish commits, remote receipt/maintenance during a draft, stale/concurrent publication, retries and permanent purge. Add committed-draft and uncommitted-publication SIGKILL boundaries and verify browser reload.

## Decisions and limits

The draft is a local durable note with an unstamped marker, not a second server queue or an immutable network edit. Its generation is meaningful only with the note ID and local revision. Newer local saves coalesce it. Publication is a later causal protocol event and preserves display dates; it does not prove the real-world order of human actions on bad clocks. Authenticated calibration, repair/uncertainty UX and production policy remain gates before any automatic app publication. Existing stamped-write helpers remain only for old fixtures and must refuse to bypass a pending draft.

Keep this package outside the application. No pairing, network, infrastructure, real notes or schema changes to the shipped SQLite/IndexedDB repositories. The approved modes and 0.7 mockup baseline remain unchanged.

## Evidence

The isolated engine now has saveDraft and publishDraft, a body-free draft marker and logical identity version 2. Capture does not call the clock or Web Crypto. A saved draft's projection survives headless maintenance, verified remote head receipt and restart. Publishing atomically changes the protocol head/outbox and clears the marker, retaining the editor revision and display dates. Permanent purge removes draft state and bodies. The old stamped fixture helper refuses to bypass a draft.

Four added shared contract scenarios pass on actual Node 26.4 / SQLite 3.53.2 and Chrome 155 IndexedDB, extending both adapters to eleven scenarios. They cover a one-year-future saved clock, durable text while publication is quarantined, lost-response retries, failed draft/publication/replacement commits, coalescing, original null base preservation, remote receipt without draft leakage into delivery, headless/history maintenance, purge and a controlled race where a newer local commit invalidates a paused publication. A separate logical-identity case verifies version-1 upgrade and refusal/preservation of future or malformed identity values. TypeScript, formatting and all 59 shared cases pass.

Two added SQLite SIGKILL boundaries preserve a committed unstamped draft and roll back an uncommitted publication without a partial head/outbox/clock. Together with the earlier two cases, four subprocess boundaries pass. Chrome reload preserves both the prior projection and a separate pending draft. The bound-channel regression still passes all 15 checks across eleven host/host DTLS sessions. [Synthetic report](../experiments/peer-local-drafts-2026-10-27.json) contains only environment, counters and boolean outcomes.

No application repository, native runtime, real note/account, network sync or cloud resource was used. Publication with a supplied safe timestamp is an M0 API contract, not authenticated calibration or repair evidence. Clock policy, current-trust transactions, bounded inventory/history/seen growth, actual pairing, cross-network direct/forced relay and native/iPhone remain gates. No product acceptance criterion is complete from this package.
