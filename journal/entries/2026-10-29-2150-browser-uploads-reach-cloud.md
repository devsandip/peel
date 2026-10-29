# Browser uploads reach the Cloud service

2026-10-29 21:50 IST. Previous: [Browser cache receives Cloud notes](2026-10-29-2020-browser-cache-receives-cloud-notes.md).

I completed PR170/issue168 at merge0e2dc1d with all three source40895731617 and separate actual-main40896979983 gates on first attempts. Proof6500447037, actual closure, Project status and owned cleanup are verified. The earlier2020 entry remains its historical snapshot.

I planned issue171 before code. Browser uploads now use the same captured-origin, issued-CSRF, bounded JSON machinery as downloads, after validating the immutable operation and its actual content hash. An account cancellation during hash preparation prevents dispatch. The complete-operation deadline covers preparation, headers and body; response and request bytes are bounded. Neither factory issues authentication or paid entitlement.

Three actual browser IndexedDB/owned HTTP/SQLite cases prove held acknowledgements cannot mark newer typing Saved,401 pauses without automatic failed retry, and a lost successful response recovers through the identical durable operation after reload. Fifty-seven focused transport cases pass. The first full Cloud run had four existing time/child-limit failures; its later stages never ran. After the peer released its test window, one unchanged sequential run passed Cloud542/39, shared757/77 and54 browser cases, plus static/build and unchanged default bundle hashes. The initial failures remain evidence; resource contention is an inference.

Antigravity submitted PR172 independently. Its frozen c5 passed hosted checks, but focused review reproduced two lifecycle/accessibility defects: duplicate Put-away notification during concurrent close routes, and keyboard focus landing on a different note with the same title. Review5701065953 requests owned-file fixes and a new frozen Ready head with fresh gates. I left its checkout and files untouched and released the test window.

## Decisions

Share bounded browser transport internals while preserving the existing download API and tests. Coordinate test windows without weakening defaults or stopping unrelated processes. Review behavior even when hosted gates are green.

## Direction changes

None. The confirmed independent Local and cloud-authoritative v0.8 scope remains.

## Needs revisit

Issue171 source/gates/integration/main proof and peer169/PR172 corrected Ready head. Default Cloud remains disabled. Real authentication, paid activation, full web, live/reconnect, native/iPhone/performance and actual M2.2 managed/independent teardown are unproven. Expired allowances and stopped probes remain stopped.
