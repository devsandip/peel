# Remote peer sync protocol experiments

## Requirements and scope

FR-13, FR-14, FR-17 and FR-19; AC-03/04/09/10/21/25. Free On-device sync includes remote networks, periodic exchange, authenticated peers, latest-edit convergence and no server-stored note payload. Local-only capture remains usable while disconnected. This plan does not activate sync in the app or satisfy the cross-network release gate.

## Plan

1. Check primary transport/background references and run an isolated synthetic browser data-channel experiment. Record host/direct versus relay evidence separately; do not infer different-network or iPhone viability from loopback success.
2. Build a transport-independent protocol model for immutable hybrid logical stamps, deterministic whole-note winners, seven-day local recovery and permanent tombstones. Exercise three replicas under reordered/duplicated delivery, restart snapshots, equal-time edits and one-year clock skew.
3. Define an explicit provisional clock-skew policy and test that suspect future stamps do not poison the receiving clock. Keep pending local content; no clock or connection problem may gate local capture. Do not enable sync until clock repair and authenticated calibration are designed and tested.
4. Add a durable adapter before emitting real peer acknowledgements. Atomically commit the note, winning stamp, received edit identity, local recovery, tombstones and outbox progress. Test injected transaction failure and process restart on SQLite and IndexedDB.
5. Prove authenticated pairing/revocation and direct/forced-relay transfer on different networks, then native/iPhone/background behavior. Pin any new runtime only after those results. Plan and bound relay/signaling infrastructure, cost, payload-free logging and abuse controls before provisioning.

## Candidate connectivity design

Evaluate an ordered reliable WebRTC data channel shared by browsers and native WebViews. WebRTC requires separate signaling; SCTP/DTLS provides encrypted data transfer but does not by itself authenticate a Peel library. Bind negotiated fingerprints and session nonces to already paired device keys before note exchange. Pairing confirmation, revoked devices, replay protection and library isolation remain explicit security gates. [WebRTC setup](https://webrtc.org/getting-started/peer-connections), [data channels](https://webrtc.org/getting-started/data-channels), [W3C WebRTC](https://www.w3.org/TR/webrtc/).

Use bounded frames (initial experiment: 16 KiB, capped by negotiated maxMessageSize), backpressure and per-transfer byte limits; a 256 KiB note is not one assumed-unbounded message. A transient TURN relay can forward encrypted packets when direct ICE paths fail. Short-lived relay credentials and bounded allocations are required; server-side note storage or offline queues are prohibited. Coturn remains a candidate for the app. Two isolated temporary installations were fully deleted after failed relay validation; [remote-relay-experiment.md](remote-relay-experiment.md) records those stopped gates. No relay fleet is deployed. [Coturn upstream](https://github.com/coturn/coturn).

iOS background execution cannot guarantee a one-minute peer opportunity. Foreground/reconnect/Sync now remain reliable triggers; actual WebView and native networking behavior needs an iPhone experiment. [Apple background tasks](https://developer.apple.com/documentation/backgroundtasks/refreshing-and-maintaining-your-app-using-background-tasks).

## Provisional model decisions

The model is not imported by the application. Session-signature primitives and an isolated key-persistence experiment are tracked in [peer-authentication.md](peer-authentication.md); they are not yet connected to this reducer or to real signaling. It assumes authenticated, signature-verified library/author identity supplied by a future transport boundary. It supplies no peer authentication, encryption, network service or production acknowledgement path. Local SHA-256 edit digests reject reused IDs after recovery bodies expire; hashes do not authenticate senders. A durable adapter must serialize transitions and translate replica-local revisions rather than write the model's note snapshots straight into the current repositories.

Stamp ordering is physical milliseconds, logical counter, device ID, then immutable edit ID, using binary identifier ordering rather than locale sorting. Observe remote clocks without changing the received edit's stamp. Hybrid clocks preserve causal ordering when physical clocks move backwards. [Logical Physical Clocks](https://cse.buffalo.edu/tech-reports/2014-04.pdf).

For this experiment, quarantine an incoming stamp more than five minutes ahead of local wall time before observing it. Past edits are allowed because legitimate offline notes may be old. Authenticated session clock calibration, local clock repair and uncertainty UX remain M0 gates; a timestamp check alone cannot identify which device is correct. Recovery retains losing non-purged snapshots for seven days from receipt/replacement, deduplicated by edit ID. Permanent purge removes heads and retained history and leaves a body-free marker that dominates all stamps. A separate recovered note must receive a new ID.

## Evidence

Eight protocol-model checks pass within the 43-case shared suite. They cover three replicas across all six orderings of three concurrent edit/archive/Trash snapshots, duplicate delivery, immutable payload snapshots, persisted-clock JSON restart, backwards time, equal stamps, one-year-future quarantine, old offline content, history expiry without retry-driven revival, reused edit IDs, cross-library/unknown-author rejection, and every ordering of edits and permanent purge markers. The receiving clock remains unchanged on future-stamp quarantine. These are model checks, not durable-store or cryptographic tests.

The synthetic Chrome 155 / M4 host-channel experiment transferred **252,025 UTF-8 bytes** in **16 frames** of at most **16,384 bytes**, with matching SHA-256 before/after. Negotiated SCTP maxMessageSize was 262,144 bytes. Statistics reported DTLS connected and host/host UDP candidates; connection took 29.2 ms and transfer 8.9 ms in this single local run. No external STUN/TURN service was configured, no server received a note payload, and no page errors were observed. A relay-only negative control with no TURN server produced no candidates and did not silently connect via host ICE. Raw metadata is in [the experiment report](../experiments/peer-channel-2026-10-26.json).

This runs two peer connections inside one temporary browser page. It proves local data-channel availability and framing only. No direct/relayed cross-network, cryptographic pairing, native/iPhone or durable-acknowledgement acceptance is claimed. Apple's [WKWebView overview](https://developer.apple.com/videos/play/wwdc2021/10032/) establishes a supported WebRTC API direction, not that Peel's wrapper has passed it. Native UI remains unavailable while the Mac is locked.

An isolated [durable store experiment](peer-durability.md) now persists normalized note/head/history/seen/clock/tombstone/delivery state atomically on SQLite and IndexedDB, with revision translation and failure/restart checks. It remains outside the app. Native migration and production acknowledgement integration remain open.

The later [bound channel harness](peer-wire-session.md) composes that store with transcript proofs and framed direct-author messages over same-page WebRTC host connections. It checks real commit acknowledgements, failed writes, lost acknowledgements/retry, malformed traffic and channel revocation. It remains outside the app and does not establish remote direct/relay connectivity or production signaling.

Local future-clock-jump repair, authenticated offset/uncertainty checks, production wire schema and snapshot validation, revocation, payload limits/backpressure interruption, durable seen-ID/history/outbox cleanup, and explicit transport commit acknowledgements remain open. The five-minute quarantine is a provisional experiment value, not a finalized release guarantee. Never replace a received edit's immutable stamp just to force it through the guard. Local capture must continue while synchronization is paused for clock repair.

The isolated [clock-independent draft store](peer-local-drafts.md) now verifies that local text can commit before stamping, remains protected during remote receipt and survives failed/paused publication. Eleven real-store scenarios and four SQLite process-recovery boundaries pass. This closes a store prerequisite; it does not solve clock calibration/repair or enable app sync.

## Reproduce

```bash
pnpm check
pnpm test
node scripts/experiment-peer-channel.mjs
```

The channel script uses installed Chrome by default on Mac, supports PEEL_BROWSER_PATH, opens an isolated temporary profile and a blank loopback page, and generates its own synthetic text. It does not read existing notes or credentials. Raw experiment output goes under ignored scratch/.

The [current-trust](peer-current-trust.md) and [session-flow](peer-session-flow.md) follow-ups now compose durable confirmed trust/revocation with explicit readiness, independent one-credit duplex transfer and body-free receipts. They pass 27 Chrome host-channel checks and 74 shared cases. These are isolated prerequisites; production pairing/trust propagation, clock policy, bounded inventory, reconnect scheduling and native/remote integration remain open. The earlier model-only evidence above is historical.
