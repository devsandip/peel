# Synkies project journal

Last refreshed: 2026-10-29 23:56 IST.

Latest entry: [Closed views keep their upload owner](entries/2026-10-29-2356-closed-views-keep-their-upload-owner.md).

Synkies is a fast sticky-note app with independent Mac notes, a searchable library, free independent Local storage and optional paid cloud-authoritative storage. It was called Peel until 28 October 2026.

## Where we are now

I have Local Mac/browser development clients and tested Cloud foundations. I do not yet have a complete desktop/Cloud beta, enabled Cloud login/live delivery, real billing or an iPhone app. The [PRD](../docs/PRD.md) and [SPEC](../docs/SPEC.md) define active scope; mockups, fixtures and infrastructure PRs are not public app acceptance.

Sandip's 29 October v0.8 contract makes free Local libraries independent, with no pairing/discovery/relay/sync or cross-device awareness. Paid Cloud is authoritative, pushes server-committed changes and provides complete authenticated web access. Offline drafts stay durable Pending until matching current confirmation. The older peer gallery/experiments remain historical without completion credit.

The scoped cached editor/library, resumable downloads and bounded web upload/download transports are merged foundations. PR175 fixed verified retention races (proof6503676649), and peer PR172 adds the responsive development workspace after resolved lifecycle/focus review (proof6504154806); both have separate source/main all3 first-attempt gates, actual closure/Project/primary proof. Issue176 adds same-owner closed-view reopening and stable session/undo handling, with49 focused and final Cloud558/39/shared773/77/66 browser/static/build checks passing before source gates/integration. Default Cloud remains unavailable; authenticated parent/registry and enabled live/reconnect composition remain.

I am building [M2.2](https://github.com/devsandip/peel/milestone/2), tracked in [Project12](https://github.com/users/devsandip/projects/12). Actual managed smoke/independent teardown remains unproven; audit51, managed31 and native72 stay stopped or blocked. Retired/canceled work is not shipped scope. No expired AWS allowance or stopped probe is revived, and no production/billing/public-beta acceptance is inferred from these foundations.

## Recent entries

- [2026-10-29 23:56 IST: Closed views keep their upload owner](entries/2026-10-29-2356-closed-views-keep-their-upload-owner.md)

- [2026-10-29 22:33 IST: Cloud retention tolerates known upload races](entries/2026-10-29-2233-cloud-retention-tolerates-upload-races.md)

- [2026-10-29 21:50 IST: Browser uploads reach the Cloud service](entries/2026-10-29-2150-browser-uploads-reach-cloud.md)

- [2026-10-29 20:20 IST: Browser cache receives Cloud notes](entries/2026-10-29-2020-browser-cache-receives-cloud-notes.md)

- [2026-10-29 19:22 IST: Downloads keep their checkpoints](entries/2026-10-29-1922-downloads-keep-their-checkpoints.md)

- [2026-10-29 18:46 IST: Cached notes become discoverable](entries/2026-10-29-1846-cached-notes-become-discoverable.md)

- [2026-10-29 17:35 IST: Automatic edits are batched](entries/2026-10-29-1735-automatic-edits-are-batched.md)

- [2026-10-29 17:17 IST: Editing reaches server confirmation](entries/2026-10-29-1717-editing-reaches-server-confirmation.md)

- [2026-10-29 16:32 IST: New Cloud notes stay pending](entries/2026-10-29-1632-new-cloud-notes-stay-pending.md)

- [2026-10-29 15:58 IST: Readers finish before the expected commit](entries/2026-10-29-1558-readers-finish-before-commit.md)

- [2026-10-29 14:51 IST: The Cloud editor waits for retention](entries/2026-10-29-1451-cloud-editor-waits-for-retention.md)

- [2026-10-29 14:13 IST: Put away waits for retention](entries/2026-10-29-1413-put-away-waits-for-retention.md)

- [2026-10-29 13:27 IST: Cached is not confirmed](entries/2026-10-29-1327-cached-is-not-confirmed.md)

- [2026-10-29 12:34 IST: Local means this device](entries/2026-10-29-1234-local-means-this-device.md)

- [2026-10-29 12:15 IST: two tiers, no peer sync](entries/2026-10-29-1215-two-tiers-no-peer-sync.md)

- [2026-10-29 11:32 IST: initial state is not a session](entries/2026-10-29-1132-initial-state-is-not-a-session.md)

- [2026-10-29 11:12 IST: keep the old store while moving its engine](entries/2026-10-29-1112-keep-the-old-store.md)

- [2026-10-29 10:49 IST: a catalog without a store](entries/2026-10-29-1049-a-catalog-without-a-store.md)

- [2026-10-29 09:44 IST: a storage version cannot restore a session](entries/2026-10-29-0944-storage-version-is-not-a-session.md)

- [2026-10-29 09:25 IST: response identifiers stay observations](entries/2026-10-29-0925-response-identifiers-stay-observations.md)

- [2026-10-29 08:51 IST: the original request reaches the SDK without a transport](entries/2026-10-29-0851-original-query-without-a-transport.md)

- [2026-10-28 23:21 IST: initial guard facts stay unproven](entries/2026-10-28-2321-initial-guard-facts-stay-unproven.md)

- [2026-10-28 22:30 IST: a consumed run needs current phase evidence](entries/2026-10-28-2230-reserved-run-phase-evidence.md)

- [2026-10-28 22:00 IST: acknowledgements stay in the original process](entries/2026-10-28-2200-fresh-session-acknowledgement-lineage.md)

- [2026-10-28 21:25 IST: original requests without a secret checkpoint](entries/2026-10-28-2125-original-request-transient-material.md)

- [2026-10-28 21:13 IST: a fixed budget for test workers](entries/2026-10-28-2113-bounded-test-worker-budget.md)
- [2026-10-28 19:59 IST: acknowledged original genesis sources](entries/2026-10-28-1959-acknowledged-genesis-sources.md)
- [2026-10-28 19:25 IST: genesis transactions before source acknowledgement](entries/2026-10-28-1925-genesis-transaction-boundary.md)
- [2026-10-28 19:02 IST: journal files before transactional genesis](entries/2026-10-28-1902-journal-file-boundary.md)
- [2026-10-28 18:39 IST: original journal genesis contract](entries/2026-10-28-1839-original-genesis-contract.md)
- [2026-10-28 17:38 IST: shared SQLite mechanics after branding](entries/2026-10-28-1738-sqlite-mechanics-shared.md)
- [2026-10-28 17:10 IST: Synkies and Folded Horizon adopted](entries/2026-10-28-1710-synkies-brand-adopted.md)
- [2026-10-28 16:53 IST: build checkpoint and brand decision](entries/2026-10-28-1653-bootstrap.md)

## Weekly summaries

None yet.

## Working hypotheses

- Independent Local storage and one Cloud authority reduce the transport and trust surface.
- Cloud pending-draft durability preserves responsive offline editing without a false Saved claim.
- Product progress needs complete user flows, not only backend tests and infrastructure counts.

## Open questions

- Active tier/status UI, Cloud login/save-to-web/live delivery, iPhone, meaning search and native acceptance remain.
- Cloud commercial terms and fresh managed-run/audit/cleanup gates remain explicit in SPEC and active issues.

## Things ruled out

- Google Drive storage and per-note mode overrides.
- Reusing expired AWS leases, turning local recovery records into spending authority or treating card counts as product completion.
- Importing private archive history, publishing private notes, or blindly retrying stopped probes.

- Peer discovery, pairing, signaling, TURN relays and peer latest-edit convergence, removed by Sandip on 29 October 2026. Historical failures are retained without becoming current release gates.
