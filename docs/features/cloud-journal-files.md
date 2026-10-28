# Strict creation-journal file boundary

[Issue119](https://github.com/devsandip/peel/issues/119) is the next small slice of [issue114](https://github.com/devsandip/peel/issues/114) in [M2.2](https://github.com/devsandip/peel/milestone/2). It supports [SPEC](../SPEC.md) FR-04/14/20 and AC-04/12/13 prerequisites. Read the [journal protocol](cloud-creation-journal.md) and [pure genesis contract](cloud-journal-genesis.md). This plan precedes code. Functional v0.7 and Synkies branding stay unchanged.

## One purpose

Implement fixed internal journal file ownership and exclusive namespace creation, separately from SQLite/schema/genesis and actual source acknowledgement. The legacy ledger and immutable-file engines retain their existing behavior and bytes.

Normalize the independently supplied anchor and derive journal-<original run UUID> beneath its workspace. Require an existing canonical owned workspace with exact mode0700. Hold no-follow directory/file descriptors, compare full current UID/type/mode/link/device/inode facts with paths before and after operations, and retain workspace/directory/database identities in a strict canonical marker. Exact modes include special permission bits. Refuse aliases, symlinks, hardlinks, replacement paths and copied namespaces. No default path, alternate search, arbitrary filename/schema/codec, adoption or repair.

Only exclusive creation creates mode0700 journal and mode0600 journal.sqlite/owner.json. EEXIST always refuses, even for a valid namespace. Failure preserves partial files. Open-only re-entry validates file facts without initialization. Database files are bounded at2MiB; recognized rollback journals at4MiB. Strict use rejects extra names; explicit inspection may ignore extras without reading them. These primitives do not validate SQLite header/schema/genesis or authenticate funding/source facts. An empty file is still an incomplete journal. The later fixed storage layer must validate those things before SQL use.

Synchronization checks the held identities, syncs database, marker, journal directory and workspace descriptors, rechecks after each stage and returns no execution capability. Marker contents are strict closed-schema canonical UTF8 with one newline, bounded at4096bytes. Sync acknowledgement covers these namespace files only; it is neither source-store acknowledgement nor committed genesis. Close all descriptors on initialization/open failure and on explicit close. Errors stay fixed and private, without paths or causes.

Node's path-based filesystem and future SQLite calls are not a same-UID sandbox. Descriptor/path checks detect ordinary copies/replacements and fail closed on observed changes; they cannot certify an adversarial filesystem, ACLs, network mounts, drive caches or physical power loss. The workspace is deliberately private. Earlier ledger parent semantics are not extended implicitly.

## Sequence and evidence

1. Commit this plan, with issue/Project In progress, before code.
2. Add fixed file primitives and tests using fresh synthetic temporary canonical private workspaces only. No actual/default note or operator files.
3. Exercise real independent creators (one exclusive namespace winner), preserved partial creation, copy/move/symlink/hardlink/mode/parent/descriptor replacement, malformed/oversized markers and files, foreign-extra inspection, failed fsync and descriptor closure. A removed identity check must fail its intended negative control.
4. Run actualNode24 direct imports and focused/relevant legacy consumers, shared tests, type/format/build. Preserve actual ledger concurrency/SIGKILL evidence. No SQLite operation is added here; its schema/page/bootstrap/crash/source-ACK evidence stays pending.
5. Focused review, scans and actual no-reply author AND committer checks precede push; all three exact-head hosted gates precede normal merge. Update Project, WORKLOG, journal and immutable ignored resume. Verify main separately.

## Remaining scope

Issue114 stays open for fixed SQLite header/schema/bootstrap and actual canonical funding/source-store validation, separate recipe/context acknowledgements, genesis transactions/readback and SIGKILL/lost-ack recovery. No public storage API, provider call, run permit, intent/token/fence/receipt, lease/budget, app activation or stopped-probe retry belongs here. M2.2/audit51/managed31 and app/release gates remain open.

## Local validation

Fourteen focused cases pass, including actual independent creators with one exclusive namespace winner, exact marker/mode/sync ordering, copied workspace/directory/database and live descriptor replacement, parent aliases, UID/mode/link refusal, rollback limits/header checks, extra-file inspection, preserved partial files and descriptor closure after each failed sync stage. Removing the device/inode comparison makes the intended copy-refusal assertion fail; the exact original source is restored before passing checks.

ActualNode24.22.1 direct import and274Cloud consumer cases/24files pass, retaining the actual ledger independent-writer/SIGKILL cases. All489shared cases/62files, TypeScript, formatting and web build pass. The initial type check caught use of an array method outside the existing configured library target; replacing it with a compatible reverse fixes that check without configuration changes. Existing browser chunk warning remains. Legacy production ledger/immutable mechanics are byte-unchanged. Required final-head hosted checks and focused review still precede merge. No SQL schema/genesis, source-acknowledgement, physical-power-loss or app evidence is inferred.

## Sources checked

The [Node24 filesystem API](https://nodejs.org/docs/latest-v24.x/api/fs.html) defines descriptor operations and no-follow flags. [SQLite PRAGMAs](https://www.sqlite.org/pragma.html) remain later SQL-layer concerns. This slice uses actual file/process tests for its own contract, not documentation as acceptance evidence.

## Integration follow-up, 28 October 2026

The file boundary merged in PR120, with all three exact-source and exact-main checks passing. [Fixed SQLite persistence](cloud-journal-storage.md) then merged in PR122 with separate evidence. [Actual funding/source binding](cloud-journal-sources.md) is the remaining issue123/parent114 boundary. The file-layer-only validation above remains scoped to its own contract.
