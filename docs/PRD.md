# Synkies product requirements

Version 0.7 | 26 October 2026 | Implementation baseline

Brand update: 28 October 2026. Synkies replaces the name Peel and adopts Antigravity v2 Folded Horizon. Functional version 0.7 and requirement IDs stay unchanged; repository, storage and protocol identifiers retain their compatible names. See [brand plan](features/synkies-brand.md).

Synkies is a fast personal note app for Mac, iPhone, and browsers, including Android browsers. Sandip dogfoods it first; public release follows measured reliability and distribution gates. [PRFAQ.md](PRFAQ.md) describes the customer experience and [SPEC.md](SPEC.md) owns the detailed contracts and stable requirement IDs.

## Customer problem

Capture should take one action and no saving ritual. Notes should remain close to the work on Mac and easy to retrieve on other devices. People should be able to choose whether note data ever lives in a cloud database.

## Two app-wide modes

| | On-device | Synkies Cloud |
| --- | --- | --- |
| Price | Free | Paid; price and billing provider undecided |
| Note storage | Local database on each paired device only | Complete collection in DynamoDB plus local device caches |
| Sync | Periodic, between paired devices, including different networks | Live push between online connected devices |
| Offline recipient | Changes wait on a device until peers overlap online | Stored cloud changes download when the device returns |
| Concurrent edits | Latest edit wins automatically; optional local recovery history | Preserve both offline concurrent versions for explicit resolution |
| Account | No cloud account required for local capture or peer pairing | Synkies account and active entitlement |

On-device remote sync may use encrypted transient relays for connectivity. Relays do not store note content. This differs from a cloud copy that can deliver changes while the source device is offline. The UI must explain waiting devices and last successful sync. iOS decides when background work can run; foreground and reconnect provide reliable sync opportunities.

The selected mode applies to all notes in the linked library. This supersedes the earlier per-note local/cloud destination choice. Switching to paid Cloud requires explicit authorization to upload the whole library; signing in alone does not upload it. Switching back preserves a complete on-device copy and separately explains subscription cancellation and cloud-data removal.

## Core experience

- One-action capture, a ready cursor, and durable local autosave in both modes.
- Independent floating Mac notes with a single top-left green minus Put away button. It saves and closes the window while retaining the note in Notes Library.
- A separate library; closing or minimizing it leaves floating notes visible. Drag notes by their title bars, drag cards out to pin, right-click to pin, and arrange open notes at any display edge with shortcuts and Undo.
- Word, phrase, prefix, and tag search offline; optional local natural-language retrieval. No hosted inference of note content or queries.
- One Markdown heading level, bold, checkboxes, bullets, numbering, and inline ##tags. Preserve source text.
- Edit, archive, Trash with 30-day restoration, permanent deletion, and portable Markdown plus metadata exports/imports.
- Truthful, separate local-save and sync states. Failures preserve local work and do not block capture.

## Delivery and success

Start with native/local Mac durability and desktop behavior, validate remote peer transport, then add full two-mode sync/browser, iPhone, and meaning search. A local-only development build is not the complete free offering. A polling cloud prototype is not the promised live Cloud mode.

Speed, acknowledged-save recovery, peer convergence, paid entitlement isolation, live delivery, and account/device isolation are release requirements. SPEC owns performance budgets and acceptance evidence. Public launch also requires 14 days of dogfooding, signed native distribution, tested restore/rollback, published pricing and retention, operating budgets, and accessible core flows.

## Open implementation decisions

Remote peer transport/runtime and relay deployment need feasibility and cost evidence. Billing provider, subscription price, quotas and trial policy remain open. Exact supported devices/OS versions, semantic model and distribution access still need verification. These are implementation/launch gates, not permission to remove free remote sync or paid live Cloud from scope.
