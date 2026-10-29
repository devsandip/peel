# Read-only scoped Cloud conflict preview

[Issue 181](https://github.com/devsandip/peel/issues/181) adds a read-only scoped Cloud conflict preview under [Milestone M2.2](https://github.com/devsandip/peel/milestone/2) so a user can inspect both preserved versions of a conflicted note and explicitly copy either body while parent conflict-resolution orchestration is built separately. This plan precedes code. [SPEC](../SPEC.md) FR-02, FR-07, FR-13, FR-14 and AC-09, AC-10, AC-12, AC-13 prerequisites plus [ui-spec.md](../ui-spec.md), [cloud-note-cache-view.md](cloud-note-cache-view.md), [cloud-client-conflicts.md](cloud-client-conflicts.md), [cloud-local-durability.md](cloud-local-durability.md), [cloud-workspace.md](cloud-workspace.md) and [cloud-workspace-status.md](cloud-workspace-status.md) define the contract. Default Cloud remains unavailable and unwired from default application routes.

## Scope and interface boundary

This slice adds only new conflict-preview files and modifies zero existing repository files:

- `docs/features/cloud-conflict-preview.md`
- `apps/web/src/cloud-conflict-preview.tsx`
- `apps/web/src/cloud-conflict-preview.css`
- `tests/fixtures/cloud-conflict-preview.html`
- `tests/fixtures/cloud-conflict-preview.tsx`
- `tests/e2e/cloud-conflict-preview.spec.ts`

Existing workspace, editor, protocol, persistence, transport, server, shared HTTP fixture, default route and global tracking files remain untouched. Neither this component nor its clipboard actions authenticate a user, grant paid Cloud entitlement, open or close storage, mutate or resolve conflicts, upload or download notes, delete data or activate Cloud mode.

Coordinated component contract ([Issue 181](https://github.com/devsandip/peel/issues/181), [Issue 169 comment 6506543880](https://github.com/devsandip/peel/issues/169#issuecomment-6506543880)):

```ts
export type CloudConflictPreviewProps = {
  context: CloudLibraryContext;
  noteId: string;
  signal: AbortSignal;
  refreshKey: number;
};

export function CloudConflictPreview(
  props: CloudConflictPreviewProps,
): React.JSX.Element | null;
```

## Behavior and lifecycle decisions

1. **Original-context capture, strict read-only cache validation and synchronous account/note isolation:** Inspect `props.context` through own enumerable data property descriptors (`store` with `typeof store.read === "function"` and `scope` cloned, validated and frozen via `validateCloudScope`), validate `props.noteId` via `validateCloudNoteId` and verify `props.signal` supports `aborted`, `addEventListener` and `removeEventListener` without forwarding raw `props` (`{...props}`) to child components. Key the inner `SelectedConflictPreview` instance on `store`, `signal`, serialized validated `scope` and `noteId` so any account, collection, mode-generation, note or signal change (including in-place mutation of caller `context` or `scope` objects) synchronously unmounts previous DOM during render without flashing prior account or note text. Perform cache reads strictly through `new DurableCloudClient(store, frozenScope).get(noteId)` and validate every non-null state with `cloudStateInScope(frozenScope, noteId, raw)`. Never call `store.commit`, `store.close`, `client.save`, `client.prepare`, `client.resolve` or `client.retry`, and never consult global credentials or network transports.
2. **Honest loading, unavailable and non-conflict states:**
   - Invalid `context`, invalid `scope`, invalid `noteId`, negative or non-integer `refreshKey`, aborted `AbortSignal`, rejected `client.get(noteId)` or failed `cloudStateInScope` validation render fixed unavailable copy (`Cloud conflict preview unavailable. Preserved versions on this device were not changed.`, `role="alert"`) with zero version panels, zero copy controls and zero raw exception, token or note strings. Invalid props or invalid `refreshKey` perform zero `store.read` calls.
   - While a valid read is in flight (initial mount, account/note switch or `refreshKey` update), render `<section aria-label="Cloud conflict preview" aria-busy="true">` with non-live `"Loading Cloud conflict preview..."` text and hide previous version panels immediately during render.
   - When a valid read settles with `state === null` or `state.conflict === null` (including `baseRevision === 0`, `pending !== null`, `inFlight !== null`, deferred `observed !== null` during an unacknowledged send, confirmed `Saved in Cloud` or confirmed `Deleted in Cloud`), never fabricate conflict comparison columns from `base`, `current` or deferred `observed`. Render the honest cache status (`No cached Cloud note`, `Pending upload`, `Deleted in Cloud` or `Saved in Cloud` matching `projectCloudCachedNote`) with read-only non-conflict copy so pending edits are never labeled saved.
3. **Preserved conflict comparison, lifecycle fidelity, permanent purge and literal Markdown safety:**
   - Only actual `state.conflict` renders the two comparison `<article>` cards named via `aria-labelledby` from fixed `<h2>` headings `Draft on this device` and `Observed Cloud version`, underneath the section `<h1>Cloud conflict preview</h1>` and an honest conflict status banner (`Conflict: Automatic Cloud upload is paused while both preserved versions remain on this device.`, `role="status" aria-live="polite"`).
   - Label the cached remote revision explicitly as `Observed Cloud revision <N> (cached on this device)` and never `Latest`, `Live`, `All notes synced` or `Up to date`. Show local base revision context (`Base revision: None (created offline before conflict)` when `baseRevision === 0`, or `Base revision: <M> (unconfirmed local change)` when `baseRevision > 0`).
   - Display actual local and remote lifecycle states explicitly:
     - Local (`conflict.local`): `Local state: Active`, `Local state: Archived`, `Local state: In Trash` (when `conflict.local.kind === "upsert"`), or `Local state: Permanent purge queued` (when `conflict.local.kind === "purge"` and `snapshot === null`).
     - Remote (`conflict.remote`): `Observed Cloud state: Active`, `Observed Cloud state: Archived`, `Observed Cloud state: In Trash` (when `conflict.remote !== null`), or `Observed Cloud state: Permanently purged in Cloud` (when `conflict.remote === null`).
   - Distinguish missing remote text (`conflict.remote === null`) from an empty active, archived or trashed note (`bodyMarkdown === ""`). When `conflict.remote === null`, render fixed permanent-purge copy (`This note identity was permanently purged in Cloud at observed revision <N>. No remote note text exists. A permanently purged note ID cannot be restored; saving your draft later requires a new note ID.`). When `snapshot !== null` and `bodyMarkdown === ""`, render its actual lifecycle state and explicit empty-note notice (`This local draft is an empty <state> note with no text.` or `This observed Cloud version is an empty <state> note with no text.`).
   - Render non-empty `bodyMarkdown` as a literal React text child inside `<pre className="cloud-conflict-preview-body">` (`white-space: pre-wrap; overflow-wrap: anywhere; user-select: text`) without HTML execution, `innerHTML` or rich-text Markdown rendering. Render zero `Save`, green-minus `Put away`, `Resolve`, `Restore` or `Retry` controls.
4. **Explicit per-version clipboard copy, single-flight locking and stale-outcome refusal:**
   - Render `Copy draft text` only when `conflict.local.kind === "upsert" && conflict.local.snapshot.bodyMarkdown.length > 0`, and render `Copy observed Cloud text` only when `conflict.remote !== null && conflict.remote.bodyMarkdown.length > 0`.
   - Call `navigator.clipboard.writeText(capturedBody)` only on explicit button click using the exact string captured from the currently visible validated `state.conflict` selection. Never invoke clipboard APIs on mount, render or selection change, and never re-read storage or mutable caller state during copy.
   - Prevent overlapping same-action copies with per-side synchronous ref locks (`"local"` and `"remote"` tracked independently) plus `disabled` button state while keeping the opposite version's copy button operable.
   - Bind each copy attempt to the mounted instance, active `AbortSignal` and exact `selection` (`refreshKey`). Clear visible copy feedback synchronously on `refreshKey` updates, `signal` abort or `store` / `scope` / `noteId` / `signal` replacement, and ignore late clipboard resolutions or rejections from superseded selections, aborted signals or unmounted views.
   - Show fixed generic outcomes (`Draft text copied to clipboard.` or `Observed Cloud text copied to clipboard.` with `role="status" aria-live="polite"`; `Could not copy draft text. Select the text below to copy it manually.` or `Could not copy observed Cloud text. Select the text below to copy it manually.` with `role="alert"`) without exposing exception messages, tokens, note text or telemetry.
5. **Responsive container layout, keyboard focus and visual tokens:**
   - Scope styles in `apps/web/src/cloud-conflict-preview.css` using container queries (`container: conflict-preview / inline-size`) so `.cloud-conflict-preview-grid` renders two side-by-side `repeat(2, minmax(0, 1fr))` columns when `inline-size >= 720px` (`1280x800` desktop) and stacks into `minmax(0, 1fr)` on narrow containers and `390x844` mobile viewports, with `min-inline-size: 0` and `overflow-wrap: anywhere` preventing horizontal overflow even for long unbroken tokens.
   - Size interactive copy buttons to at least `24x24` CSS pixels (`min-block-size: 36px` default, `40px` on coarse pointers and narrow containers), preserve native `<button type="button">` keyboard focus and activation in logical DOM order without placing `tabIndex={0}` on static `<pre>` blocks, and support Folded Horizon light and dark color schemes with explicit borders and high-contrast `:focus-visible` outlines.

## Verification plan and limits

Add synthetic browser-only fixture `tests/fixtures/cloud-conflict-preview.html` and `tests/fixtures/cloud-conflict-preview.tsx` (never imported by `apps/web/src/main.tsx`) backed by fresh test-owned `peel-m0-cloud-conflict-*` `IndexedDBCloudStateStore` namespaces, real `DurableCloudClient` conflict transitions (`save`, `prepare`, `conflict`, `applyRemoteCloudHead`) and a stubbed in-page `navigator.clipboard.writeText` double so the host OS clipboard, default `peel-local-v1` database, real profiles and external providers are never touched.

Verify in real headless Chrome on strict port `65528` (`reuseExistingServer: false`):

- Real durable conflicted states in IndexedDB across differing local and observed Cloud Markdown text, lifecycle combinations (`active`, `archived`, `trashed`, local `purge` with no local body, remote permanent purge `remote: null` with new-note-ID explanation, and empty active note `bodyMarkdown: ""` distinct from permanent purge), zero storage writes during preview/copy (`store.commit` count remains `0` and stored state/generation remain byte-identical), and literal HTML/script/Unicode preservation without script execution.
- Honest non-conflict states (`No cached Cloud note`, `Pending upload` including deferred `observed` while `inFlight`, `Saved in Cloud`, `Deleted in Cloud`) rendering zero conflict version columns and zero copy buttons.
- Held-read isolation across account, collection, mode-generation, in-place `scope` mutation, `noteId` and `refreshKey` replacements (immediately hiding previous account/note text and discarding late read completions and errors), plus `AbortSignal` abort, invalid props/`refreshKey` (zero `store.read` calls), foreign scope, closed store, malformed stored state and accessor-getter `context`/`scope` props without raw error leakage.
- Explicit fake-clipboard copy of `Draft on this device` and `Observed Cloud version`, copy button omission when a version has no body (`purge` or `""`), no automatic clipboard calls, same-action single-flight locking while allowing the opposite version to copy, generic error alert on clipboard rejection without leaking private error payloads, and stale clipboard success/failure refusal across account, note, `refreshKey`, `AbortSignal` abort and unmount transitions.
- Desktop (`1280x800` side-by-side) and narrow (`390x844` stacked) geometry, zero horizontal overflow with long unbroken strings, `>= 24x24` px button targets, keyboard `Tab` / `Enter` / `Space` operation, text selectability (`user-select: text`), clean `peel-m0-cloud-conflict-*` IndexedDB teardown (`peel-local-v1` never opened) and visually inspected desktop and mobile screenshots.

Run `pnpm check`, Prettier check, `pnpm build` confirming unchanged default app bundle hashes, focused Cloud unit suites, coordinated local Playwright validation, no-reply Git author/committer verification and `gitleaks` staged and range scans. Parent conflict-resolution actions, new-note recovery creation, real Cognito login, paid entitlement, sync scheduling, native shells, AWS deployment and M2.2 milestone exit remain outside this slice.
