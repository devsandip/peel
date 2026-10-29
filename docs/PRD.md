# Synkies product requirements

Version 0.8 | 29 October 2026 | Confirmed two-tier implementation baseline

Synkies uses Antigravity's Folded Horizon identity. Compatible repository, package, protocol and storage identifiers retain their existing names. This revision replaces v0.7's peer-sync scope following Sandip's explicit decision; stable requirement IDs remain in [SPEC.md](SPEC.md).

Synkies is a fast personal note app for Mac, iPhone and browsers, including Android browsers. Sandip dogfoods it first; public release follows measured reliability and distribution gates. [PRFAQ.md](PRFAQ.md) describes the customer experience and SPEC owns the detailed behavior and acceptance evidence.

## Customer problem

Capture should take one action and no saving ritual. Notes should remain close to the work on Mac and easy to retrieve. People choose either an independent library on one device or a Cloud library available across their devices and the web.

## Two app-wide tiers

|                     | Local storage                                          | Cloud storage                                                                                   |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Price               | Free                                                   | Paid; price and billing provider undecided                                                      |
| Authoritative notes | This installation's local database                     | Complete authenticated library in DynamoDB                                                      |
| Other devices       | Independent libraries with no awareness of one another | Server-committed changes pushed to online devices                                               |
| Web access          | Browser-local notes stay in that browser profile       | Complete committed Cloud library accessible after sign-in, independently of the original device |
| Offline editing     | Save directly on this device                           | Retain local pending drafts; upload on reconnect                                                |
| Saved status        | After durable local commit                             | Only after Cloud confirms the matching current edit                                             |
| Account             | No Cloud account required                              | Synkies account and active entitlement                                                          |

Local storage has no pairing, device discovery/list, signaling, relay, background peer sync or automatic transfer. Laptop, phone and browser installations do not know that the others exist. Portable export/import remains an explicit user action.

Cloud is authoritative. A new edit becomes a shared note only after its server commit, then propagates to online clients. Cached notes remain readable offline. As explicitly confirmed by Sandip, offline edits survive as durable pending drafts and upload on reconnect; a local draft write never displays Saved in Cloud. Unuploaded drafts are unavailable on other devices and the web until their source reconnects. A source device may go offline after Cloud confirms a save without preventing other clients from reading that committed note.

The selected tier applies to the whole library, with no per-note destination picker. Switching from Local to Cloud requires explicit authorization to upload the complete library; signing in alone does not upload it. Switching back downloads a complete confirmed copy for this installation, then makes its Local library independent. Subscription cancellation and Cloud-data removal remain explicit, separate actions. No switch silently deletes another device's notes or the Cloud copy.

## Core experience

- One-action capture, a ready cursor and automatic persistence. Local writes are final Local saves; Cloud local writes retain pending drafts until server confirmation.
- Independent floating Mac notes with one top-left green minus Put away. Local notes commit locally before closing; Cloud notes can close after their pending draft is durably retained, with Pending upload still visible until confirmation. Retention failure keeps the editor open.
- A separate library; closing or minimizing it leaves floating notes visible. Drag title bars, drag cards out or right-click to pin, and arrange notes at display edges with shortcuts and Undo.
- Word, phrase, prefix and tag search over available local/cached notes; optional local meaning search. No hosted inference of note content or queries.
- One Markdown heading level, bold, checkboxes, bullets, numbering and inline ##tags, preserving source text.
- Edit, archive, Trash with30-day restoration, permanent deletion and portable Markdown plus metadata export/import.
- Honest statuses: Local Saving/Saved on this device/Could not save; Cloud Pending upload/Saving to Cloud/Saved in Cloud, with Offline/Sign in again/Conflict/Sync paused when applicable. An older receipt cannot mark newer typing Saved.
- Server revisions preserve concurrent offline Cloud drafts for explicit resolution. No peer clock/convergence protocol or silent device-time overwrite is required.

## Delivery and success

Complete native/local Mac durability and desktop behavior, then an authenticated Cloud save-to-web/other-device path, live updates, offline draft reconciliation and whole-library transitions. Add iPhone and meaning search under their existing platform and quality gates. Local-only installations are a complete storage tier once their native/browser acceptance passes. A locally tested backend or polling-only prototype is not the promised live Cloud tier.

Acknowledged-save recovery, account/entitlement isolation, server-confirmed status, complete web access and push/reconnect correctness are release requirements. Public launch also requires14 days of dogfooding, signed native distribution, tested restore/rollback, published pricing/retention, operating budgets and accessible core flows.

Peer transport, pairing, relays and automatic peer latest-edit convergence are removed from product scope. Retained prototype modules, failed experiments and v0.7 mockups are historical evidence, not active requirements or enabled features. Existing local clients and backend foundations do not establish v0.8 Cloud acceptance.

## Open implementation decisions

Billing provider, subscription price, quotas and trial/retention policy remain open. Supported device/OS versions, semantic model and Apple distribution access still require evidence. Hosting/authentication/live delivery and the new tier/status UI still need app integration. No actual AWS allowance, production deployment or real charge is renewed by this scope change.
