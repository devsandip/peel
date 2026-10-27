# Composed Cloud foundation recovery evidence

## Requirement and PR boundary

[Issue 14](https://github.com/devsandip/peel/issues/14) supplies the exit evidence for [M2.1 Cloud sync foundations](https://github.com/devsandip/peel/milestone/1), linked to FR-04/13/14/20 and AC-09/10/12/13/23. One purpose: exercise the configured Lambda data service together with durable local clients across restart, retry, conflict, purge and authorization failures. This is a test/evidence slice, not app activation or public acceptance.

## Plan before implementation

1. Use only disposable DynamoDB Local tables, generated synthetic RSA tokens/JWKS, explicit loopback SDK clients and fresh temporary SQLite stores. Seed two unrelated test accounts with the same collection/note identifiers to expose partition mistakes. Recreate the handler/client store to verify persisted state rather than relying on instance caches.
2. Bootstrap a complete library into a durable client with one-record pages, interrupt/reopen/resume it, and verify its completed cursor. A foreign token/page/local-store scope and unsupported live path cannot expose or restore another account's content. Preserve local-only drafts during download and reject stale/duplicate page work without advancing past an unapplied page.
3. Drop an actual successful mutation response, save a newer draft locally and reopen. Retry the identical persisted operation after another client advances the head. Reconcile the current head without losing the later draft, explicitly resolve and commit it, then purge and prove a stale edit cannot revive that ID. Explicit recovery creates a new ID and keeps the saved text.
4. Compose preexisting durable web sessions with local pending work. Expired/revoked sessions, inactive entitlement and a private SDK failure must return fixed errors. Feed those actual error bodies to the reply validator and prove rejection leaves local text/immutable retry unchanged after reopen. Restore authorized access and finish the original operation. No UI or refresh behavior is inferred from these protocol tests.
5. Run shared tests, all local-engine cases, TypeScript, formatting and web build; record exact passing evidence and remaining hosted/app gates. Review and merge one focused PR after hosted checks. Split any independently fixable defect into its own issue/PR, and do not close the milestone until this issue's exit evidence has passed.

## Scope of evidence and remaining gates

Synthetic signed identities plus local-engine HTTP events prove this composed contract only. Real Cognito issuance/refresh/reset, browser-bound login attempts, native system-browser/keychain, production response dispatch bound to an initiating account generation, real API Gateway/IAM/key persistence/rotation/cost/backups/restore, hosted throttles/quotas, account erasure, live push, app repository/UI integration and mode transitions remain open. In particular, validated replies must still be delivered only to their authenticated initiating client context; browser account-switch races are an app-integration gate. No live subscription exists here, so rejecting its unsupported path is not live authorization acceptance.

Node SQLite is not the native Rust or iPhone store, and local temporary files do not establish physical power-loss durability. Earlier IndexedDB/reload and transaction-abort evidence remains separate; this suite does not retry the stopped WebKit/relay probes or access the default user database. Plans and isolated tests do not mark any complete public AC or all M2 as passed.

## Evidence

Three composed groups pass against actual DynamoDB Local 3.3.2 and temporary Node SQLite files:

- One-record bootstrap pages complete after a failed page transaction, client reopen and fresh SDK/handler construction with the same injected signing key. Duplicate pages do not reapply, the completed sequence/checkpoint is durable, and an unsent Cloud draft survives download. Same-ID account data stays separate; a foreign signed cursor, foreign local page/store scope and unsupported live route cannot restore or expose it.
- A lost successful response is retried with the identical persisted operation after reopen and a concurrent remote edit. The later local draft and remote head survive as a conflict, explicit resolution commits, and a purge rejects a stale edit after 31 modeled days. Recovery under a new ID keeps its text while the original remains purged.
- Actual expired/revoked session, inactive paid-policy and injected private-storage error bodies are rejected by the reply validator. Every rejection preserves both the immutable retry and newer saved draft after SQLite reopen. Restoring access commits the original operation, then the later draft, without losing text.

All 27 DynamoDB cases in five files pass, including the three new groups, alongside all 135 shared cases in 27 files, TypeScript, source formatting and the unchanged web build. The existing bundle-size warning remains. Hosted final checks are recorded with the PR/issue when complete. The 31 days use the injected service clock; this is not elapsed wall time, physical TTL cleanup or a device clock-repair test. Handler reconstruction reuses the fixture's key, not a production key store. Error-body rejection proves protocol/state protection, not an implemented app sign-in/retry UI. No real credentials, user notes, default database or AWS resource was accessed.
