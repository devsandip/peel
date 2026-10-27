# DynamoDB TTL preserves logical retention

## Requirement and PR boundary

Tracked by [issue 16](https://github.com/devsandip/peel/issues/16) in [Cloud sync foundations](https://github.com/devsandip/peel/milestone/1).

FR-04/13/20 and AC-12/23 require stable idempotency and retained changes for the full logical window. DynamoDB TTL uses whole epoch seconds. Flooring an expiry timestamp with a millisecond fraction makes a row eligible for physical cleanup before the actual deadline. This bug fix changes only the expiry encoding and its boundary evidence; public retention periods and local stores are unchanged.

## Plan before implementation

1. Encode receipt/change TTL with the next whole second, keeping physical expiry at or after logical expiry. Keep service-side deadline checks authoritative; background deletion is asynchronous.
2. Add an actual DynamoDB Local regression with a subsecond server timestamp. Simulate allowed physical TTL cleanup one millisecond before the retention deadline and verify the original immutable operation still replays its original receipt. At the deadline, ignore the logically expired receipt even while physical cleanup has not occurred.
3. Preserve permanent tombstones without TTL. Run the complete DynamoDB suite, shared checks and hosted CI. Merge separately after the session-boundary dependency, if stacked.

## Deployment and evidence

No hosted DynamoDB table or user data exists for this adapter. Disposable fixture records can be recreated; deployed-schema migration is not claimed. Background cleanup is simulated explicitly because DynamoDB Local does not establish managed TTL scheduling. The new actual-DynamoDB regression fails before the fix: simulated eligible cleanup removes the operation receipt one millisecond early and retry no longer returns its original outcome. Rounding the TTL up makes the case pass. The test also confirms immediate logical expiry at the actual deadline while the physical row remains.

All 16 DynamoDB Local cases and all 123 shared cases pass, with TypeScript and changed-source formatting passing. The existing permanent-tombstone case still has no TTL. Hosted checks are pending. This is a deterministic simulation of the earliest allowed TTL eligibility, not a claim to measure AWS cleanup timing. See [AWS TTL rules](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html).
