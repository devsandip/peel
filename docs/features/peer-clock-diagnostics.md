# Signed peer clock diagnostics

## Requirements and bounded plan

FR-02/13/17/19 and AC-02/09/21/25. Local drafts already save without clocks; publication still requires an external safety decision. Current session authorization checks absolute wall-clock expiry, so a device with a year of skew cannot use that session as its only calibration prerequisite. Add a separate body-free signed diagnostic before authorization, without granting note access or repairing time.

1. Bind a fresh CSPRNG challenge and signed request/reply to the locally reconstructed installed-description session transcript and both explicitly confirmed public identities. Use a distinct signature domain. Structural session expiry remains in the binding hash, but this diagnostic does not authorize it or adopt its wall expiry. Fresh local challenge lifetime uses monotonic time, not peer or wall time. No incoming message can create trust.
2. Capture local send/receive wall and monotonic readings, and signed peer receive/send wall readings plus elapsed duration. Derive a conservative relative-offset interval using nonnegative one-way latency assumptions, inspired by the four-timestamp [NTP model](https://www.rfc-editor.org/rfc/rfc5905.html). Do not assume symmetric latency or claim either device has correct UTC. A malicious confirmed peer can lie about time; a signature proves its statement's author, not its truth.
3. Use provisional M0 limits: five-second challenge/round trip, 250 ms wall-versus-monotonic discrepancy per endpoint, two-minute relative-skew bound, 2,500 ms maximum interval width, 32 outstanding challenges and 512 consumed responder challenges. Expand the interval by both endpoints' tolerance. These are experiment limits, not a final publication/quarantine policy or product device/session quota.
4. Reject replay, wrong transcript/direction/key, malformed/oversized messages, impossible durations, wall jumps, delayed verification, immutable-input races and registry revocation. Consume each local challenge once and bound responder replay state. Clock failure does not read/write notes, clock stamps, trust rows, session claims or delivery acknowledgements. No repaired timestamp or active-session handle is returned.
5. Exercise real Web Crypto in Node and an isolated Chrome fixture, with simulated one-year-forward/back clocks, asymmetric delay, uncertainty boundaries, wall jumps, stale/forged replies and revocation during verification. Also exchange public SPKI identities and signed packets between those two runtimes through the test RPC to verify actual canonical/signature interoperability, with private keys staying in their originating runtime. This is not live DTLS/wire integration. Do not change OS clocks or retry stopped WebKit/relay/native UI components. No real notes, AWS, billing or app sync.
6. Keep the full gate open: production current-durable-trust ordering, authenticated wire composition, retry/rate/replay lifecycle, a trusted time/repair source and user-facing uncertainty policy, safe publication and native/iPhone still need evidence. In-memory diagnostic success cannot bypass current TrustedReplica authorization or publishDraft's caller-safety contract. Preserve approved 0.7 documents/mockups and stop safely at the overnight cutoff.

## Decisions and limits

This primitive reports peer-relative observation only. Two devices that are both a year wrong can agree; the result must never be named or treated as permission to publish. Large skew pauses a future sync decision while local source remains saved. Do not automatically reset HLC state, restamp received edits or discard recovery versions. Current five-minute future-edit quarantine in the lower-level reducer remains unchanged.

## Evidence

### Implemented observation boundary, 27 October 2026

`packages/peer-protocol/src/clock-diagnostics.ts` contains the isolated primitive and a strict 4 KiB body-free codec. Requests and replies use distinct ECDSA/P-256 signature domains from session authorization. The binding hash includes both installed-description hashes, device IDs, both session nonces, library/session identity and the structural expiry value. Only locally added confirmed public keys are used. Inputs are cloned before asynchronous work; registry generation/key checks run after verification/signing. Private keys remain nonextractable in memory.

A local challenge is reserved before asynchronous signing, consumed once before reply verification and expired using monotonic elapsed time. Invalid replies do not return a publication permission or clear any note delivery state. Responder concurrency and replay sets are bounded, with a second replay-capacity check after asynchronous verification. Registry changes conservatively invalidate outstanding observations. These are instance-local checks, not durable current-trust integration.

For local `T1/T4` and signed peer `T2/T3`, the relative interval starts at `[T3-T4, T2-T1]`, then expands each end by 500 ms for the two endpoint tolerances. It assumes nonnegative one-way delay and sufficiently stable clocks over the observed window; it does not assume symmetric delay. The result labels are `within-relative-bound`, `large-relative-skew` and `uncertain`. No corrected UTC timestamp, HLC change, session claim or safe-to-publish handle is produced.

### Verification

[Synthetic metadata](../experiments/peer-clock-diagnostics-2026-10-27.json) records the same compiled contract on Node 26.4 and Chrome 156 on M4/Darwin 25.6.0. Nine scenarios pass in each runtime:

- Signed asymmetric intervals, consumed requests/replies and rejection of a clock signature transplanted into session authorization. A subsequent legitimate session proof still succeeds; the diagnostic does not consume its challenge.
- One-year-forward and one-year-back peer clocks classify as large relative skew while ordinary session expiry still rejects. Two equally wrong clocks classify as relatively aligned, explicitly proving that this is not UTC authority.
- Wide/boundary intervals, impossible duration beyond tolerance, malformed readings and arithmetic overflow fail or remain uncertain.
- Forged/altered signatures, different transcript, signature-domain substitution, wrong confirmed key and unpaired callers fail.
- Local/peer wall jumps, exact lifetime expiry and expiry after verification fail. A held real Web Crypto verification followed by revocation also fails.
- 32 outstanding requests are reserved across concurrent signing; expired reservations are reclaimed. Concurrent completion accepts a challenge once.
- 32 responder operations are reserved before awaiting verification; a 33rd gets the concurrency error. After 500 consumed requests, 32 concurrent valid requests produce exactly 12 further successes, never exceeding 512 retained replay entries.
- Mutation of request and expected-binding objects during asynchronous work does not change the captured input. Malformed JSON, extra body fields and oversized packets fail.

The contract groups some related checks; these are nine scenarios, not nine additional top-level unit cases. The complete shared suite has 82 passing cases. TypeScript and formatting pass.

Additional actual interoperability checks exchange public SPKI identities and signed request/reply packets between Node and Chrome through the fixture RPC. Both directions verify, and the simulated positive/negative one-year offsets lie inside their returned intervals. Private keys stay in their originating runtime. Zero external/unexpected requests, page errors or application database opens were observed. This is not DTLS, a skewed operating system, a native app or a real network-delay measurement.

### Remaining gate

No clock is repaired and no application sync is enabled. A later [isolated durable current-trust gate](peer-clock-current-trust.md) now rechecks confirmed key generations before returning diagnostic results; the standalone primitive here still does not read the store. A [same-page Chrome channel fixture](peer-clock-channel.md) checks installed descriptions before and after diagnostic operations, but no production channel manager is integrated. Replay/rate lifecycle, delivery with skewed OS/TLS/runtime clocks, trusted time/repair source, immutable-history/epoch repair, uncertain-draft publication policy and native/iPhone remain open. The diagnostic must not be wired as an authorization bypass or treated as a trusted time anchor. The existing five-minute edit quarantine and all app behavior are unchanged. No stopped WebKit/relay probe, native UI action, real note, AWS resource or billing change occurred.
