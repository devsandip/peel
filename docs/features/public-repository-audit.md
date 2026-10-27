# Public repository snapshot

## Scope and decisions

Sandip authorized public source visibility after a code/history/Actions audit on 27 October 2026. The old history contains personal commit-author email metadata. Sandip chose to keep that private and authorized a new clean public repository rather than rewriting old PR copies. Preserve the original repository/history/logs privately; publish a new root snapshot with GitHub no-reply attribution.

Copy the complete tracked source, canonical documentation, mockups and existing local logo explorations. Exclude Git history, private audit files, scratch data, credentials, databases, exports, build outputs, dependencies, session resumes and Finder metadata. The logo explorations remain unadopted. Public source visibility does not enable Cloud, payments, deployment or public beta; all product acceptance gates remain.

## Audit evidence

- Reviewed 54 commits reachable from three remote branches and both closed PR histories. Scanned 542 text blobs with Gitleaks 8.30.1 and additional private-data patterns. The single historical credential-shaped finding was ordinary experiment prose with missing word spacing; its readable public wording is corrected without suppressing scanner rules.
- Downloaded logs for all 41 Actions runs that executed steps, covering 161 log files and 6,017,195 bytes. Another 35 runs had no executed steps. No uploaded artifacts/releases, repository secrets/variables, reviews, issue/review comments, discussion forum or wiki content existed. Dependency caches were inventoried; the workflow caches package dependencies rather than app data.
- Historical private-data candidates were synthetic example addresses, benchmark numbers/checksums, public vendor/test identifiers and commit-author metadata. No credential or real note content was identified. Raw evidence and identifying values stay in private audit storage.
- Inspected the tracked image inventory and metadata. All 305 PNGs contained only image chunks, without text/EXIF metadata. Local OCR of all 262 historical mockup images produced no credential/private-email candidates. Reviewed the additional logo source and locally OCR-checked all 49 logo exports without finding credential/private-email candidates.

Automated scans and OCR have limits; this is scoped review evidence, not a guarantee that every possible secret format is detectable. Earlier private CI execution evidence remains historical; the new repository requires fresh CI.

## Follow-through

The exact 518-file staged snapshot and its fresh root history pass Gitleaks with zero findings and no matches for the old personal author email. The new public repository has a different identity, a single clean starting commit, and no imported old refs/PRs/logs. Anonymous API access succeeds; the original archive remains private. All 49 additional logo images pass local OCR/pattern checks.

Public CI now executes real hosted jobs. Its first run reproduced the pnpm installer-policy issue, followed by a separate missing temporary-directory issue after installation was repaired. Both fixes and trigger deduplication are separate small PRs with explicit evidence. These are code/setup failures rather than an Actions quota block.

Future agent-created commits use repository-local GitHub no-reply identities. GitHub merges must also receive the explicit no-reply author email and have their metadata verified afterward. The old private history must never be pushed into this repository. Product changes continue in small, single-purpose PRs; public-beta and distribution gates remain unchanged.
