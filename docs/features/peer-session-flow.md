# Mutual readiness and duplex peer flow

## Requirements and plan

FR-13/14/17/19, AC-04/09/12/21. The current isolated harness authenticates both endpoints through a shared test coordinator and rejects overlapping application packets while a commit is pending. Establish an explicit per-connection readiness and credit protocol without app integration or another live relay/native probe.

1. Add a strict bounded control codec and a small session state machine. After its own durable verified claim, each endpoint sends Ready with one receive credit. Each acknowledges the other's Ready. Data requires both Ready messages and acknowledgements, bound to the current session. A peer Ready can wait for local verification; it cannot grant early note access.
2. Permit at most one outgoing unacknowledged note packet and one incoming packet/commit per direction. Encode durable receipts as body-free session controls so they can arrive while the opposite-direction note commit is pending. Reject unsolicited, mismatched or overlapping data and receipts. Release outbound credit only after processing the matching durable receipt locally; release inbound credit only after its receipt is handed to transport following commit.
3. Keep binary note frames serialized per direction, retain bounded assembly/drain/receipt timeouts and existing byte limits, and check current trust before outgoing controls/frames. Lost receipt, failed/quarantined commit, closure or expiry never clears the durable outbox. A new connection needs fresh proofs/readiness; it does not restore an active handle.
4. Integrate the state machine into the same-page Chrome harness. Remove the test coordinator's requirement that both peers finish authentication before either can progress. Test delayed local claim, early data, simultaneous edits with one held recipient commit, receipts during that commit, lost receipt/retry and wrong-session controls. Changed installed descriptions invalidate the bound connection; renegotiation requires a fresh proof/session.
5. Preserve existing trust, draft and durability contracts. Record unit and real-channel evidence with exact scope. Different networks, native/iPhone, production pairing/signaling, clock policy, inventory and app integration remain open.

## Decisions and limits

Use one credit rather than an unbounded in-memory note queue. Local durable delivery state remains the source of retries; callers can coalesce newer local edits there while a packet is in flight. A receipt for an older in-flight generation may return credit but cannot clear a newer delivery generation. Controls have no note body, title, tags or query. Already authorized/sent bytes cannot be recalled.

These are provisional M0 bounds and a direct-author transport experiment. No server, app database, real account/note, billing, or stopped native/relay component is used. General reconnect scheduling, inventory paging, trust propagation and production network budgets remain separate work.

The harness uses a five-second readiness timeout, two-second assembly/drain/receipt bounds, the proof's expiry, an 8 MiB binary receive ceiling and ceilings of 512 incoming control frames and 256 KiB of control bytes per session. Individual controls are at most 4 KiB. These deliberately small synthetic-test limits are not a supported remote-network budget. Receipt controls can interleave with binary chunks without sharing their assembler; only one binary note packet may be in flight in that direction.

## Evidence

The transport-independent SessionFlow state machine and strict control codec are implemented. Seven unit cases cover delayed authorization, queued-versus-sent readiness, independent duplex credits, durable receipt completion/replay, operation/generation/session substitution, extra packets, closure and body-free bounded controls. TypeScript, formatting and all 74 shared cases pass.

The Chrome 156 harness passes 27 checks across nineteen fresh host/host DTLS sessions. Added cases hold one endpoint's durable claim while the other waits for mutual readiness, hold an incoming note commit while the opposite edit and receipt finish, reject an extra send without closing the valid transfer, preserve a coalesced newer generation through an older in-flight receipt, and converge after releasing the held commit. A failed sender receipt transaction retains delivery and fresh-session retry deduplicates. An actual receipt timeout closes the channel with delivery intact. Wrong-session controls and changed installed descriptions close the bound session. Earlier Unicode, commit-before-ack, quarantine/failure, purge, replay/reopen and revocation checks remain passing. [Synthetic metadata](../experiments/peer-session-flow-2026-10-27.json).

The extended fixture initially stalled, and its first diagnostic watchdog had a coarse last-stage label that did not locate the failing substep. The fixture awaited a set-description operation while its own description-change guard closed that connection. The corrected negative check observes the guarded closure without waiting for the cancelled operation; finer stages and bounded waits now prevent an unbounded harness stall. This controlled change passed the complete harness, but the coarse prior output does not prove an underlying browser cause. WebRTC's queued operation steps can abort after closure. [W3C connection operations](https://www.w3.org/TR/webrtc/#set-description), [diagnostic metadata](../experiments/peer-session-flow-diagnostic-2026-10-27.json).

No full acceptance criterion is complete. Neither native WebKit nor live relay execution was retried; their stopped gates remain open. The app and approved mockups are unchanged. Full transport integration, production time/byte limits, anti-entropy inventory, clock policy, pairing and native/iPhone remain required.

## Hosted CI availability

Both GitHub Actions runs at d969dde failed before checkout or any test step. The check annotations report an account billing/spending restriction; they do not establish whether payment or the spending limit is responsible. Both runs at prior head cf3a79a passed. No billing settings were changed and no automatic rerun was requested. [Dispatch metadata](../experiments/github-actions-2026-10-27.json). Local verification continues while Sandip reviews GitHub Billing and plans; hosted CI for this head is not passing.
