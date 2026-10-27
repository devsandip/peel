# Reviewed Cloud source observations

## Purpose and boundary

[Issue 47](https://github.com/devsandip/peel/issues/47), within [M2.2](https://github.com/devsandip/peel/milestone/2), supplies source/artifact facts to the [deployment-plan policy](cloud-deployment-guards.md). It supports SPEC FR-04/14/20 and AC-04/12/13 prerequisites. This PR has one purpose: bind reproducible deployment inputs to clean public main and its exact successful hosted checks. Account/quota/audit/ownership observations, atomic run slots, apply/recovery and managed proof remain issues 30/31. App Cloud and canonical v0.7 scope remain unchanged.

## Collection contract

Read only fixed Git metadata and public GitHub metadata for `devsandip/peel`, repository ID 1435686213. Require the existing origin to name that repository, local main, clean tracked/untracked status, HEAD/tree and origin/main matching the current remote main reference. Never fetch, pull, stash, reset or reflect unrecognized filenames, command output, credentials or raw errors into reports.

Use GitHub's [workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow) without filtering by success or head SHA: the latest main push must itself match the current commit and be complete/successful. Pin `.github/workflows/checks.yml`, repository identity and workflow ID; require exactly the three named successful jobs from that run's latest attempt using the [attempt jobs endpoint](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt). Bound counts and response sizes; do not silently paginate/truncate or select an older green result. Re-read the latest run/reference after building to reject superseding pushes/retries. This is a point-in-time observation, not a lock on GitHub.

Reuse `buildCloudLambda()` twice in memory. Require identical ZIP bytes/manifests, validated runtime/handler/architecture/manifest and the current tracked lockfile digest. Recompute the ZIP digest and byte count. Generate a fresh whole-second 90-minute lease only after builds/checks, render all five actual pure IaC factories for the explicit UUID and hash the complete template set. Read source/lock/status again before returning; drift fails closed. No original generated artifact path is overwritten or trusted as an input.

The command supplies only a fresh run UUID; it does not reserve a run slot or create resources. All subprocesses use argument arrays, fixed commands, bounded buffers/timeouts and a shared deadline; fixed failure codes contain no raw causes. Snapshot input values before awaiting. The command requires actual Node 24, checks that its output remains ignored, and creates a new private directory with exclusive restricted files for normalized observation, ZIP and templates. No real note/default database, AWS account or credentials are accessed.

## Acceptance and limits

Test a complete valid observation, dirty/branch/remote/repository drift, current-main/CI mismatch, latest retry/pending/failure, missing/duplicate/extra jobs, oversized/malformed responses, deadlines/clock failures, artifact/lock/manifest mismatch and immutable input snapshots. Verify a feature-branch invocation safely reports not-ready. Run relevant shared, TypeScript, formatting and existing artifact/template checks; all hosted jobs must pass before merge.

Any positive live observation is valid only for its captured source, run UUID, lease and metadata time. It proves neither a later clean state nor account, quota, audit, ownership, budget reservation, deployment or managed acceptance. The final guard must recheck all inputs immediately before any write; cleanup must never depend on a new-run source check.

## Validation

Eleven focused cases and all 197 shared cases in 36 files pass. TypeScript, formatting, web build, all five provider-schema template checks and actual Node 24 packaged checks pass. The focused cases also pass under actual Node 24; the command on its feature branch reports only `source-not-ready` and zero writes. The ZIP remains 336,713 bytes with the previously verified digest. Hosted gates and a positive clean-main metadata observation are recorded separately after integration. This attests ordinary reviewed build inputs, not a security boundary against a malicious local runtime/dependency installation.
