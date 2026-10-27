# Explicit pnpm build-script decisions

## Scope and plan

SPEC's reproducible-build validation needs fresh dependency installation to succeed before tests can run. A clean pnpm 11.0.8 install currently fails with `ERR_PNPM_IGNORED_BUILDS` for two transitive development dependencies. This PR only makes the existing dependency build policy explicit; it changes no versions, app behavior, CI triggers or runner sizes.

1. Replace the legacy esbuild allowlist with pnpm's `allowBuilds` map. Retain esbuild permission and explicitly deny postinstall execution for pinned onnxruntime-node 1.30.0 and protobufjs 7.6.6. Keep strict handling of unreviewed installers enabled.
2. The reviewed ONNX installer downloads platform extras (including CUDA), while the required Mac/Linux CPU bindings are already packaged. The reviewed protobuf installer prints a dependent-version warning and produces no runtime files. Neither script is needed for the current CPU/browser checks. GPU/platform extras require a separately reviewed policy change.
3. Verify frozen installation, TypeScript, shared tests and web build. Load the packaged native CPU binding without a model or network download. Run hosted CI after publication; retain any failures as failures.

## Evidence

Fresh installation reproduced the blocker. With explicit decisions, frozen installation succeeds without warnings or manifest rewrites. TypeScript, all 116 shared tests across 23 files, workspace formatting and production web build pass on the fresh Mac checkout. The packaged native CPU binding also loads without running its installer or downloading a model. The existing web bundle-size warning remains. Hosted Linux/Mac verification is pending the PR checks. [pnpm build settings](https://pnpm.io/settings/build#allowbuilds) defines explicit allow/deny decisions; no blanket approval or strict-check bypass is used.
