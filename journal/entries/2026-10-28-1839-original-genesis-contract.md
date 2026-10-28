# Original journal genesis contract

2026-10-28 18:39 IST. Previous: [Shared SQLite mechanics after branding](2026-10-28-1738-sqlite-mechanics-shared.md).

I split the next [genesis work](https://github.com/devsandip/peel/issues/114) into pure original-data validation, private namespace/bootstrap mechanics and actual source-acknowledged persistence. The first slice defines canonical original bytes and the independent funding reservation anchor. It cannot open a database, authenticate a caller-supplied reservation, acknowledge source files or grant execution.

I retained the original recipe/context snapshots and reused their historical codecs. An original plan must agree with the independent run/slot/plan/time/authority tuple. The global funding ledger can stay outside a per-run workspace. Journal selection is deterministic; actual filesystem identity and exclusive bootstrap remain future work.

The initial broader test run exposed an old concurrency test assuming someone must always win. I kept that failure visible and fixed its verification contract separately in PR117: zero-timeout contention can refuse both writers. A real held-reader case proves that outcome without consuming a stored slot; actual acknowledged identity and durable counter are still checked. Production funding code did not change. The precise interleaving of the first failure remains unproven.

The pure slice now passes260actualNode24 Cloud cases and475shared cases, plus type/format/build. Its original canonical bytes are independently pinned and an omitted plan comparison fails the intended negative control. Final hosted gates and merge still follow this local evidence. No persistent journal, provider resource or app feature is accepted from those fixtures. M2.2 and the stopped managed/native/peer gates remain open.

## Decisions

- I kept data integrity separate from store provenance, acknowledged source synchronization and execution capabilities.
- I corrected the concurrency verification in its own small PR without adding production retries or changing timeouts.

## Direction changes

None in product scope. The original genesis contract is now a separate pure slice before physical persistence.

## Needs revisit

- [Issue115](https://github.com/devsandip/peel/issues/115): final hosted gates and standalone merge.
- [Issue114](https://github.com/devsandip/peel/issues/114): actual hardened namespace/bootstrap/source-bound storage and real process/crash evidence remain.
- [M2.2](https://github.com/devsandip/peel/milestone/2): audit and managed/independent teardown still unproven; no completion report is due.
