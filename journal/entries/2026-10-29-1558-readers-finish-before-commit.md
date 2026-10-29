# Readers finish before the expected commit

2026-10-29 15:58 IST. Previous: [The Cloud editor waits for retention](2026-10-29-1451-cloud-editor-waits-for-retention.md).

I integrated PR157 after all three source gates. Actual main40850706587 first failed the old preparation race with419 passes and one failure: zero acknowledged processes instead of one. Web and native passed. After inspecting that assertion and one focused synthetic case, one bounded failed-job recheck passed; the original web/native execution timestamps carried forward. Proof6493475426 records the failure separately. Actual closure/Project status, primary advancement and owned cleanup are verified. The Cloud editor remains disabled.

I tracked the failure as issue158 and committed planb27fa77 before diagnosis/code. A real SQLite reader can prevent COMMIT while another initializer's reservation is busy. Both may correctly refuse and preserve their workspaces. A deterministic probe and then two real processes reproduce that outcome with zero rows. The old free-start fixture required progress without specifying those reader/commit conditions; the strict initializer never promised it. The original CI refusal details are missing, so I do not claim its exact schedule or a timeout cause.

I now pause the real writer before COMMIT, let the competing initializer refuse and close its reader, then release the writer. The original one-ACK/one-refusal/one-row assertions and deadline remain byte-identical. The opposite order is a new regression: both refuse, no rows are consumed, workspaces remain and restart cannot mint a session. Reversing only the positive release order fails the old zero-ACK assertion deterministically, with exact source restored before positives.

Actual Node24 preparation24 and Cloud421/34 pass, then shared636/72, type/format/build pass under unchanged defaults. Production code/configuration and app bundle are unchanged. This is a fixture correction with actual contention evidence, not a relaxed ACK policy, provider run or enabled app. Hosted source/main verification still follows.

## Decisions

- I specify the positive test's reader lifetime rather than require every arbitrary contention schedule to make progress.
- I keep both-refused behavior in an actual-process regression, preserving recovery and no-ACK safety.

## Direction changes

None to product or private guard policy. The positive fixture now states its required COMMIT conditions explicitly.

## Needs revisit

- Issue158 needs focused hosted review/gates and normal integration. The old CI event's exact refusal trace remains unavailable; future different failures need their own evidence. M2.2 actual managed/independent teardown, audit51/managed31/native72 and enabled Cloud remain unmet/stopped. No expired budget or stopped probe is revived.
