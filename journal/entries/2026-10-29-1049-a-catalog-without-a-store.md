# A catalog without a store

2026-10-29 10:49 IST. Previous: [A storage version cannot restore a session](2026-10-29-0944-storage-version-is-not-a-session.md).

I integrated PR140 as293f300 after focused review and all three exact-source gates. The docs-only main push triggered no eligible new workflow. I verified tested-tree equality and unchanged runtime against5430f71, whose actual main gates passed. Issue139 and both Project cards are complete. The decision preserves v1 and a separate future v2 path; it does not implement a migration or store.

I then froze a passive v2 catalog under issue141. Plana3356a8 came before the first independent Python SQLite golden and artifact. The module exports only fixed frozen metadata and SQL, with no path, execution function, store or permission. Tests execute that SQL only in fresh synthetic namespaces/in-memory databases. The catalog reserves the original genesis, actual state revision, four intents/fences,64ordinary/32cleanup observations and one teardown root. It stores no key/full unsigned body/credential or ready flag. Future typed row acceptance and all actual current gates remain separate.

Page geometry changed the design before publication. The same maximal SQL-valid data used465pages ascending,507 descending and470 shuffled, all below512. I did not treat one order as universal capacity proof. Revised plan43c8247 then required contiguous append IDs before the artifact changed; a second independent golden preceded that update. No cap increased and no real operator database existed to migrate.

On the final ordered catalog, actual Node24.22.1/SQLite3.53.4 uses465pages /1,904,640bytes for all maxima, including reserved cleanup after ordinary exhaustion. Live rollback is21,032bytes. DBSTAT measures largest observation/root payloads at2006/1997bytes. Header, integrity and foreign-key checks pass. These are SQL-valid padding/physical measurements, not domain/provider/ownership or cleanup-completion evidence. Every temporary database was removed.

All13 final cases pass. They cover exact independent catalog bytes, conflict replacement/ignore and immutability, token/tuple/revision/byte limits, contiguous ordering and separate capacities. Omitting only the ordinary bound fails its intended refusal; exact source was restored. Actual Node24 direct/394 Cloud cases then609 shared/type/format/build pass under unchanged defaults. V1 code/tests/dependencies remain unchanged and the existing browser chunk warning remains. Hosted exact-head review/gates still precede integration. The app and all stopped real gates are unchanged.

## Decisions

- I export passive compiled SQL without a database executor or caller schema override, so this artifact cannot create a protected namespace or grant execution.
- I reserve64bytes within the2KiB row envelope and require ordered IDs, because physical SQLite packing needs measurement rather than logical sums.
- I keep SQL-valid capacity padding distinct from typed domain/provider evidence; later stores/codecs must reject unsupported records.

## Direction changes

- The first candidate allowed arbitrary observation ID order. The final pre-release catalog requires contiguous append IDs across both categories, with a revised committed plan and independent golden before code.

## Needs revisit

- Issue30 still needs actual protected v2 storage/bootstrap/readers and ACK/crash evidence, current collector/phase/runway provenance, private preparation/fence, real transport and provider ownership/complete teardown. Issue31/51, M2.2 and app/release acceptance remain open or stopped. Issue141 closes only this passive catalog/capacity prerequisite.
