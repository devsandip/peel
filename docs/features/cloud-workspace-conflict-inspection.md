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
