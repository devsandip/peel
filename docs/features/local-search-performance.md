# Local word-search performance

## Requirements

FR-06 and FR-08; AC-05 and AC-14. Cached word search targets p95 at most 100 ms on the specified release devices and must not block typing with tasks over 50 ms. This feature does not implement semantic search.

## Plan

1. Measure the existing search path on synthetic 10,000-note / 2 KiB fixtures with 500 tags and 10 percent archived notes. Use the initial small smoke measurement to identify rescan/allocation costs, not to claim release acceptance.
2. If it misses the budget, build an incrementally updated word index and worker boundary, preserving AND terms, final-token prefixes, phrases, tag filters and archive/Trash semantics from the canonical SPEC.
3. Reuse quality fixtures and add meaningful update/deletion/invalidation checks. Keep original notes as the source of truth; indexes are rebuildable and contain private derived data.
4. Run at least 100 measured release interactions, with device/build/raw timing and typing traces, before marking the performance acceptance passed. Record actual browser/native coverage and memory rather than extrapolating from Node.

## Evidence

The scan-per-query implementation took multiple seconds in the initial synthetic Node smoke test. An incremental word/posting index now caches tokenization, title/tag weights and phrase data. The core tokenizer has an ASCII fast path while retaining the full Unicode case-fold path. Original Markdown remains the source of truth.

Each library owns a worker and destroys it on unmount. Initial note transfer is bounded by 128 records and 262,144 UTF-16 code units per message, with a yield between batches. Later refreshes send only changed/removed records. Replies contain one page of IDs/excerpts plus the complete count; stale request IDs are discarded. Word, phrase, prefix, tag, lifecycle, edited-source and purge fixtures match the reference contract. Worker failure leaves saving available and offers an explicit local rebuild.

A production Chrome 155.0.8059.85 run on this Apple M4 / 16 GB Mac used 10,000 synthetic notes averaging 2,131 UTF-8 bytes, 500 tags and 10 percent archived. Across 100 warm offline input-to-result interactions, including two animation frames and no debounce, p50 was **32.6 ms**, p95 **33.6 ms**, and maximum **49.2 ms**. There were no observed main-thread long tasks or page errors during the measured queries. One cold library rebuild reached ready at **812.4 ms**. Raw samples, device and build asset IDs are in [the experiment report](../experiments/word-search-browser-2026-10-26.json).

This is partial evidence, not AC-05 or AC-14 completion. The fixture does not include unresolved cloud conflicts, and the timing corpus has no near-limit long notes. A separate paged worker browser flow includes a 240 KB note and edit/tag invalidation. The reported JavaScript heap is main-thread-only and excludes worker/native resident memory. There is no sustained typing trace or 20-run startup series yet. The baseline M1 Air / 8 GB, Safari, native WebView, iPhone, full memory and quality/device matrix remain open. Native runtime checking was unavailable while the Mac was locked; the worker asset is included in the successful release bundle.

Seven browser flows and 35 shared unit cases pass after the worker change. The held-commit fixture now releases acknowledgements that arrive after its release signal too, removing a race in the test harness without weakening the save barrier. Native window and save gates remain separate in [local-mac-app.md](local-mac-app.md).

## Reproduce

```bash
pnpm build
node scripts/benchmark-browser.mjs
pnpm exec vite build --ssr packages/search/src/index.ts --outDir scratch/word-bench --emptyOutDir
node scripts/benchmark-words.mjs
```

Run the timing experiment without concurrent build/test loads. Both scripts use only generated synthetic data. The browser script uses a temporary profile and an isolated loopback preview server; it never reads the user's browser or native library. The Node result is a component experiment and cannot substitute for browser or native timings.
