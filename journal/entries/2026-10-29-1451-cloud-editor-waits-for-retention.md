# The Cloud editor waits for retention

2026-10-29 14:51 IST. Previous: [Put away waits for retention](2026-10-29-1413-put-away-waits-for-retention.md).

I integrated PR155 after all three source gates and verified all three actual-main jobs40845613221. The retention session is complete within its limited scope. Actual closure/Project status, primary advancement and owned cleanup are recorded in proof6492415014. Default Cloud is still unavailable.

Under issue156 I connected that session to the existing Markdown editor in a component outside the default route. It has the sole green minus, a quiet Cloud status footer and Retry/Copy after failure. Put away waits for retained text and passes the original session to its dismissal owner. A new session remounts the editor, including undo history; old async work cannot replace its text or dismiss it.

Seven new browser flows pass against actual fresh IndexedDB and all27 prior flows still pass. Removing the old-session dismissal guard makes the intended refusal fail. Exact source is restored before positive checks. Type/format/build pass and the production bundle is unchanged. I inspected the functional fixture screenshot: paper, heading/bold/tags/tasks, one green minus and Pending upload. The owned audit sees no default DB, page error or note network write. No actual clipboard or native app was touched. Backend modules/tests did not change, so their prior service evidence is not counted again as a new local run.

## Decisions

- I remount on supplied-session changes so undo cannot carry another account's source into this editor.
- I keep actual authenticated loading/window ownership outside this disabled component. Dismissal is owner-bound and local retention never becomes Cloud Saved.

## Direction changes

None. This composes the confirmed v0.8 contract without enabling unfinished Cloud.

## Needs revisit

- Issue156 still needs exact-source hosted review/gates and normal integration. The authenticated parent must hide the old editor while loading a new account. Full Cloud new-note/reconnect/web inventory/live, menus/native/iPhone and M2.2 managed/independent teardown remain. Stopped probes and expired allowances stay unchanged.
