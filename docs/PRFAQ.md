# Synkies PRFAQ

Version 0.7 | 26 October 2026 | Intended product, implementation underway

Brand update: 28 October 2026. Synkies replaces the name Peel and adopts Antigravity v2 Folded Horizon. Functional version 0.7 and requirement IDs stay unchanged; repository, storage and protocol identifiers retain their compatible names. See [brand plan](features/synkies-brand.md).

[PRD.md](PRD.md) defines the product scope; [SPEC.md](SPEC.md) owns behavior and acceptance. This launch narrative is a future promise, not a claim that all features have shipped.

## Proposed press release

### Synkies keeps a thought close, on your terms

Synkies combines the immediacy of a Mac sticky note with a searchable library for Mac, iPhone, and the browser. One shortcut opens a note with a ready cursor. Type, put it away, and carry on. Saving happens automatically on the device.

Choose one of two modes for your library. Free On-device mode keeps notes in local databases on your devices and periodically syncs paired devices, including across different networks. The latest edit becomes the current note after a peer sync. Synkies stores no note content on a server in this mode. Encrypted transient relays help devices connect when a direct connection is unavailable; changes wait on a device until paired devices have an overlapping online opportunity.

Paid Synkies Cloud stores the complete library in DynamoDB and keeps local copies on connected devices. Edits sync live between online devices, and the cloud can deliver saved changes after the originating device goes offline. Offline work still saves locally and catches up when a device reconnects.

On Mac, notes are independent, draggable windows outside the separate Notes Library. The only top-left control is a green minus: Save and put away. It finishes the local save and closes that note window while keeping the note in the library. Drag cards out of the library or right-click to pin them. Keyboard commands arrange open notes against any screen edge, with Undo.

Synkies supports one Markdown heading level, bold, checkboxes, bullets, numbering, and ##tags. Find notes by words or with optional on-device search by meaning. Archive puts notes out of the way; Trash allows recovery for 30 days. Export portable Markdown and metadata whenever you want.

Sandip dogfoods Synkies before public beta. Pricing and the launch date remain undecided. The intended public release includes both storage modes, remote periodic device sync, paid live Cloud sync, Mac, iPhone, browser access including Android, and local retrieval.

## Customer FAQ

### How do I capture and save a note?

Use the Mac global shortcut, menu bar, or New Note. The proposed capture shortcut is Control Option N. On iPhone and web, tap New Note. Start in the body without entering a title. Every edit saves locally in both modes; cloud or peer availability never gates typing.

### Does the green minus delete my note?

It saves and puts the window away. The note remains in Notes Library. The tooltip says Save and put away note. A failed save keeps the editor open with Retry and Copy text. Archive and deletion are separate menu actions.

### How do free On-device and paid Cloud differ?

On-device stores notes on paired devices only. It syncs periodically whenever devices can reach one another, including remotely. Cloud stores the whole library in Synkies Cloud and pushes committed updates to connected devices as they happen. Cloud is paid; the price is not set yet.

### Will free sync work when I am away from home?

Yes, remote sync is required. Pair your devices once. Synkies first attempts an encrypted direct connection and can use an encrypted transient relay when network restrictions require it. A relay passes packets without keeping your notes. Both devices, or a chain of paired devices holding the latest copy, must have overlapping online opportunities. If your phone is offline, your Mac keeps pending changes until a peer can receive them.

### Does “periodic” mean my iPhone always wakes on a fixed schedule?

No. While apps are active and peers are reachable, the proposed default is an attempt every minute, plus foreground, reconnect, and Sync now. iOS controls background execution, so a suspended phone can catch up when Synkies opens. Last sync and Waiting for a device make that visible.

### What if I change the same note on two devices in On-device mode?

The latest edit becomes the current version automatically after sync. The app uses a deterministic edit ordering shared by peers and records clock uncertainty; it does not ask you to merge every concurrent edit. The replaced text is kept in local recent-version recovery for seven days. Recovery makes a new edit or separate note. Unsynchronized changes remain on their device until exchanged.

### Is the latest real-world edit always knowable offline?

Device clocks can disagree. Synkies combines edit time with a logical counter and stable device identity to converge, calibrates clocks during sync, and explains a clock problem when one is detected. Causally later edits win; truly concurrent offline edits use the agreed ordering. A recovery copy protects against an unwanted winner.

### How does Cloud behave offline?

Your local cache remains editable and durable. Connected active devices receive live changes after the cloud accepts them. An offline or suspended device reconciles on return. Concurrent offline Cloud edits retain both versions for explicit resolution; the automatic latest-edit rule currently applies to On-device mode.

### Is storage chosen per note?

No. The selected mode applies to the whole linked library. Cloud mode includes every note, including Archive and recoverable Trash. There is no per-note destination picker. This replaces the earlier proposal for separate local and cloud collections.

### Do I need an account or payment for On-device mode?

No cloud account or subscription is required. Capture is available immediately; adding another device requires explicit pairing. Pairing authenticates devices to each other and does not sign up for paid Cloud.

### Does signing in upload my existing notes?

Signing in alone does not. Enabling paid Cloud includes a separate review showing that all notes will upload, the plan terms, and the linked library. Source data remains on devices until cloud durability is verified. A failed or interrupted upgrade keeps recoverable local copies.

### Can I switch back to On-device mode?

Yes. Download and verify the complete collection before leaving Cloud. Keep paired-device copies and continue periodic peer sync. Subscription cancellation and cloud-data removal are explicit, separate actions with published retention. Switching mode does not silently delete cloud data, other devices, or backups. An expired subscription keeps local capture and export usable and explains the cloud retention grace period.

### Where does each device store notes?

Mac and iPhone use a small SQLite database. Mac can use a chosen local directory; iPhone uses private app storage. Web uses IndexedDB in its browser profile. Clearing browser data can remove its local copies, so export important notes. Free browser peer-sync compatibility is an M0 gate and remains part of the intended public product.

### What is kept on Synkies's servers in free mode?

No note bodies, titles, tags, embeddings, recovery versions, or offline note queue. A remote connectivity service may keep limited pairing/public-key and connection metadata; transient relay buffers exist only for delivery. The privacy policy must distinguish that metadata from note storage. Server logs must exclude note payloads and credentials.

### How does the desktop work?

Each note is an independent window outside Notes Library. Closing or minimizing the library leaves notes visible. Drag the title bar to move a note, or drag a library card out/right-click Pin to desktop to open it. Keep on top is separate from pinning. Quit preserves pinned placements for the next launch; putting a note away removes it from the current desktop set.

### Can I arrange all open notes?

Use Window or the proposed Control Option Command plus Left, Right, Up, or Down. It arranges notes on the active display, keeps other displays unchanged, and offers Undo last arrangement without changing text.

### What Markdown and tags are supported?

Use # Heading for the sole heading level, **bold**, - [ ] and - [x] for tasks, - for bullets, and 1. for numbering. Type ##work after whitespace to add a tag. Other syntax remains literal and editable. Source mode stays available.

### Does AI search send my notes to an AI company?

No. Optional search by meaning downloads a local model and returns real notes and excerpts. It does not invent answers or act as a chatbot. Word search stays available without the model. Meaning search is not being made a paid Cloud-only feature by this change.

### What happens to archived or deleted notes?

Archive remains searchable. Trash is excluded from normal search and recoverable for 30 days. Lifecycle changes sync according to the selected mode. Permanent deletion leaves a body-free marker so a stale peer cannot revive that identity. Offline devices and exported copies can retain content until they reconnect or are cleaned up.

### Is Cloud end to end encrypted?

The initial Cloud design uses HTTPS, device security, and AWS encryption at rest. It is not end to end encrypted. Free peer transport authenticates paired devices and encrypts note transfer through relays. Local databases and exports rely on the device's security. Cloud encryption requirements remain a public-launch decision.

## Internal FAQ

### What changes in the plan?

The product now has a free device-resident library with remote periodic peer sync and a paid cloud-backed library with live sync. It no longer offers per-note storage destinations. Free peer connectivity, clock/convergence rules, paid entitlements and real-time delivery are explicit engineering work. A local-only build does not complete On-device mode.

### Who pays for free remote sync infrastructure?

The operator still pays for signaling and any relayed bandwidth. No cloud note storage does not mean zero network cost. Measure direct versus relayed sessions and set abuse/bandwidth protections without logging note content. Public pricing must sustain the free tier alongside paid Cloud.

### What must be proven before public launch?

Native durability and window behavior; remote peer sync across different networks; latest-edit convergence and recovery; live cloud delivery; payment/entitlement isolation; offline and mode-transition recovery; browser and iPhone parity; local search; accessibility; export/restore; signing and rollback; operating budgets; and at least 14 days of daily dogfooding. SPEC owns the acceptance evidence.

### What remains undecided?

Subscription price, billing provider, trial and quota policy, cancellation grace/retention periods, peer transport/runtime and relay deployment, semantic model, exact supported versions, Apple distribution access, and whether Cloud needs end to end encryption before launch. These open decisions do not remove the confirmed features from scope.
