# Retained Cloud run recipe

## Purpose and boundary

[Issue 78](https://github.com/devsandip/peel/issues/78) separates a pure versioned recipe codec from issue 30's durable journal and owned lifecycle work in [M2.2](https://github.com/devsandip/peel/milestone/2). It supports SPEC FR-04/14/20 and AC-04/12/13 prerequisites under the [hosting](cloud-dev-hosting.md) and [guard](cloud-deployment-guards.md) plans. Recovery must retain the original reviewed source, templates and expected inventory rather than regenerate them using today's factories.

## Contract

Capture one explicit profile, original source commit/tree/lockfile digest, normalized plan digest, canonical inventory input and exact reviewed templates. Only capture calls the current inventory factory. Serialize its expected-inventory snapshot and original templates as opaque strings inside a deterministic format-1 envelope. Limit templates to 128 KiB, inventory snapshot to 64 KiB and envelope to 512 KiB. Return immutable bytes/digest and pins for the original account/region/run/source/plan/template/inventory identities. Reject extras, getters, invalid selectors and private errors.

Reading requires the exact retained bytes and independently retained trusted pins. Verify canonical envelope encoding, format, byte limits, outer digest, original snapshot header/digest and all pinned identities. Preserve both opaque strings exactly. Do not interpret the snapshot's resource graph as executable selectors. Do not invoke current factories, Git/main/CI, the clock, fresh prices, new-run authorization or lease validation while reading an old recipe. Expired runs still need inspection and cleanup.

A self-supplied digest is not provenance. This codec has no storage, run-slot reservation, creation intent/response IDs, AWS reader/write, physical ownership or deletion authority. A later private durable journal must retain the pins before the first write; a separately reviewed historical inventory interpreter and independently verified creation/resource ownership must precede any cleanup action. Keep issue 30/31 and audit 51 open. No app feature, public v0.7 contract or mockup changes.

## Verification plan

Use the actual inventory/template factories and synthetic selectors. Verify deterministic bytes despite input property order, exact immutable round trip after source/factory changes and lease expiry, and rejection of tampering, wrong/extra/malformed pins, unknown versions, noncanonical JSON, invalid snapshot headers/digests, byte limits and accessors. Verify that reading does not call the current factory. Run direct actual Node 24 import/focused tests, shared type/format/tests/build and all three exact-head hosted checks before a single-purpose merge. These establish a codec contract, not durability, provider ownership, recovery execution or app acceptance.
