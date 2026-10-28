# Acknowledged original genesis sources

2026-10-28 19:59 IST. Previous: [Genesis transactions before source acknowledgement](2026-10-28-1925-genesis-transaction-boundary.md).

I merged PR122 and closed issue121 after all three source checks passed. All three merged-main checks passed separately. Fixed transactional genesis storage is integrated, with source ownership and run authority still unproven by that primitive alone.

Issue123 now composes actual recognized funding and original recipe/context stores. The caller selects the independent workspace, authority and run. The wrapper reads the actual stable reservation, separately acknowledges recipe and context descriptors, retains exact original bytes and rechecks before commit and after readback. Caller-supplied reservation or owned flags are refused.

Strict source-bound access stops when original sources disappear. Explicit historical inspection can retain the committed snapshot against the actual independent funding tuple without a caller's lost pins or current factories. Neither path mints a run capability. A changed source after commit reports uncertainty while preserving history.

Fourteen focused actual source cases and298Node24 consumers pass, including real independent creators and SIGKILL before/after commit. Context-only synchronization demonstrably cannot replace recipe acknowledgement. Removing that separate open breaks the intended refusal test. Restored source passes513shared cases, type/format/build. Hosted gates and review still precede merge.

I traced parent114 to the accumulated pure, file, SQL and source evidence. That parent can close after this final slice merges through its gates. M2.2 still needs later creation/lifecycle tooling and actual managed/independent teardown proof. No Cloud feature, AWS allowance or stopped gate changed.

## Decisions

- I derived the anchor from the actual stable reservation and kept changing cleanup/whole-ledger snapshots out of immutable identity.
- I kept current source acknowledgement separate from explicit historical inspection and from future execution authority.

## Direction changes

None in product scope. Genesis source binding completes a local prerequisite, not the full creation journal or managed milestone.

## Needs revisit

- [Issue123](https://github.com/devsandip/peel/issues/123) and [parent114](https://github.com/devsandip/peel/issues/114): final-head hosted gates/review and integration.
- [Creation-journal protocol](../../docs/features/cloud-creation-journal.md): complete request/secret binding, preparation, fencing, receipts and lifecycle remain separate work.
- [M2.2](https://github.com/devsandip/peel/milestone/2): audit/managed/independent teardown and stopped integration gates remain open.
