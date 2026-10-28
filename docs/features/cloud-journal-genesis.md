# Fixed original creation-journal genesis

## Purpose and small PR boundaries

[Issue114](https://github.com/devsandip/peel/issues/114) implements the genesis slice of the [creation-journal protocol](cloud-creation-journal.md), under issue30/[M2.2](https://github.com/devsandip/peel/milestone/2). It supports [SPEC](../SPEC.md) FR-04/14/20 and AC-04/12/13 prerequisites. Functional v0.7 and Synkies branding are unchanged. This plan is committed before code.

Separate the pure format/binding decision from filesystem ownership/bootstrap and actual source acknowledgement:

1. [Issue115](https://github.com/devsandip/peel/issues/115): a bounded pure genesis/independent-anchor codec. No file, database, source sync, current reservation observation or execution capability. Only this PR is implemented first.
2. Journal-specific namespace/bootstrap mechanics: new fixed schema/app ID, strict parent/descriptor/inode checks, exclusive creation, initialization/sync/readback/crash boundaries. Preserve the existing ledger's older semantics and byte contracts; the shared engine does not already supply every new guarantee.
3. Bound genesis persistence: actual canonical funding lookup, independent original source selection, separate successful recipe/context open acknowledgements, retained original data and conservative explicit recovery. No permit is returned by storage. Issue114 closes only when all its original acceptance criteria have evidence.

Create only the next concrete issue when needed. Do not bundle tokens, request construction, preparation/fencing, receipts, provenance or provider lifecycle into these PRs. Later work remains in the protocol.

## Pure contract

Use a fixed version1/catalog1/revision0 envelope, kind synkies-cloud-journal-genesis. Its independent anchor contains canonical workspace and funding-ledger selections, the normalized original authority and the actual stable reservation tuple: slot, original run UUID, normalized-plan SHA and reservedAt. A future trusted adapter must obtain that tuple from the actual independently selected ledger. The codec only validates supplied data; it never authenticates the tuple or reserves a slot.

Derive one location from the workspace and original run: journal-<run UUID>. There is no caller journal-directory override or search. The funding ledger may be outside the per-run workspace; do not accidentally require one funding ledger per run. Reject overlapping ledger/source/journal namespaces that would nest one recognized private store inside another. Paths are bounded, absolute and lexically normalized, without ASCII control characters or invalid UTF8. Only the future store can verify actual canonical filesystem identity/ownership and descriptors.

Capture original recipe bytes/pin and original context bytes/independent SHA with their source-store paths. Reuse original manifest/context/catalog codecs and compare plan identity, authorization cleanup margin, plan SHA, slot envelope, run and reservation-time bounds. Never call current template factories, new-run validation or Date.now for historical recovery. A stable reservation is independent of the changing whole-ledger snapshot and cleanup status.

Pure normalization, create and read return detached deeply frozen data with fixed private errors. The read path takes the independent anchor plus serialized genesis; it does not require an expected random/genesis digest lost with process memory. SHA values establish integrity only within a later recognized journal trust chain. A self-consistent unknown JSON file or caller-supplied anchor is not provenance, current source acknowledgement, ownership, available funding or a create capability. Return unproven ownership/run authority and zero resource writes explicitly.

Initial limits: recipe512KiB and context32KiB from the protocol; each path4096UTF8bytes, source-selection/anchor metadata24KiB, complete canonical envelope1536KiB. JSON escaping and metadata fit within that envelope limit or refuse; do not silently raise the2MiB database/4MiB rollback limits. Actual SQLite page usage/capacity must be verified by the later persistence PR, not inferred from codec bounds.

## Verification and remaining gates

Use original frozen synthetic plan/recipe fixtures, independently pinned canonical result digests and semantically altered/rehashed failures. Cover mismatched independent anchors/reservations, slot/account/authority/time/source/path bindings, lost-caller-digest reads, expired originals with current factories unavailable, canonical closed schema/UTF8/bounds, detached/frozen results and private failures. No actual/default note or operator files, RNG or network calls. Add actualNode24 direct-import/focused CI coverage; run relevant legacy/consumer/shared/type/format/build and all3required final-head hosted checks plus focused review/scans/no-reply before merging.

Actual source opens, namespace/inode ownership, durable genesis transactions, concurrent creators/SIGKILL/ack loss, source disappearance, SQLite page limits and exclusive bootstrap are UNRUN here. They remain issue114's storage work. Audit51/managed31/M2.2 and all app/release acceptance stay open. Expired permissions/leases are not renewed by any local record.

## Validation status

The pure codec passes13focused cases and an actualNode24 direct create/read roundtrip. Independent Python serialization of the frozen original fixture pins44191canonical bytes, genesis SHA15ee52507cd7b8eae8553445b2c61b6a763401b3bf8fe9e16f135268bda229b2 and scope SHA734db0a1d42e8b3fa7d6e8f6ae06db11868a5f4fb7efb99178f80cb4ae3b912d. A fully coherent rehashed different plan is rejected against the independent original reservation; omitting that comparison fails the intended assertion, then exact restored source passes. Both create/read work with current factories/policy/clock and physical store/entropy calls unavailable.

The first259-case consumer run exposed an unchanged ledger test assuming exactly one acknowledged concurrent writer. Its original interleaving remains unproven; controlled shared-reader evidence demonstrates a legitimate busy+uncertain/zero-row outcome. That verification correction is separately merged in PR117 without production changes; no passing result is substituted for the original failure.

After that dependency, all260actualNode24 Cloud cases/23files and475shared cases/61files, TypeScript, formatting and web build pass. The dependency-source and post-merge rebases preserve the exact locally tested tree. Existing browser chunk warning remains. Required exact-head hosted gates and focused review still precede the pure-codec PR merge. Actual namespace ownership, canonical filesystem selection, source ACKs, durable transactions, process/crash recovery and physical page capacity remain UNRUN issue114 work. No journal persistence, provider permission or app acceptance is claimed.

## Integration follow-up, 28 October 2026

The pure contract merged in PR118 with all three exact-source and exact-main checks passing. Strict files (PR120) and fixed SQLite persistence (PR122) have since merged with their own evidence. [Actual funding/source binding](cloud-journal-sources.md) is issue123, the final parent114 slice. Earlier UNRUN statements above describe the pure PR scope; none establishes provider or app acceptance.
