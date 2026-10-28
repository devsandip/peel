# Bounded unit-test file scheduling

[Issue126](https://github.com/devsandip/peel/issues/126) is one verification fix in [M2.2](https://github.com/devsandip/peel/milestone/2), under issue30. It supports [SPEC](../SPEC.md) FR-04/14/20 and AC-04/12/13 prerequisites. This plan precedes code. The request feature125 is saved on its own unpublished branch and waits for this dependency; it is not bundled here.

## Evidence and one change

The prospective125actualNode24 consumer run has310passes and one unchanged context-storage5000ms timeout, with5604ms observed. That unchanged test passes alone in1.15seconds total. Explicit four-worker runs then pass all311prospective Cloud cases/27files and526shared cases/65files. The earlier121concurrent run also retains an unchanged peer-inventory timeout. The exact external CPU/I/O contributors remain unproven; neither failed run is relabeled as passing.

Set only the existing Vitest unit configuration maxWorkers4. [Vitest](https://vitest.dev/config/maxworkers) otherwise derives worker concurrency from available parallelism; a fixed budget reduces overlapping durable-filesystem suites across hosts. Keep includes, isolation, assertions, per-test timeouts, retries and test bodies unchanged. In particular, actual independent processes, held-reader barriers and SIGKILL within each case remain concurrent as written. No production, native, browser-flow or provider behavior changes.

This controls verification resources rather than extending a correctness deadline. It is not an app performance claim or proof of the first timeout's complete cause. Do not add a config-mirroring test; validate the real existing suites.

## Sequence

1. Commit this plan, with126In progress and125Blocked, before the config change.
2. Set the four-worker file budget without a timeout/retry/skip or test change. Confirm production/test modules are byte-unchanged from main.
3. Run the main-only actualNode24 Cloud cohort, normal pnpm test, type/format/build using configured defaults. Keep these results separate from the prospective125CLI4experiment. Retain all actual process cases.
4. Focused review, scans, no-reply author AND committer and all3required exact-head hosted gates precede normal merge. Update issue/Project and verify actual main separately.
5. Rebase and resume saved125, rerun its combined defaults and finish its own focused request PR. No milestone/app acceptance follows from test scheduling.

No real/default note/operator files, account/AWS/budget/billing/app activation or stopped probe. M2.2/audit51/managed31/native72 and all release gates remain open or stopped. Existing [test timeout](https://vitest.dev/config/testtimeout) settings remain unchanged.

## Main-only validation

Configured defaults pass all298actualNode24 Cloud cases/26files and513shared cases/64files, followed by type/format/build. Existing browser chunk warning remains. Every production and test module compares byte-unchanged with main; the sole semantic config change is maxWorkers4. No retry, timeout, isolation, include or test-body change. The prospective125CLI4results above remain separate evidence for its saved branch, not this PR's case count. Required exact-head hosted gates and focused review still precede merge.
