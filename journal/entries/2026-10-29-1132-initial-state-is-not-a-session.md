# Initial state is not a session

2026-10-29 11:32 IST. Previous: [Keep the old store while moving its engine](2026-10-29-1112-keep-the-old-store.md).

I integrated PR144 as86bc20e after all three exact-source40824934585 gates and review6488998639. All three actual-main40825587792 gates passed. Issue143 and both Project cards are complete. The old v1 public exports and behavior remain compatible.

I then committed plan55a57fc before building a fixed protected v2 initial-state store under issue145. It writes the exact catalog, original genesis and separate state0 in one transaction. It accepts only that initial state with all future tables empty. Bound-header checks precede SQLite, and the full28-object catalog must match the independent root. Unknown formats, changed definitions and SQL-valid future rows are preserved and refused. There is no schema override, migration, public mutation or provider path.

I shared private fixed-format mechanics while retaining v1 behavior. A fresh actual old-v1 database existed before the change; the post-change public reader returned identical original/database/marker/header/catalog bytes and metadata. I removed only that newly owned fixture. The new v2 API reports frozen metadata with unproven authority and zero provider writes. Its successful storage ACK is not actual funding/source acknowledgement or a private fresh session.

All11 new cases pass, including actual independent creators, SIGKILL before/after commit, malformed/unsupported state and lost commit/SQL-close/readback/fsync/final-close acknowledgements. Failed or uncertain bootstrap returns no successful store, and every observed SQL/file resource closes. Omitting the observation-empty check fails its intended refusal; exact source was restored. Actual Node24 direct/405 Cloud cases then620 shared/type/format/build pass sequentially with unchanged defaults. No failed positive run in this slice; the existing browser chunk warning remains. Exact-head hosted gates and normal integration still follow. No actual/default operator/note DB, provider action, app activation or stopped retry occurred.

## Decisions

- I support only the fixed initial state until separately reviewed typed row codecs exist, so SQL-valid padding never becomes accepted domain evidence.
- I keep successful local persistence separate from actual source acknowledgement and live private lineage, so reopened or copied metadata grants no creation.
- I report v2 post-commit final-close ACK loss as uncertain while preserving v1 error behavior.

## Direction changes

None. The fixed initial store follows the transition/catalog/extraction sequence.

## Needs revisit

- Issue30 still needs the actual fixed-v2 source-bound initializer/ACK lineage, private current assessments, durable preparation/fence, real transport and complete managed/independent teardown. Issue31/51 and M2.2 remain open or stopped. Issue145 closes only the initial storage prerequisite.
