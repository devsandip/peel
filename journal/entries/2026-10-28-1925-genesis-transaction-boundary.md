# Genesis transactions before source acknowledgement

2026-10-28 19:25 IST. Previous: [Journal files before transactional genesis](2026-10-28-1902-journal-file-boundary.md).

I merged PR120 and closed issue119 after all three source checks passed. All three merged-main checks also passed. Strict file ownership and exclusive creation are integrated; parent114 still needs complete original-source binding.

Issue121 adds one fixed SQLite genesis table and header. It commits schema and exact original bytes together, then synchronizes held files and reads back. Existing paths never initialize. Before-commit SIGKILL leaves preserved incomplete state; after-commit SIGKILL and lost acknowledgements recover exact original bytes without another bootstrap or a run capability.

The storage primitive validates supplied anchors structurally. It still cannot authenticate the actual funding reservation or substitute for separate acknowledged recipe/context opens. Those are the next wrapper. I kept returned authority unproven and avoided future intent/token/fence tables.

Ten storage cases and284actualNode24 consumers pass. One concurrent shared run timed out in the unchanged peer-inventory test. It passed alone, and a separate full run passed all499cases. I kept the first failure visible and changed no peer logic or timeout. Type/format/build pass. Hosted gates and review remain before integration.

## Decisions

- I kept one immutable genesis table and left later schema transitions to their own reviewed slices.
- I tested physical payload capacity separately from valid genesis and retained the2MiB/4MiB limits.

## Direction changes

None in product scope. Actual source acknowledgement remains separate from local record persistence.

## Needs revisit

- [Issue121](https://github.com/devsandip/peel/issues/121): exact-head hosted gates, review and merge.
- [Issue114](https://github.com/devsandip/peel/issues/114): actual canonical funding/source binding and independent source acknowledgements remain.
- [M2.2](https://github.com/devsandip/peel/milestone/2): actual audit/managed/teardown evidence remains open; stopped gates stay stopped.
