# Automatic edits are batched

2026-10-29 17:35 IST. Previous: [Editing reaches server confirmation](2026-10-29-1717-editing-reaches-server-confirmation.md).

Sandip reaffirmed the existing approach, then clarified automatic saving: no dedicated Save button, every addition or deletion persists, and network writes may be batched. I recorded that clarification in1745d58 before implementing it in the same issue162/PR163.

I retain local drafts immediately and start a fixed200ms Cloud window after the first retained edit. Later typing does not reset the window. Put away flushes a scheduled attempt without waiting for the response. Authentication/network/conflict failure pauses automatic scheduling; Retry is recovery, not the normal saving action. Account cancellation removes its timer.

I also corrected two review findings. A browser regression first showed upload recovery outside the paper note; it now sits inside the existing note body. A real SQLite generation race first paused normal newer typing during asynchronous mutation preparation. I now reobserve a proven higher local generation in a new window; unknown failures and failed network requests still do not automatically retry. The current projection must pass the existing session checks before a request can be prepared.

The earlier observer-cancellation failure, body-notice failure and generation-race failure remain separate evidence. Final focused Node24 tests pass33/2, including16 new upload cases. Node24 Cloud444/35 then shared659/73 pass sequentially, all41 browser cases pass, and type/format/build pass. The default bundle and legacy assertions/defaults remain unchanged.

PR163 is temporarily a draft while this changed head gets its own review and hosted gates. The earlier15a source checks cannot authorize these later changes. This remains a synthetic browser/HTTP/SQLite integration; actual authentication, complete web library/live, native/iPhone and managed teardown are not accepted or enabled.

## Decisions

- I use a non-resetting200ms window so bursts coalesce and continuous typing cannot postpone uploads indefinitely.
- I keep local retention immediate and error recovery inside the note body, with no normal Save button.
- I reobserve proven local generation progress without converting unknown outcomes into success or retrying failed network requests automatically.

## Direction changes

Automatic post-retention sends were immediate; they now use the confirmed short batching window. Put away and explicit recovery can flush it immediately.

## Needs revisit

- Issue162/PR163 requires fresh exact-head source review/gates, normal integration and actual-main proof. Real authenticated parent/sender bounds/reconnect/full inventory/live/platform and M2.2 teardown gates remain. Stopped probes and expired allowances remain untouched.
