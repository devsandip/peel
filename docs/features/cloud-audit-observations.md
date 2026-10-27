# Private hook and audit observations

## Purpose and PR boundary

[Issue 51](https://github.com/devsandip/peel/issues/51) supplies hook/data-event facts to the [deployment guard](cloud-deployment-guards.md), within [M2.2](https://github.com/devsandip/peel/milestone/2), under SPEC FR-04/14/20 and AC-04/12/13 prerequisites. The public [region registry prerequisite](cloud-audit-regions.md) is separate PR 53; this dependent branch must not merge before it. This PR reads private configuration metadata only. Ownership/target names, atomic run slots, lifecycle/apply/recovery and managed proof remain separate issues 30/31. No product v0.7 behavior or app Cloud activation changes.

## Collection contract

Capture explicit existing profile, us-east-1 resource scope and authorization cutoff before awaiting. Verify the current official complete Lake registry before account calls; use the existing private configured-identity/history guard and require a matched active SSO session. Account expectations come from existing configuration, not observed STS/organization metadata. Preserve the account and all settings.

Read only these fixed metadata operations, with argument arrays, explicit regional service endpoints, no pager/prompt/debug, one attempt, bounded output/subprocess timeouts and a shared 90-second deadline:

- Organizations [DescribeOrganization](https://docs.aws.amazon.com/organizations/latest/APIReference/API_DescribeOrganization.html), selecting only the management-account ID for comparison. Only the precise documented not-in-use service exception establishes standalone status; denied/unknown errors do not. Do not store the organization's ARN, name, email or management ID.
- CloudFormation [ListTypes](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ListTypes.html), HOOK/PRIVATE/LIVE, including activated public hooks. [Lambda hooks register a private entry](https://docs.aws.amazon.com/cloudformation-cli/latest/hooks-userguide/lambda-hooks.html). Any present hook requires separate configuration review; do not execute or disable it.
- CloudTrail [DescribeTrails](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_DescribeTrails.html), explicitly including shadow/organization/multi-region trails in us-east-1. Any trail requires later selector review; do not read event payloads.
- [ListEventDataStores](https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_ListEventDataStores.html) in every verified commercial home region. Read small presence pages only. Absence requires zero count and no continuation in every region. A present/partial result requires review; denied, unsupported or disabled-region access remains unavailable, never empty. Limit concurrent reads to four, stop later batches once readiness cannot be established, and cancel outstanding reads on failure.
- Recheck STS account/SSO role after successful or conservatively not-ready metadata collection. Account drift or missing recheck invalidates the observation.

Organization member accounts [cannot normally see organization event data stores](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-lake-organizations.html). This collector accepts organization coverage only in the independently pinned management account, or a proven standalone account. A member returns explicit unknown without changing profiles or assuming an empty local list proves absence. Management/standalone status does not substitute for complete regional visibility.

CLI queries retain counts/continuation facts only; raw resource addresses/selection configurations and error messages never enter normalized output. Never invoke hooks, query audit events, list/read note tables/functions or change regions, quotas, IAM, audit, billing or resources. No automatic pagination into configurations is necessary to prove emptiness: a nonempty or truncated page is not-ready.

## Evidence and output

Return frozen normalized private identity, credentials, public registry provenance, coarse coverage, hook/data-event states and safe readiness facts. Target-name absence is deliberately omitted because ownership is another boundary. Public command output contains only fixed codes/booleans, zero writes and the ignored output path. Create a fresh private directory/mode-0600 observation file; never overwrite earlier artifacts. Unavailable results have no raw errors or partial identities. Recompute direct cleanup runway at completion, without claiming refresh, deployment authority or managed acceptance.

Test complete absence across all regions, nonempty/partial pages, member/denied organization visibility, regional failures without fallbacks, account/role drift, concurrency/deadline cancellation, privacy/immutability and fixed read scope. Run focused actual Node 24, shared tests, TypeScript/formatting/web build and all hosted gates. An actual private metadata observation may be unavailable; record that honestly and keep managed gates open. Do not change settings to force a positive result or rerun unknown errors blindly.

Twelve focused cases pass under development Node and actual Node 24. All 225 shared cases in 39 files, TypeScript, formatting and web build pass locally. Hosted gates and an actual private observation follow integration of the public registry prerequisite; no private audit absence is claimed from fixtures.
