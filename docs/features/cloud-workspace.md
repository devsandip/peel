# Responsive Cloud library and note workspace

[Issue 169](https://github.com/devsandip/peel/issues/169) composes the existing [cached Cloud library](cloud-cached-library.md) and [automatic Cloud uploading editor](cloud-note-upload.md) into one reusable responsive browser workspace. This plan precedes code. [SPEC](../SPEC.md) FR-02, FR-04, FR-05, FR-08, FR-13, FR-14 and AC-02, AC-04, AC-09, AC-12, AC-13 prerequisites plus [ui-spec.md](../ui-spec.md) define the contract. Default Cloud remains unavailable and unwired from default application routes.

## Scope and interface boundary

Add `apps/web/src/cloud-workspace.tsx` and component-scoped `apps/web/src/cloud-workspace.css` without altering shared protocol, storage, transport, server or existing component contracts. Reuse `CloudCachedLibrary`, `CloudUploadingNoteEditor`, `CloudNoteUpload`, `CloudDraftSession`, `CloudLibraryContext` and `CloudLibraryNoteSelection`.

Confirmed workspace contract ([issue 169 comment 6500227038](https://github.com/devsandip/peel/issues/169#issuecomment-6500227038)):

```ts
export type CloudWorkspacePutAway = Readonly<{
  context: CloudLibraryContext;
  upload: CloudNoteUpload;
  session: CloudDraftSession;
}>;

export type CloudWorkspaceProps = {
  context: CloudLibraryContext;
  signal: AbortSignal;
  refreshKey: number;
  onOpen: (
    selection: CloudLibraryNoteSelection,
  ) => CloudNoteUpload | Promise<CloudNoteUpload>;
  onCreate: (
    context: CloudLibraryContext,
  ) => CloudNoteUpload | Promise<CloudNoteUpload>;
  onPutAway?: (closed: CloudWorkspacePutAway) => void | Promise<void>;
};
```

The authenticated parent constructs `CloudNoteUpload` instances through `CloudNoteUpload.open` and `CloudNoteUpload.capture` using its original store, validated scope, authenticated mutation sender and account-context `AbortSignal`. The parent retains those upload owners for background completion and recovery after the editor view closes, owns dirty-draft handling across account transitions, and increments `refreshKey` when background uploads confirm or cached state changes. Neither `CloudWorkspace` nor its callbacks grant authentication or paid entitlement.

## Behavior and lifecycle decisions

1. **Immediate context isolation and stale-callback refusal:** Validate `context.scope` before rendering active workspace state. When `context.store`, serialized validated `context.scope` or `signal` changes, synchronously unmount the active workspace instance so prior account library rows, open note text, errors and CodeMirror undo history disappear in the same render without a one-frame flash. Also subscribe to `signal` abort events and check `Number.isSafeInteger(refreshKey) && refreshKey >= 0`; when aborted or given an invalid refresh key, immediately hide any open editor view. Bind every `onOpen`, `onCreate` and `onPutAway` request to the initiating workspace instance and a monotonic request token so late resolutions or errors from superseded clicks or old accounts are ignored and never retargeted to later state.
2. **Honest retention, autosave and Put away:** Reuse `CloudUploadingNoteEditor` and `CloudNoteEditor` unchanged: immediate local draft retention, fixed 200 ms Cloud autosave windows, `Saved in Cloud` only after matching current server confirmation, and the sole top-left green-minus `Put away` control with no Save button. Clicking `Put away` (or pressing `Meta+W` / `Ctrl+W`) waits only for durable local draft retention and any supplied `onPutAway` callback, triggers background upload flush without awaiting the network, closes the editor view, and refreshes the cached library immediately so pending drafts appear as `Pending upload` until server confirmation arrives and bumps `refreshKey`. Untouched new captures close without writing an empty row.
3. **Failure recovery and split-view switching:** If local draft retention or `onPutAway` fails, keep the current editor mounted and editable with its existing generic `Retry` and `Copy text` recovery controls (and `Retry upload` inside the note body for paused or unauthorized uploads) without leaking raw internal error strings. On desktop split view, clicking the card of the already-open active note focuses the open editor without discarding undo history; clicking a different note or `New note` flushes and puts away the current draft first, keeping the current editor open and recoverable if retention or `onPutAway` fails.
4. **Responsive desktop and narrow layouts with keyboard focus:** Scope all styles under `.cloud-workspace`. Use a single-column cached library when no note is open, expanding to a two-column split workspace on desktop viewports (`> 820px`) with the scrollable cached library beside a sticky pale-yellow paper editor pane. On narrow viewports (`<= 820px`, verified at `390x844`), present an open note as a `100dvh` full-viewport paper sheet with at least `24x24` CSS pixel touch target sizing on `Put away`, `overscroll-behavior: contain`, zero horizontal overflow, and `inert` on the covered library container so keyboard Tab navigation stays inside the open editor. Move focus into CodeMirror (`Note text`) on open or create, keep `Escape` non-destructive per SPEC, and restore focus to the refreshed library card button (or `New note` for untouched captures) when Put away completes.

## Verification plan and limits

Add isolated browser fixtures `tests/fixtures/cloud-workspace.html` and `tests/fixtures/cloud-workspace.tsx` plus `tests/e2e/cloud-workspace.spec.ts`. Use fresh explicit M0 IndexedDB databases (`peel-m0-cloud-workspace-*`) cleaned up after every test, stubbed browser clipboard before page scripts, and the unmodified `startCloudUploadServer(browserOrigin, secondScope)` loopback HTTP/SQLite mutation service. Run Playwright during development against owned strict port `65528` (`reuseExistingServer: false`) from an ignored worktree-local config so shared ports and Codex's checkout remain untouched.

Verify in real headless Chrome:

- Browsing cached collections (`Notes`, `Archive`, `Trash`, `Needs attention`), pagination, safe literal HTML titles, and download-progress messaging distinct from per-note save status.
- Opening an existing cached note by its original ID, editing with 200 ms HTTP autosave, putting away while the server reply is held without blocking view closure, observing `Pending upload` in the refreshed library, then observing `Saved in Cloud` after releasing the held HTTP response and verifying the committed server head via an independent HTTP read.
- Creating a new note draft (both untouched empty Put away creating no row and typed draft surviving Put away and pending-to-confirmed transition), plus desktop split-view direct note-to-note switching.
- Recovery paths: 401 upload pause and `Retry upload`, failed IndexedDB retention keeping the editor open and blocking note switches with `Retry` and stubbed `Copy text`, and failed parent `onPutAway` keeping the editor recoverable.
- Account/context isolation: immediate hiding of prior account library and editor content on context replacement or `AbortSignal` abort, ignoring held stale `onOpen`/`onCreate` resolutions and errors without leaking private text, and preserving already-retained drafts and parent upload owners in their original account stores.
- Keyboard focus entry into `Note text`, `Escape` preserving the open editor, `Ctrl+W` / `Meta+W` Put away, narrow-screen `inert` background containment, focus restoration to the refreshed library control, and desktop (`1280x800`) plus narrow (`390x844`) layout geometry and visually inspected screenshots.

Run `pnpm check`, Prettier check on owned and checked paths, `pnpm build` verifying the default bundle remains unchanged, no-reply Git author/committer verification, and `gitleaks` staged and commit-range scans. Real Cognito login, paid entitlement activation, Cloud download/live push scheduling, native Mac/iPhone shells, AWS deployment and M2.2 exit remain outside this slice.

## Validation evidence

Rebased onto verified `main` `0e2dc1d26f8403801058bda1b0918bae6af14b5f` ([issue 169 comment 6500539742](https://github.com/devsandip/peel/issues/169#issuecomment-6500539742)) with zero edits to shared contracts, backend packages, shared fixtures or default routes.

Initial failures and fixes during verification:

- First `cloud-workspace.spec.ts` run (`3 passed, 2 failed`): (1) the first test assumed `server.control.committed` started at `0` before holding responses, whereas `CloudUploadingNoteEditor` uploads the seeded pending draft on mount; updated the test to wait for initial `Saved in Cloud` and assert `committedBeforeEdit + 1` after holding responses. (2) the fifth test lost focus on the renamed card button after `Ctrl+W` Put away because the asynchronous loopback HTTP confirmation incremented parent `refreshKey` a few milliseconds after `localRefresh`, transiently unmounting `.note-grid` while `aria-busy="true"`.
- Second `cloud-workspace.spec.ts` run (`4 passed, 1 failed`): desktop `Ctrl+W` focus restoration passed across confirmation reload, while `390x844` `Put away` lost provisional `New note` tracking when consecutive effect runs occurred during `aria-busy="true"`. Fixed `CloudWorkspace` by storing both focused card title and provisional `New note` element references in component refs (`desiredCardTitleRef` and `provisionalButtonRef`), clearing card focus only when a still-connected card button genuinely blurs. All 5 workspace tests then passed.

Checks passed on the rebased tree:

- `pnpm check` (`tsc --noEmit`).
- `pnpm exec prettier --check apps/web/src packages infra tests docs/features/cloud-workspace.md`.
- `pnpm build`: default bundle outputs unchanged (`dist/assets/index-C2AI2ViB.js` 580.47 kB, `dist/assets/index-BJXYavW2.css` 14.14 kB, `dist/assets/search.worker-B3BfQQXg.js` 19.27 kB); default Cloud remains unavailable and unwired from `apps/web/src/main.tsx`.
- Cloud web unit suites (`pnpm exec vitest run --maxWorkers=1` on `cloud-note-cache-view`, `cloud-draft-session`, `cloud-note-upload`, `cloud-cached-library`, `cloud-library-download`, `cloud-download-web-transport`): `6` files, `118` tests passed. Unbounded `pnpm test` locally spawned 76 workers and hit 4-5 s child-process timeouts in 3 untouched `infra/cloud` unit suites (`cloud-preparation-session`, `cloud-run-context-storage`, `cloud-stack-create-query`), which run in hosted CI (`web-and-core` and `cloud-artifact`).
- Real headless Chrome Playwright suites on strict port `65528`: `tests/e2e/cloud-workspace.spec.ts` (`5 passed`), plus regression suites `cloud-cached-library.spec.ts`, `cloud-note-upload.spec.ts`, `cloud-note-editor.spec.ts`, `cloud-download-web.spec.ts` and `local.spec.ts` (`36 passed` total across 6 browser spec files), cleaning up all synthetic `peel-m0-cloud-workspace-*` IndexedDB databases and confirming `peel-local-v1` is never created by workspace tests.
- Visually inspected `workspace-desktop-split.png` (`1280x800`), `workspace-mobile-library.png` (`390x844`) and `workspace-mobile-editor.png` (`390x844`): verified warm-paper contrast, sole top-left green-minus `Put away` control (`24x24` px on narrow/coarse viewports, no Save button), non-overlapping collection navigation and status text, unclipped `New note` and card status labels, safe literal `<img src=x onerror=...>` rendering, and zero horizontal overflow.

Limits and unrun local checks: DynamoDB Local, Python Cloud IaC rendering/linting, and macOS Rust/Tauri packaging were not executed locally for this web UI slice and run in the 3 required GitHub Actions jobs (`web-and-core`, `cloud-artifact`, `native`) on the exact PR head. Authenticated Cognito session wiring, paid entitlement activation, automatic download/push scheduling, native shells, AWS deployment and M2.2 milestone exit remain outside this PR.
