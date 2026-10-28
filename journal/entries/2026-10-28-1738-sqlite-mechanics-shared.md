# Shared SQLite mechanics after the Synkies rename

2026-10-28 17:38 IST. Previous: [Synkies and Folded Horizon adopted](2026-10-28-1710-synkies-brand-adopted.md).

I finished the branding checkpoint in PR108/110/112. The app, icons, current docs and110canonical mockups plus five dark exports now use Synkies/Folded Horizon. Each PR passed its required source-head checks before merge. PR110 also passed its separate integrated main checks. The preserved repository/storage/protocol identities are unchanged.

I returned to [issue106](https://github.com/devsandip/peel/issues/106). I extracted the existing owned SQLite mechanics into a fixed internal helper so the next journal wrapper can reuse them without copying the entire funding ledger. The funding schema, bytes, public behavior and reservation/cleanup policy stay the same. This is preparation for journal genesis, not that journal or a new AWS permission.

I tested the compatibility cases against the original implementation before extraction, then against the extracted version.26 namespace/ledger cases include actual independent writers and interrupted commits.246 focused Cloud cases under actual Node24 and461 shared cases, type/format/build pass. A deliberately removed metadata validator fails the intended refusal test; the source is restored. Final hosted gates/review still precede this slice’s merge. These results establish local mechanics compatibility, not physical power-loss, same-UID protection, managed teardown or app Cloud acceptance.

[M2.2](https://github.com/devsandip/peel/milestone/2) is still open. I next need a separately reviewed fixed journal namespace/genesis, followed by immutable request/token/fence/receipt/lifecycle work and fresh valid managed-run authorization. I do not treat a record on disk as proof of ownership, available budget or successful cleanup.

## Decisions

- I kept compatibility extraction separate from new journal bootstrap/hardening and execution policy.
- I preserved original real process tests and checked new compatibility assertions against baseline before relying on them.

## Direction changes

None in product scope. The existing SQLite mechanics now have one shared implementation; the new journal remains a separate deliverable.

## Needs revisit

- [Issue106](https://github.com/devsandip/peel/issues/106): exact-head hosted gates and focused review before merge, then Project/evidence updates.
- [Creation-journal plan](../../docs/features/cloud-creation-journal.md): fixed genesis/bootstrap and later slices remain; audit51/managed31 and actual M2.2 exit gates remain open.
