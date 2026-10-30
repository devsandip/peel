# Original connections retain their scope

2026-10-30 14:24 IST. Previous: [A scoped connect attempt consumes one original-session ticket](2026-10-30-0803-scoped-connect-admission.md).

I resumed after the pause. PR200 is fully merged and separately verified at94d2c91, with [proof6513750554](https://github.com/devsandip/peel/pull/200#issuecomment-6513750554). I preserved the pause worklog rather than replacing it. Antigravity's conflict-preview assignment and all unknown primary paths stay untouched.

Issue201 now retains original admitted connection metadata in an explicit isolated SQLite registry. A successful handshake prerequisite does not grant a lasting subscription. Registration checks current session and library policy. Lookup checks them again and verifies that the exact original registration remains. The lease can outlast its admission ticket but never the original session. Exact cleanup protects a later registration when an expired connection ID is reused.

The local evidence and its failures are in the [feature plan](../../docs/features/cloud-connection-registry.md). Exact-source hosted review and separate actual-main evidence are still pending at this checkpoint. The app has no enabled live Cloud path, and M2.2's managed acceptance is still open.

## Decisions

- I retain only scoped metadata, with independent admission and lease deadlines, because ticket expiry is not a continuing authorization policy.
- I attempt exact cleanup after an uncertain insert acknowledgement because a committed write can outlive a failed response.

## Direction changes

- Was paused after PR200, now resumed for201 at Sandip's request. The recurring heartbeat remains paused.

## Needs revisit

- Finish exact-source/main proof and issue201 closure before calling it complete. Later hosted registry, trusted invocation and actual fan-out remain outside this slice, tracked in the feature plan and milestone.
