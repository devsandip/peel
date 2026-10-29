# Cloud retention tolerates known upload races

2026-10-29 22:33 IST. Previous: [Browser uploads reach the Cloud service](2026-10-29-2150-browser-uploads-reach-cloud.md).

I completed PR173/issue171 at d6d48dd after all three source40910952734 and actual-main40912555135 gates passed on first attempts. Proof6502648584, actual closure, both Project cards, guarded primary advancement and scanned owned cleanup are verified. The earlier2150 entry remains its historical snapshot.

The peer's workspace fix exposed an existing cached-editor failure when typing immediately after opening. I planned issue174 before code and reproduced valid retention races using actual owned SQLite: initial upload preparation or its known older acknowledgement advances the generation while the newer draft is waiting to commit. Put away then refused to close. The deterministic cases prove a runtime problem with that symptom, not the exact unrecorded hosted interleaving.

I distinguish an actual refused CAS from a storage exception. Retention can reobserve once only when the complete validated state matches one real preparation or exact acknowledgement of the previously known operation. Hashes and immutable operations stay intact. Different text, unknown write outcomes, multiple transitions, repeated contention and conflicting heads require conservative recovery. Focused review first exposed an acknowledgement consuming an observed conflicting head; the final guard keeps newest text copyable and explicit Retry preserves both branches.

Final39 focused cases, sequential Node24 Cloud548/39 and shared763/77,56 browser cases, type/format/whitespace/build and unchanged default bundle pass. The earlier547/762/56 full pass precedes the strengthened conflict guard. Two controlled browser IndexedDB/HTTP/SQLite races close while responses are held, show Pending and reach Saved only after matching current confirmation; a separate scoped API read verifies the committed text. Initial runtime reds and three new-fixture mistakes remain separate evidence. Existing assertions/defaults and worker/time/retry/isolation limits are unchanged.

Antigravity holds ab64 with its two workspace regressions passing and the shared failed run retained. I left its files and checkout untouched, coordinated local test windows and will publish the next verified base after Root174 integration/main proof. Default Cloud remains unavailable.

## Decisions

Recover once only from a completely verified known local protocol transition. Keep failures and fixture corrections visible. Preserve separate ownership and fresh Ready heads for peer integration.

## Direction changes

None. Autosave and the confirmed Local/Cloud scope remain unchanged.

## Needs revisit

Issue174 source/gates/integration/main proof, then peer169/PR172 fresh rebase/Ready/review/gates. Real authentication, paid activation, full web/live/reconnect, native/iPhone/performance and actual M2.2 managed/independent teardown remain unmet. No expired allowance or stopped probe is revived.
