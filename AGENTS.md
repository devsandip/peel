# Peel project instructions

Read the applicable user and Developer-folder instructions, then `docs/PRFAQ.md` and `docs/SPEC.md` before making product or architecture decisions.

- The PRD defines product scope and the PRFAQ describes customer intent. The SPEC defines behavior and acceptance criteria. Keep one canonical copy of each under `docs/`.
- Use spec driven development. Create a requirement-linked plan in `docs/features/<feature>.md` before implementing a milestone or nontrivial feature.
- Update the SPEC in the same branch when intentionally changing behavior. Do not silently narrow public v1 scope or claim an acceptance criterion passed without evidence.
- Implementation is authorized. Start with M0 experiments and the local Mac milestone. Do not interpret specifications or mockups as evidence that a feature exists or has passed its performance targets.
- Do not run the agent council unless Sandip explicitly asks to use it.
- Default to local persistence, an explicit library-wide On-device or paid Cloud mode, and no note content or search queries in telemetry.
- Use pnpm for JavaScript/TypeScript. Keep runtime dependency choices and versions tied to the M0 experiments.
- Do not provision infrastructure simply to validate local capture. AWS deployment follows the hosting milestone and its infrastructure plan.
- Never commit notes, real account tokens, local databases, exports, or credentials. Use synthetic fixtures for tests.
- Preserve canonical docs across branches; do not copy them into worktree-specific folders.
