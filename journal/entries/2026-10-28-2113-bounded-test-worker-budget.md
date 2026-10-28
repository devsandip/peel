# A fixed budget for test workers

2026-10-28 21:13 IST. Previous: [Acknowledged original genesis sources](2026-10-28-1959-acknowledged-genesis-sources.md).

I merged PR124 and closed source issue123 and genesis parent114 after all three source checks passed. All three merged-main checks passed separately. Original genesis is now bound to actual recognized local funding and separately acknowledged source stores. It remains a prerequisite, not provider execution or app acceptance.

I saved the next pure request feature125 locally after thirteen focused cases and independent Python golden commitments. Its first full Cloud run timed out in one unchanged context-storage test. That case passed alone, and four-worker runs passed all311prospective Cloud cases and526shared cases. I kept the first failure visible. The complete external CPU/I/O cause remains unproven.

I split verification scheduling into issue126. It caps Vitest at four file workers and keeps every timeout, assertion, include and actual independent-process case unchanged. The main-only configured defaults pass298Node24 Cloud cases and513shared cases, plus type/format/build. Hosted gates and focused review still precede merge.

## Decisions

- I bounded file scheduling instead of extending correctness timeouts or adding retries.
- I kept the request feature saved and Blocked until the separate verification fix integrates.

## Direction changes

Test file concurrency was derived from available host parallelism; it now has a fixed four-worker budget. Product scope is unchanged.

## Needs revisit

- [Issue126](https://github.com/devsandip/peel/issues/126): final-head checks/review and integration.
- [Issue125](https://github.com/devsandip/peel/issues/125): rebase the saved branch and finish its own combined defaults/review/gates.
- [M2.2](https://github.com/devsandip/peel/milestone/2): creation coordination/lifecycle and actual audit/managed/teardown remain open; stopped probes stay stopped.
