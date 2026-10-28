# Initial guard facts stay unproven

2026-10-28 23:21 IST. Previous: [A consumed run needs current phase evidence](2026-10-28-2230-reserved-run-phase-evidence.md).

I merged PR 132 after all three checks passed on its revised protocol head. The merged tree equals that tested source and runtime code is unchanged. The existing main workflow filtered this documentation-only push. That is a not-run result, not a passing main run.

I then committed issue 133's plan before generating fixtures or code. I now check supplied original genesis, full consumed-ledger metadata and current facts for the initial guard only. The checker does not reserve again or replay new-run validation against invented history. Original birth ages stay attached to original reservedAt; later time uses the unchanged first-guard window and fresh observations.

The supplied ledger must have the original selected latest pending run and consistent authority, hashes, receipts and envelope. Identity, source, checks, credential runway, original quote age and initial absence facts must match the contract. The result is a small frozen projection with every current and ownership authority unproven. No account, file, source synchronization, private session or provider permission is obtained. A positive remaining millisecond does not establish adequate runway.

The synthetic first/second-slot metadata came through actual public APIs in a fresh temporary ledger, which was removed. An independent serializer pinned both 1204-byte result commitments before the checker existed. All 27 focused cases pass with filesystem, SQL, process, network and randomness denied. Omitting the active-pending condition fails a coherent cleaned-run refusal. The exact source was restored. Actual Node 24 passes 361 Cloud cases and the shared suite passes 576, then type, formatting and build. Final-head review and hosted gates precede integration.

## Decisions

- I kept supplied-data consistency separate from actual collector provenance, source acknowledgements, private current assessment and dispatch.
- I normalized consumed ledger data rather than fabricating a new-run prior or minting another slot.
- I retained explicit unproven authority even when all provided data is coherent.

## Direction changes

The phase design is merged; the first narrow facts checker now has local code evidence. Product scope is unchanged.

## Needs revisit

- [Issue 133](https://github.com/devsandip/peel/issues/133): focused review, exact-head checks and normal integration.
- [Phase/provenance gates](../../docs/features/cloud-reserved-phase-gates.md): actual private collectors, current journal state, source synchronization and adequate phase budgets still precede trusted preparation/fencing.
- [M2.2](https://github.com/devsandip/peel/milestone/2): actual managed smoke and independent teardown remain unproven. Stopped components and expired real budgets remain unchanged.
