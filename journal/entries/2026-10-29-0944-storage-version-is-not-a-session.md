# A storage version cannot restore a session

2026-10-29 09:44 IST. Previous: [Response identifiers stay observations](2026-10-29-0925-response-identifiers-stay-observations.md).

I integrated PR138 as5430f71 after its exact-source review and three hosted gates. All three actual main gates40815771203 passed separately. Issue137 and both Project cards are complete. The bounded response format preserves supplied observation integrity without proving a provider result, ownership or settlement. The failed review fixture remains recorded separately from corrected final checks.

I found a concrete storage decision before adding immutable writes. The current journal recognizes user_version1 and exactly one genesis table. Adding preparation/fence/observation tables silently would weaken its fixed-format recognition. Issue139's planb2e7afa came before this protocol change. I keep v1 intact for its current behavior and inspection, and choose a separately fixed future v2 initializer/catalog with no in-place migration or session upcast. An existing selected workspace remains preserved, including a stranded legacy initialization. A version field or reopened row cannot recover a fresh-process acknowledgement.

The original genesis and its revision0 remain immutable. Future v2 state needs its own actual coherent revision and bounded rows. The initial schema design does not prove that no intent/fence exists, that cleanup capacity fits or that any provider gate passed. I retain the2MiB/4MiB bounds and require real synthetic worst-case page/transaction/cleanup-reserve evidence before runtime claims. No actual database was opened.

I also distinguish logical metadata inspection from physical SQLite behavior. The file layer reads a held header; the storage layer validates versions and catalogs. Current DatabaseSync connections omit readOnly:true. A future classifier must inspect only bound headers before SQL, while recognized readers retain their separately reviewed recovery/settings behavior. I do not label that existing path physically write-free.

This change is documentation only. Runtime, tests, workflow and dependencies match the passing base. Formatting, relative links, source/protocol consistency and focused review precede the mandatory exact-head hosted gates. No v2 runtime, migration, current assessment, provider action or app acceptance is supplied.

## Decisions

- I preserve v1 and require a separate fixed fresh-v2 path, because catalog expansion must not adopt old workspaces or restore creation from metadata.
- I keep immutable genesis separate from actual mutable journal revision, because revision0 is original data rather than proof of no pending work.
- I require measured SQLite/cleanup capacity and actual recovery evidence before runtime claims; logical count arithmetic is insufficient.

## Direction changes

- Immutable preparation now has an explicit storage-evolution prerequisite. The original broader journal design did not define that transition.

## Needs revisit

- Issue30 still needs the exact v2 catalog and actual local storage/session evidence, actual current collector/phase/runway provenance, private preparation/fence, real bounded transport and complete provider ownership/teardown. Issue31/51, M2.2 and app/release acceptance remain open or stopped. Issue139 closes only this design choice.
