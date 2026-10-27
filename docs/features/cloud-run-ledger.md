# Durable Cloud run-slot ledger

## Purpose and boundary

[Issue 55](https://github.com/devsandip/peel/issues/55) implements the private persistence boundary required by the [deployment-plan guard](cloud-deployment-guards.md), within [M2.2](https://github.com/devsandip/peel/milestone/2), under SPEC FR-04/14/20 and AC-04/12/13 prerequisites. One PR handles durable compare-and-reserve and cleanup-receipt storage. No AWS operation, resource discovery, apply command, real note/default database or app Cloud activation belongs here. Audit issue 51 remains blocked; target ownership/lifecycle and managed proof remain issues 30/31. Product v0.7 is unchanged.

Before opening a PR, separate [issue 56's filesystem/schema namespace](cloud-ledger-namespace.md) from issue 55's run/receipt mutation policy and process-crash evidence. The namespace prerequisite exposes only an internal owned connection boundary; it cannot reserve a slot or claim cleanup. Follow with one separately reviewed transactional counter PR. Keep each within one focused review rather than combining both risk boundaries.

## Storage and ownership

Use the existing operator Node SQLite runtime, verified under actual Node 24, for [atomic transactions and process-crash recovery](https://www.sqlite.org/atomiccommit.html). Require an explicit new private directory in a caller-controlled parent. A future runner must choose one canonical ledger for the complete authorization window; choosing another path is not a refund or a new spending grant. This is an operational allowance, not an account-global AWS hard spending cap.

Create only a mode-0700 directory, exclusive mode-0600 ownership marker and precreated mode-0600 operator database. Bind marker format/kind, canonical authorization digest and directory/database device/inode identities. Existing directories/files require that exact ownership before opening SQLite. Refuse links, permissive ownership/modes, unknown files, wrong formats/schemas or oversized/corrupt state; preserve unrecognized data without chmod, reset, repair or deletion. The recognized SQLite rollback journal stays inside the private namespace. No default path points at an installed app's note database.

Initialization is explicit bootstrap. Re-entry must open the existing canonical ledger; a missing ledger is not permission to initialize another for the same window. The future runner must preserve this distinction and never use an open failure as an automatic create/reset fallback.

Use a fixed application ID/schema, strict bounded tables and exact schema/authority validation. Set DELETE journaling, synchronous FULL, fullfsync and foreign keys; verify their readback. SQLite documents [fullfsync behavior](https://www.sqlite.org/pragma.html#pragma_fullfsync) as platform-dependent. Sync initial files/directories before returning initialization. Evidence covers actual process interruption/reopen; physical power-loss guarantees still depend on SQLite, filesystem and storage behavior.

## Atomic policy and receipts

Each reservation obtains SQLite's immediate transaction lock, loads the actual ledger and compares its canonical digest with the caller's prior snapshot. Run the existing full new-run validator against that stored projection, explicit authorization and supplied plan/observations inside the transaction. Recheck time/policy immediately before commit. Supplied observations still need the real collectors; this ledger does not authenticate fabricated facts.

Commit the UUID, immutable normalized-plan digest and reservation time before acknowledging. At most two distinct identities consume USD 2 each plus the fixed USD 1 cleanup reserve. Reject duplicate, stale, exhausted or unresolved-prior state. A failed/uncertain AWS create after acknowledgement never removes its reservation. If local acknowledgement is lost after commit, reopening still finds the consumed slot; callers must inspect that identity instead of retrying with another UUID. A transaction rolled back before durable reservation cannot authorize any AWS write.

Store cleanup receipts immutably against the exact run and plan digest, including inventory digest and checked time, with compare-and-write/idempotent retry. A receipt records facts supplied by a future trusted ownership/cleanup verifier; a hash or method call does not establish AWS deletion. No operator CLI accepts a manual verified-cleanup flag in this PR. The second reservation still requires a recorded matching receipt and all fresh new-run guards. Keep actual inventory provenance/teardown acceptance in issue 31.

Existing-reservation inspection and cleanup-receipt storage do not call the new-run validator. Expired leases/source/quotes/authorization cannot prevent reading a known reservation or recording its later cleanup. Storage ownership/integrity and external AWS ownership/authentication remain necessary. The future cleanup runner must not depend on a new run being authorized.

## Verification

Use synthetic fixtures and fresh test-owned directories only. Test independent competing processes, acknowledged and lost-ack commit recovery, termination before commit, stale/duplicate/exhausted/unresolved state, expired-authorization cleanup, injected commit failures, private fixed errors, links/permissions/unknown/corrupt state and preservation of foreign files. Exercise actual Node 24 and the development runtime; add focused Node 24 hosted coverage alongside existing checks. All relevant local and hosted gates precede merge. No real operator ledger, AWS run, resource, account setting, billing or note data is created by validation.

Twelve focused cases pass under actual Node 24, including real independent writers and SIGKILL before commit, after commit before acknowledgement, and after acknowledgement. All 247 shared cases, TypeScript, formatting and web build pass locally; combined Node 24 namespace/ledger coverage has 21 cases. Local policy/receipt fixtures do not establish AWS cleanup provenance. Namespace tests remain a separate prerequisite. Hosted gates follow before integration.
