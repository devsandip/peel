# Scoped Cloud conflict-resolution controller

[Issue204](https://github.com/devsandip/peel/issues/204) follows PR203's read-only conflict preview. SPEC FR-02/04/07/13/14 and AC-02/09/10/12/13 prerequisites, [preview](cloud-conflict-preview.md), [library owners](cloud-library-owners.md), [upload](cloud-note-upload.md) and the existing durable conflict contract govern this slice. This plan is committed before runtime/tests.

## One correctness boundary

Add CloudConflictResolutionController in apps/web/src/cloud-conflict-resolution.ts, meaningful unit evidence and narrow additive owner/upload coordination. No workspace/preview/CSS/browser fixture edits, default route, new storage schema, auth grant, account switch, live connection, hosted provisioning or public acceptance. Antigravity205 separately owns read-only workspace inspection; later resolution controls consume the real controller after it merges.

Freeze in169 before code:

- CloudLibraryOwners.conflicts() returns one lazy captured controller without I/O, using its original store/frozen scope/authenticated sender/signal and a private exclusive-note operation.
- read(noteId) returns a deeply frozen validated view: noteId, generation (null for missing), actual cache status, conflict (actual local action, observed remote snapshot/null and revision) and canMerge. Missing remote text is distinct from an empty active note. No scope/auth is selected by UI.
- resolve(noteId,expectedGeneration,choice) accepts exactly {kind:"local"}, {kind:"cloud"} or {kind:"merge",bodyMarkdown:string}. The controller re-reads actual conflict under its note gate, rejects a stale generation and uses the actual stored branch. Merge replaces only the body/update timestamp of an active local upsert, preserving identity/origin/lifecycle; it does not restore archived/trashed notes or recreate a purged ID.
- retry(noteId,expectedGeneration) is an explicit bounded attempt of the retained pending/in-flight mutation. No implicit retry or continuous loop.
- Mutation methods return frozen {kind,view}, with fixed kinds complete, pending, conflict, sign-in-required, paused, canceled, stale, busy, new-note-required or unavailable. read failures throw a fixed typed error; raw causes, provider bodies, note text and credentials never become error messages.

## Ownership and transitions

The original CloudLibraryOwners gates one note at a time. Refuse if that note is opening, another resolution is running, or an owned editor is open/not durably retained/errored. A closed retained owner must have no current upload/reopen task; expose an additive readiness predicate on CloudNoteUpload. Retire only that proven quiescent closed owner, revoking its queued timer before any durable resolution. Reject same-note open/register while the gate is held. Other notes remain independent. This is a per-owner gate plus durable CAS, not a global browser lock.

A caller must put away the active editor through the existing retention/parent acknowledgement path before resolution. Busy/stale refusal never drops typing or resolves implicitly. If the controller retires a closed owner but later storage fails, all recoverable work remains in the original durable store, and later explicit opening obtains fresh state. Never close caller stores or enumerate a default database. Abort withholds late results and any not-yet-started commit; a commit already in progress may finish only in its original scope and is not represented as rolled back.

Use DurableCloudClient.resolve for the generation-bound local CAS. Accepting the observed Cloud branch adopts its previously confirmed head without inventing a new server receipt or a latest/Live claim. Local/merge choices remain Pending until a matching authenticated server result. A purged remote identity allows acceptance/deletion only; preserving old text requires copying/recovery into a new identity in a later slice. Local purge remains an explicit deletion choice, not a body merge.

After confirmed local CAS, perform at most one mutation through the original sender. Reuse existing prepare/retry/hash/request/reply validation and applyCloudServerReply. Preserve exact in-flight operation identity across transport loss,401,5xx or malformed responses. Explicit retry never creates a new operation for an existing in-flight mutation. A newer409 becomes an actual new conflict. Reconcile-required pauses without fake ACK. Fresh final cache projection prevents a response for earlier text from marking later edits Saved. A later generation before preparation refuses stale rather than silently sending a new choice.

## Evidence and scope

Use fresh explicit SQLite caches/accounts and real existing library owners, durable protocol, service/HTTP mutation handler behind synthetic authentication. Cover local/observed/merge, empty bodies/lifecycle/purge, no-network construction/read/remote acceptance, open/dirty/upload/opening owner refusal, retired queued timer, captured context, foreign/stale/concurrent generations, held reads/commits/sends, abort, server401/503/wrong/missing ACK/409, lost response and exact retry, later text before ACK, corruption/read/commit failures, and no caller-store closure. Release all held tasks, abort owned controllers and remove only fresh fixture directories. Preserve old assertions/defaults/workers/timeouts/retries/isolation.

Run meaningful focused Node24 + existing owner/upload/durability suites and relevant shared/type/full format/whitespace/artifact/build checks. No UI change warrants another browser sweep for this controller. Add its unit to the Node24 hosted list; require focused exact-source review/all3 source gates, normal scanned no-reply merge and independent actual-main/closure/Project/guarded-primary proof. Coordinate windows in169; Root65527/peer65528 strict/no reuse. Do not retry stopped native/peer probes or prior local adapter acquisition.

M2.2 stays open. Synthetic HTTP identities and SQLite do not prove real login, paid entitlement, hosted web, socket/live delivery, native/iPhone or managed teardown. Public requirements remain unchanged. Backfill PR202/203 integration proof in new WORKLOG/journal/INDEX artifacts; preserve frozen history and the receipt-bound approved WORKLOG append.

Verified starting mainffa55a57a7a5409c3277fb010234fdf52c5208a4, PR203 final proof: https://github.com/devsandip/peel/pull/203#issuecomment-6523446267.
