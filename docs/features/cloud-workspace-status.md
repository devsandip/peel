# Truthful Cloud workspace connection and recovery states

[Issue 178](https://github.com/devsandip/peel/issues/178) adds optional truthful Cloud connection and recovery presentation to the responsive browser workspace introduced in [Issue 169](https://github.com/devsandip/peel/issues/169) ([cloud-workspace.md](cloud-workspace.md)). This plan precedes code. [SPEC](../SPEC.md) FR-02, FR-04, FR-08, FR-13, FR-14, FR-20 and AC-04, AC-12, AC-13, AC-23 prerequisites plus [ui-spec.md](../ui-spec.md), [cloud-cached-library.md](cloud-cached-library.md) and [cloud-note-upload.md](cloud-note-upload.md) define the contract. Default Cloud remains unavailable and unwired from default application routes.

## Scope and interface boundary

Extend `apps/web/src/cloud-workspace.tsx` and component-scoped `apps/web/src/cloud-workspace.css` without editing shared protocol, storage, transport, server, shared HTTP fixtures, default routes or existing child components (`CloudCachedLibrary`, `CloudUploadingNoteEditor`, `CloudNoteEditor`, `CloudNoteUpload`, `CloudDraftSession`). This slice is presentation and explicit user-triggered callback dispatch over parent-supplied state, not authentication, paid entitlement, sync scheduling, live push delivery or Cloud mode activation.

Coordinated workspace contract ([Issue 178](https://github.com/devsandip/peel/issues/178), [Issue 169 comment 6505355501](https://github.com/devsandip/peel/issues/169#issuecomment-6505355501)):

```ts
export type CloudWorkspaceConnectionKind =
  "cached" | "syncing" | "offline" | "sign-in-required" | "paused";

export type CloudWorkspaceConnection = Readonly<{
  kind: CloudWorkspaceConnectionKind;
}>;

export type CloudWorkspaceProps = {
  context: CloudLibraryContext;
  signal: AbortSignal;
  refreshKey: number;
  connection?: CloudWorkspaceConnection;
  onOpen: (
    selection: CloudLibraryNoteSelection,
  ) => CloudNoteUpload | Promise<CloudNoteUpload>;
  onCreate: (
    context: CloudLibraryContext,
  ) => CloudNoteUpload | Promise<CloudNoteUpload>;
  onPutAway?: (closed: CloudWorkspacePutAway) => void | Promise<void>;
  onRetrySync?: (context: CloudLibraryContext) => void | Promise<void>;
  onSignIn?: (context: CloudLibraryContext) => void | Promise<void>;
};
```

Omitting `connection` (`undefined`) preserves existing workspace DOM and behavior unchanged. Neither `connection` nor `onRetrySync` or `onSignIn` authenticates a user, grants paid access, switches storage tiers, erases pending drafts or marks unconfirmed edits saved.

## Behavior and lifecycle decisions

1. **Strict closed-set `connection` validation and fixed safe copy:** Accept `undefined` as omitted. For any provided value, accept only a non-null plain object whose sole own property (no extra string or symbol keys) is an enumerable `"kind"` equal to `"cached"`, `"syncing"`, `"offline"`, `"sign-in-required"` or `"paused"`. Read `"kind"` once inside `try / catch` so getters or proxies cannot throw out of render or flip state mid-render. Reject any other value, including `null`, primitives, arrays, unknown kinds such as `"live"` or `"all-synced"`, or objects carrying extra fields such as server messages, note bodies, tokens or paid flags. Render only fixed copy:
   - `"cached"`: `Showing notes cached on this device.`
   - `"syncing"`: `Syncing with Cloud…`
   - `"offline"`: `Offline. New edits stay pending on this device.`
   - `"paused"`: `Cloud sync is paused. Your pending drafts remain on this device.`
   - `"sign-in-required"`: `Sign in again to resume Cloud sync. Your pending drafts remain on this device.`
   - Malformed non-`undefined` state: `Cloud sync status unavailable. Your pending drafts remain on this device.` (`role="alert"`, no recovery action buttons, no raw input or error text, while keeping the cached library and any open editor mounted and editable).
     Never display `Live`, `All notes synced`, `Up to date` or pending-note counts without a complete verified inventory.
2. **Conditional explicit recovery, single-flight locking and parent authority:** Render `Retry sync` only when `connection.kind === "paused"` and `typeof onRetrySync === "function"`. Render `Sign in again` only when `connection.kind === "sign-in-required"` and `typeof onSignIn === "function"`. Never invoke either callback automatically on mount, render or status transition. On explicit user click, pass the workspace instance's originally captured frozen `CloudLibraryContext` (`store` plus validated cloned `scope`), never reading later global or mutated caller objects. Guard execution synchronously with an epoch-bound ref lock plus `disabled` button state so rapid double-clicks cannot start concurrent requests. Resolving a recovery callback clears only the pending button state and never invents a `connection` transition; the parent remains authoritative. Synchronous throws or promise rejections clear the pending lock and display fixed generic recovery copy (`Could not resume Cloud sync. Your pending drafts remain on this device.` or `Could not start Cloud sign-in. Your pending drafts remain on this device.`) without exposing exception messages, response bodies, tokens or telemetry.
3. **Stale-result isolation across status, refresh and account changes:** Bind each recovery invocation to the mounted workspace instance and a monotonic connection epoch that advances whenever `connection` changes (between valid kinds, omitted or malformed), `refreshKey` becomes invalid or `signal` aborts, and unmounts synchronously when `context.store`, validated `context.scope` or `signal` changes. Ignore late resolutions and rejections from superseded epochs or replaced accounts so an earlier account or status never mutates or surfaces an alert in later UI state.
4. **Placement, responsive layout and accessibility:** Place the connection status container at the top of `.cloud-workspace-library` outside `.cloud-workspace-editor` and outside the note's sole top-left green-minus `Put away` control. Keep `Refresh cached notes` as a local catalog refresh, keep immediate local draft retention and fixed 200 ms Cloud autosave unchanged, and never add a normal Save button. Convey status with explicit text and solid borders in light and dark schemes rather than color alone, enforce at least `24x24` CSS pixel interactive target sizing (`min-block-size: 32px` on desktop, `36px` on coarse/narrow viewports) on recovery buttons via `min-block-size` / `min-inline-size` and padding, and suppress `aria-live` (`aria-live="off"`) on the background connection status while `.cloud-workspace-library` is `inert` behind the `100dvh` narrow-viewport (`<= 820px`) editor sheet.

## Verification plan and limits

Extend `tests/fixtures/cloud-workspace.tsx` and `tests/e2e/cloud-workspace.spec.ts` while keeping `connection` omitted by default so all seven existing browser tests continue verifying omitted-prop compatibility against the unmodified `startCloudUploadServer` fixture on strict port `65528` (`reuseExistingServer: false`).

Verify in real headless Chrome:

- Omitted `connection` renders zero connection status banner, while each of the five valid `connection.kind` values renders its exact fixed copy without `Live` / `All notes synced` claims, without automatic callback calls on mount or transitions, and without interfering with `Refresh cached notes`, open-note editing, immediate local retention, 200 ms HTTP autosave or sole green-minus `Put away`.
- Action visibility rules (`Retry sync` only for `"paused"` with `onRetrySync`; `Sign in again` only for `"sign-in-required"` with `onSignIn`; hidden when callbacks are omitted or for other states), single-flight disabling while a callback is held, authoritative parent state after callback resolution (no invented transition until parent updates `connection`), and generic recovery error alerts after synchronous throws or rejections without leaking private exception strings.
- Original-context binding when caller props are mutated in place, plus stale resolution/rejection refusal across status changes (`"paused"` to `"offline"`, `"sign-in-required"`, `"cached"` or omitted), account replacement, `AbortSignal` abort and invalid `refreshKey`.
- Malformed `connection` inputs (`null`, primitives, unknown `kind: "live"`, extra `message` / `token` / `paid` properties and accessor getters) rendering generic unavailable copy with no action buttons, no leaked secret text and no loss or unmounting of cached notes or open pending drafts.
- Desktop (`1280x800`) split view and narrow (`390x844`) layout geometry, zero horizontal overflow, `>= 24x24` px recovery button targets, keyboard focus and activation, `inert` containment of background status/recovery controls when the narrow editor sheet is open, and visually inspected screenshots.

Run `pnpm check`, Prettier check, `pnpm build` confirming unchanged default app bundle hashes, Cloud web unit tests, no-reply Git author/committer verification and `gitleaks` scans. Real Cognito login, paid entitlement verification, sync/download/push scheduling, native Mac/iPhone shells, AWS deployment and M2.2 milestone exit remain outside this slice.

## Validation evidence

Implemented on branch `antigravity/cloud-workspace-status` from verified `main` `1166cd71edc72471acc7fcd0a1ac5a06ed8785c6` ([PR 177 proof 6505545151](https://github.com/devsandip/peel/pull/177#issuecomment-6505545151)), after committing pre-code plan `c2ebfaeefd3ac911107a8dc165ea7c68b459378a`. Shared contracts, backend packages, shared fixtures and default routes remain untouched.

Initial failure and fix during verification:

- First `cloud-workspace.spec.ts` run (`11 passed, 1 failed`): Test 11 passed `null`, primitives, arrays, empty objects, unknown kinds (`"live"`, `"all-synced"`), extra secret string/symbol fields, non-enumerable properties and `Error` instances, then failed on a throwing enumerable getter preset because React 19's dev-mode `logComponentRender` profiler walks component `props` during `commitPassiveMountOnFiber` (`flushSync`), and `CloudWorkspace` also forwarded `{...props}` (including raw `props.connection`) to `SelectedWorkspace`. Tightened `parseConnection` in `apps/web/src/cloud-workspace.tsx` to require a plain enumerable data descriptor (`"value" in descriptor`) and read `descriptor.value` directly without invoking untrusted accessor getters, parsed `props.connection` once in `CloudWorkspace` without forwarding raw `props.connection` or `{...props}` to `SelectedWorkspace`, and updated Test 11's accessor preset to verify that even an enumerable getter returning `"paused"` is rejected as malformed without rendering recovery controls or losing open pending drafts. All `12/12` workspace tests then passed.

Checks passed on `antigravity/cloud-workspace-status`:

- `pnpm check` (`tsc --noEmit`).
- `pnpm exec prettier --check apps/web/src packages infra tests docs/features/cloud-workspace.md docs/features/cloud-workspace-status.md package.json tsconfig.json` and `git diff --check`.
- `pnpm build`: default bundle outputs unchanged (`dist/assets/index-C2AI2ViB.js` 580.47 kB, `dist/assets/index-BJXYavW2.css` 14.14 kB, `dist/assets/search.worker-B3BfQQXg.js` 19.27 kB); default Cloud remains unavailable and unwired from `apps/web/src/main.tsx`.
- Focused unit suites (`pnpm exec vitest run --maxWorkers=4`): `8/8` files (`175/175` tests) passed across `cloud-cached-library`, `cloud-download-web-transport`, `cloud-draft-session`, `cloud-library-download`, `cloud-mutation-web-transport`, `cloud-note-cache-view`, `cloud-note-upload` and `core`.
- Real headless Chrome Playwright suites on strict port `65528` (`reuseExistingServer: false`): all `71/71` browser tests passed across all `10` e2e spec files (`12/12` in `tests/e2e/cloud-workspace.spec.ts`, comprising `7/7` existing omitted-connection workspace flows plus `5/5` new connection/recovery flows, and `59/59` across all other Cloud, reopen, download, mutation, local and native-bridge specs), cleaning up all synthetic `peel-m0-cloud-workspace-*` IndexedDB databases and confirming `peel-local-v1` is never created by workspace tests.
- Visually inspected `workspace-status-desktop-split.png` (`1280x800`), `workspace-status-mobile-library.png` (`390x844`), `workspace-desktop-split.png` (`1280x800`), `workspace-mobile-library.png` (`390x844`) and `workspace-mobile-editor.png` (`390x844`): verified warm neutral/amber banner borders and high-contrast text, crisp `:focus-visible` outlines and unclipped `Retry sync` (`>= 32px` height) and `Sign in again` (`>= 36px` height on narrow viewports) buttons outside the note editor's sole top-left green-minus `Put away` control, pixel-identical omitted-connection layouts, full-screen `390x844` sheet coverage over the `inert` background library/status bar, and zero horizontal overflow.

Limits and unrun local checks: DynamoDB Local, full Node 24 unit matrices, Python Cloud IaC rendering/linting and macOS Rust/Tauri packaging were not executed locally for this web UI slice and run in the 3 required GitHub Actions jobs (`web-and-core`, `cloud-artifact`, `native`) on the exact PR head. Real Cognito authentication, paid entitlement verification, automatic sync/download/push scheduling, native shells, AWS deployment and M2.2 milestone exit remain outside this PR.
