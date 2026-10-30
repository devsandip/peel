# Safe attribution for unavailable Cloud audit collection

[Issue216](https://github.com/devsandip/peel/issues/216), under issue51/[M2.2](https://github.com/devsandip/peel/milestone/2), supports [SPEC](../SPEC.md) FR-04/14/20 and AC-04/12/13 prerequisites. Read [audit observation](cloud-audit-observations.md). This plan precedes implementation.

Add fixed stage and validated public-region context to unavailable outcomes from the existing collector. Bind concurrent failures to their own operation, and leave region null when global timeout/abort cannot identify one. Return no raw provider errors, metadata, identifiers or caller-supplied private strings. If needed, expose a frozen copy of the reviewed public region list from audit-regions.ts only to whitelist diagnostic names; existing registry parsing/output/ordering stays unchanged.

Successful observed output, classifiers, identity/cutoff/credential requirements, all-region coverage, ordering/concurrency, pagination/readiness policy remain unchanged. These diagnostics cannot prove historical cause, disabled opt-in status, account policy or audit absence. No new command, live provider/profile/config/private-data read, stopped retry, permissions or app change.

Existing module/unit tests plus this plan are owned, with only the bounded public-list export allowed in audit-regions.ts. Synthetic tests cover first/later concurrent failure attribution, earlier/final stages, abort/deadline, unknown region redaction, privacy/immutability and unchanged success/readiness. Root executes Git/tests after the file-edit worker exits because agy shell is denied; no settings are broadened. PinNode24 focused/static/shared and source/mainall3 plus review precede acceptance. Parent51 remains unresolved until actual evidence exists.
