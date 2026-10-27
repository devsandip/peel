# Official Cloud price observations

## Purpose and boundary

[Issue 41](https://github.com/devsandip/peel/issues/41) collects public pricing inputs for the [deployment-plan guard](cloud-deployment-guards.md), under [M2.2](https://github.com/devsandip/peel/milestone/2) and SPEC FR-04/14/20, AC-04/12/13 prerequisites. Before opening a PR, separate [issue 42](https://github.com/devsandip/peel/issues/42)'s pure provider-offer parser from issue 41's HTTPS transport, cancellation, aggregate quote and command. They have different review/rollback purposes. The parser merged in PR 43; the following PR implements bounded collection. Both use no AWS credentials or authenticated account API and create no hosted resource or app feature. Account/source preflight and lifecycle/apply remain issue 30; actual managed proof remains issue 31. Product v0.7 and mockups stay unchanged.

## Verified sources and selection

Use exactly six fixed regional AWS offer URLs under `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<service>/current/us-east-1/index.json`. Current services are AWSLambda, AmazonDynamoDB, AmazonCognito, AWSSecretsManager, AmazonS3 and AWSEvents. The [public catalog](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json) identifies AWSEvents; its `USE1-ScheduledInvocation` product supplies Scheduler rates. Do not confuse it with API destinations, ordinary event delivery or a differently priced event bus.

The current [service offer format](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/reading-service-price-list-file-for-services.html) separates products and OnDemand terms. Match the product's service, region, AWS-region location, family, operation and exact usage/group/storage attributes, with one matching SKU and one current OnDemand term. Check map keys against SKU/term/rate identifiers. Require correct units, USD decimal strings and valid nonfuture publication/effective dates. Extra provider metadata is tolerated; missing or ambiguous required identity/dimension data refuses a quote.

| Normalized rate | Service / exact usage | Unit | Decimal scale |
| --- | --- | --- | ---: |
| lambdaRequestsPerMillion | AWSLambda / Request | Requests | 6 |
| lambdaGbSecond | AWSLambda / Lambda-GB-Second | Lambda-GB-Second | 0 |
| cognitoMau | AmazonCognito / USE1-CognitoEssentialsMAU | CognitoUserPoolsMAU | 0 |
| dynamoWritesPerMillion | AmazonDynamoDB / WriteRequestUnits | WriteRequestUnits | 6 |
| dynamoReadsPerMillion | AmazonDynamoDB / ReadRequestUnits | ReadRequestUnits | 6 |
| dynamoGbMonth | AmazonDynamoDB / TimedStorage-ByteHrs | GB-Mo | 0 |
| secretMonth | AWSSecretsManager / USE1-AWSSecretsManager-Secrets | Secrets | 0 |
| secretPerTenThousand | AWSSecretsManager / USE1-AWSSecretsManagerAPIRequest | API Requests | 4 |
| s3GbMonth | AmazonS3 / TimedStorage-ByteHrs, Standard | GB-Mo | 0 |
| s3PutsPerThousand | AmazonS3 / Requests-Tier1 | Requests | 3 |
| s3GetsPerThousand | AmazonS3 / Requests-Tier2 | Requests | 3 |
| schedulerPerMillion | AWSEvents / USE1-ScheduledInvocation | Invocations | 6 |

Validate complete nonoverlapping/continuous usage ranges from zero to infinity. Skip only leading zero-priced free ranges, select the first positive paid tier and require later paid tiers not to increase. This deliberately applies marginal paid rates even to the tiny fixture, without assuming account allowances or volume discounts. For example DynamoDB storage's first 25 GB and Scheduler's first 14 million invocations currently have zero ranges; choosing them would understate the envelope. Preserve selected ranges and original wire prices in provenance. A changed price remains data; changed/ambiguous service, unit or tier structure needs review and cannot fall back to a hardcoded quote.

## Transport and aggregate provenance

Fetch the six fixed HTTPS URLs concurrently, credentials omitted, redirects rejected, cache disabled and identity encoding requested. One ten-second deadline covers each response/body; no automatic retry. Bound each body to 2 MiB while streaming, validate advertised length when present and reject other encodings, bad status/content type, truncation, invalid JSON or a failed source. Cancel outstanding requests on failure. Fixed errors do not include response bodies. Downloaded JSON is public provider data, never executable instructions.

Return the exact normalized quote shape consumed by `cloudDevelopmentCost`, with the oldest request-start time, us-east-1/USD, twelve rates and a digest of complete provenance. Each source records its fixed URL, raw SHA256/byte count, publication/version and selected SKU/term/rate/unit/range/wire-price metadata. Scale decimal strings using decimal exponents rather than repeated floating-point multiplication. Freeze returned observations. The guard still enforces quote freshness and the USD 2 forecast ceiling; a successful fetch does not establish account readiness or a hard spending cap.

Use small synthetic fixtures for offline tests. `pnpm cloud:prices` accepts no arguments, writes only public quote/provenance to a unique ignored artifact directory without overwriting earlier observations, and prints a bounded summary. It never runs by default in CI or accesses an account, note database, credential file or environment secret. Provider files downloaded during research remain ignored, without entering git.

## Parser evidence and remaining collection gates

Eight focused parser cases pass for all twelve rates, free/discounted lookalikes, service/unit/currency/region identity, ambiguous/missing/current terms, map identities, changed prices/source hashes, range gaps/overlap and exact paid-tier ordering, including a decimal increase below floating-point resolution. Malformed/oversized/invalid-UTF8 inputs fail with fixed errors.

At 20:13 UTC on 27 October, an isolated public-only input probe passed all six actual offer bodies (1,342,298 bytes) through this parser under Node 24.22.1. Its twelve normalized rates reproduce the canonical USD 1.488729 forecast. This verifies the parser against current public input; an HTTP collector is not shipped by that experiment. All 169 shared cases in 33 files, TypeScript, formatting, web build, five provider-schema templates and actual Node 24 packaged checks pass locally. The Lambda artifact and existing browser warning are unchanged. Hosted gates must pass before merge.

Seven additional collection cases pass for six exact credential-free URLs, request options, changed-source aggregate binding, HTTP/redirect/content/encoding/length failures, streamed size enforcement, stalled-body deadline, cancellation of another stalled source on early failure, and clock reversal/overrun. CI uses injected synthetic responses; it does not depend on a live pricing service.

At 20:30 UTC on 27 October, the actual Node 24 command collected all six public offers (1,342,298 bytes) and produced a fresh bound quote with the USD 1.488729 estimate and a new restricted artifact file. All 176 shared cases in 34 files, TypeScript, formatting, web build, five template checks and Node 24 packaged checks pass locally. The Lambda ZIP/hash and browser warning are unchanged. Hosted gates must pass before merge. Actual account/IAM/SSO/quota/audit/lifecycle/managed teardown gates remain unclaimed.
