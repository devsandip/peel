# Installed-channel clock diagnostic composition

## Requirements and plan

FR-13/17/19 and AC-09/12/21/25 require remote paired-device sync to detect skew without letting a diagnostic authorize note traffic. The signed diagnostic and durable trust wrapper have separate Node/Chrome evidence. Exercise them on an actual Chrome WebRTC data channel with both peers independently deriving the binding from their installed local and remote descriptions.

1. Establish two same-page Chrome host peers with no STUN or TURN server and separate synthetic IndexedDB stores. Confirm public keys out of band in each store. Keep private keys inside each endpoint.
2. Build each expected binding from the corresponding installed offer/answer SDP, not from the incoming packet. Check both installed descriptions immediately before and after each asynchronous diagnostic operation and before sending a reply or exposing an observation. Reject changed descriptions.
3. Exchange only signed clock probe/reply packets over the opened ordered data channel. Test normal relative observation and a simulated one-year skew. Demonstrate that an ordinary absolute-expiry proof still fails for a skewed clock and the diagnostic does not bypass it.
4. Test wrong binding, current-trust revocation while a request is in flight, replay and malformed/non-clock traffic. Show that none creates a session claim, note row, clock stamp or acknowledgement. Do not use real notes or the app database.
5. Record the actual host-channel candidate/DTLS observation and exact limits. This is not different-network/TURN reachability, a physically skewed OS/TLS stack, native WebKit or iPhone acceptance.

## Evidence

The [synthetic Chrome report](../experiments/peer-clock-channel-2026-10-27.json) records ten passing checks on an opened ordered WebRTC data channel with DTLS connected and host candidates at both ends. Each endpoint independently hashed its own installed offer and answer, then used the durable current-trust wrapper to exchange signed clock packets. A simulated one-year offset lay inside the 1,100 ms relative interval. Ordinary absolute-expiry session verification still rejected that skewed clock.

The fixture rejected reuse of a consumed probe, a request evaluated against a different offer hash, malformed non-clock traffic, a peer revoked before response, and old installed descriptions after an actual renegotiation. It found no diagnostic writes to the isolated stores and no note, session-claim, clock or pending-delivery rows. Both synthetic IndexedDB databases were closed and deleted. Browser requests stayed on the loopback fixture origin, with no unexpected requests or page errors.

This is a same-page host-host channel fixture. The installed-description guard lives in the fixture, not a production channel manager. It does not show two clients on different networks, forced TURN, a real skewed OS/TLS stack, native WebKit, iPhone, trusted UTC, HLC repair or safe publication. No real notes, application database, AWS resource or running Peel window were touched.
