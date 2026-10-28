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
- This is the clean public repository. Never import refs/history from `peel-private-archive`; its old commit-author metadata stays private.
- Use a GitHub no-reply identity for agent-created commits and merges. Set the repository-local Git identity before committing and verify author/committer metadata before pushing. If GitHub's merge API rejects the no-reply address, merge the reviewed PR locally with that identity and push normally after its required gates pass; never fall back to a personal email or bypass protections. Confirm GitHub records the PR as merged.

## GitHub Project upkeep

- Use the existing [Peel Project](https://github.com/users/devsandip/projects/12), linked to `devsandip/peel`. Do not create a competing board. Issues and Milestones remain the deliverable and scope source; the Project provides progress views.
- Add every new repository issue and PR to Project 12. Mirror its current state as Backlog, Ready, In progress, Blocked or Done. Keep issue labels and Project status synchronized as work starts, blocks or completes; update PR cards after merge/closure in the same session.
- The Current milestone view shows deliverable issues only. Keep PR implementation/review in the separate Pull requests view so it does not double-count milestone progress. Use the Issues and Backlog views for repository-wide context and concrete unscheduled bugs.
- Close an issue only when all its acceptance criteria have evidence. Done cards and closed-item counts do not establish whole-product or public-release acceptance. Break down the next milestone only when it becomes current.
- Add items with `gh project item-add 12 --owner devsandip --url <issue-or-PR-url>`, then set and verify the Status field using the GitHub Project CLI/API. Inspect existing membership before backfilling; preserve unrelated projects and private archive items.

## Milestone reports

- Follow the shared milestone-completion reporting workflow. Save Peel completion reports under `docs/milestones/`, link them from their completed GitHub milestone, and send Sandip the report plus its file link whenever a milestone completes.
- Keep dated in-progress status snapshots under `docs/reports/`. These do not close a milestone or replace the canonical PRD/SPEC. Report foundations, enabled app behavior and unmet acceptance gates separately.
