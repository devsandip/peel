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
- `CloudBrowserWorkspaceSession`, its authenticated web senders, `CloudLibraryOwners`, `CloudLibraryDownload`, `CloudWorkspace`, the note editor, `CloudConflictPreview` and `IndexedDBCloudStateStore`.
- `CloudConflictResolutionController` through `owners.conflicts()`, once PR 207 merges.

Synthetic, and never evidence of the real thing:

- Principals and credentials. They are not Cognito or real login.
- The `Secure` session cookie, which the test proxy attaches explicitly per browser context. This is not browser-managed cookie behavior.
- The same-origin proxy and origin mapping to a fixed synthetic HTTPS origin.
- Fixed fixture note text and SQLite service storage. This is not DynamoDB, a hosted deployment, live delivery or paid entitlement.

## Dependency gates

The fixture detects `owners.conflicts` at runtime and declares only the small structural interface it calls. It does not copy or stub the controller, and it contains no hand-coded resolution transition or Saved label.

- Infrastructure and two-session conflict creation use components already on main, so they run now.
- Controller scenarios skip with a named reason until `owners.conflicts` exists, then run automatically after rebase.
- Workspace inspection scenarios stay `test.fixme` until issue 205 merges, because its visible controls cannot be known before then.

A skipped or fixme scenario is unmet acceptance, not a pass. Final Ready requires a rebase onto integrator-verified main containing issues 204 and 205, with zero skipped or fixme scenarios in this spec.

## Fixture design

`tests/fixtures/cloud-conflict-roundtrip-server.mjs` starts one owned listener on a fresh `127.0.0.1` ephemeral port, with temporary service storage. It seeds isolated synthetic accounts and issues one session per named browser session. Switches apply per session:

- `offline`: drop the connection before the service sees the request. This is a synthetic network loss, because browser offline emulation would also break the Vite dev connection.
- `hold`: commit in the service, then hold the response until released.
- `lose`: commit in the service, then destroy the connection so the reply never arrives.

An expired session uses real boundary revocation, so the 401 comes from the real session check.

Observations record session, path, status, operation ID, content hash and replay flag. They never record bodies, cookies or tokens.

`tests/fixtures/cloud-conflict-roundtrip.tsx` renders the real workspace and preview in a fresh browser context with its own explicitly named `peel-m0-cloud-conflict-roundtrip-` database. Its test API only calls real components.

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

Require issue 205:

12. The real workspace inspection control opens the preserved conflict from the library.

## Constraints

- Owned paths only. No production, existing fixture or test, package, lockfile, CI, Playwright config, SPEC, WORKLOG or journal edit.
- No live WebSocket delivery and no default Cloud enablement.
- Local browser runs use an ignored scratch config on strict port 65529 with no server reuse. Test workers, timeouts, retries and isolation stay unchanged.
- No actual notes, default profiles, OS clipboard, provider, AWS, native or stopped-probe access.
- Heavy or browser windows are coordinated in [issue 169](https://github.com/devsandip/peel/issues/169).

## Progress

**Checkpoint, not final Ready.** Infrastructure and scenarios are written. M2.2 stays open.

Blocked on:

1. PR 207 merging. It has [changes requested](https://github.com/devsandip/peel/pull/207#issuecomment-6524069769) at `2f725c5`.
2. Issue 205 merging, for the real inspection control. Its scenario is `test.fixme`.
3. A [Put away defect on main](https://github.com/devsandip/peel/issues/169#issuecomment-6524313455): with real owners and no upload in flight, Put away never completes, so a conflicted note with an open editor stays `busy` until reload. The spec records this as an expected failure.

Decisions:

- Scenarios leave an editor by reloading the page until that defect is fixed. Reload is a real durable recovery path, but it does not exercise Put away or browser owner retirement. Final Ready must move these callers to real Put away and remove the expected failure.
- A note purged in Cloud is asserted as the untitled recovery card under Needs attention, which is existing library behavior.
- Merging over a note trashed in Cloud has no scenario yet, because the expected behavior is an open question in the PR 207 review.

Evidence so far, all local and all synthetic:

- On this branch's base, 7 pass, including the expected failure. The other 10 are skipped or fixme, and that is unmet acceptance.
- Against a throwaway local copy of frozen PR 207 at `2f725c5`, 16 of 17 pass with the real controller over 2 repeats (32 runs), including the expected failure, with no flakes. Only the inspection scenario stays fixme. This is not acceptance credit, because that commit may change and has not merged.
- Deliberately breaking production code in that copy failed the expected scenario each time: new-note guard, abort check, 401 mapping and open-editor guard. Removing in-flight from the Pending projection failed all 9 controller scenarios.
- Not done: visual review of final UI, a full local e2e sweep, and any real login, hosted, live or paid behavior.
