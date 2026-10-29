# Closed views keep their upload owner

2026-10-29 23:56 IST. Previous: [Cloud retention tolerates known upload races](2026-10-29-2233-cloud-retention-tolerates-upload-races.md).

I completed PR175/174 atbaee after all3 source40917707857 and separate actual-main40919628847 gates passed on first attempts, proof6503676649. I also integrated Antigravity's responsive workspace PR172/169 at74fcff after fresh frozenReady6503862517, focused review5702256566 and all3 source40921131306/main40923169809 first attempts, proof6504154806. Both original lifecycle/focus findings are fixed and independently reproduced as passing. Actual closure, Project status, primary/unknown-path preservation and Root-owned cleanup are verified; the active peer checkout/source100153 remain untouched. These are disabled development components, not a Cloud beta.

I planned issue176 before code. A locally closed draft session could only be reopened by creating another upload owner. An actual SQLite/service counterexample sent the same durable operation through two owners; after the older owner consumed its acknowledgement, the reopened view paused unnecessarily. Sixteen existing cases passed and the new counterexample failed. I retained that evidence separately.

The explicit reopen primitive now keeps the owner, original store/scope/signal, immutable operation and pause state while reading a fresh editable session. Concurrent opens share one read; cancellation or storage failure leaves the previous closed owner intact. Untouched empty captures create no row. Incidental mounting preserves authentication/network pause until explicit recovery. Put away keeps its established immediate local-retention/flush behavior and never waits for the response.

A stronger browser review found a second late remount after a direct same-owner reopen: a later unrelated parent render reset current undo state because two selectors owned session identity. I kept session/history reset in the existing note editor and made the upload effect follow the current session. The strengthened case proves both fresh history on reopen and stable current history across later parent renders, with normal automatic saves after Undo. Both red controls remain evidence.

Final49 model cases, sequential Node24Cloud558/39/shared773/77,66 browser cases, type/format/whitespace/build and unchanged default bundle pass. The earlier full pass precedes the renderer correction and is retained separately. Three new actual M0 IndexedDB/HTTP/SQLite flows cover held old ACK/newer typing, paused remount and mounted-view history; independent service reads confirm the final source. Existing assertions/defaults and worker/time/retry/isolation controls are unchanged. Source gates/integration/main proof still follow.

## Decisions

Keep one upload owner across its view lifetimes. Replace only a locally closed editing session, with captured scope and cancellation guards. Preserve explicit recovery and current undo state. Coordinate compatible shared APIs before code while leaving peer-owned files unchanged.

## Direction changes

None. The confirmed Local/Cloud contract and autosave behavior remain unchanged.

## Needs revisit

Issue176 exact-source review/gates/integration/main proof; authenticated parent/registry and enabled app composition. Real authentication, paid activation, full web/live/reconnect, native/iPhone/performance and actual M2.2 managed/independent teardown remain unmet. Expired allowances and stopped probes remain stopped; no actual/default user/operator store or provider was accessed.
