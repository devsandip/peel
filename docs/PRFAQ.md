# Synkies press release and FAQ

Version 0.8 | 29 October 2026 | Confirmed two-tier product direction

This is a proposed customer narrative, not a launch announcement. Synkies/Folded Horizon and compatible stored identifiers remain. Sandip's 29 October decision replaces the earlier peer-sync model: Local libraries are independent; Cloud is authoritative across devices and the web. Implementation and acceptance status live in [SPEC.md](SPEC.md).

## Proposed announcement

Synkies puts small, independent notes on your Mac desktop, with a searchable library and simple editing on iPhone and the web. Capture without a title or saving ritual, put a note away when finished, and find it again by words or tags. Optional meaning search runs locally.

Choose one storage tier for the whole library. **Local storage** keeps an independent library on this device. **Cloud storage** saves the authoritative library in Synkies Cloud, makes it available through the web and pushes confirmed changes to online devices. The source device does not have to stay online after a Cloud save.

Local notes display Saved on this device after local persistence. Cloud notes display Saved in Cloud only after the server confirms the current edit. You can edit cached Cloud notes offline: Synkies retains a pending draft on the device and uploads it when connected. Pending drafts remain clearly separate from confirmed Cloud notes.

## What does Local storage mean?

Each installation has its own library. Your laptop and phone do not discover, pair with or synchronize with one another. A browser's Local library belongs to that browser profile. There is no device list, relay, connection service or background peer transfer. Export/import is an explicit way to move a copy yourself.

## What does Cloud storage mean?

Your complete library belongs to one authenticated Synkies account and is stored in app-managed DynamoDB. Devices submit changes to that authoritative service first. After commit, the service pushes updates to online clients, which reconcile their caches. You can sign into the web interface to access all confirmed Cloud notes without needing the original laptop or phone online.

Cloud remains the paid tier; the price, billing provider and terms are not finalized. Users do not configure their own AWS account.

## Can I write without an internet connection?

Yes. Local notes save directly on the device. Cloud clients can read cached notes and retain offline edits or new notes as durable pending drafts. They upload on reconnect, and display Saved in Cloud only after confirmation. An offline draft cannot appear on another device or the web before its source uploads it. A new browser/device needs a connection to authenticate and download its Cloud library.

## Does a local draft count as a Cloud save?

No. A local write, sent request or push notification does not establish a server save. Pending upload remains visible until the server confirms the matching current edit. If you keep typing while an earlier edit is acknowledged, the newer draft remains pending. Failed authentication, conflict or quota must preserve that draft and offer recovery.

## What happens if devices edit a Cloud note while offline?

The server checks note revisions. Concurrent drafts preserve both versions for explicit resolution rather than silently overwriting one by device time. Resolving a conflict produces a new server mutation. Nothing in Local storage merges across devices because those libraries are independent.

## How do Mac notes work?

Use the global capture shortcut, menu bar or New Note. Start in the body without entering a title. Each note is an independent floating macOS window outside the separate Notes Library. Closing or minimizing the library leaves those notes visible.

Each note has one top-left green minus Put away control. A Local note commits before closing. A Cloud note may close after its pending draft is durably retained, while the library continues to show Pending upload until server confirmation. Failure to retain the latest text keeps the editor open with Retry and Copy text. Putting away does not archive or delete a note.

## Can I pin and arrange notes?

Drag a library card out or choose Pin to desktop from its menu. Drag a note by its title bar. Device-local shortcuts and Window menu actions arrange notes along an edge; Undo last arrangement restores geometry without reverting text. These desktop interactions do not change the selected storage tier.

## Can I change tiers?

Yes, through an explicit whole-library transition. Signing in alone never uploads a Local library. Upgrading previews and authorizes the upload, preserves recoverable originals and confirms accepted Cloud notes. Downgrading downloads a complete confirmed copy for this installation and explains pending drafts before its library becomes independent. Cancelling a subscription, removing Cloud data and deleting an account are separate actions.

## Do I need an account?

Local storage does not require a Cloud account or subscription. Cloud access needs sign-in and a server-verified entitlement. Account switching must keep cached notes and pending drafts isolated; it must never upload one account's draft under another identity.

## Where are notes stored?

Local native libraries use SQLite; browser-local libraries use IndexedDB. Local notes are not uploaded. Cloud's authoritative library uses DynamoDB, with device-local caches and pending drafts for responsiveness and recovery. Search indexes and embeddings remain local. Clearing browser data can remove local-only notes and unuploaded drafts, so export important work.

## How do search and formatting work?

Word, phrase, prefix and ##tag search operate over available notes, including Archive and excluding Trash. Meaning search is optional local retrieval with a disclosed model download; it returns source notes/excerpts rather than generated answers. Note bodies support one Markdown heading level, bold, checkboxes, bullets and numbered lists. Unsupported source remains editable text.

## How do archive and deletion work?

Archive keeps a note searchable. Trash is excluded from ordinary search and recoverable for30 days. Permanent deletion leaves a body-free marker to prevent stale Cloud clients or imports from reviving that identity; explicit recovery creates a new note. Offline caches and user exports can retain copies until reconnected or separately cleaned. Backups have published retention; deletion must not claim instantaneous physical erasure.

## What is encrypted?

Cloud uses authenticated HTTPS and AWS encryption at rest. It is not currently promised to be end-to-end encrypted; the service processes Cloud note text. Local databases, caches, drafts and exports depend on the device/browser security context. Notes, titles, tags, queries, credentials and draft payloads must stay out of telemetry.

## What does the operator pay for?

Cloud hosting, authentication, API requests, DynamoDB, live connections/notifications, transfer, backups, billing integration and bounded operational logs. Local storage needs no peer signaling or relay service. Verify current rates and measured usage before deployment; no price or cost allowance is invented by this document.

## What exists today?

Local Mac/browser development clients and tested Cloud backend/recovery foundations exist. The complete new Cloud login, authoritative save status, hosted web access, live delivery, billing, iPhone and release acceptance are not enabled by a specification or mockup. There is a known native dragging gate and broader platform validation remains. See [README](../README.md), SPEC and current milestone evidence.

## What must pass before public release?

Durability and honest save states; Local isolation; Cloud authentication/entitlement/account isolation; server-confirmed mutation, complete web library, push/reconnect and offline draft recovery; mode transitions; Mac/iPhone/browser parity; search/accessibility/performance; export/restore; signed distribution, operating budgets and at least14 days of dogfooding. Peer pairing, TURN relays and peer clock convergence are no longer launch gates.

## What remains undecided?

Subscription price, billing provider, trial/quota/grace/retention policy, exact supported versions, semantic model and Apple distribution access. These are implementation and launch decisions. They do not restore the retired peer-sync scope.
