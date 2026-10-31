# Bounded audit packet synthetic CI replay

[Issue 223](https://github.com/devsandip/peel/issues/223) is one offline validation slice under [audit51](https://github.com/devsandip/peel/issues/51) / [M2.2](https://github.com/devsandip/peel/milestone/2), supporting SPEC FR-04/14/20 and AC-04/12/13 prerequisites. This plan precedes code. The [bounded packet](cloud-audit-bounded-diagnostic.md) remains the sole canonical candidate and synthetic harness, not an app or provider entry point.

## Scope and ownership

Antigravity owns only scripts/check-cloud-audit-diagnostic.mjs and tests/scripts/cloud-audit-diagnostic.test.mjs. Codex owns this plan, the existing checks workflow and a small dated runbook validation amendment after implementation. Existing candidate/harness bytes, helpers, dependencies, default test controls, required jobs and permissions stay unchanged. Root alone reviews, runs Git/tests after worker exit under runner lock, publishes and integrates.

## Behavior

Extract exactly one complete JavaScript candidate block and one complete text harness block from the canonical runbook. Check the reviewed candidate918a9f49d574da9b7f6d5c4c5dc385eb67debaf46bbfe83b259e4b6fc6b9437c and harness1a38efac554b006ffc911dbd8ef76a9bfb6cd862b7cbc7a4d395c5a467621ad5 SHA256 pins before any file publication or child execution. Missing, duplicate, malformed or changed source refuses privately. Export a pure extraction function for focused builtin Node tests, with CLI side effects guarded by exact entrypoint identity.

The CLI requires pinned Node24.22.1, uses a fresh private unique folder directly under ignored repo/scratch (candidate relative helper paths remain correct), writes the exact extracted source/harness and a fixed isolated Vitest config, then runs ONLY that harness using existing dependencies/current Node. No package/runtime acquisition. Use only fixed synthetic empty child home/config/credential paths and necessary non-sensitive process environment; no actual profile/config/default inputs. Never run the candidate CLI or pass an execution flag. Keep maxWorkers4 and existing default timeouts/retries/isolation. Collect structured Vitest evidence and require exactly28 passed, zero failed/pending/todo cases. Runner failure, no tests, skips or malformed evidence fail. Always clean only the uniquely owned temporary folder; preserve all other scratch/user/peer paths. Public output fixed synthetic status/counts only.

## Evidence and integration

Builtin Node tests cover actual canonical extraction, changed candidate/harness, missing/duplicate/unterminated/wrong fences and fixed refusal. Root removes only the candidate hash check to prove the corresponding tamper case fails, then restores exact source and passes tests. Run pinnedNode24 builtin tests and actual exact28-case replay under test-window.py, plus relevant type/format/shared checks. Do not weaken the existing28case harness or assertions. Wire two small steps into cloud-artifact after dependency installation, with no other workflow policy change. Required source and separate actual-main jobs/logs/counters must include the new replay before normal no-force integration and actual closure/ProjectDone/guardedprimaryff.

No actual provider/profile command, stopped probe, expired allowance renewal, audit observation, deployment or Cloud activation is authorized. Actual51/30/31 remainOPEN/Blocked; a three-region synthetic fixture is never real audit coverage, historical cause, ownership or teardown authority.

## Local implementation and review

Antigravity implemented only the two assigned files through file tools. Codex reviewed the actual code, added the two workflow steps and dated runbook amendment, and corrected the CLI error boundary to emit only the fixed refusal instead of an uncaught stack. No denied command, policy broadening or real provider/profile access occurred.

Actual pinned Node24.22.1 passes7 builtin extraction/report tests, the exact28-case replay, shared1120/89 files, type checking, formatting, syntax and whitespace. Removing only the candidate-hash guard makes the changed-candidate refusal assertion fail; the exact original script is restored and all7 plus28 pass. A separate missing-runner probe fails with the fixed public error, removes its owned temporary folder and restores the exact script. Extra CLI arguments refuse without execution. No existing harness assertion or test control changed. The candidate/harness pins remain the reviewed values above.

Source and separate main hosted evidence are still pending; these local results grant no audit/provider/managed/cleanup acceptance. Root remains sole final reviewer/integrator, with Antigravity independently checking Root-owned integration changes before publication.
