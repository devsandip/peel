# New Cloud notes stay pending

2026-10-29 16:32 IST. Previous: [Readers finish before the expected commit](2026-10-29-1558-readers-finish-before-commit.md).

I integrated PR159 after all three source40858493017 and separate main40859641351 gates passed. Proof6494678079, actual158closure/ProjectDone, primary advancement and owned ref cleanup are verified. The original157 main failure remains failed evidence. I corrected the positive fixture's unsupported progress assumption; its exact old interleaving is still unknown.

I planned issue160 before code in21a2ae4. A fresh Cloud capture now allocates its own ID and empty editor state synchronously. It waits for no storage or network call. Nothing enters the cache until the first actual edit. Putting away an untouched empty draft leaves no row; typing and then clearing the text still retains a touched note.

I reuse the scoped session's retention drain and existing Markdown editor. A held first write must finish before Put away, failed retention keeps copyable text, and an existing or competing row cannot be adopted or overwritten. A lost first-insert reply can be reconciled against its exact attempted snapshot. Local retention remains Pending upload; only a matching service confirmation permits Saved in Cloud, and an older receipt cannot save newer typing.

Seven new SQLite/service cases pass, with Node24 focused25/4, Cloud428/34 then shared643/72. All37 browser cases pass, including three new capture flows. The first focused browser run failed only its new empty-DOM matcher because CodeMirror renders a placeholder; the corrected visible-placeholder/empty-source assertion and original failure are recorded. An unsafe collision-adoption control fails the intended refusal, with exact source restored before positives. Type/format/build pass and the default bundle is unchanged.

This is another disabled app composition prerequisite. It does not enable Cloud authentication, upload, full web inventory or live delivery. Hosted source/main gates still precede integration. I have not accessed a real note/operator database, launched a native app or renewed an old allowance.

## Decisions

- I defer the first cache row until actual typing so untouched captures need no empty-row deletion API or storage transaction.
- I keep a touched empty note and require an absent-row insert, preserving intentional edits and competing content.

## Direction changes

None. This applies the existing v0.8 capture and pending-draft contract.

## Needs revisit

- Issue160 needs hosted source review/gates and normal integration/main proof. Cloud authenticated parent loading, upload/reconnect/full library/live and actual platform acceptance remain open. M2.2 managed/independent teardown and stopped31/51/72 remain unmet; no expired allowance is revived.
