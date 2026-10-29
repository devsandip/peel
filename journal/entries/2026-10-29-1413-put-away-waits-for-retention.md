# Put away waits for retention

2026-10-29 14:13 IST. Previous: [Cached is not confirmed](2026-10-29-1327-cached-is-not-confirmed.md).

I integrated PR153 after all three source gates and verified all three actual-main jobs40840091152. Its read-only Cloud cache panel remains outside the default app route. Actual closure/Project status, primary advancement and owned branch cleanup are recorded in proof6491628289.

Under issue154 I added a scoped session for an already cached active Cloud note. Typing starts pending-draft retention immediately. Put away locks further edits, waits for the latest retained text and then settles as closed. A failed write keeps the session open with copyable text and generic recovery. Retention alone stays Pending upload or Conflict. The API does not close an actual window or activate Cloud.

Actual SQLite service receipts, failed/held commits, reopen, competing editors, lost local commit replies and newer typing pass. Review caught an older refresh error replacing a newer successful refresh without typing; a request sequence now discards that late error. Removing the close await fails the held-write refusal, with exact source restored before positives. Final checks pass30 focused Node24 tests,635 shared tests and27 browser flows, including actual IndexedDB retention/reload/failure. Type/format/build pass; the old bundle warning remains. Earlier failures remain evidence, and no timeout or legacy assertion changed.

## Decisions

- I keep retention and Cloud confirmation separate. A closed local session is not an acknowledged Cloud save.
- I refuse to replace a competing projection and preserve copyable text. Existing Cloud revisions/conflict branches remain authoritative for resolution.

## Direction changes

None. This is a disabled session prerequisite under the confirmed v0.8 contract.

## Needs revisit

- Issue154 still needs exact-source hosted review/gates and normal integration. The full Cloud editor/new-note flow, authenticated reconnect upload, complete web inventory/live delivery, native/iPhone and M2.2 managed/independent teardown remain. Existing stopped probes and expired allowances are unchanged.
