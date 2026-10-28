# Journal files before transactional genesis

2026-10-28 19:02 IST. Previous: [Original journal genesis contract](2026-10-28-1839-original-genesis-contract.md).

I merged PR118 and closed issue115 after all three exact-source checks passed. All three merged-main checks also passed. The pure original-genesis contract is integrated; parent114 still needs actual storage and source acknowledgement.

I split the next physical boundary into file ownership and transactional storage. Issue119 creates only exclusive journal namespace files under a canonical private workspace. Held descriptors bind workspace, journal directory and database identities. Existing paths always refuse creation. Partial state stays preserved. Explicit file inspection cannot recognize a complete SQLite journal or mint a run permit.

Fourteen focused cases cover actual competing creators, copied/replaced paths, strict modes/UID/links, bounded canonical marker/rollback files, partial creation and failed synchronization. Removing the inode comparison breaks the intended refusal check. Restored source passes274actualNode24 consumers and489shared cases, plus type/format/build. Hosted gates and review still follow this local evidence.

The file boundary is another operator prerequisite. It does not enable Cloud in the app. Fixed SQL header/schema/genesis transactions and separate source opens remain next. No AWS allowance, lease or stopped integration gate changed.

## Decisions

- I kept strict file ownership separate from SQL bootstrap and actual cross-store acknowledgement so each has one review purpose.
- I kept empty files explicitly incomplete and returned no execution capability from creation or file synchronization.

## Direction changes

The prior namespace/bootstrap slice is now a file-boundary PR followed by fixed transactional bootstrap. Product scope is unchanged.

## Needs revisit

- [Issue119](https://github.com/devsandip/peel/issues/119): final hosted checks, focused review and standalone merge.
- [Issue114](https://github.com/devsandip/peel/issues/114): SQL bootstrap, actual bound sources and genesis crash/lost-ack recovery remain.
- [M2.2](https://github.com/devsandip/peel/milestone/2): audit and actual managed/independent teardown evidence remain open.
