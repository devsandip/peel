# Two-session Cloud conflict-recovery acceptance harness

[Issue 206](https://github.com/devsandip/peel/issues/206) adds an independent browser harness for the conflict-recovery round. Root owns the controller ([issue 204](https://github.com/devsandip/peel/issues/204), [PR 207](https://github.com/devsandip/peel/pull/207)). Antigravity owns workspace inspection and later resolution UI ([issue 205](https://github.com/devsandip/peel/issues/205)). This harness owns only its five new files and implements no production behavior.

Base: verified main `ffa55a57a7a5409c3277fb010234fdf52c5208a4`, [PR 203 proof](https://github.com/devsandip/peel/pull/203#issuecomment-6523446267). This plan is committed before harness code.

## Requirements covered

| Requirement  | What the harness must show                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| FR-02, AC-02 | Pending drafts survive reload. A lost response or retry never produces a false Saved.                     |
| FR-04        | A confirmed decision reaches the second session through the real service after an explicit refresh.       |
| FR-07, AC-10 | A remote permanent purge cannot be resurrected through the old note ID.                                   |
| FR-13, AC-09 | Both versions are preserved until an explicit decision, and an older ACK never marks newer typing Saved.  |
| AC-12        | Duplicate requests and expired or missing authentication preserve local work and show the matching state. |
| FR-14, AC-13 | A second account shares nothing, and a switched-away session cannot affect the later account.             |

These are prerequisites only. Passing this harness does not close any of these acceptance criteria.

## What is real and what is synthetic

Real, imported and never reimplemented:

- `CloudMutationService`, `SQLiteCloudServerStore`, `createCloudMutationHandler`, `CloudPullService` and the web-session boundary, behind a loopback HTTP listener.
- `CloudBrowserWorkspaceSession`, its authenticated web senders, `CloudLibraryOwners`, `CloudLibraryDownload`, `CloudWorkspace` with its Inspect conflict action and embedded `CloudConflictPreview`, the note editor and `IndexedDBCloudStateStore`.
- `CloudConflictResolutionController` through `owners.conflicts()`.

Synthetic, and never evidence of the real thing:

- Principals and credentials. They are not Cognito or real login.
- The `Secure` session cookie, which the test proxy attaches explicitly per browser context. This is not browser-managed cookie behavior.
- The same-origin proxy and origin mapping to a fixed synthetic HTTPS origin.
- Fixed fixture note text and SQLite service storage. This is not DynamoDB, a hosted deployment, live delivery or paid entitlement.

## Dependencies

All three dependencies are on verified main: the controller (PR 207), Put away acknowledgement (PR 209) and workspace inspection (PR 211). The spec has no skip, fixme, expected failure or dependency-existence check. Every scenario is a required pass. The static check that the default app does not import this harness or the controller stays, because it guards a boundary rather than gating on a dependency.

## Fixture design

`tests/fixtures/cloud-conflict-roundtrip-server.mjs` starts one owned listener on a fresh `127.0.0.1` ephemeral port, with temporary service storage. It seeds isolated synthetic accounts and issues one session per named browser session. Switches apply per session:

- `offline`: drop the connection before the service sees the request. This is a synthetic network loss, because browser offline emulation would also break the Vite dev connection.
- `hold`: commit in the service, then hold the response until released.
- `lose`: commit in the service, then destroy the connection so the reply never arrives.

An expired session uses real boundary revocation, so the 401 comes from the real session check.

Observations record session, path, status, operation ID, content hash and replay flag. They never record bodies, cookies or tokens.

`tests/fixtures/cloud-conflict-roundtrip.tsx` renders only the real workspace in a fresh browser context with its own explicitly named `peel-m0-cloud-conflict-roundtrip-` database. Its test API only calls real components.

`tests/e2e/cloud-conflict-roundtrip.spec.ts` creates two fresh contexts per test. Conflicts come from real editing in both sessions. Existing durable transitions may seed a scenario only where the assignment allows it.

## Scenarios

Run on current main:

1. Two contexts use separate caches, nothing runs before explicit preparation, and teardown removes every owned resource.
2. Accounts are isolated, including the same note ID under two accounts.
3. Two sessions edit one note, one reaches the server first, and the other shows a preserved conflict in the real preview. Offline and lost-response switches keep work Pending.

Require the real controller:

4. Device choice stays Pending through a held reply, reaches Saved only after the matching reply, and appears in the second session after explicit refresh.
5. Combined text survives a lost response and reload, and retry sends the exact same operation.
6. Observed Cloud choice sends nothing.
7. Stale selection and newer edit are refused without a send or lost text.
8. A newer remote write produces 409 and a fresh conflict.
9. Old-session abort and account switch withhold the late result and leave the later account untouched.
10. Remote permanent purge refuses device and combined choices, keeps the text readable until an explicit decision, and never recreates the old ID.
11. Results and errors contain no body or credential text, and no storage mode is activated implicitly.
12. Combined text is refused when the observed Cloud version is in Trash. Both durable branches survive the refusal byte for byte, nothing is sent, the server keeps the trashed revision, and the library shows recovery with Conflict rather than Saved. An explicit observed Cloud choice then keeps the note in Trash without a send.

Require issue 205:

13. The real Inspect conflict control opens the preserved conflict from the library by keyboard. Focus moves to Back to notes, Tab reaches both copy controls once the preview has loaded, and Back to notes returns focus to the originating control. Desktop 1280x800 and mobile 390x844 screenshots are captured for visual review.

Every scenario that shows a conflict reaches the preview through the visible library control, including the purged and trashed recovery cards under Needs attention.

## Constraints

- Owned paths only. No production, existing fixture or test, package, lockfile, CI, Playwright config, SPEC, WORKLOG or journal edit.
- No live WebSocket delivery and no default Cloud enablement.
- Local browser runs use an ignored scratch config on strict port 65529 with no server reuse. Test workers, timeouts, retries and isolation stay unchanged.
- No actual notes, default profiles, OS clipboard, provider, AWS, native or stopped-probe access.
- Heavy or browser windows are coordinated in [issue 169](https://github.com/devsandip/peel/issues/169).

## Progress

**Final local checkpoint.** M2.2 stays open.

Base: verified main `31a52c378f6749abcf536dcf86bfdcfbeaa65b94` (PR 207, PR 209 and PR 211, [main proof](https://github.com/devsandip/peel/pull/211#issuecomment-6526176970)), merged normally into the isolated CLI branch, which is then pushed to the PR 210 branch.

Planned before editing:

- Remove the fixture's own preview rendering and inspect shortcut. Every scenario opens the preview through the real Inspect conflict control.
- Replace the inspection fixme with the keyboard and focus scenario and its screenshots.
- Wait for the preview to finish loading (`aria-busy="false"` and a visible copy control) before keyboard navigation, without raising timeouts or retries or focusing the expected target programmatically.

Cleanup rework for the [Codex PR 210 review](https://github.com/devsandip/peel/pull/210) at `5411558`, planned before editing:

- Register every browser context the moment it is created, before navigation or readiness, so a failed setup cannot leave an untracked context.
- In afterEach, run the browser-store checks and fixture teardown first, then always attempt to close every registered context and the owned server, each separately. The first original error is rethrown. Cleanup errors surface only when nothing failed earlier, and none is swallowed.
- Success-path invariants stay, after the closes: owned databases only, no storage-mode key, no caller-store closure, no remaining databases, the listener refusing connections, the temporary folder removed, and no note text or credential in diagnostics.
- Deletion stays limited to the fixture's own temporary folder and its explicitly prefixed databases. The server fixture already cleans up its own partial startup failure.
- Ignored probes inject a setup failure after context creation and a teardown failure, and a separate receipt confirms no context remains, the listener refuses connections and the folder is gone. The same probe runs against the previous implementation for comparison.

Decisions:

- A note purged in Cloud is asserted as the untitled recovery card under Needs attention, which is existing library behavior. A note trashed in Cloud while the device copy is active is listed the same way.
- The trashed remote is written by a third client through the real service, because the development workspace has no Trash control.
- The one reload left in the spec is the intentional lost-reply restart case.

Earlier evidence against unmerged heads, or with reload workarounds, is superseded and carries no acceptance credit. Synthetic identity, cookie, proxy and SQLite service remain fixtures, never real login, hosted, live or paid proof.
