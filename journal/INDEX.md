# Synkies project journal

Last refreshed: 2026-10-29 12:34 IST.

Latest entry: [Local means this device](entries/2026-10-29-1234-local-means-this-device.md).

Synkies is a fast sticky-note app with independent Mac notes, a searchable library, free independent Local storage and optional paid cloud-authoritative storage. It was called Peel until 28 October 2026.

## Where we are now

I have local Mac and browser development clients and tested backend foundations. I do not yet have a complete desktop/Cloud beta, enabled Cloud login/live delivery, real billing or an iPhone app. The [PRD](../docs/PRD.md) and [SPEC](../docs/SPEC.md) define the active scope; mockups and infrastructure PRs are not app acceptance.

I adopted Sandip's 29 October v0.8 simplification under issue148: Local libraries are independent, with no pairing, discovery, relay or sync. Cloud is authoritative, pushes server-committed updates to online clients and provides the complete confirmed web library. Offline Cloud edits remain durable pending drafts and are Saved only after matching server confirmation. The v0.7 gallery and peer experiments remain historical. PR149 integrated that contract with passing source gates and honest docs-only main proof. Issue150 now aligns the visible Local/Cloud tier copy, with browser isolation/flow checks passing and its own hosted gates still pending. Actual Cloud save/status implementation remains.

I am building [M2.2](https://github.com/devsandip/peel/milestone/2), tracked in [Project12](https://github.com/users/devsandip/projects/12). PR146's fixed initial-state store passed source/main checks, but actual managed smoke/independent teardown remains unproven. Issue147 was canceled after planning, removed from the milestone and is not shipped progress. Audit51, managed31 and native72 remain stopped or blocked. The continuing automation now follows v0.8; no expired allowance or stopped probe is revived.

## Recent entries

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
