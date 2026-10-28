# Original requests without a secret checkpoint

2026-10-28 21:25 IST. Previous: [A fixed budget for test workers](2026-10-28-2113-bounded-test-worker-budget.md).

I merged PR 127 after all three exact-source checks passed. It bounds test file scheduling without changing timeouts, assertions or actual independent-process cases. I resumed the saved request feature on that main.

I now bind all four intended CreateStack inputs to their original context, recipe, stack identity and token. The contract fixes fields, defaults, explicit absence, original templates, tags, capabilities and phase deadlines. It generates no key or token and grants no provider permission. A trusted future wire adapter still needs actual SDK serialization and signing evidence.

The data request takes its transient NoEcho value only in memory. Safe metadata carries an opaque commitment and an explicit missing-material slot. Copied metadata, readback and a separate process cannot recover the value. Discard drops the internal reference; it does not claim physical memory erasure or control caller copies.

The configured defaults pass 311 actual Node 24 Cloud cases and 526 shared cases, then type, formatting and browser build. Independent Python golden commitments cover all four requests. Omitting the transient value from the commitment fails the intended changed-value assertion. The earlier unchanged-test timeout remains failed evidence, and its complete external cause remains unproven. Final-head hosted checks and focused review precede this request's integration.

## Decisions

- I kept complete request binding separate from durable preparation, dispatch and provider execution.
- I retained secret-bearing input behind private active handles and made safe readback incapable of reconstructing it.
- I kept the first timeout visible and validated new configured defaults after the separate scheduling fix.

## Direction changes

The request branch was blocked by scheduling verification; it now resumes on the merged scheduling fix. Product scope is unchanged.

## Needs revisit

- [Issue 125](https://github.com/devsandip/peel/issues/125): exact-head review, hosted gates and normal integration.
- [Creation journal](../../docs/features/cloud-creation-journal.md): a same-process actual reserve/bootstrap acknowledgement must precede any later preparation session. Recovered records do not provide that proof.
- [M2.2](https://github.com/devsandip/peel/milestone/2): managed smoke and independent teardown remain unproven. Stopped probes stay stopped.
