# Peer session authentication experiment

## Requirements and plan

FR-14/17, AC-03/13/21, and the remote-peer M0 gate. This experiment does not enable app sync or replace the remaining work in [peer-sync-protocol.md](peer-sync-protocol.md).

1. Use standard Web Crypto ECDSA P-256/SHA-256 primitives with non-extractable private keys. Derive stable device identifiers from public SPKI bytes. Keep test keys ephemeral and never export a private key.
2. Bind a session proof to library, both device identities, both fresh random challenges, session ID, offer/answer hashes and bounded expiry. Require an existing, explicitly confirmed pairing entry. A key supplied by an incoming proof is never automatically trusted.
3. Verify against the caller's locally reconstructed transcript. Reject tampering, reflection, unknown/revoked peers, expired proofs, wrong library and challenge reuse. Consume each local challenge at most once, including concurrent verification and revocation while crypto is pending.
4. Check Node/Chrome signature interoperability and record only synthetic metadata. Native keychain storage, browser CryptoKey persistence, pairing UI, durable replay state, signed signaling order and actual native/iPhone transport remain gates before app integration.

## Basis and limits

WebRTC encrypts data-channel transport but needs authenticated certificate/fingerprint binding to identify a peer. This prototype signs session descriptions and challenges using already paired keys; it does not invent a cipher or key exchange. The full signaling state machine must verify trusted signed descriptions before note data is permitted and bind the proof to the descriptions actually installed in RTCPeerConnection. [WebRTC security architecture](https://www.rfc-editor.org/rfc/rfc8827.html).

P-256/SHA-256 signing, public SPKI import/export and non-extractable private keys use the platform's Web Crypto implementation. Browser non-extractability prevents export through that API; it does not protect against all same-origin script compromise or replace native Keychain storage. [Web Crypto](https://www.w3.org/TR/WebCryptoAPI/).

The verifier is an in-memory M0 component. Callers must generate and track their own fresh challenges and must not pass an untrusted proof's transcript back as the expected one. Pairing is a separate out-of-band user confirmation; importing a public key is not pairing. Revocation of a registry entry rejects new proofs and invalidates pending verification. The separate [durable store experiment](peer-durability.md) atomically persists consumed challenges and session claims; [the bound harness](peer-wire-session.md) composes a successful proof with that claim and closes active channels on revocation. This is not a production pairing registry or session manager. Replay state and current durable trust must be coordinated with activation before production use.

The initial session proof has a five-minute maximum lifetime. Clock repair/calibration remains open; local capture must not depend on a successful handshake. Public v1 still requires remote direct and transient-relay sync, browser/native/iPhone pairing and truthful waiting states.

The [current-trust follow-up](peer-current-trust.md) now composes stored confirmed keys, trust generations and replay claims with scoped direct note commits in one compare-and-swap ordering. Ten cases pass on both SQLite and Chrome IndexedDB, and the bound harness uses that path. The original SessionVerifier remains an in-memory primitive; production pairing/keystore/session management and native/iPhone acceptance remain open.

## Evidence

Seven authentication checks pass within the 50-case shared suite: private export denial/public identity round-trip; explicit pairing and reflection rejection; tampering with every bound field; expiry/signature/key mismatch; concurrent and cross-session replay; revocation during verification or pairing; and immutable async input snapshots. Failed proofs do not consume a valid challenge.

The isolated Node 26.4 / Chrome 155 experiment verified signatures in both directions. A browser-generated non-extractable private CryptoKey survived IndexedDB commit and page reload, retained the same public identity, and produced a signature accepted by Node. Private key export was denied; no private key material was exported or written to a report. Replay rejection passed in the running verifier, with no page errors. Raw non-secret metadata is in [the experiment report](../experiments/peer-auth-2026-10-26.json).

This initial interoperability test uses descriptor fixtures. The later [bound channel experiment](peer-wire-session.md) composes proofs for real installed descriptions, durable claims and active channel closure in a same-page Chrome harness. Neither proves a pairing UI, code/QR verification, browser eviction recovery, native Keychain, Safari/iPhone, production signed signaling order, atomic durable trust or trust propagation. Those remain required before app integration. A production security review of the completed protocol is still needed.

## Reproduce

```bash
pnpm check
pnpm test
pnpm exec vite build --ssr packages/peer-protocol/src/auth.ts --outDir scratch/auth-module --emptyOutDir
node scripts/experiment-peer-auth.mjs
```

The script creates fresh synthetic identities and a temporary browser profile, serves only the experiment module and a blank page on loopback, and records boolean outcomes/environment metadata under ignored scratch/. It never reads an existing account, key, note database or browser profile.
