# Preserve immediate Cloud retention during upload races

[Issue174](https://github.com/devsandip/peel/issues/174) follows verified PR173 (source40910952734/main40912555135 all3 first attempts, proof6502648584). This plan precedes code. SPEC FR-02/04/05/14 and AC-02/04/13 prerequisites, [draft retention](cloud-draft-session.md), [automatic upload](cloud-note-upload.md) and [cached library](cloud-cached-library.md) control this slice.

## Observed failure and scope

Peer PR172's published ab64 web job123584960900 passes both workspace fixes but fails the unchanged cached-library immediate typing/Put-away case62, with60/61 browser cases passing. Existing main separately passes. Hypothesis, not demonstrated cause: a concurrent legitimate upload preparation/acknowledgement advances the local generation between draft retention read and CAS, unnecessarily surfacing recovery. Antigravity owns only its new workspace files; Root owns this existing shared boundary and must not hide this failure with a wait-for-Saved precondition.

## Plan before implementation

1. Use an explicit fresh owned SQLite store and deterministic commit/read gates to reproduce preparation or acknowledgement advancing the generation while typing/Put away retains a newer draft. Preserve a red result and inspect actual state. If this does not explain the browser failure, investigate before changing runtime.
2. Make the smallest correctness change. A bounded reobservation may recover only after actual newer generation with the expected unchanged current projection is verified. Preserve immutable in-flight operation and concurrent remote/conflict metadata through the existing validated client save. Different text/account, unproven write outcomes, storage failures and repeated contention remain recovery rather than guessed adoption or blind retry.
3. Cover conservative negatives and older ACK/newer typing. Keep every edit immediately retained, existing200ms Cloud batching/no Save button, Put away independent of response latency and Saved only matching current confirmation. Add a controlled actual browser interleaving if needed; preserve all old assertions/defaults/timeouts/retries/workers/isolation.
4. Run focused existing/new session/upload cases, sequential relevant Node24 Cloud then shared, browser, type/format/whitespace/build/default-bundle checks. Stage explicit owned files/scans/no-reply author AND committer, review exact public source/all3 required hosted gates, normal merge, separate actual-main/closure/Project proof and owned-only cleanup. Backfill173 final proof in WORKLOG/new immutable journal/INDEX; preserve frozen2150.

## Boundaries and remaining acceptance

No new workspace UI/CSS/plan/browser files owned by Antigravity, UI contract/protocol/schema/dependency/default route or provider changes. Default Cloud stays unavailable. No actual/default user/operator DB/profile/credentials/native launch/provider/expired allowances/stopped probes. Real authentication/paid activation/full web/live/reconnect/native/iPhone/performance and M2.2 managed/independent teardown remain unmet. Coordinate issue169 and local test windows; no spawned agents or unrelated-process cleanup.
