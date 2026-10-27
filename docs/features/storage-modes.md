# On-device and paid Cloud modes

## User direction, 26 October 2026

Update PRFAQ/PRD, SPEC, and mockups before continuing application implementation.

1. On-device mode keeps note data on phones and computers, periodically synchronizes devices without cloud note storage, and accepts the latest edit as the correct version.
2. Cloud mode stores the complete collection in Peel Cloud, synchronizes connected devices in real time, and is paid.
3. Keep the sole green minus Put away control and its save-before-close behavior.

This supersedes the earlier separate local-only and cloud collections with per-note destination overrides. It also adds free peer sync; SQLite alone does not implement that requirement.

## Requirements

Revise FR-03/04/13 and add FR-17 (direct periodic sync), FR-18 (paid entitlement), FR-19 (latest-edit convergence), and FR-20 (live cloud delivery). Extend AC-03/04/09/11/12/13 and add mode, peer, payment, live-delivery and transition checks. Existing capture, editor, local durability and desktop requirements remain in force.

## Working assumptions

- The mode applies to the linked note library, not individual notes. Every note in Cloud mode participates in cloud storage and sync.
- On-device sync requires deliberate pairing. Unpaired installations remain independent. Paired installations retain local replicas and exchange updates periodically.
- Sandip confirmed remote free sync, including different networks. Prefer a direct authenticated encrypted peer connection; use transient TURN packet relay when direct connectivity fails. Signaling and relays may run on servers, but no note payload is stored there, queued for offline recipients, or logged. Paired devices need an overlapping online opportunity; local outboxes retain work until then.
- iPhone background execution is controlled by iOS. Sync on foreground/reconnect plus periodic attempts while the app is active; show last sync and waiting devices. Do not promise a guaranteed background timer.
- Latest edit wins automatically for on-device synchronization. Retain the replaced version locally for seven days as optional recovery, without a blocking conflict picker. Cloud concurrent-offline policy is explicitly retained in the SPEC until Sandip extends the latest-edit rule to Cloud.
- Cloud is a paid feature; price, billing provider, trial and quotas remain undecided. Mockups label it Paid without inventing a price or successful charge.
- Real-time Cloud means push delivery between online, authorized, active clients. Offline or suspended clients reconcile on return. Durable local save always comes first.

## Work order

1. Rewrite the canonical product documents and mode/transition contracts.
2. Update onboarding, library labels, settings, pairing, sync status, note actions, recovery, upgrade, cancellation, browser and iPhone mockups. Remove per-note Move to destination choices.
3. Render and inspect the affected screens; verify new routes, mode labels, latest-edit states and green Put away controls.
4. Record the document/mockup baseline, then resume native checks and implementation against the revised SPEC. Keep the initial local app as an incomplete on-device build until peer sync is proven.

## Verification

PRD, PRFAQ and SPEC are version 0.7. SPEC has 20 functional requirements and 25 acceptance criteria. The gallery now contains 110 canonical screens and five dark exports. All render/route/dialog/theme/desktop interaction checks pass, including free-mode pairing, automatic latest-edit recovery, paid activation, verified-copy downgrade, removal of stale per-note destinations, and green minus controls.

I visually inspected the mode picker, Mac paired-device view, iPhone device status, paid plan, automatic latest-edit recovery and complete-copy verification screens. These validate presentation only; no remote sync, payment or Cloud implementation is claimed. Application implementation may now resume against version 0.7.
