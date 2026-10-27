# Cloud audit region registry

## Purpose and scope

[Issue 52](https://github.com/devsandip/peel/issues/52) is a prerequisite to the private [audit observation in issue 51](https://github.com/devsandip/peel/issues/51), within [M2.2](https://github.com/devsandip/peel/milestone/2). It supports SPEC FR-04/14/20 and AC-04/12/13 prerequisites. This PR has one purpose: verify current public Lake home-region coverage. Private account/hook/audit metadata and permission/organization visibility remain a separate PR. Product v0.7, app Cloud activation and all managed gates remain unchanged.

The [ListEventDataStores API](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_ListEventDataStores.html) lists only one region/account, while a store can capture multiple regions. Obtain the complete current home-region set from AWS's [official supported-region registry](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-lake-supported-regions.html), never from an empty local store list or an assumed us-east-1-only layout. The actual public table checked on 28 October has 28 commercial and two GovCloud regions. The existing identity boundary accepts the commercial `aws` partition; explicitly exclude GovCloud after validating the complete published set. Unknown additions, removals, duplicates or markup prevent a coverage claim until reviewed.

## Contract and decisions

- A pure parser requires the complete single region table, its two headers and two cells in every row. Match the entire reviewed region set, with no silent truncation, permissive fallback or inferred partition. Return a frozen sorted commercial set, official source URL, retrieval time and SHA-256 of the UTF-8 document. Provenance is public metadata, not authorization.
- A collector fetches that one fixed HTTPS URL, without credentials, redirects, retries, cache fallback or arbitrary input URLs. Check exact resolved origin/path, status and HTML content type. Bound decoded bytes to 256 KiB and all work to ten seconds; abort/cancel on failure. Do not execute the HTML.
- Use fixed error codes with no raw source/cause. Validate clocks; capture the earliest observation time. Unknown/changed registry means not-ready. It does not justify querying only a known subset or changing AWS regions.
- No AWS profile, STS, resources, notes, default database, billing or infrastructure is accessed. The helper creates no files. Account collection and any private normalized output remain issue 51 work. A complete region set does not prove regional API or organization visibility; disabled/denied/partial responses must remain unknown there.

## Validation plan

Test complete commercial/GovCloud partition handling, deterministic provenance, immutable output, missing/extra/duplicate rows/cells/tables, changed regions, unsafe text/oversize/malformed input, fixed request scope, wrong status/URL/redirect/type, body bounds and deadline cancellation. Check actual Node 24 and shared TypeScript/formatting/tests/web build; all hosted gates precede integration. Read the actual public registry once after implementation and record only public counts/hash and zero account/resource access. No managed or product acceptance follows from this helper.

Eight focused cases pass under development Node and actual Node 24. An actual Node 24 fetch validated all 30 published rows, returned 28 commercial regions, and explicitly excluded the two GovCloud regions. The UTF-8 document digest was `69a015ac4a0732d3a6677d56c2576aadf86076d6cb5c7bc637fdc1bf4a5f8182`. No account call, output file or resource was created. Shared/local and hosted integration evidence follows with the focused PR; private audit absence remains unclaimed.
