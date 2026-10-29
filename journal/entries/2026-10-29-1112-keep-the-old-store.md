# Keep the old store while moving its engine

2026-10-29 11:12 IST. Previous: [A catalog without a store](2026-10-29-1049-a-catalog-without-a-store.md).

I integrated the passive catalog in PR142 after all three exact-source gates40822868058 passed and review6488715728. Main is1a0a83c. Issue141 and both Project cards are complete. It remains SQL data and physical capacity evidence, with no protected v2 store or execution permission.

I kept the next change small. Issue143 moves the entire v1 implementation byte-for-byte to an internal engine module. The original public path re-exports the same store and error constructors. I changed no schema, settings, hook, transaction, sync/close ordering, source acknowledgement or private session behavior. This makes later fixed-format sharing reviewable without quietly generalizing v1.

Before the move, the actual old public API created one fresh private synthetic namespace. After the move, a fresh process reopened that exact database through the same public path. Original genesis, database/marker bytes, header, catalog and persistent page metadata matched. Public/internal constructor and error identities matched. I then removed only that newly owned workspace. This is compatibility evidence, not actual funding/source acknowledgement or current permission.

Actual Node24 direct/394 Cloud tests then609 shared/type/format/build pass sequentially. Existing namespace, lost-ACK, process-race and SIGKILL cases remain unchanged. There is no failed positive run in this slice; the browser chunk warning remains. Focused review and exact-head hosted gates still precede normal integration. The app and all stopped real gates remain unchanged.

## Decisions

- I move existing bytes before adding future fixed-v2 behavior, so v1 compatibility is reviewed separately.
- I retain the public re-export path and exact constructor identity, because source/session consumers and their spies already use them.

## Direction changes

None. The separate extraction follows the fixed-storage transition plan.

## Needs revisit

- Issue30 still needs actual protected v2 bootstrap/readers and ACK/crash evidence, private current assessments, preparation/fence, real transport and complete managed/independent teardown. Issue31/51 and M2.2 remain open or stopped. Issue143 closes only this internal compatibility prerequisite.
