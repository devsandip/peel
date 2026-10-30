# Bounded audit diagnostic review packet

[Issue 219](https://github.com/devsandip/peel/issues/219) is one offline preparation slice under blocked [audit 51](https://github.com/devsandip/peel/issues/51) in [M2.2](https://github.com/devsandip/peel/milestone/2). SPEC FR-04/14/20 and AC-04/12/13 prerequisites, [audit observations](cloud-audit-observations.md) and [hosting controls](cloud-dev-hosting.md) govern it. This plan is committed before any candidate-program edits.

## Reviewable scope

Prepare a concrete operator candidate in this runbook, with exact extraction/invocation instructions and a hash of the reviewed source. The public deliverable is documentation, not a new runtime module, capability codec or app feature. Extracted candidate and its synthetic-only tests stay ignored under scratch. Use the existing inspection-identity and fixed audit-command helpers rather than inventing credentials or a new AWS client. No new package and no changes to those production helpers, the app or workflows.

A future explicitly authorized run may issue at most three sequential ListEventDataStores metadata reads, in order us-east-1, us-west-2, af-south-1, one item/page and no pagination. Independent original expected-account/profile pins must be supplied; never derive expected identity from observed STS output. Recheck current inspection identity and configured role before and after a completed sample. Do not export credentials or read audit event bodies, notes, selectors or configuration beyond the existing identity safety checks.

The hard combined deadline is 120 seconds, including both identity gates. Each Lake command has a 15-second maximum, one SDK/CLI attempt and fixed endpoint; identity retains its existing 45-second bound, capped by the same parent abort. The total deadline may refuse completion even when each individual bound has not expired. An operator-supplied fresh authorization cutoff must also be checked before/after every awaited stage; no default or automatically renewed cutoff.

Stop immediately on invalid/mismatched identity or role, unsupported environment, unknown/denied/malformed/nonempty/partial response, caller cancellation, expired cutoff or deadline. No later region or final identity read starts after such a stop. Only three complete empty pages proceed to the final identity check. Even then the result is merely a bounded diagnostic sample: full coverage, hooks/trails/organization visibility, auditReady and managed/teardown authority remain unproven. Never feed it into hosting readiness or infer SCP/opt-in/root cause.

Outputs contain fixed stage, reviewed public region, safe reason codes and small counts/booleans only. Drop raw provider output, messages, IDs, ARNs, account/profile strings and credentials. Preserve unrelated processes and settings. No provider/profile/config access is allowed during preparation. The expired October 28 allowance and stopped collector are not revived.

## Required offline evidence

Validate the exact extracted candidate with injected synthetic identity/commands, including full empty sample, immediate nonempty/partial/unknown/failure stopping, no retries/pagination, fixed scope/wire arguments, privacy, invalid inputs and getters, input capture, clock/cutoff/deadline/cancellation (including ignored stalls), account/role drift and absence of late work after stop. Deny network/default command execution in the tests. Document actual checks and limits; no fake live observation or passing unrun check.

Antigravity independently reviews a frozen source snapshot after its separate issue213 assignment exits. Codex runs the tests and checks, obtains the review, and submits one focused documentation PR closing219, referencing but not closing51. Required exact-source and separate actual-main gates still apply. Fresh specific operator approval of this concrete packet, private pins and current source/budget/authorization are separate from merging it. Actual51/30/31 acceptance stays blocked.

## Candidate status

Not implemented or executed yet. No live command has been approved. The next step is to add and synthetically validate the bounded candidate described above, then request independent review before publishing the focused PR.
