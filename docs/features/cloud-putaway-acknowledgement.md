# Acknowledge retained Cloud Put away before starting another flush

[Issue208](https://github.com/devsandip/peel/issues/208) corrects the real workspace composition found by Claude while building206. SPEC FR-02/04/07/13/14 and AC-02/09/10/12/13, [upload](cloud-note-upload.md), [owners](cloud-library-owners.md) and PRFAQ Put away govern this small fix. This plan is committed before runtime or regression edits.

## One ordering correction

CloudNoteEditor already awaits local session.putAway before invoking its parent. CloudUploadingNoteEditor currently starts upload before the parent's acknowledgement. With no active upload, that starts a verifying session.flush, making retained temporarily false exactly when CloudLibraryOwners checks it. A clean Saved/Conflict note can remain stuck open despite safe durable contents.

Change only the wrapper ordering: await the parent's acknowledgement of the retained session, then initiate the existing upload without waiting for its network response. Keep owner guards, durable schema/protocol and public component interfaces unchanged. A rejected parent acknowledgement must not start an extra upload; existing pending data remains retained for retry. Context cancellation still reaches the same uploader. Do not edit Root207, Antigravity205 or Claude206 paths.

## Evidence before integration

Extend the existing real owners/workspace browser regression file, using its explicit fresh IndexedDB caches and owned SQLite/HTTP synthetic service. Prove a settled Saved note closes with no request in flight, a real409 Conflict can close while preserving both durable versions, and prior dirty-retention/held-network/account-cancellation cases remain passing. Run these new cases against unchanged source first to observe the defect, then after the ordering correction. Test genuine parent-acknowledgement failure if a deterministic existing fixture can express it without weakening controls.

Use Root's strict65527 port without reusing servers and coordinate shared heavy checks in169. Relevant focused Node24 owner/upload tests, type/full source format/whitespace/build and exact-source all3 hosted gates are required. Ask Claude for independent frozen-head review. Merge normally with no-reply metadata and range scan; separately verify actual-main gates, closure/Project/status and guarded primary update. Issue208 remains open until206 can remove its expected-failure/reload workaround and use real Put away.

No Cloud enablement, real login, hosted service, native acceptance or M2.2 completion is claimed. Scope is the editor wrapper, existing owners browser regression and this plan.
