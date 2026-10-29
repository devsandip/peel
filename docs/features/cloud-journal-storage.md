# Fixed original-genesis SQLite persistence

[Issue121](https://github.com/devsandip/peel/issues/121) is one storage primitive under [issue114](https://github.com/devsandip/peel/issues/114) and [M2.2](https://github.com/devsandip/peel/milestone/2). It supports [SPEC](../SPEC.md) FR-04/14/20 and AC-04/12/13 prerequisites. Read the [journal protocol](cloud-creation-journal.md), [pure original-genesis contract](cloud-journal-genesis.md) and [strict file boundary](cloud-journal-files.md). This plan precedes code. Functional v0.7 stays unchanged.

## One purpose and trust boundary

Persist exactly one original genesis through fixed SQLite transactions, exclusive bootstrap, owned-descriptor synchronization and complete readback. Reuse the strict file boundary; add only a fixed100byte database-header reader using its held descriptor and before/after identity checks. Never expose arbitrary SQL, callbacks, codecs, schema or database paths. Existing ledger/immutable engines remain unchanged.

This internal storage primitive validates supplied original facts through the pure codec. It does not independently authenticate the actual funding tuple or acknowledge recipe/context source stores. The next actual source wrapper must do those things before any execution facade. All ownership/run authority remains unproven, with zero provider resource writes. A recognized local record and self-checksum are not a funding grant. No intent, token, fence, receipt, live provider, current policy/clock/factory or fresh-process capability belongs here.

## Fixed format and lifecycle

Use application ID0x53594a31, SQL user version1 and one STRICT journal_genesis table. Its sole id1 row retains scope SHA, genesis SHA and exact bounded canonical genesis JSON. The codec owns semantic validation; header/catalog/row checks own local representation. No open path initializes a missing/partial store. Bootstrap calls exclusive file creation and refuses every existing directory, even if valid. Commit the schema/header and original row in one transaction, then close SQL, synchronize held file/directory descriptors and completely read back. Any failed/lost acknowledgement grants nothing; preserve all partial or committed state.

Use fixed4096byte pages and512page maximum (2MiB), DELETE journaling, FULL synchronization, fullfsync, foreign keys, trusted_schema off and busy_timeout0, with readback. Header checks precede SQL on existing stores; exact schema, row count, digests, codec/anchor, quick check and foreign-key check follow. Revalidate file identities around connections and before return. Connections and file descriptors close after every success/failure. Normal open/read requires strict namespace membership. Explicit recovery inspection may ignore foreign extras without reading/deleting them and makes no fresh synchronization claim. SQLite recovery can have physical effects; no same-UID or physical-power-loss certification is added.

Genesis stays immutable. There is no public mutation/connection method. Later journal tables require their own reviewed schema/version transition; do not add empty future tables now. Missing, unsupported, copied, malformed, oversized or conflicting data is refused and preserved. Recovery needs the independent anchor, not a caller's lost random digest, and never regenerates historical bytes with current factories.

## Verification

- Fresh synthetic temporary namespaces only. Pin exact original bytes/digests through the existing fixture. Test open/read/inspection, expired originals and unavailable current factories, strict header/catalog/row/anchor refusal and preservation.
- Actual independent creators and SIGKILL before/after commit, lost acknowledgement and failed file sync. Before-commit incomplete state stays unrecognized; after-commit state may recover exact genesis but cannot bootstrap again or mint execution permission. These are process-interruption tests.
- Verify actual page/physical file bounds. Exercise maximum-sized schema payload capacity separately from valid semantic genesis and label it accordingly. Keep2MiB/4MiB limits unchanged. A deliberately omitted header or binding check must fail its intended negative control.
- ActualNode24.22.1 direct import, focused/legacy Cloud consumers including real ledger process/SIGKILL cases, shared/type/format/build. Required final-head hosted web-and-core/cloud-artifact/native checks, focused review, staged/range scans and no-reply author AND committer precede normal merge.

Update issue/Project, WORKLOG, journal and immutable ignored resumes. Parent114 remains open for actual canonical funding observation, independent original source selection and distinct acknowledged recipe/context opens, along with any remaining original vectors. M2.2/audit51/managed31/native72 and app/release gates stay open or stopped. No actual/default note/operator DB, AWS/account/budget/billing, app activation or stopped retry.

## Primary references checked

[Node24.22.1 SQLite API](https://github.com/nodejs/node/blob/v24.22.1/doc/api/sqlite.md) and [SQLite PRAGMAs](https://www.sqlite.org/pragma.html). Actual runtime/settings/capacity tests remain required; API documentation is not durability evidence.

## Local validation

Ten focused storage cases pass under actualNode24.22.1, including literal bytes/header/settings, refused pre-SQL unknown headers, malformed catalog/rows/anchor, separate historical inspection, unavailable current helpers, partial/lost-ack/fsync failures and actual independent creators/SIGKILL before/after commit. All connections/descriptors close in the observed success and failure paths. Removing the application-ID header check fails the intended refusal assertion; exact source is restored before positive checks. Fixed-schema capacity accepts1536KiB of deliberately nonsemantic payload, bounds the actual rollback file below4MiB and refuses excess database growth with actual SQLITE_FULL under512pages/2MiB. This does not authenticate source facts or accept that payload as genesis.

ActualNode24 direct imports and284Cloud consumer cases/25files pass. A concurrently launched499case shared run had498passes and one unchanged peer-inventory5000ms timeout. The unchanged test passes alone in299ms; a separate full run without the competing consumer suite passes all499cases/63files. Its initial timeout is retained as failure evidence; the precise cause is unproven. No peer production/test or timeout setting changed. Type/format/build pass, with the existing browser chunk warning. Initial settings readback used the wrong busy_timeout result-column name (actual SQLite returns timeout), and fixture literal types needed normalization; both were corrected before final passing checks.

All required final-head hosted checks and focused review still precede merge. Actual source acknowledgement, independent actual funding observation, provider execution and app acceptance remain outside this primitive and keep issue114 open.

## Integration follow-up, 28 October 2026

The fixed persistence primitive merged in PR122 as a6061ab, after all three source checks40701061350 and all three exact-main checks40702504975 passed. [Actual funding/source binding](cloud-journal-sources.md) is issue123. The initial concurrent local timeout remains failed historical evidence; later passing source/main checks do not erase it. This storage layer still returns no execution capability.

## Internal engine extraction, 29 October 2026

[Issue143](https://github.com/devsandip/peel/issues/143) moves the existing fixed v1 implementation byte-for-byte to [journal-sqlite.ts](../../infra/cloud/journal-sqlite.ts), with exact original re-exports through [journal-storage.ts](../../infra/cloud/journal-storage.ts). The [extraction plan/evidence](cloud-journal-engine.md) records an actual pre-move synthetic database reopened without byte changes, original constructor/error identity and passing unchanged namespace/ACK/process suites. The storage API, catalog/settings, transaction/sync/close ordering and source/session behavior stay intact. This is no v2 store, format generalization or current permission. Existing inspection still has its reviewed SQLite recovery/settings behavior and is not certified physically write-free.
