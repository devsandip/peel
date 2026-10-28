# Reusable owned SQLite mechanics

[Issue 106](https://github.com/devsandip/peel/issues/106) is one compatibility refactor in [M2.2](https://github.com/devsandip/peel/milestone/2), under issue 30. It supports [SPEC](../SPEC.md) FR-04/14/20 and AC-04/12/13 prerequisites without changing product behavior. Read the [creation-journal protocol](cloud-creation-journal.md), [ledger namespace](cloud-ledger-namespace.md), [funding ledger](cloud-run-ledger.md) and [hosting plan](cloud-dev-hosting.md). The new journal remains a later PR.

## Fixed contracts and shared mechanics

Keep CloudLedgerStore as the fixed wrapper. Its existing public fields, constructor ordering, create/open/use signatures, error identity and mutable store/error objects remain compatible. Normalize the original authority exactly as before; directory canonicalization still precedes authority parsing. Keep run-ledger.ts and its reservation/cleanup policy and transactions unchanged.

Extract the existing path, owned-file, exclusive initialization, directory sync, rollback/header, catalog/settings and connection lifecycle mechanics into an internal module. Supply fixed module-level repository configuration for the ledger names, marker kind, app ID, version, bounds and exact schema. Wrapper callbacks retain the strict marker record parser and original metadata insert/validation. Configuration is not caller options or JSON and has no default path or runtime selection. Do not freeze, add fields to or otherwise narrow the old wrapper objects.

| Wrapper contract                                           | Shared mechanism to preserve                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| runs.sqlite, owner.json, peel-cloud-dev-ledger             | Exact marker JSON field order/newline, scope SHA and directory/database device/inode strings                                                                          |
| App ID 0x504c524c, version 1, three original STRICT tables | Exact header/catalog comparison and unchanged metadata normalization                                                                                                  |
| Canonical explicit directory                               | Existing realpath-parent behavior, input errors and evaluation order                                                                                                  |
| Private ownership checks                                   | Current UID, mode mask 0777, directory/file type, single file link, no-follow descriptor and inode checks                                                             |
| Explicit create                                            | Exclusive files, initialization transaction, directory/parent fsync, guarded readback; EEXIST validates a recognized existing store                                   |
| Open-only re-entry                                         | No initialization/reset on missing, foreign or damaged state                                                                                                          |
| Strict use versus recovery use                             | Reject foreign extras for new work; recovery ignores extras without reading/deleting them                                                                             |
| Bounded files and connections                              | 1 MiB database, 2 MiB rollback journal, recognized journal/header, DELETE/FULL/fullfsync/foreign-key readback, busy timeout, trusted schema, quick/foreign-key checks |
| Wrapper error and handle lifecycle                         | Same callback failure mapping, errcode 5 busy mapping, close on successful/failed callback and connection validation                                                  |

This is a mechanical extraction, not legacy hardening. Retain the current UTF-8 decoder (including BOM behavior), marker parser, mode mask, parent/path/descriptor sequencing and actual limitations. Do not claim new same-UID, rollback-snapshot or physical power-loss protection. Stronger journal-specific bootstrap/parent/descriptor/marker rules need their own reviewed scope. Do not repair, chmod, reset or delete unknown state.

## Sequence and evidence

1. Commit this plan before code. Use an isolated public-only worktree; preserve unrelated primary drafts unread. Move issue 106 and its Project card to In progress.
2. Add focused compatibility assertions for the extraction gaps: literal marker/header/schema/settings/public object shapes, constructor error ordering, callback error identity and actual closed handles. Run them against the unmodified implementation under actual Node 24 before moving mechanics.
3. Extract mechanics with fixed wrapper configuration. Retain the existing real independent writers, SIGKILL, commit-failure and expired-cleanup tests. Do not replace these with mocks or a second implementation.
4. Run actual Node 24 direct imports and namespace/ledger regressions plus relevant context/storage consumers; local type, format, shared tests and build. Review the moved code against baseline for semantic drift. Require all three hosted checks on the final PR head, no-reply identities and staged/range scans before merging.
5. Update issue/Project evidence, WORKLOG and immutable ignored resume. Main code CI follows integration. No milestone completion claim while actual managed smoke/independent teardown and other exit gates remain open.

All tests use fresh synthetic temporary namespaces. No real/default note or operator database, AWS request, provisioning, paid activation, app setting, dependency change or stopped probe belongs in this PR. Journal genesis, request/secret binding, token preparation, dispatch, receipts and lifecycle are separate PRs. Audit issue 51 and managed issue 31 remain blocked.

## Validation status

Plan committed before implementation. New compatibility assertions, extraction review and validation are pending; no journal or app acceptance is claimed.
