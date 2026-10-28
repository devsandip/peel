# A consumed run needs current phase evidence

2026-10-28 22:30 IST. Previous: [Acknowledgements stay in the original process](2026-10-28-2200-fresh-session-acknowledgement-lineage.md).

I merged PR 130 after all three checks passed on its revised head. All three merged-main checks passed separately. The local session now preserves its own reservation and genesis acknowledgement lineage, with closed nested policy structure before application path access. It still supplies no current provider approval or send permission.

I separated the next design question into issue 131. A new-run absence check cannot simply repeat after the guard exists. Later phases need exact original operation, ownership and settlement evidence for expected resources, plus full absence of resources not yet created. Existing metadata and collision adapters remain unproven.

The fresh-reservation start and plan-age checks also cannot run again after the sentinel rehearsal. Later work keeps the original absolute readiness, stop, expiry and cleanup times and requires fresh current observations. It never creates another slot or restamps the original plan. Raw quote DTOs do not establish official origin. A separate authenticated current assessment cannot renew the original quote or silently accept drift.

This is a documentation refinement. Runtime, tests, workflow and dependencies are unchanged. Relative links and formatting pass locally; required exact-head PR checks and focused review still precede integration. M2.2, actual managed smoke and independent teardown remain open. Stopped probes remain stopped.

## Decisions

- I separated original integrity, local acknowledgement lineage, actual current collector provenance and phase-specific provider evidence.
- I kept global absence before the first guard and required exact proven-owned inventory at later boundaries.
- I retained original time and quote commitments rather than replaying new-run validation against invented empty state.

## Direction changes

Current gating was a general future requirement; it now has a phase/provenance contract before an eligibility implementation. Product scope is unchanged.

## Needs revisit

- [Issue 131](https://github.com/devsandip/peel/issues/131): focused review, exact-head checks and normal integration.
- [Reserved-run gates](../../docs/features/cloud-reserved-phase-gates.md): initial-guard policy, actual private collector provenance and later provider proofs remain unimplemented. No pure DTO is a current permit.
- [M2.2](https://github.com/devsandip/peel/milestone/2): trusted preparation/fencing/transport and actual owned cleanup/teardown remain; current account/budget authorization is not renewed.
