# Atomic local Cloud state and pending mutations

## Requirements and plan

FR-02/04/13/14 and AC-02/09/12/13/16/24 require local note text and its pending Cloud work to survive failures together. The pure client reducer is already verified. Add a durable M0 repository using actual SQLite and IndexedDB before app or AWS integration.

1. Store each note's current projection, acknowledged base, pending draft, immutable in-flight mutation and conflict branches in one versioned state row. Compare its local generation on every write. Local saves must not call a clock, hash, network or entitlement service.
2. Bind the isolated database to an explicit owner, collection and mode generation. Initialize that scope in the first state transaction, validate it on reads and writes, and reject another scope or unknown schema without rewriting existing data. This is local segregation, not authentication.
3. Prepare a mutation from one captured generation. Hash outside the database transaction, then compare-and-swap that exact generation. A newer local save defeats stale preparation. Persist acknowledgement and 409 transitions atomically; retry a storage race against a newer draft while preserving its source. User resolution uses an explicit expected generation.
4. Verify committed state after reopen, failed initial save, failed preparation/ack/conflict/resolution, stale preparations, competing editors and acknowledgement races on both adapters. Verify immutable retries after restart and account/library/mode mismatches. Reject malformed persisted state before writes while retaining local capture's independence from cryptography.
5. Run SQLite process-termination boundaries and Chrome page reload checks on fresh synthetic stores. Record them separately from the native Rust repository, Safari/iPhone, physical storage failures and full app acceptance. Do not open production data, provision AWS or enable Cloud/billing.

## Decisions and limits

The whole state row is the local note plus outbox transaction, avoiding separate note and outbox commits. Per-note generations order competing edits; no wall-clock ordering is used. A duplicate or stale response that no longer matches an in-flight operation rejects without changing saved work. Server idempotency, remote pull/cursor transitions, account sign-out/cache removal, mode migration and secure session handling remain separate gates.

## Evidence

`DurableCloudClient` now saves the complete client state and pending work through a single compare-and-swap row. SQLite uses WAL/FULL synchronous transactions; IndexedDB uses strict read/write transactions covering both the first owning-scope record and note state. Store validation refuses another owner/library/mode generation, unknown versions, malformed state and unexpected browser key paths. Structural validation has no crypto dependency; a bad but structurally valid operation hash pauses retry while a newer local draft can still save.

The [synthetic report](../experiments/cloud-local-durability-2026-10-27.json) records eight shared scenarios on actual Node SQLite and Chrome IndexedDB. They cover first-save rollback including scope binding, local capture with hashing disabled, immutable retries after reopen, atomic acknowledgement/rebase, acknowledged conditional purge, failed preparation/ack/conflict/resolution, a newer save defeating held real hashing, acknowledgement CAS retry after a concurrent save, repeated conflict resolution after restart, competing editors, scope mismatches and corrupted-hash recovery. SQLite tests also preserve unrelated schemas and malformed/future state. Browser checks preserve malformed scopes/state and reject future versions and unexpected key paths.

Four actual SQLite subprocess SIGKILL boundaries pass: after committed draft capture, inside uncommitted preparation, inside uncommitted acknowledgement, and after committed acknowledgement with a newer pending draft. Chrome page reload retains current/pending text, the exact in-flight retry, and both conflict branches. TypeScript, formatting and all 90 shared top-level cases pass. These eight shared scenarios are grouped within one unit case; they are not eight additional top-level cases per adapter.

All stores are fresh synthetic fixtures and are removed after the experiment. No application database, real note, account token, hosted resource or billing setting is used. This is Node SQLite, not the native Rust repository; Chrome page reload is not Safari/iPhone background termination or a full browser restart. Injected transaction aborts are not physical disk-full or browser quota exhaustion. Scope binding segregates local contexts but does not authenticate an account or verify paid entitlement.

Production app integration remains open, including pull/cursor commits, migration, sign-out/cache removal, mode transitions and deletion of derived data. The conditional-purge prototype can retain an acknowledged base or an immutable earlier operation until the purge acknowledges; immediate local removal of all retained bodies requires its own production deletion transition before AC-07 can pass. The final acknowledged purge state contains no logical body, but secure erasure of old SQLite/WAL pages is not claimed. No public acceptance criterion is marked complete by this work.
