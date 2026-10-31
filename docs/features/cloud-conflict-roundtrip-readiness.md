# Settle the original owner before stale-selection evidence

[Issue 230](https://github.com/devsandip/peel/issues/230) is a focused current-M2.2 prerequisite for manual recovery 228/PR 229, linked to SPEC FR-13 and the [roundtrip plan](cloud-conflict-roundtrip.md) and [controller plan](cloud-conflict-resolution.md). This plan precedes code.

## Observed failure and boundary

PR 229 exact-source run 41213269698 at35bcacdecdd1c82dfde8465fe0b51432e6bbf511 passed all nine panel cases but failed the existing stale-selection roundtrip assertion: expected stale, received busy. The test typed a newer conflict draft, waited for durable text and put the editor away, then immediately attempted the stale resolution. Put away permits a retained upload owner to keep settling; it does not establish resolutionReady. The controller correctly refuses a busy owner.

Root owns only this plan and the stale-selection case in tests/e2e/cloud-conflict-roundtrip.spec.ts on a separate clean Root branch. Wait on the fixture's existing ownerQuiet(noteId), which queries the real original retained upload's resolutionReady. Keep every original busy/stale/no-send/both-branches/fresh-resolution assertion, and all default timeouts, retries, workers and isolation. Do not change runtime, fixture semantics, controller policy, dependencies or default routes. Root226 uncommitted work in review-pr211 is separate and must remain untouched.

## Evidence and integration

The recorded hosted119/120 failure is the observed missing-readiness evidence, not passing evidence or a reason for a blind retry. Run the focused old case and existing browser regressions with pinned Node24 on a strict dedicated owned port under test-window and peer lock; types/format/whitespace and scope/no-reply scans. Obtain independent review of this Root change and fresh exact-source/all3 and separate actual-main jobs/logs/counters. Merge normally, guard primary fast-forward and clean only Root-owned integration refs. Then normally merge this verified dependency into229 and obtain fresh source gates; do not reuse its failed old-head CI or alter Root226WIP.

No new test cases, default time controls, provider/profile operations or Cloud activation. Actual51/30/31 remainOPEN/Blocked; this focused readiness fix is not actual audit/managed acceptance.

## Local evidence

Root ran the original stale-selection case (1/1) and all 42 existing preview/workspace/status/roundtrip browser cases on strict owned localhost port65526, pinned Node24.22.1, default test controls and test-window/peer locks; all passed. Types, owned formatting and whitespace passed. The only spec diff is ten added lines waiting on the existing real owner readiness condition; all original busy, stale, no-send, preserved-branch and successful fresh-resolution assertions remain. No runtime code or fixture changed, so no new production build or local shared-suite result is claimed for this test-only slice. Independent review and fresh source/actual-main required jobs remain pending. The earlier hosted busy-versus-stale failure is retained as the observed missing-readiness evidence.
