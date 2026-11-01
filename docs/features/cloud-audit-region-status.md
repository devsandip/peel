# Status-aware audit coverage for us-east-1 development

[Issue 239](https://github.com/devsandip/peel/issues/239) is a bounded prerequisite under [audit 51](https://github.com/devsandip/peel/issues/51) in [M2.2](https://github.com/devsandip/peel/milestone/2). SPEC FR-04/14/20 and AC-04/12/13, [hosting](cloud-dev-hosting.md), [audit observations](cloud-audit-observations.md) and [region registry](cloud-audit-regions.md) govern this change. This plan is committed before implementation.

## Purpose and boundaries

Sandip confirmed us-east-1 resource scope and no enabling other regions. A separately authorized read-only investigation found af-south-1 DISABLED, with independently pinned identity before/after. This diagnosis does not establish audit absence or the historical exact service exception. The current observer calls every verified Lake home-region endpoint and stops on regional authentication failure, obscuring this known distinction.

Add one status-aware branch to the existing metadata collector, not a deployment, region activation or readiness bypass. No actual provider call is part of this coding task. Resource scope stays exactly us-east-1. Preserve organization/hook/trail, cross-region cost/audit, identity, deadlines, bounded concurrency and privacy requirements. Confirmed disabled coverage remains unknown, never empty. Actual51/30/31 stay OPEN/Blocked and default Cloud stays OFF.

## Fixed metadata contract

After the current organization/hook/trail gates, and only when those permit Lake inspection, read Account ListRegions through https://account.us-east-1.amazonaws.com, signing in us-east-1 with the original captured profile. One attempt, max50 results, no auto-pagination, existing15second per-command/90second parent limits and configured-endpoint refusal. Project only RegionName/RegionOptStatus rows and NextToken. No account-ID argument, other account selection, credentials export addition, region mutation or new package.

Require an exact JSON object with Regions/NextToken; array1..50 with exact two-field rows, bounded valid commercial-shaped region names, no duplicates (including unrelated rows), only documented ENABLED/ENABLED_BY_DEFAULT/DISABLED/ENABLING/DISABLING statuses and null continuation. Every verified commercial Lake home region must have a row. Validate extra account-region rows but do not infer new Lake home regions or change the registry. Missing, malformed, partial, unknown or transitional required-region status refuses before any Lake call, with fixed safe reason/stage. us-east-1 itself must be enabled. A disabled target cannot be skipped as if deployment were viable.

Only confirmed enabled home regions enter existing four-wide Lake batches. Never call disabled regional endpoints. Preserve nonempty/partial/denied Lake refusal. On empty enabled pages with one or more disabled home regions, return observed conservative not-ready reason lake-regions-disabled, targetDataEvents unknown, lakeComplete false and auditReady false. Do not claim resources/configurations disappeared when a region was disabled. Complete all-enabled absence retains the old positive behavior and counts. Recheck the original account/role before any observed result, including disabled not-ready coverage.

Add frozen coverage facts: regionStatusesRead boolean and lakeRegionsDisabled count, alongside all old coverage fields. No raw API output, IDs, account/profile values, continuation tokens or errors in public diagnostics. Command failure has fixed region-status-unavailable and region-status stage in us-east-1; no retry/fallback. Existing identity behavior is unchanged, not executed live by this task.

## Ownership and review

Antigravity writes ONLY infra/cloud/audit-observations.ts and tests/unit/cloud-audit-observations.test.ts in its preserved dedicated CLI checkout on codex/agy-audit-region-status. File tools only; no Shell/RunCommand/Git/tests. Root owns this plan and the existing audit feature-doc amendment, runs Git/tests after worker exit under its runner lock, reviews implementation and integrates. Claude gets a real bounded independent read-only review after its recorded quota reset; preserve account/model/session/permissions and stop if cap recurs. Codex is sole final reviewer/integrator. No internal agents, CUA, Samaritan or council.

## Evidence required

Preserve all existing test assertions and controls; extend exact expected coverage objects with new facts, and add a complete enabled-status response to synthetic fixtures. Cover actual fixed argv/endpoint/projection/no-pagination; all-enabled28-region readiness; disabledaf-south-1 skipped but unknown/not-ready; mixed enabled/disabled counts and original identity recheck; disabledus-east-1 refusal; missing/duplicate/extra malformed/unknown/transitional/paginated status refusal before Lake; account/role drift; failure attribution/privacy; cancellation/deadline and no late regional batches after stop. No default profile, AWS/network or actual credentials in tests.

Root temporarily omits only disabled-not-ready classification; the meaningful disabled-case assertion must fail (audit-absent versus lake-regions-disabled or true versus false), restore exact bytes, then focused and existing regressions pass. Run pnpm/pinnedNode24.22.1 through test-window.py, type/format/shared and exact-source required hosted jobs. Independently review actual diff and evidence. Then normal no-force/no-reply merge with source/merge tree equality, separate actual-main jobs/logs/counters, closure/ProjectDone and guarded primary fast-forward. Preserve every peer source ref/worktree; only Root merge refs may be cleaned.

The canonical bounded diagnostic candidate/harness and their hashes remain byte-identical. No default app/runtime/dependency/workflow or deployment-policy weakening. This slice improves the evidence and error classification; it does not itself resolve the remaining inaccessible cross-region/organization audit question or authorize a live retry, provisioning or Cloud activation.
