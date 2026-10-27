# Bound peer channel experiment

## Requirements and plan

FR-13/14/17/19, AC-03/04/09/10/12/21/25. Connect the existing isolated authentication, channel and durable-store experiments without enabling app sync or provisioning services.

1. Add a strict, bounded wire codec for direct-author edits, purges and commit acknowledgements. Preserve original note snapshots, reject unknown metadata and oversized fields, frame payloads at 16 KiB and cap one in-progress assembly at 2 MiB. The larger wire cap permits JSON escaping of a 256 KiB source note.
2. Establish real same-page WebRTC connections using fresh ephemeral identities and explicit synthetic confirmed trust. Each side reconstructs its expected proof from the offer/answer descriptions actually installed in its connection, local challenges and library identity. Never accept a proof's transcript as the expected one.
3. Exchange proofs before permitting note frames, verify them against paired keys, and commit a durable session claim before allowing transfer. Bind an active channel to that session and close it on revocation or protocol failure. Do not restore active sessions from storage.
4. Exchange only direct-author edits in this experiment. A durable recipient receipt permits a body-free acknowledgement; commit failure/quarantine must send none. Retain sender delivery state through interruption and retry. Bind acknowledgements to note, operation kind and generation.
5. Test malformed frames, wrong transcript/proof, early note traffic, failed recipient commit, lost acknowledgement/retry, receiver store reopen, purge, and revocation. Keep raw reports limited to synthetic counters/boolean outcomes. Same-page connectivity does not establish different-network direct/relay, native or iPhone acceptance.

## Limits

This is an M0 harness, not production pairing or signaling. No remote servers or real keys/notes are used. Transitive author signatures/trust propagation, production pairing/session management, clock repair, reconnect inventory, bandwidth quotas, sustained throughput, native Keychain/Rust migration and Safari/iPhone remain open. The isolated current-trust follow-up below adds durable commit/revocation ordering. A proof authenticates a transport peer, not every third-party edit it might forward. Do not enable forwarding from this direct-author prototype.

The [session-flow follow-up](peer-session-flow.md) now gives each endpoint its own mutually acknowledged readiness and one receive credit. Body-free receipts progress during the opposite-direction commit; a newer delivery generation survives an older in-flight receipt. Changed installed descriptions require a fresh bound session. Production reconnect scheduling, trust propagation, time/byte budgets and abuse limits remain open. Its two-second partial-transfer timeout and 8 MiB received-session ceiling are test limits, not supported network budgets. Revocation closes new traffic and prevents pending activation. The current scoped path orders durable registry changes with mutations: a committed revocation wins over a later note commit, while a note already committed before revocation remains valid. App migration/session management remains a gate.

## Evidence

The latest [inventory composition](peer-inventory.md) extends the historical channel results to 29 checks over twenty Chrome 156 host sessions. Current-trust-scoped local pending discovery drives fresh-session delivery without manually selected note IDs; no network inventory or production reconnect completion is claimed.

The current [session-flow report](peer-session-flow.md) extends the following historical results to 27 passing checks across nineteen Chrome 156 host-channel sessions, with 74 shared unit/contract cases. It tests real delayed claims, held duplex commits, sender receipt failure/retry, timeout and coalesced generation handling. Different networks/native/iPhone remain open.

The [current-trust follow-up](peer-current-trust.md) replaces the bound harness's separate in-memory trust/claim composition with durable confirmed trust and scoped direct-author operations. Its new dated report records all 16 checks across twelve sessions passing on Chrome 156, including an independent durable revocation blocking outgoing frames. The earlier dated report below remains historical. Production pairing, keystores, transport readiness/credits, clock policy, inventory and native/iPhone integration remain open; local commit/revocation ordering is now tested in the isolated path.

Six wire tests pass within the 58-case shared suite: lossless Unicode and maximally escaped 256 KiB source; strict metadata/revision/mode validation; UTF-8/JSON and byte limits; malformed headers; interleaving/reordering/reset; and body-free acknowledgement/purge contracts. The per-edit digest now includes recognized import-origin fields. Delivery acknowledgements include operation kind, so an old edit acknowledgement cannot clear a purge even if the two operation IDs match. Both real-store contracts cover that collision.

The Chrome 155 same-page experiment passes 15 checks over 11 fresh host/host DTLS sessions. Each endpoint hashes the offer and answer installed in its own RTCPeerConnection and verifies the opposite device's proof before committing a durable claim. A 252,026-byte synthetic Unicode note commits to IndexedDB before its acknowledgement clears sender delivery. Recipient commit failure and future-stamp quarantine send no acknowledgement. A dropped acknowledgement, recipient store reopen and a fresh-session retry preserve the note at local revision 2 without applying it twice. Purge removes the body/history and is acknowledged separately.

Negative cases reject a signed proof for the wrong installed description, note frames before authentication, third-party forwarded authors and malformed frames. Active revocation closes the channel; revocation during a pending session claim prevents activation. A partial transfer times out without an acknowledgement. There are no page errors, external ICE services, application database opens or server-persisted payloads. [Raw synthetic metadata](../experiments/bound-channel-2026-10-26.json) records the individual outcomes. The experiment is included in CI.

These are partial composition checks, not AC-21 completion or a production security review. Full product acceptance remains open, including real pairing, remote direct and forced relay, native/iPhone, clock repair and app integration.

## Reproduce

```bash
pnpm check
pnpm test
node scripts/experiment-bound-channel.mjs
```

The script builds its own fixture module, serves only that static module and a blank page on loopback, opens a temporary isolated browser profile and generates new ephemeral keys/synthetic IndexedDB databases. It records only counters, environment and boolean outcomes under ignored scratch/. No SDP, IP address, identity key, note content or existing account is included in the report.
