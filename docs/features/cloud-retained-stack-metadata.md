# Retained-recipe Cloud stack metadata

## Purpose and boundary

[Issue 84](https://github.com/devsandip/peel/issues/84), under issue 30/[M2.2](https://github.com/devsandip/peel/milestone/2), connects the [historical inventory reader](cloud-historical-inventory.md) to the existing [stack metadata collector](cloud-stack-metadata.md). It supports SPEC FR-04/14/20 and AC-04/12/13 prerequisites. This is one read-only adapter, not all service observers, provider ownership, creation journaling or lifecycle execution. App/v0.7 stay unchanged; audit51/managed31 remain blocked.

## Captured scope and commands

Accept exactly original encoded recipe bytes and independently retained pins. No profile/account/region/selector override or arbitrary expected-graph input is public. Decode and capture the original immutable graph, profile and manifest/inventory bindings before awaits. Keep the existing prospective input/current-factory checks and result shape intact for callers without the new cancellation option.

Factor the common collector and command assembly privately. Derive its four allowed names from the validated captured graph; stack ARN parsing must use that captured set, not today's name factory. A retained pure command helper validates the recipe before emitting fixed CLI metadata arguments. Preserve the original public command helper and exact current/retained command bytes for the frozen v1 recipe, including name order. Do not expose the private scope-based collector/command builder.

Reuse existing verified-TLS endpoints, native pagination/projections, three exact tags, count/resource/ID/status validation, default CLI 15-second process/64KiB output bounds, page bounds and 90-second whole-observation deadline. No extra API, default path, retries, hook/audit/source/price probe, secret/user/client/data payload access or write. Match independently configured current identity/role before and after. The old recipe's lease/source expiry is not current-run authorization and cannot block inspection.

## Cancellation and publication

Add an optional AbortSignal to the collector dependency boundary, preserving callers that omit it. Pre-abort does no identity/provider work; an active abort cancels the same internal signal and returns a fixed aborted result promptly even if an injected reader/identity ignores the signal. Deadline behavior remains 90 seconds; late responses cannot publish or trigger more reads/rechecks. Remove listeners/timers in finally. Default CLI reads retain their existing 15-second process bound; injected test readers remain subject to the global bound.

Return immutable private metadata with original manifest/inventory digest binding and explicit unproven ownership/absence. Matching tags, complete pages and decoded expectations do not establish creation provenance or deletion permission. Fixed-target/S3/Cognito adapters, canonical run budget, creation receipts and owned lifecycle stay separate issue30/31 work. No live account check belongs in this slice.

## Verification plan

Use the frozen synthetic recipe and existing raw projected stack/tag/resource fixtures. Disable every current factory/writer/name helper and verify retained collection and pure commands still work. Verify exact prospective command compatibility, expired original selectors, mutation capture, independent configured identity/role drift, malformed pins/overrides/metadata, partial coverage, changed summaries, repeated tokens, current execution clock errors, external cancellation and stalled/late reader/final-identity results. Keep all existing prospective cases passing. Run direct actual Node24/focused tests, shared type/format/tests/build and all three current-commit hosted gates before one focused merge. No app/managed/cleanup acceptance from fixtures.

## Local evidence

Implemented a private captured-scope collector and fixed command builder. The retained API accepts exactly recipe JSON/pins and binds successful observations to `retainedManifestSha256` plus the original inventory digest. Both ARN validation and default CLI arguments use captured names. Existing prospective command bytes/result shape and factory validation remain covered. An optional external signal races the whole observation, including first/final identity checks, and removes its listener/timer on return.

Thirteen retained cases and twelve existing prospective cases pass under actual Node 24.22.1, with direct import. All current factories/name helper/writer can throw while the frozen expired recipe collects seventeen synthetic resources and produces exactly compatible CLI arguments. Tests cover copied original scope/digests, private failure boundaries, current identity/role drift, metadata changes/partial coverage, malformed pages/clock, pre-abort, ignored-reader/first/final-identity cancellation and late results/deadline. All 359 shared cases in 52 files, TypeScript, repository formatting and browser build pass locally. The pre-existing browser chunk-size warning remains. Exact-head hosted checks and focused review still precede merge; fixture evidence establishes no managed provider acceptance or ownership.
