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

## Demonstrated boundary and validation

After pre-code plane2f756a, the actual SQLite/session HTTP counterexample passes7 original cases and fails the new one: session B cookie plus the earlier session A token returns B's context with200 instead of csrf-rejected403. Preserve issue185-cookie-rotation-red.log. The server selects its authenticated current cookie correctly; the missing constraint was the older captured sender's explicitly supplied binding. A two-line guard change now validates that supplied token even for safe methods, after all existing cookie/time/revocation gates. The original7 assertions remain unchanged.

Final39 focused Node24 cases pass across4 suites, including13 session cases. Actual discovery/note reads refuse stale binding before account/note access; matching token and no-token safe requests succeed; malformed/empty/duplicate headers, GET/HEAD/OPTIONS, auth precedence and paid policy are covered. Full shared817/79, type/full checked-source format/whitespace, deterministic Node24 artifact build/smoke and web build/default-bundle hashes pass. Runtime remains unchanged after those checks. The existing session suite is added as Node24's42nd consumer.

One new actual durable-session Lambda/DynamoDB case covers rotation, zero data transactions on stale discovery/note reads, matching/omitted binding, old-cookie revocation, independent signed bearer authority, mixed-credential refusal and current paid policy. This local adapter run is unrun because the previous pinned runtime download timed out and no changed acquisition evidence justifies repeating it or using an unknown old runtime. Fresh exact-source hosted gates must execute all30 adapter cases and the42-suite Node24 matrix before integration. Local browser/native/IaC checks are not repeated for this server-only slice; hosted required gates remain mandatory. No assertion/default/worker/deadline/retry/isolation, peer file or default route changed.
