# Synkies project journal

Last refreshed: 2026-10-28 16:53 IST.

Latest entry: [Build checkpoint and brand decision](entries/2026-10-28-1653-bootstrap.md).

Synkies is a fast sticky-note app with independent Mac notes, a searchable library, free remote device-only sync and optional paid live Cloud. It was called Peel until28 October2026.

## Where we are now

I have a local Mac development build and browser client. The complete promised sync/search/iPhone/distribution scope remains in the [PRD](../docs/PRD.md) and [SPEC](../docs/SPEC.md); mockups and merged foundations do not establish app acceptance. No public beta, production Cloud or real billing is enabled.

I am building [M2.2](https://github.com/devsandip/peel/milestone/2), tracked in [Project12](https://github.com/users/devsandip/projects/12). Cloud foundations and the creation-journal design are merged; actual managed smoke and independent teardown remain unproven. Audit51, managed31 and native72 keep their explicit stopped gates.

Sandip selected Synkies and Antigravity v2 Folded Horizon today. The visible brand is the immediate work. Issue106's SQLite extraction is saved on its unpublished branch with baseline/post-extraction25 Node24 tests and type checks passing; final review, broader/hosted checks and merge remain. I resume it after branding. Repository and stored identities remain compatible.

## Recent entries

- [2026-10-28 16:53 IST: build checkpoint and brand decision](entries/2026-10-28-1653-bootstrap.md)

## Weekly summaries

None yet.

## Working hypotheses

- Fast durable local capture stays independent of network and paid services.
- Provider/lifecycle and remote transport need end-to-end evidence beyond local fixtures.
- Branding changes must preserve storage compatibility and historical evidence.

## Open questions

- Enabled remote peer/live Cloud, iPhone, meaning search and native release/performance acceptance remain.
- Cloud pricing/billing terms, fresh managed-run authorization and stopped integration gates remain explicit in the SPEC and active issues.

## Things ruled out

- Google Drive storage and per-note mode overrides.
- Reusing expired AWS leases, turning local recovery records into spending authority or treating card counts as product completion.
- Importing private archive history, publishing private notes, or blindly retrying stopped probes.
