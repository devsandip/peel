# Original normalized Cloud plan context

## Purpose and boundary

[Issue94](https://github.com/devsandip/peel/issues/94), under issue30/[M2.2](https://github.com/devsandip/peel/milestone/2), retains the exact normalized plan bytes needed by future creation journaling. It supports SPEC FR-04/14/20 and AC-04/12/13 prerequisites, following the [original recipe](cloud-run-manifest.md), [historical inventory](cloud-historical-inventory.md) and [run ledger](cloud-run-ledger.md). The ledger stores the normalized RETURN digest, not the seven-field input plan; the recipe stores that digest but not normalized plan bytes. Keep both formats and the current validator unchanged.

This is one pure versioned codec, with no filesystem, budget reservation, creation intent/provider receipt, AWS operation, app behavior change or stopped-probe retry. Canonical v0.7 stays unchanged; audit51/managed31 and M2.2 remain open.

## Contract

Create from exact original normalized plan JSON plus exact original recipe JSON/independent pins. Read a separate canonical format1/kind/manifest-digest/plan-JSON envelope against that same original recipe. Bound plan JSON to16KiB and context to32KiB. Bind the SHA256 of the exact plan bytes to the recipe's pinned plan digest. Verify canonical encoding and exactly the fourteen original normalized return fields, with strict nested source/identity/lease/stack schemas. Reject extras/getters/unknown versions and private failures.

Cross-check run/profile/account/region, exact lease, original commit/tree/lock, ZIP hash/bytes, template digest and all four named stacks against the original historical graph. Reconstruct original stack-map order without today's name helper. V1 normalized plans have a90minute whole-second lease, creation at/before start within15minutes, stopTestsAt30minutes before expiry, cleanupBy30minutes after expiry, run allowance2USD/cleanup reserve1USD and envelope3or5USD. Validate finite positive microdollar estimates at most2USD and a quote digest, but do not authenticate quote provenance, recompute prices or recreate an approval. These are original-format checks, not a fresh run policy.

Return detached deeply immutable original plan bytes, typed context and context/manifest/plan/inventory digests, with ownership and run authority unproven and zero resource writes. The context is not an approval, canonical ledger reservation, synchronization acknowledgement or permission to create/delete. Canonical file/ledger binding, durable intent/client-token storage and provider provenance remain separate follow-ups.

Read must work after original expiry with all current factories/name helper/new-run validator/cost function and Date.now unavailable. Use original fixed schema/graph and explicit timestamps only. No current Git/main/CI/authorization/price/clock lookup or manual approved/owned flag.

## Verification plan

Generate a new matched frozen synthetic normalized-plan/manifest fixture through the actual existing validator/factories before implementing the reader. Preserve the old opaque-plan-digest fixture. Test actual normalized output/digest, exact deterministic/canonical round trips, frozen detached output, factory/validator/cost/clock unavailability, expired original context, wrong pins/bytes/schema/version/bounds/getters, rehashed inconsistent identity/lease/source/artifact/template/stack/derived fields and field bounds. Distinguish structural integrity from budget/provider approval. Run actual Node24 direct import/focused and legacy contract tests, shared type/format/tests/build, no-reply/scans and all three exact-head hosted gates/focused review before one merge. Fixtures establish no persistence or managed/app acceptance.
