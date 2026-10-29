# The original request reaches the SDK without a transport

2026-10-29 08:51 IST. Previous: [Initial guard facts stay unproven](2026-10-28-2321-initial-guard-facts-stay-unproven.md).

PR134 integrated the supplied initial-guard data contract as b4179c5 after focused review and all three exact-source gates. Its actual main run40810555610 also passed web-and-core, cloud-artifact and native. Issue133 and both Project cards are complete. This checks original/current supplied facts; it does not establish actual provenance or readiness. M2.2 and the stopped real audit/managed/native gates remain unchanged.

The next independent prerequisite checks what the pinned CloudFormation SDK actually serializes. Issue135's plan15b2ab0 came before dependency/code changes. The pure checker compares a bounded closed unsigned transport view with the exact original material retained behind an active request handle. Every supplied field and original omission matters, including template, token, tags, capabilities, deployment/rollback defaults and the transient NoEcho parameter. Equivalent form encoding/order is allowed; duplicate names, unknown fields, altered values and lost handles refuse privately.

The actual SDK, rather than a test-only serializer, supplies all four positive requests. It reaches an in-memory synthetic handler with fake credentials and isolated empty configuration. File/network guards record zero private reads or actual network calls. Bodies and signed headers stay in child memory. The public result contains only original commitments/counts and unproven authority. Changing the private key changes its complete commitment, and the wrong active material cannot validate an earlier body. This adds neither an SDK runner nor a send capability.

Twelve focused child scenarios pass. Removing only duplicate-name refusal produces the intended negative-control failure; exact source was restored. Actual Node24 direct/373 Cloud cases, then588 shared/type/format/build pass sequentially. Existing browser chunk warning remains; there is no failed positive run. Exact-head hosted gates and final review still precede integration. App behavior and all product acceptance remain unchanged.

## Decisions

- Use actual pinned SDK serialization as the positive oracle, because the service model/default/omission encoding must be observed rather than assumed from current documentation.
- Keep unsigned consistency separate from signatures, actual transport provenance and execution authority; a caller view cannot prove an actual send or account permission.
- Keep NoEcho material in memory and bind only its full original unsigned commitment, avoiding a secret-bearing body or separate key hash in durable output.

## Direction changes

- The broad transport slice now has one independent offline unsigned-serialization prerequisite before actual collector/preparation/fence integration. No stopped real component is retried.

## Needs revisit

- Issue30 still needs actual current collector/phase provenance, durable preparation/fence, real bounded transport/signing/header policy, provider ownership/settlement and complete teardown. Issue31/51, M2.2 and all app/release acceptance remain open or stopped; issue135 covers only the offline contract.
