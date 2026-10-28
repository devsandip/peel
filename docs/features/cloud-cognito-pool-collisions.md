# Cognito pool-name collision observation

## Purpose and boundary

[Issue 69](https://github.com/devsandip/peel/issues/69) is one partial prospective check under 30 in [M2.2](https://github.com/devsandip/peel/milestone/2), supporting SPEC FR-04/14/20 and AC-04/12/13 prerequisites. Derive only the reviewed CloudUserPool name; its ID is provider-generated. Existing matching names are collisions, never candidates for adoption. This collector grants no create/delete/cleanup authority and does not complete the full target absence gate.

## Contract and choices

[ListUserPools](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_ListUserPools.html) lists the current account's pools and has native MaxResults (1-60) and NextToken fields. Use a verified-TLS us-east-1 endpoint, current independently pinned profile/account/role before and after, and native input JSON with MaxResults 60. The [CLI paginator](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/list-user-pools.html) rewrites native pagination flags; disable it and pass service JSON, never starting-token/max-items. Retain no unrelated names or Lambda configuration: CLI projection returns only page count/token and exact-name matching IDs/names.

Validate every projected page, token and [matching pool ID](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_UserPoolDescriptionType.html), including exact region prefix and maximum 55 characters. Reject repeated tokens/IDs, partial/extra/malformed fields, wrong names/regions, count inconsistencies and more than 100 pages. Empty intermediate pages can carry a next token. Finish the bounded scan even after a match; multiple matching names are a collision count, not an invented unique identity. Return only expected identity/name, count and collision/not-listed state; discard IDs/tokens. A completed scan with no match means only not-listed. Scans are not atomic, and full absence/creation ownership remain unproven.

Use normal protected CLI execution, no retries/history/pager/prompt/debug, 64 KiB captured output, 15-second per-read and 90-second overall limits, external cancellation and late-response rejection. Capture selectors before awaits. Every process error stays unavailable, including a not-found service code; no error or message becomes an empty successful scan. Recheck configured identity/role and valid monotonic elapsed wall time before immutable output. Default execution rejects unsupported credential/endpoint/history overrides; injected tests use synthetic process output only.

No user enumeration, client configuration/secrets, pool-description or trigger-inspection APIs, tags, domain lookup, mutation, slot booking or actual account access is included. Domain-prefix observation, generated child reconciliation and retained original-manifest lifecycle/recovery remain separate under 30/31. Audit 51 remains unresolved and stopped; app Cloud and v0.7 are unchanged.

## Verification plan

Before code, verify the installed CLI input parser and bundled service/paginator models with empty configuration, no signing or API call; run the exact JMESPath projection against synthetic pages containing unrelated private metadata. Test complete/empty-intermediate pagination, multiple matches, repeats/malformed/partial pages, account/role/input drift, bounds/cancellation/late results and private immutable output. Run direct actual Node 24 import/focused tests, shared tests, TypeScript, formatting, build and all hosted gates before merge. Fixtures and input models do not establish live visibility or managed acceptance.

## Pre-implementation evidence

The installed CLI 2.34.14 accepts first/next-page service input JSON in input-skeleton mode. Its bundled Botocore input and paginator models validate MaxResults/NextToken; the exact projection removes synthetic unrelated names/triggers and keeps an empty intermediate page's token. The ignored scratch/check-cognito-pool-model.mjs diagnostic uses empty configuration and no signing/API request. This verifies parser/model/projection compatibility, not real account visibility.

## Local evidence before integration

Direct strip-only import and ten focused tests pass under actual Node 24.22.1, including complete native pagination, empty intermediate pages, multiple names, repeated tokens/IDs, the hundred-page limit, private malformed/partial output, captured selectors, identity drift and late page/final-identity rejection. All 305 shared cases, TypeScript, formatting and web build pass. The diagnostic also rechecks the actual collector's command against the installed input/paginator models and JMESPath projection, with zero account calls. Hosted checks follow on the PR's exact head before merge. No dependency, IaC factory or packaged Lambda source changes are needed.
