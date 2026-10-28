# Complete original stack request and transient material

[Issue 125](https://github.com/devsandip/peel/issues/125) is one pure request-binding slice under issue 30/[M2.2](https://github.com/devsandip/peel/milestone/2), after completed genesis parent 114. It supports [SPEC](../SPEC.md) FR-04/14/20 and AC-04/12/13 prerequisites. Read the [creation-journal protocol](cloud-creation-journal.md), [original intent](cloud-stack-create-intent.md), [acknowledged genesis](cloud-journal-sources.md), [hosting](cloud-dev-hosting.md) and [cleanup](cloud-dev-cleanup.md). This plan precedes code. Functional v0.7 and original persisted identities stay unchanged.

## One purpose

Bind a complete canonical unsigned CreateStack representation to the original context/recipe/intent and a bounded safe projection. Keep the exact nonsecret request and data-stack NoEcho value only in active process memory. This slice generates no token/key, opens no store, calls no provider and grants no execution. Durable uniqueness/preparation, fresh-process coordination, dispatch fencing, actual SDK wire serialization/signing and provider lifecycle remain separate PRs.

Use original codecs and the frozen historical inventory, not current template/name factories, policy or clock. Verify the independent intent pin, original stack/token/template digest, exact retained selected inline template, original resource graph/names/tags and supported parameter schema. No extra resource, nested stack, transform/macro, retained-resource policy or arbitrary caller service field. Original source approval/provider ownership remains unproven; checksums cannot authenticate an unknown recipe.

## Fixed policy version 1

The canonical frame binds original digests, profile/account/region, intended CloudFormation operation/API version and POST regional destination. It is an unsigned service-input contract, not verified HTTP/SDK encoding. Represent every supported optional field's absence explicitly; the future wire adapter must prove actual normalization before any transport.

| Group                       | Fixed binding                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack/template/token/tags   | Original stack name and scoped token; exact original inline TemplateBody up to 51,200 UTF-8 bytes; original three ownership tags. Safe projection references retained template digest/byte length rather than duplicating its body.                        |
| Capabilities and parameters | CAPABILITY_NAMED_IAM only for guard/data; absent for artifacts/sentinel. Data has exactly CursorKey; other stacks have no parameters. UsePreviousValue/ResolvedValue absent. No caller override or template URL.                                           |
| Failure/deployment          | OnFailure ROLLBACK, EnableTerminationProtection false, RetainExceptOnCreate false, DeploymentConfig Mode STANDARD with its DisableRollback absent. Top-level DisableRollback absent.                                                                       |
| Identity and unused fields  | Creation RoleARN absent, bound to the expected original operator selection for later current-session verification. Never substitute the deletion role. NotificationARNs, ResourceTypes, RollbackConfiguration, StackPolicyBody/URL and TemplateURL absent. |
| Time                        | TimeoutInMinutes 5 for each stack kind. Original local latest-completion boundary is start + 10 minutes for guard/sentinel and original stopTestsAt for artifacts/data. Original lease/cleanup times remain bound; no current clock or restamping.         |

The five-minute provider create timeout is a conservative chosen policy. It does not force rollback/teardown to finish by an absolute time or cap a bill. The later coordinator must check enough current runway, guard readiness/phase order, original deadlines, credential lifetime and cleanup gates. These local deadlines are not invented CreateStack fields. Existing start + 10 minute cleanup readiness still applies.

## Secret and serialization boundary

Data alone requires a supplied canonical 44 character base64 encoding of 32 bytes matching the original CursorKey NoEcho constraints. Non-data input requires explicit absence. Reject CursorKey references/substitutions outside the original CursorSecret SecretString slot and a supplied value embedded literally in the template. Syntax does not prove entropy; reviewed generation belongs to the later winning coordinator. No randomness or value regeneration here. Keep the complete unsigned frame/input in a private WeakMap keyed by a frozen active handle. The handle's enumerable fields, JSON, safe projection and errors contain no key, value checkpoint or standalone key hash. A trusted future wire adapter can explicitly retrieve a detached input from that active handle; copied/parsed metadata cannot retrieve it. An explicit discard drops the internal reference without claiming secure physical memory erasure or deleting caller copies.

Persistable metadata is canonical bounded 16 KiB projection plus integrity pin and an opaque SHA of the complete canonical unsigned frame, including the ephemeral value and explicit absence. The frame itself is at most 128 KiB in memory; that is not an HTTP wire-byte claim. Projection readback validates original nonsecret bindings and independently expected integrity only. It does not restore an active handle, material, create permission or a lost key. A different key changes the commitment; later immutable preparation must refuse conflicting captured input. Restart cannot regenerate a key to replay an old pending request.

## Verification and integration

Use frozen synthetic originals, independently serialized golden commitments and all four stack kinds. Test exact field/absence/template/tag/capability/role/deadline/parameter policy, coherent rehashed mutations, graph/transform/retention refusal, detached frozen results, supplied key binding, safe enumeration/serialization, active-material loss/discard and private failures. Current factories/policy/clock, RNG, filesystem/SQLite and network must be unavailable without affecting pure construction/readback. No actual/default note/operator data or real secret.

Actual Node 24 direct/focused/Cloud consumers, then shared tests sequentially, type/format/build and all three required exact-head hosted checks. Focused review, staged/range scans and actual no-reply author AND committer precede normal merge. Keep issue/Project, WORKLOG, journal and immutable ignored resumes current. M2.2/audit 51 / managed 31 / native 72 and all provider/app/release gates remain open or stopped; no AWS allowance, billing, app activation or stopped retry.

## Current primary references

Rechecked 28 October 2026: [CreateStack](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_CreateStack.html), [DeploymentConfig](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DeploymentConfig.html), [NoEcho](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html). The fixed constraints above are our reviewed policy over that API. They are not managed-service or actual SDK evidence.

## Validation checkpoint before worker-budget dependency

Thirteen focused cases and actual Node 24 direct construction pass. Independent Python serialization of the frozen original pins all four unsigned/projection digests; template bytes are 1575/6553/1166/7196 and safe projections 1920/1928/1917/2074 bytes for artifacts/guard/sentinel/data. Omitting the transient value from the commitment fails the intended changed-key assertion; exact source is restored. Type checks pass.

The first 311 case actual Node 24 consumer run has 310 passes and one unchanged context-storage 5000 ms timeout (5604 ms observed). The same test passes alone in 1.15 seconds total. An explicit four-worker consumer run passes 311 cases / 27 files, followed by a four-worker shared run of 526 cases / 65 files. The precise first timeout's external CPU/I/O contributor is unproven; its failed log is retained, not relabeled. No test timeout, legacy source test or production storage module changed. A separate current-milestone worker-budget fix will standardize file scheduling before this request branch resumes final validation/review/hosted gates. This source is saved locally, not yet merged or fully validated under the repository default.

## Validation after dependency integration

PR 127 merged the separate four-worker scheduling fix as ec1cbcaaeeaed1e976aefd0090e44c1228bf5365 after all three exact-source checks passed. This branch was rebased onto it. The configured defaults now pass actual Node 24 direct import and all 311 Cloud cases / 27 files, followed sequentially by 526 shared cases / 65 files, TypeScript, formatting and browser build. No CLI worker override, timeout increase, retry, skip or legacy test change. The existing browser chunk warning remains. Logs retain the earlier failed run separately from these new results.

The request module is unchanged from the tested saved implementation. All four independently serialized golden commitments and the deliberately omitted-secret negative control remain applicable. The actual separate-process reader receives only safe original/projection metadata, successfully reads it and cannot retrieve active material. The current official CreateStack and DeploymentConfig field lists were rechecked during focused review; actual SDK serialization remains future work.

The complete diff is one request contract with tests and evidence. It changes no funding/source/genesis store or app behavior. Focused review and all three required checks on the final PR head still precede merge. No provider, fresh-session, durable preparation, dispatch or M2.2 acceptance is implied.
