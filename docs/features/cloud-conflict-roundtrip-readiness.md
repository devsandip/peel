# Settle the original owner before stale-selection evidence

[Issue 230](https://github.com/devsandip/peel/issues/230) is a focused current-M2.2 prerequisite for manual recovery 228/PR 229, linked to SPEC FR-13 and the [roundtrip plan](cloud-conflict-roundtrip.md) and [controller plan](cloud-conflict-resolution.md). This plan precedes code.

## Observed failure and boundary

PR 229 exact-source run 41213269698 at35bcacdecdd1c82dfde8465fe0b51432e6bbf511 passed all nine panel cases but failed the existing stale-selection roundtrip assertion: expected stale, received busy. The test typed a newer conflict draft, waited for durable text and put the editor away, then immediately attempted the stale resolution. Put away permits a retained upload owner to keep settling; it does not establish resolutionReady. The controller correctly refuses a busy owner.

Root owns only this plan and the stale-selection case in tests/e2e/cloud-conflict-roundtrip.spec.ts on a separate clean Root branch. Wait on the fixture's existing ownerQuiet(noteId), which queries the real original retained upload's resolutionReady. Keep every original busy/stale/no-send/both-branches/fresh-resolution assertion, and all default timeouts, retries, workers and isolation. Do not change runtime, fixture semantics, controller policy, dependencies or default routes. Root226 uncommitted work in review-pr211 is separate and must remain untouched.

## Evidence and integration

The recorded hosted119/120 failure is the observed missing-readiness evidence, not passing evidence or a reason for a blind retry. Run the focused old case and existing browser regressions with pinned Node24 on a strict dedicated owned port under test-window and peer lock; types/format/whitespace and scope/no-reply scans. Obtain independent review of this Root change and fresh exact-source/all3 and separate actual-main jobs/logs/counters. Merge normally, guard primary fast-forward and clean only Root-owned integration refs. Then normally merge this verified dependency into229 and obtain fresh source gates; do not reuse its failed old-head CI or alter Root226WIP.

No new test cases, default time controls, provider/profile operations or Cloud activation. Actual51/30/31 remainOPEN/Blocked; this focused readiness fix is not actual audit/managed acceptance.
