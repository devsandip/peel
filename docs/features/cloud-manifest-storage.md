# Private immutable Cloud manifest storage

## Purpose and boundary

[Issue 80](https://github.com/devsandip/peel/issues/80), under issue 30/[M2.2](https://github.com/devsandip/peel/milestone/2), persists the [original recipe codec](cloud-run-manifest.md) for SPEC FR-04/14/20 and AC-04/12/13 prerequisites. This is an operator store, separate from the strict [run ledger](cloud-run-ledger.md) and all note databases. No AWS operation, budget reservation, creation ID, historical graph interpretation or physical cleanup authority belongs here. Canonical v0.7/app behavior stays unchanged.

## Namespace and immutable data

Require an explicit canonical absolute path with an existing caller-owned parent that others cannot write. Resolve the existing parent once and use its canonical path. Bootstrap only a new mode-0700 directory; existing paths always refuse create. Open never creates or repairs. Store only exact manifest.json bytes and owner.json, both owned regular single-link mode-0600 files. Marker format/kind, normalized original pins and directory/manifest/marker device/inode identities must match. No default path, parent creation, schema migration, chmod, reset, deletion or overwrite fallback.

Use no-follow/exclusive descriptors, bounded strict UTF-8 reads, descriptor/path identity and mode checks before/after, and exact directory membership. Reject unknown, linked, replaced, permissive, incomplete or corrupt state while preserving it. Keep root/parent/file descriptors open during publication; after initial exclusive creation all byte writes use those original descriptors. A hostile process with the same UID can still rewrite the operator's entire trust store; this is not a sandbox against its owner.

Validate/copy codec inputs and pins before filesystem mutation. Add a narrow fixed-error public pin normalizer to the codec so the storage boundary captures independently expected pins without retaining caller references. Read the marker and verify its expected pins before reading recipe contents. The resource graph remains opaque.

## Commit, re-entry and failures

Create opens both exclusive files, verifies their identities, writes/syncs the recipe, then reaches the before-commit checkpoint with an empty marker. Validate the namespace again, write/sync the complete marker, sync the directory and parent, and verify complete readback before acknowledging. A pre-marker crash leaves an incomplete unrecognized namespace; preserve it, issue no acknowledgement and never auto-recreate. A crash after the sync boundary but before acknowledgement leaves a recognizable exact recipe; reopen it rather than creating another store.

Open validates the entire namespace/codec, explicitly re-syncs the same verified file/directory/parent descriptors and revalidates before acknowledging. This also distinguishes a previous sync failure from a completed new acknowledgement. Read/inspect is a separate read-only operation and does not attest a new sync acknowledgement. Sync failure never counts as success; no cleanup-recovery read calls current source/factories, clocks, prices, authorization or fresh-run lease policy. Injected checkpoints are for interruption evidence, not authority.

Before any later AWS write, orchestration must have both this exact manifest acknowledgement and the matching durable plan/run reservation. Creating a namespace is not a new budget grant; it never replaces or refunds the canonical ledger. Creation intent/response IDs, ownership, historical interpretation, apply and provider teardown remain separate issue 30/31 work; audit 51 remains blocked.

## Verification and limits

Use fresh synthetic-only directories and actual independent Node processes. Cover exact create/reopen, detached pins, expired recipe inspection, links/modes/identity substitution, unknown/corrupt/oversized/invalid UTF-8 state preservation, competing exclusive writers, injected sync failures, SIGKILL before commit and after durable commit/before acknowledgement. Verify real Node 24 plus shared type/format/tests/build and all hosted gates before a focused merge. No stopped native/relay/audit probe or real/default notes.

Node [fsyncSync](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsfsyncsyncfd) requests OS synchronization. It is not a power-loss guarantee: [Apple documents](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html) drive-cache limitations and stronger F_FULLFSYNC behavior. This slice uses file/directory fsync and proves process-interruption recovery, not hardware power-loss recovery, managed-run readiness or cleanup acceptance. No new native binding/dependency is introduced. The existing SQLite ledger's FULL/fullfsync contract is unchanged. A local synthetic probe confirms read-descriptor file/directory fsync works on this Mac; hosted platform tests remain required.

## Local implementation evidence, 28 October

Fourteen storage cases and direct import pass under actual Node 24.22.1; combined codec/storage coverage has 22 cases. Actual independent processes prove one exclusive creator, incomplete-namespace preservation after pre-commit SIGKILL, and exact recovery after post-commit/pre-ack and post-ack SIGKILL. Injected fsync failures at all four publication stages never acknowledge; read-only inspection makes no sync claim, and reopening requires a fresh successful sync. Mode/link/inode/extra-file/content/UTF-8 checks preserve rejected bytes and unknown replacements. Pins and returned snapshots are detached and frozen.

Review found that the default UTF-8 decoder could discard a BOM before byte verification. The decoder now preserves it, so both recipe and marker changes are rejected. An actual Node 24 negative control fails without that setting and passes after restoration; its ignored log contains synthetic inputs only. This is part of the exact-byte persistence contract. No physical power-loss, ACL/network-filesystem certification, provider ownership, run reservation, live AWS or app acceptance follows. All 338 shared cases in 50 files, TypeScript, formatting and web build pass locally; the existing browser chunk-size warning remains. The hosted Node 24 import/focused suite is extended for this store. All three exact-head hosted gates and focused review precede merge. No dependency, artifact or IaC factory changed.
