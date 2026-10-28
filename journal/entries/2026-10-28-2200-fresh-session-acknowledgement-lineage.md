# Acknowledgements stay in the original process

2026-10-28 22:00 IST. Previous: [Original requests without a secret checkpoint](2026-10-28-2125-original-request-transient-material.md).

I merged PR 128 after all three source checks passed. All three actual merged-main checks passed separately. The pure original request and transient material contract is complete for its scope. It does not execute a request or complete managed hosting.

I split fresh preparation-session lineage into issue 129 and committed its plan before code. The initializer now creates and acknowledges the independently selected private workspace before obtaining its own actual reservation acknowledgement. It then publishes original sources and exclusively bootstraps actual source-bound genesis. It gives no key, token, prepared request or provider permission.

The workspace matters when a process dies before reserve COMMIT. No row survives, but that absence does not prove the initializer never ran. The preserved workspace makes a restart at the same selected path enter recovery. This may strand an unused local workspace. I prefer that cost to silently recreating a fresh path. It is not global rollback protection.

Live lineage stays behind a private runtime brand and map. Reading an old row, opening sources, copying metadata or starting another process cannot recreate it. Validation checks the original parent, workspace, funding selection and source/genesis again. Failure or discard removes the local lineage without removing files or refunding slots. Actual current safety and provider provenance remain future gates.

The final defaults pass 334 actual Node 24 Cloud cases and 549 shared cases, then type, formatting and build. Actual writers and SIGKILL surround reserve and genesis commits. A deliberate read fallback after lost reserve acknowledgement fails the intended refusal test. I retained an initial open-stdin harness timeout and two later shared-suite timeouts as failed evidence. Independent new variants now have separate cases, with no deadline or legacy test changes. The full external timing cause remains unproven. Final-head review and hosted gates precede integration.

## Decisions

- I required an acknowledged exclusive workspace before reserve so a precommit crash does not silently restart the same selected workspace.
- I kept acknowledgement lineage private and distinct from current provider approval or a dispatch capability.
- I separated independent new failure variants into their own cases and kept failed runs visible.

## Direction changes

The request feature was awaiting integration; it is merged and verified. Fresh session lineage is the next local prerequisite. Product scope is unchanged.

## Needs revisit

- [Issue 129](https://github.com/devsandip/peel/issues/129): final-head review, hosted gates and normal integration.
- [Creation journal](../../docs/features/cloud-creation-journal.md): actual already-reserved current gates and collector provenance still precede trusted immutable preparation and dispatch. New-run validation cannot be replayed with a fabricated empty ledger.
- [M2.2](https://github.com/devsandip/peel/milestone/2): actual managed smoke and independent teardown remain unproven. Stopped probes remain stopped.
