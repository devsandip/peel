# Response identifiers stay observations

2026-10-29 09:25 IST. Previous: [The original request reaches the SDK without a transport](2026-10-29-0851-original-query-without-a-transport.md).

I integrated PR136 as06383d1 after focused review and all three exact-source gates. Its actual main run40812903067 passed all three gates separately. Issue135 and both Project cards are complete. This proves an offline unsigned serialization contract, without account/signing/transport authority or a send capability. M2.2 and actual managed/independent teardown remain open.

I then separated supplied response integrity from actual provider provenance. Issue137's plan792ff96 came before code and fixtures. A pure codec binds a small observation of approved stack/operation/request identifiers and attempt counts to the exact original request. The stack ARN must match its original account, region and name. The canonical record and independent pin remain readable after expiry or loss of an active request handle, so late responses can still support inspection. Every provider, ownership, settlement and run authority remains unproven.

The actual pinned SDK supplies the response deserialization oracle through the existing isolated synthetic handler. Before the new codec existed, a separate Python serializer pinned all four expected observations. Their results match at756/748/754/746 bytes. I retain no raw response, headers, template, parameter/key, session ARN or real account data. The public fixtures are synthetic. There is no journal write or provider request in this codec.

The20 focused cases retain all12 earlier Query cases and add eight response groups. Removing original stack-prefix matching fails the wrong-account refusal control; exact source was restored. I also corrected a review test that accidentally changed the stack name's embedded run UUID instead of the stack-ID suffix. The codec correctly refused that invalid original name. That expanded run remains a failure, separate from the final381 Cloud/596 shared/type/format/build passes under unchanged defaults. Existing browser chunk warning remains. Final review and exact-head hosted gates still precede integration.

## Decisions

- I keep response integrity distinct from actual send/provider/ownership evidence, because a copied or fabricated DTO can be self-consistent.
- I preserve late historical observations without extending original deadlines or granting readiness, so cleanup inspection does not depend on a fresh-run lease.
- I use a conservative bounded ASCII identifier policy without assuming AWS guarantees an OperationId UUID format.

## Direction changes

- The response/provenance work now has a small supplied-observation codec prerequisite before durable append/correlation. No real stopped component is retried.

## Needs revisit

- Issue30 still needs actual current provenance, private phase/runway assessments, durable preparation/fence, real bounded transport/signing/header policy, provider correlation/ownership/settlement and complete teardown. Issue31/51, M2.2 and app/release acceptance remain open or stopped. Issue137 does not supply those gates.
