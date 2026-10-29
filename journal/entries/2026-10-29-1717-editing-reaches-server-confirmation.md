# Editing reaches server confirmation

2026-10-29 17:17 IST. Previous: [New Cloud notes stay pending](2026-10-29-1632-new-cloud-notes-stay-pending.md).

I completed PR161 with all three source40862463586 and separate main40863710699 checks, both first attempts. Proof6495297819, actual160closure/ProjectDone, primary advancement and owned ref cleanup are verified. I preserve its initial DOM-matcher failure and the earlier157 CI failure as historical evidence.

I planned issue162 in97ee278 before code. I now connect the pending-draft session and Markdown editor to a scoped mutation sender. Typing is retained first, an immutable operation is prepared, the actual server response is validated and committed to the original cache, and the editor refreshes from that confirmation. Newer typing stays pending. A lost successful response retries the same operation after reopen. Authentication failure and conflict preserve local work.

I exercised the whole path through actual browser fetch, an owned loopback HTTP service and fresh SQLite. A separate API client reads the committed copy while newer unconfirmed typing is still only in the source cache. Put away closes after local retention even while the server response is held. This joins existing app code; it is not a fabricated browser acknowledgement.

Review found one new cancellation race: an observer could cancel at upload-start notification and the sender still ran. Its regression failed with one request instead of zero. A check immediately after notification fixes it. Cancellation also blocks late replies and commits after held acknowledgement reads. A changed remote head pauses the old editor for recovery instead of marking old text Saved.

Twelve new unit cases pass. Node24 focused29/2, Cloud440/35 then shared655/73 pass sequentially; all41 browser cases and type/format/build pass. The default bundle remains unchanged. Source review and hosted gates still precede integration. Sender authentication, bounded requests and account lifetime belong to the real parent; the synthetic server's authentication is only a fixture. Default Cloud, managed login, full inventory/live and actual platform acceptance remain incomplete.

## Decisions

- I keep the established planning/review/validation approach, as Sandip reaffirmed, while joining existing components into a working save-and-read path.
- I stop automatic upload draining after failure/conflict and preserve the immutable operation for explicit retry or later authenticated recovery.

## Direction changes

None to v0.8 or deployment permissions. This slice connects retained drafts to server confirmation.

## Needs revisit

- Issue162 still needs exact-source hosted gates and normal integration/main proof. Real authenticated parent/context binding, sender deadlines/response bounds, complete library/reconnect/live and platform acceptance remain. Managed31/audit51/native72 stay stopped or blocked. No expired allowance or existing user database is used.
