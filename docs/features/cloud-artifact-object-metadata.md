# Retained artifact object metadata before cleanup

[Issue215](https://github.com/devsandip/peel/issues/215) is a focused prerequisite under issue30/[M2.2](https://github.com/devsandip/peel/milestone/2), supporting [SPEC](../SPEC.md) FR-04/14/20 and AC-04/12/13. Read [independent cleanup](cloud-dev-cleanup.md), [retained bucket metadata](cloud-retained-artifact-bucket.md) and the original historical inventory. This plan precedes implementation.

The bucket-tag observer cannot inspect the object versions/delete markers that block bucket deletion. Add one bounded retained-manifest-scoped metadata observer using actual pinned S3 SDK ListObjectVersions, one complete page of at most two entries, current identity before/after, exact ExpectedBucketOwner/path/endpoint binding and no other provider operation. Original bucket/key/bytes/profile/account/region come from readHistoricalCloudInventory before awaits. Preserve expired-source read-only inspection and all current identity/deadline/privacy/environment guards.

Classify complete empty or sole expected null-version object shape, otherwise review/unavailable. A null version does not establish bucket versioning state, ownership or ZIP content hash. All observations retain ownership unproven, body verification unproven and resourceWrites0. Partial/not-found/denied/malformed/truncated/grouped/foreign/versioned/markers never authorize deletion. No new cleanup capability, persistence codec, SDK dependency, real provider call, profile access, budget or app activation.

Allowed paths and detailed tests are the issue215 contract. Actual SDK fake-credential/denied-network XML tests cover complete/foreign/ambiguous/refused/error/abort/deadline/identity cases, body/header bounds and cleanup; meaningful owner-wire/truncation negative controls precede restored positives. Run pinnedNode24 focused/relevant/shared/type/format/build; sourceall3, independent review, normal integration and separate actual-main proof remain required. Parent30/31/51/M2.2 stay open. Runtime edits begin only after this plan commit.

Primary references: [ListObjectVersions](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectVersions.html), [bucket deletion](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteBucket.html) and [null versions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/list-obj-version-enabled-bucket.html).

## Implementation decisions

- `collectRetainedCloudArtifactObject` in `infra/cloud/artifact-object-metadata.ts` is retained-only, with no prospective variant. Bucket, key, byte size, profile, account and manifest pin come from `readHistoricalCloudInventory` before any await. The artifact-object bucket must equal the inventory's `ArtifactBucket` name. Caller bucket, key, owner and endpoint fields are refused as invalid input.
- The client, guard and lifecycle follow the existing retained bucket observer: current identity before and after, fixed path-style `s3.us-east-1.amazonaws.com`, `maxAttempts` 1, no region redirects, a 15-second operation bound, a 90-second overall bound, 16 KiB headers and a 64 KiB body. The guard allows exactly one `GET /<bucket>/?versions&max-keys=2` carrying the expected-owner header and no body. The existing bucket module and fixtures are unchanged, and the shared helpers are duplicated rather than refactored.
- A complete page requires HTTP 200, explicit `IsTruncated` false, no next markers, a bucket echo equal to the original, `MaxKeys` echo 2, empty prefix, marker and delimiter echoes, no encoding type, no common prefixes, at most two entries and well-formed entries. Anything else, and every service error including not-found and denied, is `metadata-unavailable`.
- Shapes: `empty`, `expected-null-version-object` (one version, the original key, `VersionId` string "null", latest and the original byte size, with no markers), otherwise `requires-review` with fixed reason codes. Only counts and those codes are returned. Foreign keys, version IDs, owner IDs, ETags, storage classes, raw responses and messages are dropped.
- Every observed result carries `bucketVersioning`, `bodyVerification`, `fullTargetAbsence` and `ownership` as unproven, plus `resourceWrites` 0. A null version shows only the observed shape, not the bucket's versioning mode.
- The optional synthetic fixture was not needed. The test reuses the existing `cloud-artifact-bucket-wire.ts` fixture read-only.

## Local evidence

All runs used pinned Node 24.22.1 and default workers, timeouts and retries, serialized through `test-window.py`.

- The focused unit file passes 20 of 20. Real SDK serialization and deserialization of synthetic XML run with fake credentials, an empty temporary HOME, and denied `net`, `tls`, `http`, `https` and `fetch`; tests assert zero socket attempts and an untouched HOME. Coverage includes:
  - exact owner-bound wire;
  - the empty and expected shapes, and seven review shapes;
  - thirteen incomplete or contradictory pages;
  - not-found, denied, redirect, server error, malformed and oversized responses;
  - retained capture while caller inputs mutate;
  - strict input refusal;
  - identity drift;
  - abort, clock and endpoint-environment gates;
  - ignored stalls, the 15-second and 90-second deadlines, and transport closure.
- The first focused run had 9 failures from my own test code, none from the module:
  - the privacy regex matched the intended `expectedOwner` field name;
  - fake timers advanced before the SDK's real asynchronous read of the empty HOME.

  The fixes were to narrow the regex to actual private values, and to fake only the timer functions while waiting for each stall to be reached. Timeouts were unchanged. There was also one TypeScript literal-type error.

- Negative controls, each applied temporarily and restored byte-for-byte:
  - Removing the owner binding from both the command and the guard fails the two owner-wire tests.
  - Accepting truncated or continued pages fails the incomplete-page test.
  - The restored module passes 20 of 20.
- The Node 24 direct import succeeds. The workflow's Cloud list passes 905 tests in 52 files. The shared suite passes 1113 tests in 89 files. `pnpm check` and `git diff --check` pass, and Prettier passes on source, tests and this plan.
- The build passes. All 8 default `apps/web/dist` files are byte-identical to a build of base `6209613`.
- `.github/workflows/checks.yml` already fails Prettier at base. Only its two coverage lists changed, and its formatting is left as is.
- Not run: any AWS, profile, credential or provider access, and any browser suite, since no web code changed. Exact-source all3 gates, independent review, normal integration and actual-main proof remain required. Issues 30, 31 and 51 and M2.2 stay open.

## Envelope rework for the Root review of `dc4bb3f`

Planned before code. The [Root review](https://github.com/devsandip/peel/pull/217) showed that the pinned SDK deserializer accepts fields from an unrelated XML root. An HTTP 200 `<UnrelatedResult>` carrying a matching `Name`, `MaxKeys` 2 and `IsTruncated` false was classified as complete and empty. Typed SDK fields cannot establish the response envelope.

- Before the SDK sees an HTTP 200 body, the guarded transport checks the already bounded body (at most 64 KiB) for the documented envelope. That is an optional UTF-8 BOM, an optional bounded XML declaration, then exactly one `ListVersionsResult` root element, either with exactly the documented `http://s3.amazonaws.com/doc/2006-03-01/` namespace or with no attributes, ending with its closing tag and only whitespace after it.
- A different root, another or foreign namespace, extra root attributes, a DOCTYPE, trailing content or an unclosed root is `metadata-unavailable`. Classification also requires that the envelope check passed.
- This is a bounded prefix and suffix check on the root element only, not an XML parser. The SDK still performs the full deserialization. Error responses keep their existing handling. No object contents are read, and no dependency is added.
- The tests replace the `reach()` turn budget with an explicit reached barrier, so slow real file reads cannot spend a fixed budget. Timing assertions and deadlines are unchanged. Root did not reproduce a failure from that budget, and this change does not claim one.
