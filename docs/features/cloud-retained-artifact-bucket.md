# Retained-recipe Cloud artifact bucket

## Purpose and scope

[Issue88](https://github.com/devsandip/peel/issues/88) connects the [historical inventory reader](cloud-historical-inventory.md) to the existing [artifact-bucket observer](cloud-artifact-bucket-metadata.md). This is one issue30/[M2.2](https://github.com/devsandip/peel/milestone/2) prerequisite for SPEC FR-04/14/20 and AC-04/12/13. Canonical v0.7 and app behavior stay unchanged. No real account call, resource/default note database/budget/app change or stopped-component retry belongs here.

## Original captured scope

Accept exactly original recipe JSON plus independently retained pins. Decode/capture original profile, expected graph, bucket name, account owner and original manifest/inventory binding before awaits. Reuse one private bucket extraction helper after either current-factory validation or historical decoding, with private shared collection. No public graph/profile/account/region/bucket/endpoint override or owned flag. Retained successful snapshots add the original manifest digest while prospective inputs/current-factory validation/result shape remain unchanged. Expired original source/lease cannot prevent inspection; current identity/time gates still apply.

## Transport and cancellation

Preserve the actual pinned SDK's one verified-TLS GetBucketTagging GET with exact expected-owner header, host/path/query/body checks and no implicit HEAD, region following or retry. Preserve response-header/body bounds, operation15second and whole90second deadlines, current configured identity/role checks before/after, and private response classification. NoSuchTagSet is collision; NoSuchBucket only point-in-time not-found. Denied, ambiguous, redirect and malformed results remain unavailable. Tag payloads, raw errors, request authorization and credentials cannot enter the snapshot.

Capture the original caller signal for registration/finally cleanup across dependency mutation. Preserve abort checks around awaits, no late requests/publication and idempotent transport/stream teardown. Metadata, original digest binding and matching account owner do not establish creation provenance, physical absence or cleanup permission. Retained Cognito adapters, complete ownership/absence and lifecycle remain separate work.

## Verification plan

Use the frozen synthetic recipe and shared existing raw HTTP/XML fixtures with fake credentials and injected transport; no actual provider call or SSO lookup. Test unavailable current factories/name helper/writer; exact original bucket/owner-bound request and compatible prospective output; original scope/digest capture through mutation; strict pins/overrides/getters; success/not-found/unknown service results; current identity/role drift; redirects/HEAD/retries/body bounds; pre-abort, ignored first/final identity/transport/credential stalls, deadlines, late responses and cleanup. Preserve all existing prospective cases. Actual Node24 import/focused tests, shared type/format/tests/build, no-reply/scans, focused review and all three exact-head hosted gates precede a focused merge. Fixtures establish no managed/app acceptance; audit51/managed31/M2.2 remain open.

## Local evidence

Implemented strict retained capture, a private shared bucket-scope extractor and common collector. Original manifest binding is included only on retained success; current prospective factory validation/output stays compatible. The SDK command/transport/error classifier is unchanged. Registration/cleanup use the original caller signal. Existing synthetic HTTP/XML/credential fixture generation is shared by both suites.

Thirteen retained cases plus ten prospective regressions and direct import pass under actual Node24.22.1. Tests cover unavailable current factories/name helper/writer, exact one owner-bound GET, original expired/captured scope/digests, bad pins/overrides/getters, empty tags/not-found, private malformed/denied/errors, redirect/no-HEAD behavior, stream/response bounds, current identity/role, pre-abort/clocks/environment, ignored first/final identity/transport cancellation, credential/stream/read deadlines, late results and cleanup. All385shared cases/54files, TypeScript, formatting and browser build pass locally; existing chunk-size warning remains. Focused review and all exact-head hosted gates precede merge. No real account call or managed/app acceptance.
