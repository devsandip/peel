# Historical version-one Cloud inventory

## Purpose and boundary

[Issue 82](https://github.com/devsandip/peel/issues/82), under issue 30/[M2.2](https://github.com/devsandip/peel/milestone/2), interprets the original expected graph retained by the [recipe codec](cloud-run-manifest.md) and [private store](cloud-manifest-storage.md). It supports SPEC FR-04/14/20 and AC-04/12/13 prerequisites. Current metadata collectors still regenerate current factories; changing their input boundary and actual ownership/lifecycle work are separate PRs. Public v0.7/app behavior stays unchanged.

## Format-one contract

Verify exact retained recipe bytes and independent original pins through the codec before interpreting inventoryJson. Use a fixed, versioned v1 catalog independent of today's IaC factories. Move only the existing exhaustive catalog into that module for sharing with the current writer, preserving field/resource/stack order and every current serialization/hash. Future format changes require another explicit version; v1 remains a legacy reader.

Validate the complete original graph by constructing the canonical v1 description from its strictly validated header and comparing exact bytes with the retained snapshot. This is a format interpreter, not an IaC template renderer. Enforce the four stacks and seventeen logical resources/types, original run names/tags, named versus generated versus parent identifiers, exact resolve/parent/dependency relationships, artifact object and function-role wiring. Unknown/missing/duplicate/extra/foreign data and versions fail; no resource may be ignored. Header rules retain v1's us-east-1/account/UUID/SHA and 1..20 MiB artifact bounds, canonical whole-second UTC leases of 60..90 minutes. Expiration is not a read gate.

Return detached deeply frozen expected selectors, original source/profile/plan/manifest binding and explicit unproven ownership. Expected parent/tag relationships and the owned-cloudformation-resource resolution recipe are not proof that physical AWS resources belong to this run. No AWS/file/clock/Git/current-source/price/authorization/new-run-policy operation or cleanup action belongs here. A matching hash is integrity, not provenance. Creation IDs, current independent identity, metadata ownership, absence and lifecycle stay under 30/31; audit 51 remains stopped.

## Verification plan

Before extracting the catalog, capture a frozen synthetic format-one full recipe using the actual existing factories and codec. Pin its original digests in tests. Verify exact current-writer byte compatibility and successful historical decoding while current factories/expected writer and clock throw. Recompute synthetic test hashes when deliberately mutating graph fields so schema checks, rather than only the outer checksum, must reject altered relationships. Test complete schema/coverage/name/type/tag/reference/dependency/artifact/lease/header/version, private failures and immutable snapshots. Use actual Node 24 direct import/focused tests plus relevant type/format/shared/build and all three hosted gates before a focused merge. Fixtures do not establish provider ownership, cleanup or app acceptance.
