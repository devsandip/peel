# OS sentence-embedding experiment

## Requirements and plan

FR-06/08/14 and AC-06/14 require local meaning retrieval across Mac, iPhone and web. The pinned browser model/cache now has isolated evidence, but its aggregate browser RSS is not a passed device budget. Evaluate Apple's existing NaturalLanguage sentence embedding as a separate native-runtime candidate without changing the selected product architecture or activating an app feature.

1. Use the installed SDK and [NLEmbedding API](https://developer.apple.com/documentation/naturallanguage/nlembedding) as primary sources. The API provides an explicit sentence-embedding revision and returns nil when unavailable. Query availability only; do not request model assets, redistribute OS weights or read private notes. Record the OS/SDK/framework identity and the lack of an exposed weight hash/download size as a limitation, not a completed artifact-pinning gate.
2. Compile a standalone Swift command-line program. Serialize every operation on each embedding instance, as Apple's documentation requires. No WebView, app window, CryptoKey store, desktop automation, relay, AWS resource or stopped component is involved. Run the owned executable with outgoing network denied; do not bypass the Mac lock or change OS settings.
3. First check installed English availability/revisions and one synthetic vector. If unavailable or restricted, record that outcome and stop this candidate without requesting an asset download. If available, use the existing frozen 30-question corpus, unchanged expected IDs and distractors. Keep all inputs/temporary binaries/results under owned ignored scratch; commit only code and metadata.
4. Measure one-process cold model/first-vector time, source indexing and 100 warm queries. Preserve complete source coverage through bounded overlapping chunks and record the opaque tokenizer/context limit as unresolved. Do not claim cross-model vector compatibility or full 10,000-body indexing from copied vectors. Record every top-three miss without tuning fixtures.
5. Distinguish current resident bytes, OS physical footprint and peak RSS. This standalone process does not establish app/multiwindow/iPhone memory, first launch, accessibility or supported-device AC-14. Keep no note/query text in error logs or reports. No automatic model choice follows from a passing synthetic score.
6. Compare candidates in this feature document, update the requirement evidence and handoff, then stop at the overnight cutoff. Native/iPhone bridge design, source/version identity, license/asset policy, incremental private indexes and held-out dogfood quality remain separate gates.

## Decisions and limits

This is a read-only OS-framework CLI experiment, distinct from the stopped WebKit crypto/peer composition and native UI interactions. Do not retry those components. It creates no app account, note database, login item or cloud copy. Apple's OS-provided model is not assumed to be the same model as all-MiniLM; vectors must never be mixed across model identities. Keep the canonical v1 platform scope and current production app unchanged.

## Evidence

### Availability and execution boundary, 27 October 2026

The installed macOS 26.6.2 (25G83) English sentence embedding supports revision1 and produces finite 512-dimensional vectors. The [capability report](../experiments/os-sentence-capability-2026-10-27.json) records one 89.276 ms API/first-vector observation and 34,144,256 bytes peak CLI RSS. This checks an existing installed model; no asset-download API, AppKit, WebView, app database or OS setting is used. `sandbox-exec` denies networking for the owned CLI. It does not account for every OS daemon/accelerator allocation or prove a different device has the model.

`node scripts/experiment-os-sentence.mjs` verifies the frozen corpus hash, writes a fresh marked scratch fixture, compiles the standalone Swift program and runs it with the network-deny profile. All API calls are serial, following Apple's [NLEmbedding concurrency requirement](https://developer.apple.com/documentation/naturallanguage/nlembedding). No Apple model binary is copied or redistributed. The output identifies the API/revision/OS build; a weight hash and download size are not exposed, so the full model-pinning gate is unresolved.

### Measured result and decision

[Initial report](../experiments/os-sentence-initial-2026-10-27.json) preserves the first complete run. The [final report](../experiments/os-sentence-2026-10-27.json) repeats it with independent arithmetic/self-retrieval controls:

| Measurement | Observed result | Boundary |
| --- | --- | --- |
| Semantic top three | 9 of 30, below the synthetic 24/30 threshold | Same frozen English questions and 70 non-Trash notes; no data/rank tuning |
| Model and first vector | 55.539 ms | Fresh CLI, measured after executable entry; OS/model caches may already be warm |
| Indexing | 621.279 ms for 70 notes/92 chunks | Every source scalar passed through bounded chunks; opaque internal tokenizer limits remain unknown |
| Warm query | 100 queries: p50 5.923 ms, p95 6.457 ms, max 7.915 ms | 10,000 copied vector rows, with 10,000 independent first-vector buffers verified; not a 10,000-body index |
| Final current resident bytes | 120,700,928 | One CLI process, including copied vectors and runtime |
| Peak physical footprint | 82,739,920 bytes | Mach task_vm_info ledger for this process, excludes other processes/system accelerators |
| Peak RSS | 120,717,312 bytes | Darwin process peak, not a unique model allocation or app/iPhone RAM gate |

Lifecycle/tag filters, exact-source top result and Accelerate-versus-scalar dot arithmetic pass. The initial additional control expected Apple's distance method to equal `1 - cosine`; it failed. [Control metadata](../experiments/os-sentence-controls-2026-10-27.json) preserves the observed 1.331626 API value versus 0.886614 calculated cosine distance. In this case the API value squared matches twice the calculated distance. The final report records both formulas without changing ranking. This observation is not a claim about every API version, and no failed control is represented as an original pass.

Do not choose this OS sentence-embedding/cosine configuration for Peel. Its small measured footprint and latency do not compensate for its 9/30 retrieval score. Stop this candidate without tuning the frozen questions, silently switching ranking or requesting new assets. This does not establish that every Apple model/configuration has poor quality. The q8 all-MiniLM browser candidate remains the stronger tested retrieval candidate at29/30; an appropriate native runtime for that same model remains to be evaluated. No app model choice or AC-06/14 gate is complete.
