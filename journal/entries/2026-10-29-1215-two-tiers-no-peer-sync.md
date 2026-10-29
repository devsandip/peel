# Two tiers, no peer sync

2026-10-29 12:15 IST. Previous: [Initial state is not a session](2026-10-29-1132-initial-state-is-not-a-session.md).

I changed the product direction after Sandip rejected the complexity of remote peer sync. Local storage is now an independent library on each installation. Laptop, phone and browser do not discover, pair with or sync with one another. Cloud storage is the authoritative whole library, with committed updates pushed to online clients and complete authenticated web access.

Sandip explicitly chose offline Cloud drafts. I retain them locally for recovery and upload on reconnect, but show Saved only after matching server confirmation. A local draft commit is not a Cloud save. Newer typing stays pending when an earlier operation is acknowledged. Other clients and the web cannot see a draft before its source uploads it. Put away can close a durably retained draft without pretending Cloud has saved it.

I committed the issue148 plan before editing the canonical contract to v0.8. I retired FR-17/19 and AC-21/25 without renumbering or claiming they passed. I kept server revisions, explicit preservation of conflicting offline drafts, local search, independent Mac notes, the green minus and compatible stored names. The old gallery is labeled historical, with retired peer screens preserved as reference. App labels and enabled Cloud still need implementation.

I updated the existing continuing automation in place to follow this decision and kept its schedule/chat active. I canceled plan-only147 as not planned and removed it from the milestone; no code or experiment for it was implemented. Its unpushed branch/plan remains history. Earlier146 passed all exact-source and actual-main gates and remains a valid storage foundation, not an app outcome.

Static contract/ID/link/HTML checks pass and runtime/tests/workflow/dependencies match the passing base. Current contract formatting is checked; historical screen inventory bytes are preserved except explicit retirement labels. No local runtime suite is repeated for prose. Required exact-head hosted gates and normal integration still follow. No actual note/operator DB, credentials, AWS, billing, app launch or stopped retry occurred.

## Decisions

- I replace peer sync with independent Local storage because Sandip chose the simpler two-tier model.
- I use Cloud as authority and acknowledge Saved only after the matching server commit; local pending drafts preserve offline work without claiming a Cloud copy.
- I preserve retired IDs, artifacts and failed experiments as history, so a scope removal is not reported as shipped functionality or passed acceptance.

## Direction changes

- Local was a periodically synchronized peer library. Local is now independent on every installation with no device relationship.
- Both modes previously described local persistence as a save. Cloud local writes now retain pending drafts; Saved requires server confirmation.

## Needs revisit

- Issue148 closes only the canonical contract revision. Active UI/tier labels, pending-versus-confirmed behavior and a real authenticated Cloud save-to-web/other-device path remain implementation work. Issue30/31/51 and native72 retain their actual unmet/stopped gates; M2.2 and release acceptance remain open. Peer transport is removed from product scope, not a reason to retry or erase old probes.
