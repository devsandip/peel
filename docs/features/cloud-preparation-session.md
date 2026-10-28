# Fresh preparation-session acknowledgement lineage

[Issue 129](https://github.com/devsandip/peel/issues/129) is one prerequisite under issue 30 / [M2.2](https://github.com/devsandip/peel/milestone/2), after PR 128. It supports [SPEC](../SPEC.md) FR-04/14/20 and AC-04/12/13 prerequisites. Read the [creation-journal protocol](cloud-creation-journal.md), [actual source/genesis boundary](cloud-journal-sources.md), [funding ledger](cloud-run-ledger.md) and [pure request contract](cloud-stack-create-request.md). This plan precedes implementation. Functional v0.7 and existing store/schema contracts stay unchanged.

## One purpose

Create a private live preparation-session lineage only when the same trusted initializer acknowledges a new workspace, its own actual fresh reservation and exclusive source-bound genesis bootstrap. It generates no key/token, prepares no request, writes no dispatch fence, calls no provider and returns no spending or execution permission. Supplied policy observations remain data, not authenticated account facts. Actual current collectors, session, phase, time and cleanup gates still precede future preparation/dispatch.

No API accepts an already reserved row, reserve/bootstrap result, approval/owned flag or arbitrary callback as proof. No public clock/commit hooks. A runtime-private constructor brand and module-private live state must prevent copies, JSON, forged instances, reopened stores and another process from constructing the lineage.

## Fresh workspace and failure policy

Require an explicit absolute canonical new run-workspace target under an existing canonical private parent. The independent funding ledger must already exist and open as recognized; no create/default/fallback ledger path. Derive recipe and context directories inside the new workspace. Capture exact data-only bounded inputs, original recipe/context/pins, path selections and policy inputs before filesystem access. Reject unknown fields/accessors/non-data values, excessive depth/size, aliases, nesting and mismatched original identities.

Preflight against the actual recognized ledger projection and expected snapshot. Validate new-run policy using its real prior ledger before reservation, never a fabricated empty ledger or already-reserved projection. Require the normalized result to match exact original normalized plan bytes.

Exclusively create the selected mode-0700 workspace and acknowledge its private parent/workspace before reserve. Hold and recheck owner/mode/type/device/inode and canonical paths around subsequent work. Existing workspace refuses before another reservation. Derive and enforce its known child names. Do not adopt, chmod, reset, delete, retry at another path or refund anything after failure.

This closes a restart ambiguity: SIGKILL before reserve COMMIT may leave no row, which does not establish that the initializer never ran. The preserved workspace forces recovery at the same selected path even when no slot was consumed. This conservative policy can strand an unused local workspace after busy/precommit failure. It does not certify global rollback protection or defend against an owner rewriting all selected anchors.

## Actual acknowledgements and private lifetime

The initializer itself calls actual `CloudRunLedger.reserve` and receives its successful return. Compare the actual stable reservation tuple and normalized-plan SHA against the originals. A duplicate/stale/busy/uncertain/lost acknowledgement never becomes a successful observation-based replacement. Once workspace creation starts, any failure preserves that workspace and any consumed slot, with no live session.

Publish the exact original recipe and bound context with their actual existing APIs, then call actual `CloudSourceBoundJournalStore.bootstrap`. Separate source opens/syncs remain required by that facade; inspection cannot replace them. Verify final recognized genesis, unchanged actual reservation snapshot and original bytes/pins. A failure after COMMIT/readback/synchronization gives no live session and never repairs/recreates partial state.

Only after all acknowledgements and descriptor closure may a frozen genuine session enter the module-private live map. Its safe read must validate the recorded workspace identity, actual ledger and source-bound genesis again without claiming a fresh source-sync/current gate. Validation failure or explicit discard permanently removes live state. Reading historical records remains separate and can never recreate it. A future preparation method must require this same internal lineage plus actual current gates; returned metadata is never the capability.

## Validation and integration

Use fresh synthetic private directories and actual public ledger/source/journal APIs. Cover first and second slots; strict pure-input rejection before FS; canonical/exclusive workspace ownership, aliases/replacement/nesting/foreign-file preservation; actual stale/duplicate/busy/uncertain reservation; source publication/separate-sync/bootstrap and close failures; original mismatch; lost reservation/genesis acknowledgement; copied/forged/readback/discarded sessions; independent competing processes and SIGKILL before/after real reserve/genesis commits. A restart at preserved workspace must refuse even after a precommit rollback. A negative control substituting an existing reservation observation for the actual reserve ACK must fail the intended assertion.

Run actual Node 24 direct/focused/Cloud consumers, then shared tests, type/format/build sequentially under configured defaults. Keep failures honest and actual process cases intact. No config-mirroring test, timeout increase, retry or legacy test change. Focused review, staged/range scans, actual no-reply author AND committer and all three exact-head hosted checks precede normal merge. Confirm actual GitHub closure before Project Done and verify merged main separately. Keep WORKLOG, journal and immutable ignored resumes current.

No actual/default note/operator data, credentials, AWS/account/resource/budget/billing/app activation or stopped probe. M2.2, audit 51, managed 31, native 72 and all app/release gates remain open or stopped. This local lineage is not provider provenance, current approval, durable request preparation, SDK serialization or managed-service evidence.
