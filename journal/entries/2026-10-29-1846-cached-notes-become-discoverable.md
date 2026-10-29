# Cached notes become discoverable

2026-10-29 18:46 IST. Previous: [Automatic edits are batched](2026-10-29-1735-automatic-edits-are-batched.md).

I completed PR163 after all three final-source40870572977 and separate main40871261039 checks passed on their first attempts. Proof6496455511 records the exact heads. Actual162closure/ProjectDone, guarded primary advancement and owned ref cleanup are verified. The earlier15a source was not used for final readiness.

I planned issue164 in8d9e6d3 before code. I now list cached Cloud notes without asking a caller to know their IDs. The M0 adapters read metadata and pull progress in one transaction, scan valid owned rows, and keep only a bounded recent-first page. Note bodies and conflict text never leave that catalog. The scan remains linear; production performance and an index remain activation gates.

The panel separates Notes, Archive, Trash and Needs attention. A remote deletion against a local edit hides its title in ordinary Notes and shows body-free recovery metadata. A completed last download does not acknowledge pending notes. Scope-bound callbacks open the original note or create a new draft through the existing automatic editor. Actual HTTP/SQLite confirmation updates its library card after Put away. A second synthetic account with the same note ID confirms under its own server partition while the first account's note remains absent there.

The first focused run caught a null cursor/page-scope validation gap and a test using the wrong remote-head shape. I fixed the scope validation and corrected that new fixture. Another new corruption test tried to mutate a frozen entry; cloning before corruption exercises the intended refusal. These failures remain recorded. A visual check found reused global styles overlapping the status and hiding mobile New text. The strengthened mobile check failed at font size zero, then scoped styles fixed it. I inspected the corrected desktop and390px screenshots.

Final Node24 Cloud466/36 and shared681/74 pass sequentially, with47 browser cases and type/format/build. This includes22 new catalog cases and six browser flows. Default bundle hashes, schema/write paths and legacy assertions/defaults remain unchanged. The library is still an explicit cached development component, not an enabled authenticated full web library, managed deployment, live channel or platform acceptance. Its source review and hosted gates still follow.

## Decisions

- I return bounded metadata pages, not whole note bodies, and bind cursors to independent account/library/mode and collection selections.
- I label download and cache state separately from per-note save confirmation.
- I keep the M0 scan simple and explicit about its linear storage work; activation needs measured performance or a derived index.

## Direction changes

None to v0.8. Cached notes can now be discovered and opened through the existing editor instead of requiring a known ID.

## Needs revisit

- Issue164 needs exact-source review/gates and normal integration/main proof. Real authenticated parent, full remote download/reconnect/live, catalog performance/index and actual native/iPhone acceptance remain. M2.2 managed/independent teardown and stopped31/51/72 remain unmet; no expired allowance is revived.
