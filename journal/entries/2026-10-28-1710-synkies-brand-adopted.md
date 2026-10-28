# Synkies and Folded Horizon adopted

2026-10-28 17:10 IST. Previous: [Build checkpoint and brand decision](2026-10-28-1653-bootstrap.md).

I applied the new identity in [PR110](https://github.com/devsandip/peel/pull/110), merged after all three required hosted checks passed on its final source. The app is Synkies in the browser, library/settings copy, native menus/windows and Mac bundle. Its icon and outlined light/dark logo are Antigravity v2 Folded Horizon, copied from the exact selected masters with provenance hashes. Project12 is now named Synkies.

I kept the compatible repository/path, bundle identifier, database/cache names, package/import names, export format and Cloud resource/protocol identities. Those names are technical contracts. There is no note migration or account reset. Historical reports and worklogs still describe Peel where that was the name at the time.

Local validation passed456 shared tests,11 browser cases, TypeScript/formatting, native Clippy and34 native tests. The existing ignored crash child is run by its parent harness. The release build produced Synkies.app; I inspected its name, unchanged bundle ID and exact new icon bytes without launching the app. Fresh synthetic desktop light/dark/mobile/compact browser renders loaded the matching logo, stayed within the viewport and switched logo offline. The existing browser chunk warning remains. This is development-build evidence, not signing or native interaction acceptance.

[Issue111](https://github.com/devsandip/peel/issues/111) aligns the presentation gallery. I regenerated110 canonical screens and five dark exports, plus the overviews and contact sheet. IDs, platforms and requirement mappings remain stable. The render/navigation/desktop checks pass; representative Mac, web dark, iPhone and overview images were inspected. The gallery keeps the same independent windows and green minus. Its own PR still needs final hosted gates and merge; these are mockups, not new app features.

I return to [issue106](https://github.com/devsandip/peel/issues/106) after this branding slice. The saved extraction still needs final review and broader/hosted validation. [M2.2](https://github.com/devsandip/peel/milestone/2), audit51 and managed31 remain open. No new milestone completed, AWS run, paid activation or public release follows from the rename.

## Decisions

- I adopted the supplied Folded Horizon assets without redrawing the identity.
- I preserved persistent identifiers to keep existing local data and reviewed resource bindings compatible.
- I put app branding and mockup regeneration in separate focused PRs, then resume the saved refactor.

## Direction changes

- Was the Peel name/old mark in current app surfaces and design exports; now Synkies/Folded Horizon. Functional v0.7 is unchanged.

## Needs revisit

- [Issue106](https://github.com/devsandip/peel/issues/106): finish its remaining checks and review on the saved branch.
- [M2.2](https://github.com/devsandip/peel/milestone/2): actual managed execution/independent teardown and stopped integration gates remain. Native distribution and full public product scope remain in the SPEC.
