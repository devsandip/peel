# Retained-recipe fixed Cloud targets

## Purpose and boundaries

[Issue 86](https://github.com/devsandip/peel/issues/86) connects the [original inventory decoder](cloud-historical-inventory.md) to the existing [eight fixed non-bucket target observer](cloud-fixed-target-metadata.md). This is one issue30/[M2.2](https://github.com/devsandip/peel/milestone/2) prerequisite for SPEC FR-04/14/20 and AC-04/12/13, following the [retained stack adapter](cloud-retained-stack-metadata.md). Canonical v0.7/app behavior is unchanged. No live account probe, resource write, new lease/budget reservation, note database access or stopped-component retry.

## Captured original scope

Accept exactly original recipe JSON plus independently retained pins. Decode with the historical reader, capturing the original profile, expected graph and manifest/inventory digests synchronously before awaits. No public arbitrary graph, profile/account/region/target/endpoint override or owned/verified flag. Factor capture/collection privately; reuse the existing fixed command builder and exact eight targets. A retained pure command helper derives only validated original selectors.

Preserve prospective current-factory validation, exact fixed CLI arguments, success/error classifier and result shape. Retained successful snapshots additionally bind the original manifest digest. Expired original source/lease does not block read-only inspection; current execution deadlines and independently configured identity still apply. A returned name or matching digest establishes no provider ownership.

## Protocol, cancellation and privacy

Reuse verified-TLS endpoints and the existing metadata-only projections/default CLI environment, process15second/64KiB and whole90second bounds. Keep current configured profile/account/region/role checks before and after the eight reads. A scope-valid success is a collision; only the exact operation's structured not-found failure can produce not-found. Neither result establishes physical deletion or complete target absence. Never fetch values, policies, note/item/user payloads or re-run a create based on not-found.

Capture the caller's signal reference so listener cleanup removes the original registration even if a dependency object changes during an await. Preserve pre-abort/active abort/deadline handling, checks around awaits and no late reads/publication. Test ignored runner and first/final identity cancellation. Keep snapshots deeply frozen and failures fixed/private. Full-target absence and ownership remain unproven. Artifact/S3/Cognito retained adapters, provenance and owned lifecycle stay separate.

## Verification plan

Reuse existing synthetic projected responses/errors and the frozen original recipe, without actual provider calls. Verify current factories/name helper/writer unavailable; exact prospective/retained command equality; original expired selectors/digests captured through mutation; strict pins/override/getter rejection; all eight successes/not-found and mixed cases; denied/wrong/private errors and foreign scope; current identity/role drift; invalid execution clocks, pre-abort/stalls/deadline/late results and listener/timer cleanup. Preserve all eleven prospective regressions. Run actual Node24 direct import/focused tests, shared TypeScript/format/tests/build, scans/no-reply checks and all three exact-head hosted gates plus focused review before one merge. Fixtures do not establish managed/app acceptance; audit51/managed31/M2.2 stay open.

## Local evidence

Implemented strict original recipe/pins capture and retained command/collection entry points through private shared plumbing. The existing command builder and response classifier are unchanged; the prospective result omits the retained-only manifest binding. The original cancellation signal reference is retained for registration and cleanup. Existing projected fixture generation is shared by the prospective and retained suites.

Thirteen retained cases plus eleven prospective regressions and direct import pass under actual Node24.22.1. Tests cover unavailable current factories/name helper/writer, exact command equality, expired original scope/digest capture, all-eight/mixed not-found, private malformed/denied failures, foreign returned scope, identity/role drift, clocks/pre-abort/default environment refusal, ignored runner/first/final-identity cancellation, changed dependency signal references and late/deadline suppression. All372shared cases/53files, TypeScript, repository formatting and browser build pass locally. The existing browser chunk-size warning remains. All exact-head hosted gates and focused review precede merge; no real provider or app acceptance is claimed.
