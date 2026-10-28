# Original plan and recorded reservation binding

## Purpose and scope

[Issue96](https://github.com/devsandip/peel/issues/96) connects the [original plan context](cloud-run-plan-context.md) to the existing [run ledger](cloud-run-ledger.md)/[owned namespace](cloud-ledger-namespace.md). This is one issue30/[M2.2](https://github.com/devsandip/peel/milestone/2) prerequisite for SPEC FR-04/14/20 and AC-04/12/13. Integrity of supplied plan bytes alone cannot establish that the selected existing ledger contains the matching reservation. No app/v0.7 change, AWS operation, actual operator/default note database or stopped-probe retry.

## Local inspection contract

Require exact context JSON and original recipe/pins, plus an explicit independently trusted canonical ledger directory/original authority. Validate/copy original context and authority before namespace access. Reuse the existing public owned-store/ledger APIs and a narrow pure authority normalizer; do not bypass schema/path/ownership checks with raw SQL. Open existing only, never initialize, choose a fallback, reset, migrate, repair, reserve/refund a slot or record cleanup. SQLite's existing recovery behavior remains its own contract; this operation does not issue a fresh sync acknowledgement.

Match the actual ledger's authority identity/digest and original run/normalized-plan digest, original authority cleanup margin, recorded reservation time against the original lease/start/creation windows, and the original slot envelope (slot1=>3USD, slot2=>5USD). Keep first-run inspection valid after the current ledger grows to two runs. A recorded cleanup receipt is only recorded metadata; return a boolean indicating its presence, not a new deletion/provenance assertion. A supplied reservation object, current total envelope or manual approved/owned flag cannot replace actual existing storage.

Return detached frozen digests/reservation facts, no raw filesystem paths or provider data, zero resource writes, and ownership/run authority unproven. Selecting another directory is not an additional spending grant: the eventual orchestrator must retain one independently trusted canonical location. This observation cannot grant a future atomic AWS write; canonical binding must be rechecked by later durable intent/execution code.

Original authority/lease/source/quote expiry cannot gate inspection; no live clock, current factory/new-run validator/cost or provider lookup. Fixed private failures preserve unknown namespaces/data.

## Verification plan

Use only fresh synthetic temporary namespaces through actual existing ledger/recipe/context APIs. Test actual first/second-slot records and first-after-second inspection, no row mutation, missing/other reservation, wrong plan/identity/authority/pins, malformed timestamp/envelope, missing/linked/unknown/corrupt namespace preservation, strict getters/overrides/private failures, expired context and all current helpers/clock unavailable. Extend synthetic fixture generation additively if needed, without changing frozen legacy output. Run actual Node24 direct import/focused/legacy tests, shared type/format/tests/build, scans/no-reply, focused review and all three exact-head hosted gates before one focused merge. No durable intent/provider ownership/managed/app acceptance; audit51/managed31/M2.2 remain open.
