# Peel status report: 28 October 2026

- Snapshot: 08:30 IST, based on main through [1a87025](https://github.com/devsandip/peel/commit/1a87025da8cb52ef0d8b4176b554c041da887458).
- Status: implementation in progress. This is not an M2.2 completion report.
- Tracking: [Peel Project](https://github.com/users/devsandip/projects/12), [current milestone](https://github.com/devsandip/peel/milestone/2).

## Overall position

Peel is roughly **35% built against the full intended public-v1 scope**, with a reasonable engineering range of 30-40%. The estimate includes implemented and tested foundations. It is not calculated from closed issues, merged PRs, mockup counts or a count of fully accepted public features.

The local Mac and browser note-taking applications exist. Free remote peer sync, paid live Cloud, iPhone and meaning search are still unavailable in the production app paths. [PRFAQ](../PRFAQ.md), [PRD](../PRD.md) and [SPEC](../SPEC.md) remain at the canonical v0.7 baseline; the gallery contains 110 canonical screens and five dark exports as design artifacts.

## Built and remaining

| Area | Built so far | Remaining |
| --- | --- | --- |
| Mac capture and saving | Development app, independent floating notes, separate library, SQLite autosave, green minus save-and-put-away and failed-save recovery. Individual native save/reopen and library independence flows were observed. | Full native interaction, failure, performance and supported-device acceptance. |
| Desktop interaction | Pinning, drag/arrangement/Undo and configurable shortcut code; actual menu arrangement and Undo were observed. | Real title-bar dragging has failed its geometry check. Drag-out, shortcut dispatch and multi-display behavior need verification. |
| Editing and organization | Restricted Markdown, tags, edit/archive/Trash/restore/permanent delete, Markdown export/import. | Broader native acceptance and parity across all clients. |
| Word search | Worker-backed indexed words, phrases, prefixes and tags. | Native, Safari, iPhone and full supported-device performance validation. |
| Browser | Local IndexedDB client and tested offline shell. | Hosted access, real authentication, shared-library synchronization and Android-browser acceptance. |
| Free On-device sync | Isolated tests cover latest-edit ordering, seven-day recovery, authentication/revocation, durable pending changes and acknowledgements. | Pairing UI, successful remote direct/relay connectivity, reconnect scheduling and app/native/iPhone integration. Sync remains disabled. |
| Paid Cloud | DynamoDB adapters, authenticated API/session boundaries, pagination, retries, conflicts and recovery foundations; infrastructure templates and safeguards. | Actual managed-service proof, hosted login/API, app activation, live push, mode transitions and billing. Cloud remains disabled. |
| Meaning search | Local-model retrieval and verified offline-cache experiments, including a native CPU-host feasibility result. | Production bridges/UI, incremental private indexes, supported-device memory/quality and iPhone support. |
| iPhone | Requirements and mockups. | Native app, persistence/editing, authentication, lifecycle interruption and sync. |

## Performance and validation

The [Chrome word-search experiment](../features/local-search-performance.md) used 10,000 synthetic notes on an M4/16 GB Mac. One hundred warm offline input-to-result interactions measured p50 32.6 ms, p95 33.6 ms and max 49.2 ms, with no observed query-time main-thread long tasks. The full native/Safari/iPhone and target-device budgets remain open.

The latest code batch has 305 passing shared tests in 47 files, plus the separately configured hosted database/browser/native checks. [PR 70](https://github.com/devsandip/peel/pull/70) and its [main run 40619916473](https://github.com/devsandip/peel/actions/runs/40619916473) passed all three hosted jobs. The following tracking-only [PR 74](https://github.com/devsandip/peel/pull/74) passed all three jobs in [run 40622701388](https://github.com/devsandip/peel/actions/runs/40622701388) before merging, with merge-tree equality verified. Its Markdown-only main push does not trigger the configured push paths; no separate unrun check is claimed.

These results provide scoped evidence, not complete public acceptance. Native dragging, global shortcut dispatch, some real picker/login interactions, accessibility, physical failure testing and the supported-device matrix remain unfinished. [Local Mac evidence](../features/local-mac-app.md) records the individual observed paths and failed checks.

## Milestones and recent work

[M2.1 Cloud sync foundations](../milestones/2026-10-28-m2-1-cloud-sync-foundations-completion.md) is complete against its backend scope. M2.2 is active and remains open. Recent work added private hosting/artifact/cleanup templates, account/source/pricing/capacity observations, durable run accounting and prospective collision checks. These prepare a controlled Cloud run; they do not enable cross-device Cloud in the app.

The public repository is the active project. Issues/Milestones retain acceptance criteria and the private Project provides current-milestone, issue, PR and backlog views. Required Project upkeep is saved in AGENTS.md. Visual board rendering was not verified because browser control was unavailable; item/status/filter verification passed through GitHub's API.

## Main blockers

- [Native dragging, issue 72](https://github.com/devsandip/peel/issues/72): actual packaged title-bar drag checks did not change geometry. Menu arrangement/Undo passed separately. A focused fresh synthetic-library diagnosis is needed.
- [Remote relay feasibility](../features/remote-relay-experiment.md): two disposable experiments failed to establish transfer; the second observed allocation-quota error 486, with its cause not fully proved. Both temporary environments were deleted. Live retries are stopped.
- [Native peer runtime](../features/native-peer-runtime.md): basic capability/host transfer evidence exists, but repeatability stalled in the ephemeral CryptoKey persistence phase. The controlled probe remains stopped.
- [Cloud audit coverage, issue 51](https://github.com/devsandip/peel/issues/51): two earlier bounded observations matched configured identity but returned lake-unavailable. Cause and complete coverage are unproven; account security/audit settings have not been changed to force readiness.
- [Deployment/recovery, issue 30](https://github.com/devsandip/peel/issues/30): complete ownership/absence composition, retained original manifests and durable interrupted-run recovery still need implementation. [Managed proof, issue 31](https://github.com/devsandip/peel/issues/31) is blocked on those gates.

## Deployment, paid plans and release

There is no hosted Peel app, enabled Cloud service, real customer billing or public beta. The Mac bundle is a development build without verified distribution signing/notarization. Pricing/billing terms, quotas, operating controls, restore/release drills, supported platforms and the required 14-day dogfood period remain release work.

Both confirmed storage modes remain required: free device-only storage with periodic encrypted remote peer sync and no server note copies, and paid library-wide DynamoDB Cloud with live updates and local caches. No Google Drive or per-note override is planned.

## Next work

Finish the separately scoped [domain-prefix check, issue 71](https://github.com/devsandip/peel/issues/71), then remaining ownership/lifecycle tooling. Resolve the audit visibility gate before any controlled managed run and verify teardown before enabling a hosted app path. Real Mac behavior, peer connectivity, iPhone, meaning search and release readiness remain separate outcomes in the full [SPEC](../SPEC.md).

This file is a dated snapshot. Use the linked Project and milestone for live status. A later completion report must verify that milestone's own exit criteria rather than relabel this in-progress snapshot.
