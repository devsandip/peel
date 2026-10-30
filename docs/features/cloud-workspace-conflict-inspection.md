# Scoped Cloud conflict inspection in the development workspace

[Issue 205](https://github.com/devsandip/peel/issues/205) makes preserved Cloud conflicts reachable from the existing Cloud development workspace under [Milestone M2.2](https://github.com/devsandip/peel/milestone/2) through the unchanged read-only `CloudConflictPreview` component shipped in [PR 203](https://github.com/devsandip/peel/pull/203). This plan precedes code. [SPEC](../SPEC.md) FR-02, FR-07, FR-13, FR-14 and AC-09, AC-10, AC-12, AC-13, AC-15 prerequisites plus [ui-spec.md](../ui-spec.md), [cloud-cached-library.md](cloud-cached-library.md), [cloud-workspace.md](cloud-workspace.md), [cloud-workspace-status.md](cloud-workspace-status.md) and [cloud-conflict-preview.md](cloud-conflict-preview.md) define the contract. Default Cloud remains unavailable and unwired from default application routes.

## Scope and interface boundary

This slice modifies four existing web workspace files and adds four owned plan, fixture and browser-test files:

- `docs/features/cloud-workspace-conflict-inspection.md`
- `apps/web/src/cloud-cached-library.tsx`
- `apps/web/src/cloud-cached-library.css`
- `apps/web/src/cloud-workspace.tsx`
- `apps/web/src/cloud-workspace.css`
- `tests/fixtures/cloud-workspace-conflict-inspection.html`
- `tests/fixtures/cloud-workspace-conflict-inspection.tsx`
- `tests/e2e/cloud-workspace-conflict-inspection.spec.ts`

Existing `CloudConflictPreview` files, conflict-resolution controllers, library owners, upload schedulers, protocol/storage packages, existing tests, shared fixtures, `apps/web/src/main.tsx` and repository worklogs remain untouched. Explicit conflict-resolution controls follow in the next PR after Root's `CloudConflictResolutionController` ([Issue 204](https://github.com/devsandip/peel/issues/204)) merges.

Coordinated callback contract ([Issue 205](https://github.com/devsandip/peel/issues/205), [Issue 169 comment 6523465012](https://github.com/devsandip/peel/issues/169#issuecomment-6523465012)):

```ts
export type CloudCachedLibraryProps = {
  store: CloudLibraryStateStore;
  scope: CloudScope;
  signal: AbortSignal;
  refreshKey: number;
  onOpen?: (selection: CloudLibraryNoteSelection) => void | Promise<void>;
  onCreate?: (context: CloudLibraryContext) => void | Promise<void>;
  onInspectConflict?: (
    selection: CloudLibraryNoteSelection,
  ) => void | Promise<void>;
};
```

`CloudLibraryContext`, `CloudLibraryNoteSelection` and `CloudWorkspaceProps` remain unchanged. `CloudWorkspace` wires `onInspectConflict` internally to `CloudConflictPreview`.

## Behavior and lifecycle decisions

1. **Distinct `Inspect conflict` action strictly on validated `Conflict` catalog entries:**
   - Render a sibling `<button type="button" className="card-inspect-conflict">` inside conflicted `.note-card` items only when `entry.status === "Conflict" && typeof onInspectConflict === "function"`. Omitting `onInspectConflict` renders zero conflict-inspection controls.
   - Support all validated `Conflict` entry kinds produced by `listLibrary` (`active`, `archived`, `trashed`, `recovery` and `purged`) across `Notes`, `Archive`, `Trash` and `Needs attention`. Never offer `Inspect conflict` for non-conflict statuses, including `entry.kind === "recovery"` entries whose status is `Pending upload` while an unacknowledged send holds a deferred observed purge or deletion.
   - Keep `Open <title>` strictly for `entry.kind === "active"` when `onOpen` is provided, and never nest `<button>` controls. Non-active conflicted entries (`archived`, `trashed`, `recovery`, `purged`) keep a non-interactive `<div className="card-open">` summary and never open in the active note editor.
   - Name the control `aria-label="Inspect conflict for <title or Cloud note needs recovery>"` with visible label `"Inspect conflict"` so the accessible name begins with the exact visible text, and attach `data-conflict-note-id={entry.noteId}` for deterministic focus restoration.
2. **Active editor retention and parent acknowledgement before conflict inspection:**
   - When an active editor is open in `CloudWorkspace` (including an open editor for the same `noteId` or an untouched new-note capture), selecting `Inspect conflict` runs the existing `closeActiveBeforeSwitch()` path (`session.putAway()`, background `void upload.upload()`, and `onPutAway` parent acknowledgement) before mounting `CloudConflictPreview`.
   - If local retention (`session.putAway()`) or `onPutAway` fails, keep the active editor mounted and focused with the latest typed text and existing recovery controls (`Retry`, `Copy text` and workspace alert when closed-session `onPutAway` fails). Never discard or unmount an unretained draft to show a conflict comparison.
   - If the user concurrently clicks green-minus `Put away note` while `Inspect conflict` awaits a held retention commit or held `onPutAway`, coalesce closure through the single `closingTask`, notify `onPutAway` once and honor the explicit dismiss without opening conflict preview afterward.
3. **Read-only `CloudConflictPreview` wiring, synchronous scope isolation and stale-action refusal:**
   - Capture `props.context` and `scope` through own enumerable data property descriptors (`Object.getOwnPropertyDescriptor` with `"value" in descriptor`) so accessor getters on `context` or `scope` are refused without invoking untrusted getters, and key `SelectedWorkspace` on `store`, `signal` and serialized validated `scope`.
   - Validate `matchesWorkspaceContext(selection)` and `validateCloudNoteId(selection.noteId)` before opening inspection. Increment `latestRequest.current` when entering or closing inspection so late `onOpen` or `onCreate` resolutions from earlier clicks are ignored, and clear `activeInspection` synchronously when starting `handleOpen` or `handleCreate` so previous conflict details hide immediately.
   - Render unchanged `<CloudConflictPreview context={workspaceContext} noteId={visibleInspection.noteId} signal={signal} refreshKey={effectiveRefreshKey} />`. Any account, collection, mode-generation or `signal` replacement (including in-place `scope` mutation), `AbortSignal` abort or invalid `refreshKey` synchronously hides or unmounts old conflict state without flashing prior account or note text.
   - Keep `Pending upload`, `Conflict` and `Observed Cloud revision <N> (cached on this device)` copy truthful. Render zero `Resolve`, `Save`, `Restore` or new-note resurrection actions and perform zero storage writes (`store.commit` or `store.close`) during conflict inspection.
4. **Keyboard-operable `Back to notes` control and focus restoration:**
   - Render a header toolbar above `CloudConflictPreview` inside `.cloud-workspace-inspection` with `<button type="button" className="cloud-workspace-inspection-back">Back to notes</button>`.
   - Move focus to `Back to notes` when conflict inspection opens (and when switching to narrow layout while focus was inside the background library) so keyboard and screen-reader navigation enters the inspection pane immediately and `Tab` advances directly to `CloudConflictPreview`'s `Copy draft text` and `Copy observed Cloud text` buttons.
   - Activating `Back to notes` closes the inspection pane and restores focus to the originating `.note-grid button.card-inspect-conflict[data-conflict-note-id="<noteId>"]` when uniquely present and enabled (waiting across `aria-busy="true"` catalog reloads with provisional `New note` fallback), or falls back to `New note` (then `Refresh cached notes`) when that conflict entry is no longer visible. Existing editor Put-away focus restoration by unique active card title remains unchanged.
5. **Responsive Folded Horizon split-pane and `390x844` full-viewport sheet:**
   - On desktop viewports (`> 820px`, verified at `1280x800`), `.cloud-workspace[data-inspection-open="true"]` uses a two-column split (`minmax(280px, 0.85fr) minmax(0, 1.35fr)`) with a sticky `100dvh` scrollable inspection pane so the cached library remains operable alongside `CloudConflictPreview`'s two-column comparison (`@container conflict-preview (inline-size >= 720px)`).
   - On narrow viewports (`<= 820px`, verified at `390x844`), `.cloud-workspace-inspection` becomes a fixed `100dvh` scrollable sheet (`inset: 0; z-index: 20; overscroll-behavior: contain`) while `.cloud-workspace-library` becomes `inert` and suppresses background polite live-region announcements (`aria-live="off"`).
   - Size `Inspect conflict` and `Back to notes` buttons to at least `24x24` CSS pixels (`min-block-size: 36px` desktop, `40px` narrow and coarse-pointer viewports), use explicit high-contrast borders and `:focus-visible` outlines in light and dark schemes, and prevent horizontal overflow with `min-inline-size: 0` and `overflow-wrap: anywhere`.

## Verification plan and limits

Add synthetic browser-only fixture `tests/fixtures/cloud-workspace-conflict-inspection.html` and `tests/fixtures/cloud-workspace-conflict-inspection.tsx` (never imported by `apps/web/src/main.tsx`) backed by fresh test-owned `peel-m0-cloud-workspace-conflict-*` `IndexedDBCloudStateStore` namespaces, real `DurableCloudClient` conflict transitions, real `CloudLibraryOwners` + loopback `startCloudUploadServer` for active editor autosave/retention/Put-away, and a fake in-page `navigator.clipboard.writeText` double.

Verify in real headless Chrome on strict port `65528` (`reuseExistingServer: false`):

- Navigating from cached library cards to `CloudConflictPreview` across `Notes` (active conflict offering both `Open` and `Inspect conflict`), `Archive` (archived conflict), `Trash` (trashed conflict) and `Needs attention` (remote-purged recovery conflict, remote-trashed recovery conflict and local-purged conflict), confirming non-active conflicts never open in the active editor, non-conflict notes (including deferred-observed `Pending upload` recovery entries) never render `Inspect conflict`, fake clipboard copies work for preserved bodies, zero `Resolve`/`Save` buttons appear and inspection performs zero `store.commit` or `store.close` calls.
- Active editor retention and `onPutAway` parent acknowledgement before opening conflict inspection: typed edits flush to IndexedDB (`Pending upload`) and notify `onPutAway` before `CloudConflictPreview` mounts, then confirm via loopback HTTP in the background; retention failure and `onPutAway` failure keep the active editor mounted and focused with the latest typed text and recovery controls without opening preview; concurrent `Inspect conflict` and green-minus `Put away note` during a held commit coalesce to a single `onPutAway` call.
- Held and stale transitions: switching between conflicted notes during a held preview `store.read`, switching from conflict inspection to `Open` or `New note` (synchronously hiding old conflict text), superseding a held `onOpen` or `onCreate` with `Inspect conflict`, account/collection/mode-generation replacement, in-place `scope` mutation, accessor-getter `context`/`scope` refusal (`0` getter calls from workspace/library/preview and `0` `store.read` calls), `refreshKey` updates (including conflict state changing to non-conflict and negative/invalid `refreshKey`), `AbortSignal` cancellation and standalone `CloudCachedLibrary` `onInspectConflict` omission or rejection without leaking private error messages.
- Keyboard focus entry (`Back to notes` focused on open), `Tab` navigation to `Copy draft text` and `Copy observed Cloud text`, `Enter`/`Space` activation of `Back to notes` restoring focus to the exact originating `Inspect conflict` button (including disambiguating two untitled `"Cloud note needs recovery"` cards in `Needs attention`, waiting across a held `refreshKey` catalog reload, and falling back to `New note` when the conflict entry is cleared), plus `1280x800` desktop split-pane and `390x844` narrow full-viewport sheet geometry (`inert` background library, `>= 24x24` px targets, zero horizontal overflow, clean `peel-m0-cloud-workspace-conflict-*` teardown, `peel-local-v1` untouched) and visually inspected desktop and mobile screenshots.

Run `pnpm check`, Prettier check, `git diff --check`, `pnpm build` confirming unchanged default app bundle hashes, focused Cloud unit suites, coordinated Playwright suites on strict port `65528`, no-reply Git author/committer verification and `gitleaks` scans. Conflict-resolution mutations, new-note ID creation for permanently purged remote notes, real Cognito login, paid entitlement, live sync fan-out, native shells, AWS deployment and M2.2 milestone exit remain outside this slice.

## Validation evidence

- Branch `antigravity/cloud-workspace-conflict-inspection` from verified `main` `ffa55a57a7a5409c3277fb010234fdf52c5208a4`, pre-code plan commit `2673961322cb6763079d92dae1860cb5a0977a51`.
- Initial failures encountered and fixed before final verification:
  - `pnpm check` initially failed in `tests/fixtures/cloud-workspace-conflict-inspection.tsx` because `DurableCloudClient.resolve` takes `(noteId, expectedGeneration, choice)` rather than `(noteId, choice, expectedGeneration)`; fixed the helper argument order.
  - First Playwright run of `tests/e2e/cloud-workspace-conflict-inspection.spec.ts` failed two test steps: (1) Test 3 clicked `CloudUploadingNoteEditor`'s green-minus `Put away note` on a settled idle editor wired to real `CloudLibraryOwners.putAway`, hitting the separate `CloudUploadingNoteEditor` acknowledgement/upload ordering defect tracked in [Issue 208](https://github.com/devsandip/peel/issues/208); updated Test 3 to switch directly from the settled idle open editor (no held upload) to `Inspect conflict for Active roadmap conflict` through `CloudWorkspace`'s `closeActiveBeforeSwitch` and `putAwayActiveEditor` path (`await onPutAway(...)` ordered immediately after `await entry.upload.session.putAway()` before `finally { void entry.upload.upload(); }`), verifying real `CloudLibraryOwners.putAway` retirement with `closed: true` and `retained: true`; and (2) Test 4's `replaceConflictWithSaved` helper passed hardcoded revision `10` instead of `prepared.baseRevision + 1` to `cloudAck(prepared)`; fixed to use `cloudAck(prepared)`.
  - Second Playwright run failed one assertion in Test 3 after `mountMutableContextAndCorruptInPlace()` and `triggerRerender()`: mutating `context.store` to Account B's store while forging `scope.ownerSubject` caused `assertCloudScope` to refuse the foreign scope and render `"Cached Cloud library unavailable"` with `0` list items rather than Account B's catalog; updated Test 3 to assert `"Cached Cloud library unavailable"`, `0` list items and absence of `"Account B private conflict"`.
- Passed local checks:
  - `pnpm check` (`tsc --noEmit`), `pnpm exec prettier --check` across all 8 owned files and `apps/web/src packages infra tests`, and `git diff --check`.
  - `pnpm build`: all 8 `apps/web/dist` SHA256 hashes matched verified `main` (`dist/assets/index-C2AI2ViB.js` `966165752f4e505298da067e93054c904b11e08a383593ddb4980cbe3c366c45`, `dist/assets/index-BJXYavW2.css` `c2290a1a8fa8af673c73743ecd7fc10183805164ec799c6f86e3463c741db29d`, `dist/assets/search.worker-B3BfQQXg.js` `225907605a1d2b1d9060df94c485d2511c2a56eeb5a9936860cabe0c9861b599`, `dist/index.html` `00b981f72f3978e90192b5de38362b643fdd0dc6f67b2467e3697fa07db40981`, `dist/peel.svg` `3339e48ad41e1925a6b1c941062c68cfd31f90ab2406c2413a6093bfb6e8cfcc`, `dist/sw.js` `2fa3ae0411105f386aabef9568c2209a5137ce9baf1aa550426e3823caf4c691`, `dist/synkies-logo-dark.svg` `634fda018515f0413580c383149ec6c8274310c487acbbf4733c443fcff50916`, `dist/synkies-logo-light.svg` `2c7c9ce104113d527029f25943b76e06ba8209d0ba381230e4900acf73eb60d1`).
  - Focused Vitest Cloud unit suites (`--maxWorkers=4`): `8/8` files, `113/113` tests passed (`cloud-client-conflicts`, `cloud-local-durability`, `cloud-note-cache-view`, `cloud-cached-library`, `cloud-draft-session`, `cloud-note-upload`, `cloud-library-owners`, `cloud-browser-workspace-session`).
  - Coordinated Playwright browser suites on strict port `65528` (`reuseExistingServer: false`): `7/7` files, `44/44` tests passed (`cloud-workspace-conflict-inspection.spec.ts` `4/4`, `cloud-workspace.spec.ts` `13/13`, `cloud-cached-library.spec.ts` `7/7`, `cloud-conflict-preview.spec.ts` `8/8`, `cloud-download-web.spec.ts` `4/4`, `cloud-library-owners.spec.ts` `5/5`, `cloud-browser-workspace-session.spec.ts` `3/3`), using fresh synthetic `peel-m0-cloud-workspace-conflict-*` IndexedDB stores (cleaned on teardown, `peel-local-v1` untouched) and an in-page fake clipboard double.
  - Visual screenshot review at `1280x800` (`workspace-conflict-inspection-desktop.png`, two-column workspace split with side-by-side comparison cards) and `390x844` (`workspace-conflict-inspection-mobile.png`, full-viewport mobile sheet with `inert` background library and stacked cards), confirming high-contrast borders, `:focus-visible` outlines, unclipped `>= 36px` desktop and `>= 40px` narrow controls, wrapped long tokens and literal HTML inside `<pre>`, and zero horizontal overflow.
- Unrun locally and scope boundaries: DynamoDB Local integration tests, full Node 24 repository test sweep, Python Cloud IaC checks (`cloud-artifact`) and macOS Rust/Tauri checks (`native`) execute in hosted GitHub Actions on the frozen PR head SHA. Explicit conflict-resolution actions, new-note ID creation for permanently purged remote notes, real Cognito authentication, paid entitlement, live sync fan-out, default app Cloud activation, AWS deployment and M2.2 milestone exit remain outside this PR.
