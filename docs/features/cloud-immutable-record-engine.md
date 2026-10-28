# Shared immutable Cloud record storage

## Purpose and boundary

[Issue98](https://github.com/devsandip/peel/issues/98), under issue30/[M2.2](https://github.com/devsandip/peel/milestone/2), extracts the tested owned-file mechanics from [manifest storage](cloud-manifest-storage.md). This preserves SPEC FR-04/14/20 and AC-04/12/13 prerequisites while preparing reuse for later bound original context storage. See [original plan context](cloud-run-plan-context.md), [recorded reservation binding](cloud-run-reservation-binding.md) and [hosting](cloud-dev-hosting.md). It adds no journal namespace or product behavior. Canonical v0.7 remains unchanged.

## Refactor contract

Keep CloudRunManifestStore and CloudManifestStorageError public APIs, frozen return/error shapes, private codes/messages, directory semantics, exact manifest.json/owner.json bytes, marker field ordering and independent pins compatible. The wrapper retains pin capture/normalization, codec validation, fixed marker schema and names, and result naming. Move shared path/ownership/descriptor/bounded UTF8/exclusive publication/synchronization/readback mechanics into an internal module with fixed trusted wrapper configuration. No public filename/kind/codec/graph/ownership override.

Keep the existing operation order: validate/copy input and normalize independent pins before I/O; open existing parent; exclusively create a new directory and both files; write/sync the recipe; beforeCommit with an empty marker; revalidate; write/sync the marker, root and parent; revalidate; afterCommit; complete readback before acknowledgement. All writes use original descriptors. Preserve incomplete/unknown state and close owned handles on every path. Open validates and re-syncs the verified recipe/marker/root/parent descriptors before acknowledgement; read/inspect remain read-only without a new sync claim. Keep pre/post path/inode/owner/mode/single-link/no-follow/exact-membership checks and strict bounded UTF8 with BOM preservation.

Never initialize on an open failure, reset/repair/chmod/delete unknown data or change ledger/schema/note stores. Same-UID trust and physical power-loss limits remain those of the existing implementation. No AWS/provider/app/billing/stopped-probe operation, new grant, journal intent/client token/provider receipt or managed acceptance.

## Verification plan

Keep the actual independent-process writer, competing creator, SIGKILL and sync-failure tests. Add compatibility assertions for exact old marker bytes/API/result shape, all four sync descriptors in order, handle closure on failures and readback behavior where the extraction creates a gap. Use fresh synthetic-only namespaces. Compare the extracted algorithm against the original at f213ad9; run actual Node24 direct import and focused/legacy storage suites, shared type/format/tests/build, focused review, no-reply/scans and all three exact-head hosted checks before one focused merge. Retain failures as failures and pending checks as pending. Bound journal persistence remains a separately scoped follow-up; audit51/managed31/M2.2 stay open.
