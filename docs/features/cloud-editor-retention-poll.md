# Retry the Cloud editor retention assertion until the draft commits

[Issue 212](https://github.com/devsandip/peel/issues/212), under [M2.2](https://github.com/devsandip/peel/milestone/2), fixes one browser assertion supporting [SPEC](../SPEC.md) FR-02/FR-04 and AC-02/AC-09 save/retention behavior. See [Cloud note editor](cloud-note-editor.md). This plan precedes implementation.

## Purpose and scope

The confirmed-status browser scenario polls the durable pending body after later typing. Pending upload can render before its asynchronous retention commit, so a temporarily null pending branch is an intermediate state the poll must retry. The existing non-null assertions throw instead. Production behavior, timing controls, workers/retries/isolation and the eventual exact retained-body assertion stay unchanged.

Only this feature plan and `tests/e2e/cloud-note-editor.spec.ts` change. Use the existing fixture's held commit to deterministically keep the confirmed record's pending branch absent, assert that the same body projection returns undefined without throwing, release retention, then poll for the exact typed body. Keep the Saved-to-Pending and literal-source safety checks. No new fixture API or production code is needed.

## Validation

Run the actual held-retention scenario with the prior unsafe projection as a negative control, retaining its expected failure; restore the intended source and pass the focused editor/draft browser suites on owned strict65527 without server reuse or test-control changes. Run TypeScript, formatting and whitespace checks. Review and exact-source all3 hosted checks precede normal merge; actual-main checks and issue/Project closure follow separately. No AWS/profile/default notes/OS clipboard/native or stopped probe, no app Cloud activation. Fixtures are synthetic and their existing teardown remains.

## Local evidence

With the actual retention commit held, the previous unsafe projection fails with `Cannot read properties of null` at `snapshot`. The restored optional projection returns undefined while the commit is held, then the same poll proves the exact typed body after release. All 13 editor/draft-session browser cases pass on strict65527 with original controls, followed by TypeScript, formatting and whitespace. No production or fixture file changed. Exact-source hosted and separate actual-main gates remain required.
