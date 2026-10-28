# Zero-timeout ledger contention verification

[Issue116](https://github.com/devsandip/peel/issues/116) fixes a verification assumption in the [funding ledger](cloud-run-ledger.md), within [M2.2](https://github.com/devsandip/peel/milestone/2). It supports SPEC FR-04/14/20 and AC-04/12/13 prerequisites without changing product or funding behavior. Plan committed before code.

The original real-process race test assumes exactly one writer must acknowledge. busy_timeout0 makes transient refusal legitimate; a writer blocked at COMMIT is reported uncertain and rolled back where possible. A shared-reader barrier demonstrably gives busy+uncertain with zero committed reservations. The uninstrumented original failure's precise interleaving remains unproven. This is not a reason to add retries or spend another slot.

Keep the two independent uncoordinated writers, but assert at most one acknowledgement and at most one actual committed reservation. Include run identity in the test worker output, correlate any acknowledgement with the stored row andUSD1+2per-slot envelope, and accept only conservative typed contention/storage refusals. A stored slot without an acknowledgement requires an uncertain outcome and stays consumed. Add a deterministic case holding a real shared read transaction: both writers must refuse, at least one must reach commit uncertainty, then after the reader releases the actual ledger remains unchanged. No test-level retry substitutes for the invariant.

Preserve all existing real SIGKILL/commit-ack cases. No production module, schema, timeout, funding policy, actual/default operator/note database, AWS call or stopped probe changes. Use fresh synthetic temporary stores only. Run actualNode24 targeted/ledger/consumer tests, shared/type/format/build and all3required exact-head hosted gates with focused review/no-reply/scans before merge. The paused pure genesis issue115 resumes afterwards; issue114/M2.2/managed/app acceptance stays open.

Validation pending. Controlled diagnostic proof is recorded in issue116; it is not a passing result for the modified tests until they run.
