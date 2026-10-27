# Durable trust gate for peer clock diagnostics

## Requirements and plan

FR-13/17/19 and AC-09/12/13/21/25 require paired peers, current revocation, and clock-skew handling before On-device sync. The signed peer-relative diagnostic is currently in memory and explicitly does not authorize a session or a note. Compose it with the existing durable trust registry without changing that boundary.

1. Read only the locally confirmed public identity and trust generation from the isolated M0 replica. Validate the library/device store identity and imported key. Incoming packets never add trust.
2. Give the diagnostic a wrapper that installs a confirmed key only from that durable read. Check the same durable generation/key again after each asynchronous begin, respond, or complete operation, before returning a packet or observation to its caller. Reconfirmation and revocation invalidate outstanding diagnostics.
3. Keep note/session claims, clocks, drafts, delivery and acknowledgements untouched. A relative-clock observation remains informational and cannot satisfy `publishDraft` or `authorizeSession`.
4. Verify real SQLite and IndexedDB with synthetic identities: unpaired refusal, ordinary exchange, revocation or reconfirmation after a request, delayed crypto, and unchanged storage revision across diagnostic operations. Record precisely where revocation can race with already returned bytes.

## Limits

The wrapper checks durable trust at its last read. A revocation committed after a packet has been handed to transport cannot recall those bytes. The diagnostic carries no note body and grants no session. This work does not prove installed-description freshness on an actual channel, trustworthy UTC, clock repair, safe draft publication, relay reachability, native WebKit, or iPhone behavior. No running app or real note database is used.

## Evidence

`CurrentTrustClockDiagnostics` wraps the standalone signed diagnostic. It loads only a previously confirmed durable public key, serializes registry installation, and checks the same durable generation and SPKI after each asynchronous operation. If the final check sees revocation or reconfirmation, it withholds the result and invalidates the in-memory diagnostic state. Its output is still only a peer-relative observation, never a time repair or publication permission.

The [dated synthetic report](../experiments/peer-clock-current-trust-2026-10-27.json) records four shared contract scenarios on actual Node SQLite and Chrome IndexedDB: an unpaired peer cannot begin or respond; a signed exchange leaves store revisions and clock/session rows untouched; revocation and reconfirmation reject an outstanding reply; a caller cannot mutate an expected generation while a trust read is pending; and revocation during held signature verification prevents the responder from returning a reply. TypeScript, Prettier and the full 83-case shared suite pass. Chrome blocked no external requests, opened no application database and removed its two isolated fixture databases.

This is a last-read release gate. Trust can change after the wrapper returns and after bytes have been handed to transport; already sent diagnostic bytes cannot be recalled. A later [same-page Chrome channel fixture](peer-clock-channel.md) exercises the wrapper with independently installed-description bindings. It is still not a production channel, skewed OS clock, secure key store, native WebKit, iPhone, app sync or clock-repair policy. The Mac remains locked, so native UI checks were not retried. An older Peel process on the real default data directory was left untouched.
