# Supplied session binding on safe Cloud reads

[Issue185](https://github.com/devsandip/peel/issues/185) follows verified PR184/main9797683, proof6507731774. This plan precedes tests/runtime. SPEC FR-05/13/14 and AC-12/13 prerequisites, [web sessions](cloud-web-sessions.md), [library context](cloud-library-context.md) and bounded web transport plans govern this narrow change.

## One purpose

Browser JSON senders capture x-peel-csrf and send it for GET as well as POST. The current session boundary checks it only on unsafe methods. If the browser's cookie changes, an older captured sender must not silently follow that later session. First demonstrate actual two-session discovery through the existing session boundary and temporary SQLite handler: session B cookie with session A's captured token currently selects B. Preserve that red separately before fixing the boundary.

Validate an explicitly supplied x-peel-csrf token for every method, including GET/HEAD/OPTIONS, using existing syntax/hash/constant-time checks. Unsafe methods continue requiring their existing Origin and token. Plain safe requests without that header retain existing behavior. Cookie parsing, expiry/revocation, Origin/Fetch Metadata, current account/paid/generation checks and Lambda bearer/mixed-credential behavior stay intact. Reject mismatch before account/note access without exposing tokens or private exceptions. No new endpoint, session schema/credential persistence, grant, UI or broad transport change. Clarify the canonical SPEC session contract alongside the code.

## Evidence

Add a deterministic actual HTTP/SQLite two-account red, then permanent coverage for discovery/note-read refusals before data access, matching-token success, no-token safe compatibility, all safe methods, empty/malformed/duplicate supplied headers and current policy. Exercise a real durable-session Lambda/DynamoDB Local case for rotation, stale token, revocation and independent bearer authority. Do not rewrite existing assertions/defaults/workers/timeouts/retries/isolation. The previous local runtime acquisition timed out; do not blindly repeat or use an unknown old runtime. Actual hosted adapter evidence remains mandatory. Add the existing session suite to Node24's matrix for this changed consumer.

Run focused relevant Node24 and shared/static/artifact/build/default-bundle checks in a coordinated window; keep failed/unrun evidence distinct. Require focused exact-source review/all3 hosted gates, normal scanned no-reply integration and separate main/closure/Project/guarded primary/owned cleanup. Backfill184 proof in append-only WORKLOG/new immutable journal/INDEX; preserve frozen0144 and earlier.

## Ownership and acceptance

Root owns this session/backend/SPEC/test slice. Peer181's six new conflict-preview files/props remain unchanged and exclusive. Coordinate in169; Root65527/peer65528 strict/no reuse. Preserve all peer refs/checkouts and private/unknown data. No actual/default note/operator DB/profile/provider/native app/clipboard, stopped probe, expired lease, private archive import or unrelated-process changes. Default Cloud remains unavailable. This is a development request boundary, not real login/paid activation/full web/live/reconnect/native/iPhone/performance or M2.2 managed teardown acceptance.
