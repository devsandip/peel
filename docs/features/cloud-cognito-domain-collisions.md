# Cognito domain-prefix collision observation

## Purpose and boundary

[Issue 71](https://github.com/devsandip/peel/issues/71) is a partial prospective check under 30 in [M2.2](https://github.com/devsandip/peel/milestone/2), supporting SPEC FR-04/14/20 and AC-04/12/13 prerequisites. Derive only CloudDomain's reviewed prefix and independently pinned profile/account/region. Keep the [pool-name scan](cloud-cognito-pool-collisions.md) separate. This collector never grants adoption, creation, deletion or cleanup authority.

## Contract and choices

Use only [DescribeUserPoolDomain](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_DescribeUserPoolDomain.html) at the fixed verified-TLS us-east-1 Cognito endpoint. The API is region-specific and can return no description in a secondary region. Its fields are optional. An empty, missing or null description remains `not-described`, with absence and ownership unproven. Do not equate empty projection with physical absence or a reserved/available prefix.

Project only description type, domain, account ID, pool ID and lifecycle status. Require an object for a collision; validate exact expected prefix, a twelve-digit owner, regional pool ID up to 55 characters and a [documented lifecycle state](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_DomainDescriptionType.html). CREATING, DELETING, UPDATING, ACTIVE and FAILED all mean collision. A valid foreign owner also means collision. Return only the expected prefix, state and nullable ownerMatchesExpected boolean; discard actual owner/pool IDs, status and all distribution/S3/certificate/routing data. Partial, malformed or wrong-scope data is unavailable.

Only the precise documented ResourceNotFoundException from a bounded ordinary CLI service failure yields a point-in-time `not-found` observation. Match structured Code only after exit 254, empty stdout, no kill/signal and bounded stderr; do not inspect provider messages. Generic numeric status, permission/validation/disabled-operation, partial errors or changed identity remain unavailable. Neither not-found nor not-described satisfies the complete target-absence gate.

Use native input JSON, no automatic pagination/retries/history/pager/prompt/debug, 64 KiB captured output, a 15-second read and 90-second overall limit. Capture selectors before awaits, reject unsupported environment/credential overrides and late responses, and verify the same independently configured identity/role before and after. Inspection does not require a new-run lease or cutoff. Results and fixed private failures are immutable.

No user/client/secret enumeration, tag lookup, domain changes, resource write, slot booking, default note database or real account probe belongs here. Complete ownership/absence composition and retained original-manifest lifecycle/recovery remain under 30/31. Audit 51 stays unresolved and stopped; no new AWS run fits the remaining overnight runway. App Cloud and canonical v0.7 requirements/mockups stay unchanged.

## Verification plan

Before implementation, check the installed CLI input parser, bundled operation/input/error model and exact JMESPath projection using empty configuration, synthetic domain data and no signing/API request. Exercise normal/foreign/deleting collisions, empty/null/malformed/partial descriptions, exact versus ambiguous errors, captured selectors, identity drift, deadline/cancellation/late results and private immutable outputs. Run direct actual Node 24 import/focused tests, shared checks, formatting/build and all three hosted gates before merging the single-purpose PR. Fixtures and model checks do not establish live domain visibility or managed acceptance.

## Pre-implementation evidence, 28 October

The [offline protocol record](../experiments/cognito-domain-input-projection-2026-10-28.json) verifies installed CLI 2.34.14 native Domain input, bundled operation shape, optional description fields, the modeled ResourceNotFoundException name and all five collision lifecycle states. The exact projection keeps description type plus domain/account/pool/status and discards synthetic distribution/S3/certificate/routing values. Missing/null/empty descriptions and malformed string/array descriptions remain distinguishable; the future parser must reject the latter rather than manufacture absence.

The first diagnostic incorrectly expected HTTP 400 to be encoded in the installed exception shape. That control failed: these AWS JSON exception traits contain only the exception marker. The corrected check records the missing HTTP metadata and verifies the modeled name; HTTP 400 remains an independent API-documentation fact. No vendor, SDK sample or provider setting was changed.

The ignored scratch/check-cognito-domain-model.mjs uses the canonical synthetic inventory, empty configuration, no signing, input-skeleton mode and bundled model/JMESPath checks. It makes zero account calls. No collector, live identity/visibility, full absence, creation ownership, timeout or native/app acceptance is established. Issue 71 stays Ready for implementation after this plan/protocol preparation.
