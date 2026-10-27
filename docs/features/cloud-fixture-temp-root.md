# Cloud fixtures on a clean checkout

## Scope and plan

SPEC's Cloud recovery evidence must be reproducible in CI. After dependency installation succeeds, Linux CI reaches the Cloud durability experiment and fails because the ignored scratch parent directory does not exist on a clean checkout. This PR only creates that parent before either Cloud experiment allocates its temporary directory.

Use idempotent recursive mkdir, keep each experiment's owned temporary cleanup unchanged, and do not weaken any assertions or change application storage. Verify both scripts from an absent scratch directory and run the hosted Linux/Mac checks. This PR depends on the separate pnpm build-policy fix.

## Evidence

Hosted Linux run 40502947916 fails at `mkdtemp` with ENOENT after install, unit tests and the web build succeed. With the parent directory absent, both corrected experiments pass locally: eight durable-store groups and four head/pull groups per SQLite/IndexedDB adapter, six local SIGKILL boundaries, and three server SIGKILL boundaries. The original scratch contents were preserved during this isolated check. Formatting passes; hosted PR verification remains pending. The parent dependency-policy PR's complete hosted Mac build/native tests pass.
