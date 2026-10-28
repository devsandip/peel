# Artifact-bucket collision metadata

## Purpose and boundary

[Issue 67](https://github.com/devsandip/peel/issues/67) adds one partial prospective observation under issue 30 in [M2.2](https://github.com/devsandip/peel/milestone/2), supporting SPEC FR-04/14/20 and AC-04/12/13 prerequisites. Observe only the canonical general-purpose ArtifactBucket, with its independently expected owner and current configured identity before/after. Keep its global name separate from the [eight non-bucket checks](cloud-fixed-target-metadata.md). No real notes/default database, slot booking, account changes or resource writes belong here.

## API and scope

Use [GetBucketTagging](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetBucketTagging.html), always passing ExpectedBucketOwner from the independently pinned account. AWS documents a 403 when that account does not match the owner. Discard the tag payload; return only collision/not-found state.

Success and the exact `NoSuchTagSet` exception both mean collision. A bucket with no tags still exists. Only exact `NoSuchBucket` from the [S3 error contract](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/ErrorResponses.html) yields `not-found`. Numeric 404, 403/AccessDenied, redirect errors, NoSuchKey/NoSuchBucketPolicy, generic validation, malformed/partial output and kill/timeout remain unavailable. Do not infer missing bucket from missing tags or turn an error message into an absence assertion.

Before publication, inspection of installed CLI 2.34.14's bundled S3RegionRedirectorv2 found that it can issue an additional HeadBucket without ExpectedBucketOwner when a redirect lacks region information. The CLI prototype's transformed tests and input-model checks did not prove the required wire behavior. Keep that prototype ignored and replace it before opening a PR.

Use a pinned JS S3 client with [region following disabled](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html), maximum one attempt and an explicit us-east-1 HTTPS endpoint. Add a transport guard that permits only one GET to that exact host/bucket/tagging route with the exact owner header, and bounds response headers/body before deserialization. Even an unexpected SDK follow-up cannot reach the network. Exposed redirects stay unknown. Names are global; a regional request does not reserve a name or establish its location. No discovered collision can be silently reused.

No list-buckets, object listing/content, location/policy/ACL/tag changes, create/delete or cleanup operations. Ownership of an AWS account's bucket is not proof that this run created it. Both full target absence and creation ownership remain explicitly unproven.

## Implementation and verification

Add a separate operator module; the eight-target observer stays unchanged. Pin dev-only S3 client 3.1157.0 to the existing DynamoDB SDK release, SSO provider 3.973.21 and Node HTTP handler 4.13.0 to already locked versions. This is an offline transport experiment, not a deployed dependency or app capability. Use normal [profile-scoped SSO credentials](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-your-credentials.html), with configured endpoint overrides ignored, no credential export or manual cache access. Current CLI inspection still verifies the independent account/profile/role before and after. Never return credentials or raw SDK errors.

Keep a 90-second overall bound, a 15-second read bound, bounded response headers/body (16/64 KiB), caller cancellation and rejection of late responses. Capture selectors before awaits; return only expected identity/name/owner, timestamps and collision/not-found state, with fixed private failures. Match actual SDK error name and HTTP status from its bounded response; permission, malformed, redirect and transport failures stay unknown.

Exercise the actual pinned SDK serializer/deserializer with synthetic credentials and an injected HTTP transport, including redirect/error XML. Assert one outbound GET, exact host/path/query/owner header, no HEAD or region follow-up, strict status/code distinction, bounded payloads, no retained private content, identity drift, timeout/cancellation and immutable results. These wire fixtures make no live request or credential lookup. Run direct actual Node 24 import, focused/shared tests, TypeScript, formatting, web/artifact builds and all hosted gates before merge. Refresh source/lock/artifact observations rather than reusing stale pre-dependency evidence.

Cognito discovery, complete absence/ownership reconciliation, durable original-manifest lifecycle/recovery/apply and actual managed teardown remain separate under 30/31. Audit 51 stays unresolved and stopped. App Cloud and canonical v0.7 requirements/mockups remain unchanged; fixture/model observations are not managed acceptance.

## Evidence before integration

Ten synthetic wire cases pass under actual Node 24.22.1, including regional redirects without a region hint, strict HTTP status/error-code pairing, streamed/oversized bodies, identity drift, pre-abort, late transport/credential results and both deadlines. The pinned SDK sends only `GET /<bucket>/?tagging` with ExpectedBucketOwner. No implicit HEAD or second request reaches the transport. Direct strip-only module import, TypeScript, 295 shared cases, formatting and the web build pass. Hosted gates are pending until the PR's exact head completes.

The dependency edit retains the previous runtime graph, adding only the three pinned dev selectors and three new S3 package entries. A fresh offline frozen install reproduces the prior Lambda ZIP (336713 bytes; SHA256 8603e9d37675877161f68d7e5a3b97b8cc57e247302a7dcbf690600671eb1013). The reviewed lock hash changes to 30c42969ee00b3645e5139e72628666b7e0be54b8b4296061537be058a7e8b2a; any future source observation must use that new lock rather than the old one. Five synthetic IaC templates pass rendering/lint, and packaged actual Node 24 checks make zero network attempts. An existing incremental dependency layout did not match its restored lock graph; clean-install verification, rather than that stale layout's ZIP, establishes the artifact evidence.

No live account request or managed resource was involved. These observations remain prerequisites and do not close the full deployment or teardown acceptance gates.
