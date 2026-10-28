# Expected Cloud development inventory

## Purpose and boundary

[Issue 59](https://github.com/devsandip/peel/issues/59) supplies one offline inventory contract under issue 30 in [M2.2](https://github.com/devsandip/peel/milestone/2). It supports SPEC FR-04/14/20 and AC-04/12/13 prerequisites in the [hosting plan](cloud-dev-hosting.md). It does not establish observed AWS ownership, absence, cleanup, provisioning readiness or product acceptance. Canonical v0.7 requirements and disabled app Cloud remain unchanged.

## Inputs and derivation

Require an explicit expected commercial account, us-east-1, run UUID, artifact digest/size and canonical lease. Bind the inventory to the exact five-template JSON and digest returned by the reviewed [source collector](cloud-source-observations.md). Regenerate those templates with the actual factories and refuse any difference. This contract neither authenticates the caller's expected account nor substitutes for the independent identity/source guards.

Describe only the four stacks that would be deployed: guard, artifacts, sentinel and data. The standalone data-identity template participates in the source digest; private-hosting already includes its six resources, so it is not a fifth stack. Require an explicit exhaustive resource/type mapping for all 17 logical resources. Future factory additions, omissions or type changes must fail closed until the contract receives review. Validate named properties, run tags, references and dependency edges against the actual factory output. Never silently omit an unfamiliar resource.

Keep fixed service names separate from provider-generated identifiers. Every resource requires resolution through its exact owned CloudFormation stack/logical ID before a future observer can claim ownership. Pool/client/branding identifiers, secret ARN suffixes and stack IDs are not inferred from display names. For children without ownership tags, carry the exact parent relationships, including schedule groups, buckets, pools and clients. A shared parent or matching name alone is insufficient deletion authority.

Return a deeply frozen, bounded description and stable digest that binds expected account/region, run, lease, artifact, reviewed template digest and all resource relationships. Include no template bodies, IAM policies, secret values, Lambda environment or account-derived observations in the description. Errors use fixed private messages without echoing supplied input.

## Verification and next boundary

Use synthetic inputs and the actual factories. Demonstrate complete four-stack/17-resource coverage, source-bundle compatibility, deterministic scope binding, generated-ID handling, parent/tag coverage and immutability. Reject invalid account/region/run/lease/artifact input, wrong source digest and changed/missing/duplicate/unknown templates, resources, tags or references. Also inject factory drift to prove completeness cannot silently degrade after a factory changes.

Run focused tests, shared tests, TypeScript, formatting, web build and all hosted gates before merge. No AWS calls, live audit retries, resource discovery/deletion, operator slot booking or real note/default-database access belong in this slice. A later separately scoped observer must establish target absence or ownership from bounded metadata, then lifecycle/recovery tooling must use that proof. Issue 51 remains blocked and issues 30/31 stay open.

Six focused inventory cases and the existing source collector's 11 cases pass locally, including actual source-bundle composition. Together with namespace/ledger coverage, 38 cases pass under actual Node 24.22.1. All 253 shared cases, TypeScript, formatting and web build pass. The inventory binds the caller's explicit expected account into its digest; it cannot authenticate that account or infer it from account-independent templates. Changing a valid expected account requires a different inventory digest. Hosted evidence follows before integration.

The [historical v1 reader](cloud-historical-inventory.md) shares the fixed version-one catalog while preserving this current writer's actual-factory checks and serialization. Recovery should decode the retained original recipe rather than regenerate this current writer after source changes. Neither interface establishes observed ownership.
