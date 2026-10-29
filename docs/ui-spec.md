# Synkies visual specification

Version 0.8 | 29 October 2026 | Current tier/status contract; historical v0.7 exports

Synkies uses a quiet library and independent paper notes, with common editing behavior on Mac, iPhone and browser. The current [SPEC](SPEC.md) and [PRFAQ](PRFAQ.md) define two tiers: independent Local storage and cloud-authoritative Cloud storage. Local installations have no awareness of one another. Cloud commits first on the server, then pushes updates to online clients and exposes all confirmed notes through the web.

The existing gallery/PNG exports depict historical v0.7. They include retired peer pairing, waiting-device and relay flows and old save labels. Retain them as design history and reusable layout references, not current requirements or enabled v0.8 behavior. No new v0.8 screen export or UI acceptance is claimed by this document. Stable screen/storage identifiers and Synkies/Folded Horizon assets remain compatible.

## Review the historical screens

- [Open the local gallery](mockups/index.html). Open this file in a browser, or serve the mockups folder as static files.
- [Overview](mockups/overview.png) shows the floating Mac desktop and iPhone editor.
- [Desktop overview](mockups/desktop-overview.png) shows the library alongside floating notes and edge arrangements.
- [Complete screen index](mockups/all-screens.png) places every canonical screen on one sheet.
- Individual PNG exports are linked in the inventory below.

The gallery provides navigation, direct links, light/dark appearance, and related flows. The Mac desktop additionally simulates title-bar dragging, library drag-out, right-click pinning, four keyboard edge arrangements, and Undo last arrangement within the depicted screen. No notes are saved and no OS-level windows or shortcuts are created.

## Visual decisions

Use system typography, warm neutral surfaces, compact icon controls, and restrained borders. Pale yellow paper makes floating notes distinct from the library. The adopted Antigravity v2 Folded Horizon icon combines pale-yellow paper with an amber cloud fold on charcoal. Use its outlined Synkies wordmark and light/dark lockups; system typography remains the app UI font. Canonical masters live under `ux/brand/folded-horizon/`. The pale variation between note cards is a visual treatment, not a new color-picker feature.

Mac opens with independently draggable floating notes. Each note is a top-level macOS window outside Notes Library, with wallpaper and the OS Dock behind it. The desktop has no surrounding Synkies app frame. Open Notes Library is an explicit action; closing or minimizing the separate library window leaves the notes visible. Pinning through drag-out or right-click keeps the same note on the desktop and in the library. Always on top is an independent preference. The library organizes a selected collection with Notes, Archive, Trash, tags, and Settings. Each floating note has exactly one top-left title-bar button, a green minus called Put away, which commits a Local note or retains a pending Cloud draft and closes only that window. The rest of the title bar is draggable. No additional minimize, maximize, pin, overflow, or formatting toolbar appears on the normal floating note. Its footer is noninteractive status. Note actions, Keep on top, and Markdown source live in menus. Save failure keeps the editor open with recovery actions. Close remains separate from archive and delete; the editor has no Save button.

The entire Mac capture section uses that same desktop and note-window presentation: quick capture, formatted note, Markdown source, note actions, and menu bar capture. Each note is draggable in the gallery. The menu bar capture scene shows the library and all notes closed, with New note still available.

On iPhone, use a two-column library, a direct new-note action, a full-screen editor, and bottom sheets for collection choice, filters, and actions. On Android, show the responsive browser layout rather than a native Android application.

Storage tier is app-wide. Show **Local storage · Free** and **Cloud storage · Paid**. Local storage has no device list, pairing, discovery, waiting-peer status, signaling, relay or sync control. Its status describes only this installation. Signing in alone must not upload a Local library.

Cloud stores the authoritative complete library, pushes server-committed changes to online clients and provides complete authenticated web access without the original device online. Account-bound caches provide offline reads; durable offline drafts remain Pending upload until reconnect and matching server confirmation. An unuploaded draft is unavailable on other devices/web. An older receipt cannot mark newer typing Saved. Live/Connecting is separate channel status and never acknowledges an edit.

| Tier/state                                      | Customer status and behavior                                            |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Local write pending                             | Saving on this device                                                   |
| Local durable commit                            | Saved on this device                                                    |
| Cloud draft retained locally, offline or queued | Pending upload; explain Offline or sign-in/quota reason when applicable |
| Cloud request in progress                       | Saving to Cloud; no Saved claim yet                                     |
| Matching latest Cloud edit confirmed            | Saved in Cloud                                                          |
| Concurrent Cloud draft                          | Conflict; preserve both versions for explicit resolution                |
| Local note/draft retention failed               | Could not save/retain draft; keep editor open with Retry/Copy text      |

The sole green minus remains Put away. Local closes after durable commit. Cloud can close after its pending draft is durably retained, with Pending upload visible in the library until server confirmation. Never force a network round trip merely to close a retained draft, and never mistake that close for Cloud Saved. Keep independent native windows and existing note/library geometry behavior.

Paid Cloud still needs plan review, explicit whole-library activation, server upload acknowledgement, live/reconnect, billing/payment/expiry, cancellation, complete-download downgrade and separate data removal. Price/provider/retention remain undecided; no real purchase follows from a mockup. Downgrading creates an independent Local library on this installation and does not switch other clients. Cloud conflict comparisons remain relevant; automatic peer latest-edit recovery screens are retired. DynamoDB/entitlement internals stay out of customer setup.

Word and meaning search are separate modes. Results link to actual note excerpts rather than generated answers. Model size/progress values in the mockups are illustrative until the M0 model experiment. Formatting follows the SPEC's limited Markdown subset and uses ##tag syntax in source content.

Show Local saves separately from Cloud confirmation. Offline, sign-in expiry, quota, local retention failure, unavailable folders, unsupported schema, note-size limits and conflicts need explicit recovery. A pending/conflict Cloud draft is labelled unconfirmed until server acknowledgement.

## Appearance tokens

| Token          | Light   | Dark    |
| -------------- | ------- | ------- |
| Canvas         | #eeede8 | #20231f |
| App surface    | #fffefa | #30342e |
| Sidebar        | #f5f4ef | #292d27 |
| Primary text   | #292c28 | #efeee4 |
| Secondary text | #777a70 | #b0b4a6 |
| Note paper     | #fff5c7 | #514a2e |
| Note text      | #45412d | #f5eac8 |
| Amber accent   | #efd06b | #d9b657 |

Use native system font stacks and line icons. Primary actions use a strong neutral fill; destructive actions use red with explicit text. Do not rely on color alone for status. These are proposed design tokens, subject to implementation accessibility checks.

## Historical v0.7 screen inventory

### Mac capture

| Screen | Platform | Requirements |
| --- | --- | --- |
| [Notes on the desktop](mockups/screens/mac-desktop.png) | mac | FR-01 · FR-11 |
| [Quick capture](mockups/screens/mac-capture.png) | mac | FR-01 · FR-02 |
| [Formatted note](mockups/screens/mac-note.png) | mac | FR-02 · FR-09 · FR-10 |
| [Markdown source](mockups/screens/mac-source.png) | mac | FR-10 |
| [Note actions](mockups/screens/mac-note-menu.png) | mac | FR-07 · FR-11 · FR-12 |
| [Menu bar capture](mockups/screens/mac-menu-bar.png) | mac | FR-01 · FR-11 |

### Library

| Screen | Platform | Requirements |
| --- | --- | --- |
| [Notes library](mockups/screens/mac-library.png) | mac | FR-05 · FR-08 |
| [First local note](mockups/screens/mac-empty.png) | mac | FR-01 · FR-03 |
| [Filter by tags](mockups/screens/mac-tags.png) | mac | FR-09 |
| [Archive](mockups/screens/mac-archive.png) | mac | FR-07 |
| [Trash and restore](mockups/screens/mac-trash.png) | mac | FR-07 |
| [Delete permanently](mockups/screens/delete-note.png) | mac | FR-07 |
| [Archived note editor](mockups/screens/mac-archived-note.png) | mac | FR-07 |

### Search

| Screen | Platform | Requirements |
| --- | --- | --- |
| [Word search](mockups/screens/search-words.png) | mac | FR-06 |
| [No search matches](mockups/screens/search-empty.png) | mac | FR-06 |
| [Search by meaning](mockups/screens/search-meaning.png) | mac | FR-06 · FR-14 |
| [Enable meaning search](mockups/screens/model-consent.png) | mac | FR-06 · FR-14 |
| [Model download](mockups/screens/model-download.png) | mac | FR-06 |
| [Preparing meaning search](mockups/screens/model-indexing.png) | mac | FR-06 · FR-08 |
| [Meaning search unavailable](mockups/screens/model-unavailable.png) | mac | FR-06 |

### Storage

| Screen | Platform | Requirements |
| --- | --- | --- |
| [Choose saving mode](mockups/screens/storage-destination.png) | mac | FR-03 · FR-17 · FR-18 |
| [Connect Synkies Cloud](mockups/screens/cloud-signin.png) | mac | FR-04 · FR-14 |
| [Waiting for authorization](mockups/screens/cloud-authorizing.png) | mac | FR-04 |
| [Downloading cloud notes](mockups/screens/cloud-download.png) | mac | FR-04 · FR-08 |
| [Enable Cloud for all notes](mockups/screens/move-to-cloud.png) | mac | FR-03 · FR-13 · FR-18 |
| [Switch library to On-device](mockups/screens/move-to-local.png) | mac | FR-03 · FR-13 |
| [Sign out of Synkies](mockups/screens/signout-cloud.png) | mac | FR-04 · FR-14 |
| [Change Synkies account](mockups/screens/switch-account.png) | mac | FR-14 |

### Settings

| Screen | Platform | Requirements |
| --- | --- | --- |
| [General settings](mockups/screens/settings-general.png) | mac | FR-01 · FR-11 |
| [Storage settings](mockups/screens/settings-storage.png) | mac | FR-03 · FR-04 |
| [Search settings](mockups/screens/settings-search.png) | mac | FR-06 |
| [Export your notes](mockups/screens/transfer-export.png) | mac | FR-12 |
| [Import notes](mockups/screens/transfer-import.png) | mac | FR-12 |
| [Import results](mockups/screens/transfer-results.png) | mac | FR-12 |
| [Desktop and shortcuts](mockups/screens/settings-desktop.png) | mac | FR-11 · FR-15 · FR-16 |

### Recovery

| Screen | Platform | Requirements |
| --- | --- | --- |
| [Offline and saved locally](mockups/screens/sync-offline.png) | mac | FR-04 · FR-13 |
| [Sign in to sync again](mockups/screens/sync-reconnect.png) | mac | FR-04 · FR-13 |
| [Cloud sync paused](mockups/screens/sync-paused.png) | mac | FR-04 · FR-13 |
| [Local save failed](mockups/screens/save-error.png) | mac | FR-02 · FR-13 |
| [Compare concurrent versions](mockups/screens/conflict-compare.png) | mac | FR-13 |
| [Combine versions](mockups/screens/conflict-merge.png) | mac | FR-13 |
| [Cloud collection missing](mockups/screens/cloud-missing.png) | mac | FR-04 · FR-13 |
| [Local folder unavailable](mockups/screens/local-drive-missing.png) | mac | FR-03 · FR-13 |
| [Update required](mockups/screens/unsupported-version.png) | mac | FR-13 |
| [Note length limit](mockups/screens/note-limit.png) | mac | FR-10 · FR-13 |
| [Shortcut unavailable](mockups/screens/shortcut-conflict.png) | mac | FR-01 |

### iPhone

| Screen | Platform | Requirements |
| --- | --- | --- |
| [iPhone notes library](mockups/screens/iphone-library.png) | iphone | FR-01 · FR-05 |
| [iPhone note editor](mockups/screens/iphone-editor.png) | iphone | FR-02 · FR-05 · FR-10 |
| [iPhone quick capture](mockups/screens/iphone-capture.png) | iphone | FR-01 · FR-02 |
| [iPhone Markdown source](mockups/screens/iphone-source.png) | iphone | FR-05 · FR-10 |
| [iPhone search](mockups/screens/iphone-search.png) | iphone | FR-05 · FR-06 |
| [iPhone tag filters](mockups/screens/iphone-tags.png) | iphone | FR-09 |
| [iPhone saving mode](mockups/screens/iphone-collections.png) | iphone | FR-03 · FR-05 |
| [iPhone note actions](mockups/screens/iphone-actions.png) | iphone | FR-07 · FR-12 |
| [iPhone settings](mockups/screens/iphone-settings.png) | iphone | FR-03 · FR-06 |
| [iPhone conflict resolution](mockups/screens/iphone-conflict.png) | iphone | FR-13 |
| [iPhone Trash](mockups/screens/iphone-trash.png) | iphone | FR-07 |
| [iPhone mode switch](mockups/screens/iphone-move.png) | iphone | FR-03 · FR-13 |
| [iPhone meaning search](mockups/screens/iphone-meaning.png) | iphone | FR-06 · FR-14 |
| [iPhone library menu](mockups/screens/iphone-more.png) | iphone | FR-07 |
| [iPhone Archive](mockups/screens/iphone-archive.png) | iphone | FR-07 |
| [iPhone On-device notes](mockups/screens/iphone-peer-library.png) | iphone | FR-05 · FR-17 |
| [iPhone paired devices](mockups/screens/iphone-peer-devices.png) | iphone | FR-05 · FR-17 |
| [iPhone device pairing](mockups/screens/iphone-peer-pair.png) | iphone | FR-14 · FR-17 |

### Browser

| Screen | Platform | Requirements |
| --- | --- | --- |
| [Browser notes library](mockups/screens/web-library.png) | web | FR-05 |
| [Browser note editor](mockups/screens/web-editor.png) | web | FR-02 · FR-05 |
| [Browser first use](mockups/screens/web-welcome.png) | web | FR-03 · FR-05 |
| [Browser offline](mockups/screens/web-offline.png) | web | FR-04 · FR-08 |
| [Browser storage settings](mockups/screens/web-storage.png) | web | FR-03 · FR-13 |
| [Browser storage is full](mockups/screens/browser-quota.png) | web | FR-02 · FR-13 |
| [Android browser layout](mockups/screens/web-mobile.png) | android | FR-05 |
| [Browser local note](mockups/screens/web-local-editor.png) | web | FR-02 · FR-03 |
| [Browser On-device notes](mockups/screens/web-peer-library.png) | web | FR-05 · FR-17 |
| [Browser device pairing](mockups/screens/web-peer-pair.png) | web | FR-05 · FR-14 · FR-17 |

### Account

| Screen | Platform | Requirements |
| --- | --- | --- |
| [Create a Synkies account](mockups/screens/cloud-signup.png) | web | FR-04 · FR-14 |
| [Verify email](mockups/screens/account-verify.png) | web | FR-14 |
| [Reset password](mockups/screens/account-password.png) | web | FR-14 |
| [Delete Synkies account](mockups/screens/account-delete.png) | web | FR-07 · FR-14 |
| [Account deletion status](mockups/screens/account-deleting.png) | web | FR-14 |
| [Choose new password](mockups/screens/account-reset-code.png) | web | FR-14 |

### Mac desktop

| Screen | Platform | Requirements |
| --- | --- | --- |
| [Notes Library and desktop](mockups/screens/mac-library-desktop.png) | mac | FR-11 · FR-15 |
| [Drag a note onto the desktop](mockups/screens/mac-library-drag.png) | mac | FR-15 |
| [Pinned from the library](mockups/screens/mac-library-pinned.png) | mac | FR-11 · FR-15 |
| [Right-click to pin](mockups/screens/mac-library-context.png) | mac | FR-15 |
| [Arrange open notes menu](mockups/screens/mac-arrange-menu.png) | mac | FR-16 |
| [Arrange notes left](mockups/screens/mac-arrange-left.png) | mac | FR-16 |
| [Arrange notes right](mockups/screens/mac-arrange-right.png) | mac | FR-16 |
| [Arrange notes top](mockups/screens/mac-arrange-top.png) | mac | FR-16 |
| [Arrange notes bottom](mockups/screens/mac-arrange-bottom.png) | mac | FR-16 |
| [Library closed, notes visible](mockups/screens/mac-library-closed.png) | mac | FR-02 · FR-11 |

### Retired v0.7 peer-sync screens

| Screen | Platform | Requirements |
| --- | --- | --- |
| [On-device notes](mockups/screens/peer-library.png) | mac | FR-03 · FR-17 |
| [Your paired devices](mockups/screens/peer-devices.png) | mac | FR-17 |
| [Pair another device](mockups/screens/peer-pair.png) | mac | FR-14 · FR-17 |
| [Confirm the paired device](mockups/screens/peer-confirm.png) | mac | FR-14 · FR-17 |
| [Waiting for a device](mockups/screens/peer-waiting.png) | mac | FR-13 · FR-17 |
| [Periodic device sync](mockups/screens/peer-syncing.png) | mac | FR-02 · FR-17 |
| [Remote encrypted connection](mockups/screens/peer-relay.png) | mac | FR-14 · FR-17 |
| [Latest edit applied](mockups/screens/peer-latest.png) | mac | FR-13 · FR-19 |
| [Recent local versions](mockups/screens/peer-history.png) | mac | FR-13 · FR-19 |
| [Unpair a device](mockups/screens/peer-unpair.png) | mac | FR-14 · FR-17 |

### Paid Cloud

| Screen | Platform | Requirements |
| --- | --- | --- |
| [Paid Cloud plan](mockups/screens/cloud-plan.png) | mac | FR-03 · FR-18 |
| [Activating Cloud for all notes](mockups/screens/cloud-activating.png) | mac | FR-03 · FR-13 · FR-18 |
| [Cloud live sync](mockups/screens/cloud-live.png) | mac | FR-04 · FR-20 |
| [Cloud subscription](mockups/screens/cloud-billing.png) | mac | FR-18 |
| [Cloud payment needs attention](mockups/screens/cloud-payment-failed.png) | mac | FR-13 · FR-18 |
| [Cancel Cloud renewal](mockups/screens/cloud-cancel.png) | mac | FR-18 |
| [Cloud plan expired](mockups/screens/cloud-expired.png) | mac | FR-13 · FR-18 |
| [Verify the complete device copy](mockups/screens/cloud-downgrading.png) | mac | FR-03 · FR-13 |
| [Remove retained Cloud data](mockups/screens/cloud-remove-data.png) | mac | FR-03 · FR-07 · FR-18 |
| [Cloud data removal requested](mockups/screens/cloud-data-removed.png) | mac | FR-03 · FR-07 |

## Verification and limits

Every inventory screen was rendered in headless Chrome through Playwright. Checks cover JavaScript errors, broken screen routes, dialog placement, stale branding/provider copy, capture/account navigation, appearance switching, and gallery width at 390 pixels. The render report lives in [mockups/render-report.json](mockups/render-report.json).

I visually inspected the Mac library and floating desktop, iPhone library/editor/capture and tag sheet, cloud sign-in, conflict comparison, storage settings, and local-save failure. I corrected a clipped iPhone formatting label before regenerating all exports. Five representative screens also have dark PNG exports; the whole gallery supports both themes.

This validates mockup presentation only. It does not pass the SPEC's application acceptance criteria, guarantee native performance, validate actual authentication, or establish accessibility compliance. Production implementation must verify keyboard and VoiceOver behavior, text scaling, contrast, touch targets, and native lifecycle handling.

## Desktop interaction details

Pinning leaves a note freely movable and preserves its note ID and library mode. Closing/removing it from the desktop keeps it in the library. Quit preserves the desktop set for relaunch. A library note already open on the desktop offers Bring to front and Remove from desktop in its context menu.

The Window menu proposes Control Option Command with Left/Right/Up/Down for edge arrangements, plus Undo last arrangement. Command Shift L opens Notes Library. Layout commands operate on the active display. Desktop mockup scenes illustrate three-note layouts; larger-count native layout, display handling, and global shortcut registration remain M0 work.

The presentation check confirms one Close button per floating note, closes Notes Library while preserving the same note windows and positions, closes one note while retaining the other windows and its library entry, and keeps a failed-save note open. It also checks the shared design across all six Mac capture screens, drags quick/formatted/source note title bars, dismisses an untouched draft, opens right-click note actions, and creates a note through the resident menu bar with all windows closed. It physically drags a desktop title bar, drags a library card outside its window, cancels a drop with Escape, pins with the right-click menu, verifies no duplicate window, invokes all four keyboard arrangements, and restores the previous positions. These are browser mockup checks, not native application acceptance results.

## Green Put away control

Sandip replaced the red cross with a green circle containing a minus. Its tooltip is Save and put away note. It retains save-before-close behavior, preserves the library entry, and leaves a failed save open. The accessible name continues to describe save and close. Apply the same control to all floating Mac and capture mockups and the native editor. Verify its glyph and color as well as existing close/recovery behavior.

## Two saving modes, version 0.7

The historical v0.7 gallery has 110 screens and five additional dark exports. The following paragraph describes that retired scope, not v0.8: The updated gallery adds remote On-device pairing/status/recovery and paid live Cloud lifecycle screens. All free-mode notes remain on devices; remote encrypted relay is transient transport. Paid Cloud covers the complete library. Review storage-destination for the mode choice, peer-devices for free sync, cloud-plan for paid activation, and cloud-live for connected live status. The green minus Put away control retains its existing save-before-close behavior. These are presentation artifacts, not proof that remote sync, payment, or cloud storage exists.
