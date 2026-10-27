# Packaged private Cloud Lambda

## Requirement and PR boundary

[Issue 27](https://github.com/devsandip/peel/issues/27) supplies the server artifact for [controlled development hosting](cloud-dev-hosting.md), linked to SPEC FR-04/14/20 and AC-04/12/13 prerequisites. One purpose: reproduce and check the server bundle that later IaC may deploy. No infrastructure, managed account, public endpoint or app feature is activated.

## Plan before implementation

1. Export only a Lambda handler around the existing authenticated data service. Parse explicit development-only table/pool/client/scope/origin/region, a canonical base64-encoded 256-bit cursor secret and bounded UTC start/expiry values. Fail privately before client creation for missing/invalid/expired configuration. Check the fixed lease on every invocation, including a warm worker. No test-auth or local-endpoint override; the SDK ignores configured endpoint overrides. Once a lease/clock check stops a worker, it cannot reopen after a clock reversal.
2. Create a bounded-retry DynamoDB client only after valid configuration, import a nonextractable HMAC key, and reuse the resulting handler. Never log initialization errors, events or tokens. The environment secret is a future IaC dynamic reference; this PR does not fetch or create one. No account-wide credentials or table fallback.
3. Pin esbuild 0.28.2, bundle the existing pinned SDK/verifier for Node 24 CommonJS, and ZIP only the generated entry and its dependency license notices with fixed local-calendar ZIP timestamps/permissions and dependency license notices. Reject unexpected external modules, fixture/app/storage inputs and oversized artifacts. Write hashes and a runtime manifest outside the ZIP under ignored artifacts. Rebuilding from the same inputs must reproduce identical ZIP bytes.
4. Unit-test real configuration parsing, private initialization failures, valid handler composition and warm-worker expiry using injected dependencies and synthetic data. Separately unpack the actual ZIP in an isolated temporary directory, block network entry points, provide only synthetic environment/credential paths and check its real exported handler under Node 24. The smoke checks missing/invalid configuration, normal authentication rejection, malformed events and lease expiry without needing a default user database or real credential.
5. Add a focused Node 24 hosted artifact job. Run type/format/shared checks and deterministic packaged smoke locally; repository Linux/Mac gates remain required. Preserve existing web/native behavior and record actual evidence. The prior hosting-plan PR must merge before this dependent artifact PR can merge.

## Tool and runtime basis

[esbuild's Node bundling guidance](https://esbuild.github.io/getting-started/#bundling-for-node) describes platform/target/CommonJS bundling; the registry reports 0.28.2 with Node >=18 support. AWS recommends [bundling preferred SDK dependencies](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html), with the handler at ZIP root and readable POSIX permissions. AWS lists [Node 24 as supported](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html); Node 26 is still preview. A local Homebrew node@24 launcher actually runs Node 26, so local compatibility evidence must use the separately SHA256-verified official Node v24.22.1 archive, not that misleading launcher.

## Evidence and remaining gates

Four focused unit groups pass: complete/canonical configuration and lease boundaries; shared initialization and immutable captured configuration; private failures before initialization; and expiry during initialization plus the real authenticated transport. Invalid/nonintegral clocks and warm expiry cannot initialize or reopen access.

The actual 336,713-byte ZIP exports only `handler`, bundles the pinned SDK/verifier and core normalizers, retains dependency notices and has no app/client database input or external package import. Three unpacked Node v24.22.1 subprocess modes check missing/invalid config, real unauthenticated rejection, malformed events and warm expiry with zero network attempts. Their environment contains synthetic credentials only, credential/config paths point to absent temporary files, Node permissions restrict reads to that temporary directory and deny writes, and SDK network entry points are blocked. This is not an OS network-namespace test. Temporary files are removed afterward.

Two builds reproduce identical ZIP bytes, and separate UTC/Asia-Kolkata builds agree on SHA256 `8603e9d37675877161f68d7e5a3b97b8cc57e247302a7dcbf690600671eb1013`. The published ignored artifact/manifest must match the rebuilt bytes before smoke checks. AWS confirms [CommonJS `.cjs` handlers](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-handler.html). The official local Node v24.22.1 archive matched its published SHA256 before use.

All 139 shared cases in 28 files, all 27 DynamoDB Local cases in five files, TypeScript, source/script formatting and web build pass locally. The existing browser chunk-size warning remains. A focused hosted Node 24 job builds/checks the artifact alongside existing Linux/Mac jobs; actual hosted results are recorded in the PR/issue. Use `pnpm cloud:build` then `pnpm cloud:check` with Node 24. The future key provisioning path must generate 32 random bytes and retain their canonical base64 representation in Secrets Manager; a generic random-password string is not this format.

Offline export/configuration checks do not establish a managed Lambda execution environment, Cognito issuance, IAM access, secret persistence/rotation, API Gateway, browser/native login, live sync or complete public acceptance. Those remain explicit hosting/app gates.
