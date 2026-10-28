# Durable creation journal and recovery protocol

## Status and scope

[Issue104](https://github.com/devsandip/peel/issues/104) defines the local recovery contract for issue30/[M2.2](https://github.com/devsandip/peel/milestone/2). It supports SPEC FR-04/14/20 and AC-04/12/13 prerequisites. This document is a design, not implemented journal behavior or executed acceptance evidence. Public v0.7 stays unchanged. No apply command, account call, new authorization, billing or stopped-probe retry follows from this document.

Use the [original identity codec](cloud-stack-create-intent.md), [bound context](cloud-run-context-storage.md), [run ledger](cloud-run-ledger.md), [owned namespace](cloud-ledger-namespace.md) and [original recipe](cloud-manifest-storage.md). The [hosting](cloud-dev-hosting.md), [independent cleanup](cloud-dev-cleanup.md) and [private key/hosting](cloud-private-hosting.md) plans still own their operational gates. Historical dates and allowances in those plans are not a renewed lease or budget.

## Decision: one owned transactional journal

Choose a separate bounded SQLite journal per run. Its recognized private namespace and independently anchored genesis become the authoritative local record of captured source pins, random client tokens and receipts. Do not change the funding ledger's schema or store journal rows in a note database.

| Approach                     | Strength                                                                          | Missing work                                                                                                                                              | Decision                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Immutable record directories | Existing engine gives exclusive publication and exact readback                    | Atomic per-stack uniqueness, coherent attempt/receipt history, canonical record discovery and recovery-pin bootstrap would need another registry/protocol | Keep the existing recipe/context stores; do not build an implicit journal by scanning arbitrary siblings |
| Owned SQLite journal         | Transactions can bind uniqueness, original bytes and revision checks in one store | A separate fixed schema, genesis trust, token/dispatch/receipt policies and process-crash evidence are still required                                     | Use after a behavior-preserving extraction of reusable namespace mechanics                               |

[SQLite transactions](https://www.sqlite.org/lang_transaction.html) support multiple readers and one simultaneous writer; BEGIN IMMEDIATE can fail busy before obtaining the write transaction. This motivates our locking policy, not a distributed transaction or an AWS spending guarantee. [Atomic commit](https://www.sqlite.org/atomiccommit.html) depends on filesystem/storage assumptions. The existing [Node24 DatabaseSync](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) API is synchronous; no new database package is selected here.

## Independent anchor and genesis

The operator retains one independently selected canonical workspace root, canonical funding-ledger directory and original authority. The run selector is explicit. Derive the sole journal location from that root and original run UUID; no arbitrary journal-directory override, fallback search, reset or replacement on open failure. Absence of the configured anchor blocks execution.

Before journal access, open the actual canonical funding ledger with that independent authority and read the actual stable reservation: slot, run UUID, normalized-plan SHA and reservation time. Bind those facts, the authority digest and canonical workspace/ledger selection into a versioned journal scope. Do not use the changing whole-ledger snapshot as the immutable identity. Source/account/region and original cleanup-authority margin must match the original plan. This observation grants no new slot.

Fresh bootstrap requires successful acknowledged opens of both the actual original recipe and bound context stores, with independently supplied pins. Manifest open re-syncs the recipe; context open re-syncs context descriptors only and cannot substitute for that separate recipe acknowledgement. A source-sync failure cannot mint a run permit. Persist one immutable genesis transaction containing:

- The canonical anchor and stable reservation tuple.
- Exact original normalized context and recipe bytes, their independently captured pins and original source-store selections.
- Format/catalog version and the journal's initial revision.

Verify the normalized plan inside the retained context against the plan SHA in the actual funding reservation. Validate every original identity/graph/template binding with the original codecs/catalog. Captured source digests do not become trusted merely because a file supplied them: provenance here is the independently selected funding anchor plus the recognized, protected journal and validated genesis. This is local operator trust, not cryptographic attestation against its owner.

On restart, these committed genesis rows retain the original source pins and later random tokens. The caller does not need a random token or intent SHA that existed only in crashed memory. Read a stored descriptor and its checksum from this authoritative journal, then verify its schema and original-context bindings through the pure identity codec. Its checksum establishes integrity within that trust chain; it cannot authenticate an unknown journal by itself.

A recognized journal can supply its committed historical snapshot for explicit recovery inspection even if separate source files are unavailable. This is not a claim that those files still exist or have been re-synced. Missing/damaged sources never authorize new creation. Unknown journal/schema/anchor state is preserved and refused; do not regenerate historical inputs with current factories. Reading expired records does not approve a new run.

A same-UID actor can alter the operator's trust store; this is not a sandbox against that actor. Database/directory inode binding rejects ordinary copies/replacements. Rewriting markers, moving the workspace, selecting a second journal or restoring an old snapshot cannot create another run grant. Global rollback protection or an account-level hard spending cap is not claimed. Recovery never produces a create permit, which also avoids interpreting a restored old journal view as unused execution capacity.

## Namespace and local durability policy

Use a new fixed journal application ID/version, journal.sqlite and owner.json under mode0700, with mode0600 owned single-link regular files. Retain fixed wrapper configuration only. The marker binds the independently derived scope and namespace/database identities. Check known paths, ownership, links, header, exact schema/metadata and bounded state before SQL access; revalidate around operations. No default library path, user-selected schema/codec or repair/chmod/delete behavior.

Initial limits are2MiB database and4MiB recognized rollback journal. Genesis retains at most512KiB recipe and32KiB context; source-selection metadata is bounded separately. Allow four immutable stack-intent rows and four dispatch-fence rows. Allow at most96 small observation rows of at most2KiB each:64 ordinary and32 reserved for cleanup. Request projections are at most16KiB per stack. Verify actual page/storage bounds in the implementation; these are limits, not a prediction of physical byte usage. Refuse growth rather than increasing them silently.

Use DELETE journaling, FULL synchronization, fullfsync and foreign keys with readback, busy_timeout0 and trusted_schema off. [SQLite's pragma documentation](https://www.sqlite.org/pragma.html#pragma_fullfsync) makes fullfsync platform-dependent. Preserve the existing process-interruption versus physical-power-loss distinction. No network-filesystem, ACL or drive-cache certification is implied.

Bootstrap is exclusive and acknowledges only after recognized schema/genesis commit, required file/directory synchronization and complete readback. Existing journals open only; they never mint a fresh-process permit. An incomplete bootstrap remains preserved/unrecognized, with its funding slot still consumed. A lost local acknowledgement requires inspection, not bootstrap at another path.

Normal writes require exact known namespace membership and strict source/anchor checks. Explicit recovery inspection may ignore foreign extra files without reading/deleting them, only after the known journal files, ownership, scope, schema and genesis validate. It makes no new namespace-sync claim and grants no create authority. SQLite's existing recovery may have physical effects; logical inspection is not a promise of zero filesystem writes.

Extract shared mechanics without silently changing the existing ledger contract. In particular, existing ledger create may return an already recognized store; reservation inspection can ignore foreign extras while strict paths reject them. Keep its names, marker, schema, application ID, public errors and settings compatible. Parent/descriptor checks required by the new journal wrapper must not be described as guarantees already supplied by every old ledger path. Separate any necessary hardening from the compatibility extraction.

## Immutable intent, request and secret binding

A future prepare transaction uses BEGIN IMMEDIATE, actual journal revision and the unique original stack kind. Check for an existing row before generating the v4 nonce once in the winning transaction. Capture that token/descriptor, exact nonsecret request projection and unsigned request digest together. The pure codec still generates no token. A same-purpose retry returns the committed original token only when the immutable bindings match; a conflicting request refuses. There is no second token, overwrite or deletion of that row. Busy/stale/uncertain commit returns no execution permission.

The existing identity descriptor is not that complete request. The future wire builder must bind every supported field, including explicit absence, to the original context and fixed reviewed policy:

| Field group             | v1 policy                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Target, token, template | Exact original stack name, original scoped token and selected original inline template bytes; enforce the provider body limit, no URL/alternate-template fallback                              |
| Identity and transport  | Pinned configured account/profile/region and validated current session; no arbitrary endpoint or inherited mutable environment selection                                                       |
| Tags and capabilities   | Exact original three ownership tags; named-IAM capability only for the guard/data templates; no macro expansion or extra resources                                                             |
| Creation role           | Explicitly bind omitted creation RoleARN to the approved operator context; never substitute the deletion role for creation or accept an arbitrary service role                                 |
| Failure and lifetime    | OnFailure ROLLBACK, termination protection false, original absolute lease, bounded per-kind create deadline; no competing DisableRollback field, retention/forced shortcuts or lease extension |
| Deployment behavior     | Pin standard behavior; reject an express override and unreviewed fields/default changes                                                                                                        |
| Parameters              | Exact supported keys and material binding; never UsePreviousValue, masked-value replay or arbitrary parameters                                                                                 |

These are chosen Peel policies. [CreateStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html) specifies the request fields and inline body limit. [DeploymentConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeploymentConfig.html) documents standard behavior as the default. The [service-role guide](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-iam-servicerole.html) explains why a passed role affects later stack operations; creation-role policy and dedicated deletion-role policy must remain separate. The lease is bound through original templates/local gates, not an invented CreateStack field. The wire-builder PR must recheck and test the precise encoding before any transport is added.

The private-hosting template requires a transient32-byte CursorKey through NoEcho. Do not serialize a full data-stack request containing that value into the journal, argv, exports, logs or reports. [NoEcho](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html) masks some returned parameter views, with exceptions for metadata/outputs; it is not our local persistence boundary.

Keep the exact unsigned request, including that one-time value, only in active-process memory. Persist a canonical nonsecret projection with an explicit ephemeral-parameter slot and an opaque digest committing to the complete unsigned request. Immediately before the one permitted send, compare the actual body with that commitment. The projection is not a replayable full request. Retain no secret value, standalone value checkpoint, credentials, signing headers or auth/session tokens. A request-body digest is an integrity commitment, not current approval or a recoverable credential. After process loss, never generate a replacement key to replay that request or read provider secret values to reconstruct it. Use inspection and proven-owned cleanup.

## Dispatch fencing and recovery states

Bootstrap storage returns no execution capability. A separate trusted coordinator can mint a fresh-process run permit only after its own fresh funding-reservation commit acknowledgement, successful exclusive bootstrap, acknowledged source opens and the actual current safety gates. Reading an existing reservation, even when the journal is missing, cannot stand in for that same-coordinator acknowledgement. A lost reservation acknowledgement enters recovery rather than a new bootstrap/dispatch flow. It is an internal nonserializable process-local capability, not a caller-owned flag. Reading a journal, a Boolean field, copying an object or possessing a token cannot recreate it.

Immediately before a stack call, commit a unique dispatch fence bound to kind/token/request digest and current journal revision. Recheck current policy/time and required actual dependencies. Only the process that receives a successful durable fence acknowledgement may obtain one in-memory, one-use send capability. No database transaction spans network I/O. A commit error or lost acknowledgement gives no capability and invalidates the active coordinator for further creation. The transport must disable automatic create retries and allow at most one application dispatch per stack in v1; provider-internal behavior is not an exactly-once guarantee.

| Durable state        | Meaning                                                                        | Allowed next action                                                                          |
| -------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Genesis only         | Original inputs are retained; no provider success is implied                   | Same fresh process may prepare after gates; a reopened process inspects/cleans only          |
| Prepared             | Token and request commitment exist                                             | Same fresh process may fence; any recovered pending intent is possibly submitted             |
| Dispatch fenced      | Local one-use dispatch was durably claimed; it may or may not have reached AWS | Never mint another send capability from the row                                              |
| Response observed    | A whitelisted response ID/result was durably recorded                          | Independently correlate operation/stack/resource ownership and settlement                    |
| Operation correlated | Later bounded provider evidence matches the original operation                 | Same live process may advance only after full phase gates; recovery stays inspection/cleanup |
| Teardown observed    | Owned-resource verifier has complete bounded teardown evidence                 | Durably record that evidence, then idempotently publish the matching funding-ledger receipt  |
| Unknown/conflicting  | Missing/corrupt/inconsistent evidence or unresolved result                     | Preserve, stop creation, inspect and clean only resources independently proven owned         |

Already-reserved live execution needs a separate policy check over the actual matching reservation and current facts. Never replay new-run validation with a fabricated empty ledger, reserve the same run again or reinterpret the original reservation as unused budget.

This conservative v1 policy permits no create resubmission after process restart, even from a journal that appears prepared or empty. It does not infer unsent from an absent fence in a restored view. It can consume a slot without creating resources. A future retry feature would require separate provider/recovery evidence and review; the API's token support alone does not enable it.

After a timeout, lost response, AlreadyExists or TokenAlreadyExists, retain the original identity and mark uncertainty. Same-process reconciliation is metadata-only and bounded. A returned ID, matching tag, expected name, empty description or single not-found response is insufficient. Future provenance adapters must correlate the original operation/token and exact account/region/stack, reviewed template/role/dependency expectations and actual resource identities before cleanup or phase advancement. No CLI manual verified/owned override.

Responses and observations are append-only, size/type limited and checked against original bindings. Persist only approved identifiers, statuses, counts and digests. Split complete teardown evidence into bounded per-resource projections plus an immutable root linking the complete expected inventory; an opaque hash without those validated facts is not the proof. Do not persist every poll tick or let ordinary observations consume the cleanup reserve. Never store raw provider responses, event properties, environment, parameter values, unrestricted status reasons or secrets. A successful request is not stack settlement, provider ownership, complete absence or physical erasure.

## Phase ordering and cleanup bootstrap

1. Finish fresh source/artifact/account/role/session/cost/capacity/audit/full-target-safety checks, bounded funding reservation, original stores and journal bootstrap before the first resource request. Existing collector unknown/unproven results do not become green because this journal exists.
2. Create and independently validate guard resources first. Create the empty sentinel, read back the exact original schedules/roles/targets, and meet the existing start-plus10minute readiness deadline. Do not delay this behind artifact upload.
3. Create the private artifact stack, upload/verify only the original owned code object, and wait for the actual scheduled sentinel deletion. Those operations need their own bounded mutation/receipt contracts; four stack identities do not journal every side effect.
4. Verify sentinel settlement/absence and the still-armed data schedule before the data-stack fence. Only a complete owned data/identity/function result can precede the bounded managed smoke. Recheck readiness, identity, authorization, current clock and original lease at each boundary.
5. Stop smoke at the original stopTestsAt; enter owned cleanup on any failure or uncertainty. Never restamp start/expiry, reschedule for more runway, raise allowances/quotas or reuse an expired lease. Re-entry cannot continue creation.

Guard/artifact resources cannot independently delete themselves under the existing design. Losing the runner before the guard is ready or after artifact creation can leave bootstrap residue. That is a real cleanup gap, not evidence of no cost or permission to run unattended. Current credential lifetime/cleanup runway and the independent sentinel rehearsal are mandatory; abort before provisioning when they cannot be established. Preserve the existing stop limits for failed components.

Recovery uses the committed historical snapshot and actual stable reservation, not current template factories or new-run validation. Actual cleanup still needs valid current operator identity/permission, protected original-account selection and independently proven ownership. No fallback tag scan, forced deletion, retained-resource shortcut or broad permission change. Missing permission/provenance stays unresolved and is reported.

Reserve local journal observation capacity for cleanup. If disk/commit failure still prevents recording, it never permits new creation or a second run. It must not prevent otherwise authorized, independently proven-owned teardown using existing trusted evidence. Do not publish a durable cleanup claim or funding receipt until the complete matching evidence is safely retained. Reconcile lost acknowledgements of the journal proof and ledger receipt separately; they are not one transaction. Preserve consumed slots and require all fresh gates before any later reservation.

## Acceptance vectors, not yet executed

Every row below is pending journal implementation. Existing ledger/context tests prove their own contracts only.

| Vector                                                           | Required outcome                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Crash before valid genesis / after commit before ack             | Preserve incomplete state or recover exact recognized genesis; neither path recreates a fresh-process permit                     |
| Token committed but acknowledgement lost                         | Recover the exact stored token from the anchored journal without a caller's lost random-token digest                             |
| Two preparers / conflicting request                              | One original token/request wins; no second mutable identity or lost first request                                                |
| Dispatch-fence commit failure / ack loss                         | No send capability; recovered state cannot mint one                                                                              |
| Kill before send / after send before receipt                     | Treat possible submission conservatively, retain token and reconcile; no blind retry                                             |
| Old journal snapshot / cloned namespace / switched root          | No new run grant, refunded slot or recovered create capability                                                                   |
| Missing fresh reservation acknowledgement / source-open sync failure | No fresh-process permit, replacement bootstrap or provider send; an existing row is recovery data only |
| Changed funding authority/run/plan or genesis/source pins        | Refuse before mutation/dispatch; no fallback to another store                                                                    |
| Partial/schema/ownership/link/inode/foreign-file damage          | Preserve unknown data, refuse writes; any explicit recovery reader touches only recognized files and grants no create capability |
| Busy/stale revision / file or row limit                          | No unacknowledged mutation/permit; cleanup reserve and observation limits remain enforced                                        |
| Ephemeral secret lost / masked parameter / raw response          | No value checkpoint/replacement replay; private refusal and inspection/proven-owned cleanup only                                 |
| Expired original / current factories unavailable                 | Historical inspection remains possible; no current create approval is inferred                                                   |
| Timeout/conflict ID/tag/not-found only                           | Uncertainty remains until complete operation/ownership/settlement evidence                                                       |
| Guard not ready / sentinel manual deletion / wrong data schedule | No data creation or smoke; original lease is not extended                                                                        |
| Teardown proof committed but ledger receipt ack lost             | Reconcile exact immutable proof/receipt, no slot deletion/refund or automatic new run                                            |
| Default note DB path / arbitrary codec/owned flag                | Reject; no note, credential or unrecognized operator data is opened or adopted                                                   |

## Small PR sequence

Each row needs its own issue, focused evidence and all required gates before merge. Create only the next ready issue; keep later implementation boundaries here until needed.

| Slice                                       | One purpose                                                                                           | Evidence boundary                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Owned SQLite mechanics extraction           | Share fixed internal mechanics while preserving every existing ledger byte/API/error/setting contract | Existing real namespace/concurrency/SIGKILL tests and compatibility controls; no journal feature                                    |
| Journal namespace and genesis               | New fixed schema/anchor/bootstrap/recovery snapshot                                                   | Fresh synthetic-only files, source bindings, unknown preservation and actual genesis crash/ack recovery; no intent or create permit |
| Complete request builder and secret binding | Canonical original unsigned request, safe projection and digest                                       | Actual original templates, strict field/default/dependency/role/NoEcho tests; no provider send                                      |
| Immutable preparation                       | Atomic per-stack token/request capture and idempotent same-purpose return                             | Competing processes, lost-ack recovery and immutable conflicts; no dispatch                                                         |
| One-use dispatch fence                      | Revision/current-gate check and local nonserializable capability                                      | Commit/ack/crash/clone/restart/one-use controls with synthetic transport only                                                       |
| Response/provenance contracts               | Append bounded response IDs and independent provider correlation                                      | Private projection/wire/ownership/uncertainty cases, not successful managed creation                                                |
| Bounded transport and owned lifecycle       | Execute only an acknowledged fence with all real gates; implement inspection/cleanup                  | SDK attempt/endpoint/identity bounds, interruption/ownership/cleanup gates; no live run merely because code merges                  |
| Managed evidence                            | One separately authorized bounded synthetic run with actual rehearsal and verified teardown           | Issue31 exit evidence only after every prerequisite, current authorization and source checks                                        |

Do not merge these slices into one large journal/orchestrator PR. Any new gap becomes its own current-milestone issue. This design closes issue104 only after review/gates; audit51, managed31, M2.2 and all app/release acceptance stay open.
