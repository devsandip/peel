# Local meaning-search feasibility

## Requirements and plan

FR-06/08/14, AC-06/14 and the M0 local semantic retrieval gate. Word search and capture must remain usable; note bodies and queries cannot be sent to an inference service. Native/relay probing is stopped and hosted CI is unavailable, so use an independent isolated local browser experiment with synthetic content.

1. Inspect primary model/runtime sources before choosing a candidate. Pin the model repository revision, quantized artifact hashes, tokenizer/pooling configuration, runtime version and license. Evaluate a small sentence embedding candidate, initially all-MiniLM-L6-v2 if its current official artifacts support the required local runtime. Do not imply model selection is complete before evidence.
2. Keep public artifacts under ignored scratch, never commit model binaries or private notes. Verify download hashes, serve only the pinned public runtime/model files over loopback and reject unexpected network requests during inference. No account/token is required for public artifacts. Separate model download from note/query processing.
3. Run CPU inference in a worker with bounded batches. Establish correct normalized vectors and ranking, including long-text chunking limits rather than silently treating a truncated note as fully indexed. Preserve a responsive main thread and available word search. Pin any package/lockfile change to this M0 experiment; do not import the runtime into the shipped app yet.
4. Create at least 30 fixed synthetic natural-language questions and expected notes before observing model rankings, with distractors and paraphrases. Record top-three success without editing the evaluation to improve the score. This synthetic set cannot replace Sandip's held-out dogfood questions in AC-06.
5. Record download bytes, cold initialization, indexing and warm query p50/p95, plus clearly scoped memory measurements. Distinguish JavaScript heap from process/OS memory; no full RAM target is passed from a partial heap metric. Identify exact device/browser/runtime/model revision and every outlier.
6. Repeat inference with external networking disabled after artifacts load, verify no note/query payload leaves loopback, and test failed/corrupt/missing artifact handling. No source or query in telemetry/error reports. Return only counters/timings/booleans in committed metadata.
7. Choose the next integration only after results. App model-consent/download/progress/cancel/status, native/iPhone runtime and accessibility/performance remain separate gates. Do not activate a placeholder meaning-search feature or claim public AC completion from an isolated experiment.

## Decisions and limits

No hosted embedding API, vector database or LLM service. No AWS resource or user billing. Keep the current app and approved 0.7 mockups unchanged during M0. Stop at the overnight cutoff after a safe batch. Model quality, compatibility, artifact size or RAM/timing failure can require a different candidate; scope cannot be silently narrowed.

## Evidence

### Candidate and reproducible boundary, 27 October 2026

Evaluated `Xenova/all-MiniLM-L6-v2` revision `751bff37182d3f1213fa05d7196b954e230abad9`, q8 ONNX, 384 dimensions, mean pooling and normalized vectors. The conversion and base model cards declare Apache-2.0. Pin the base revision as well, rather than assuming a conversion repository is the original publisher: [conversion card](https://huggingface.co/Xenova/all-MiniLM-L6-v2/blob/751bff37182d3f1213fa05d7196b954e230abad9/README.md), [base card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/blob/1110a243fdf4706b3f48f1d95db1a4f5529b4d41/README.md). The cards provide license metadata; a separate license file was not present in these repositories.

The experiment pins dev-only Transformers.js 4.3.1 and its ONNX Runtime Web dependency `1.31.0-dev.20260914-8d85527a0`, CPU/WASM with one thread. The [official 4.3.1 release](https://github.com/huggingface/transformers.js/releases/tag/4.3.1) and installed source establish this runtime API. The prerelease transitive runtime is a feasibility candidate, not an accepted production dependency. Nothing imports the model/runtime into the shipped app.

[Artifact lock](../experiments/meaning-model-manifest-2026-10-27.json) records eight public files with exact bytes, SHA-256 and immutable model URLs. Model files total 23,686,939 bytes (22.59 MiB); the two WASM runtime files total 26,914,834 bytes (25.67 MiB). The quantized weights are 22,972,370 bytes, SHA-256 `afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1`. `node scripts/prepare-meaning-model.mjs` verifies existing files or obtains only those locked public artifacts under ignored scratch. It refuses unrecognized folders, symlinks and mismatched existing artifacts rather than overwriting them. No account credentials or user notes are read.

The synthetic corpus and 30 expected answers were frozen in commit `d1cb2a6` before inference, SHA-256 `8e04b40da6d95b30925a51b303e7feaed551cf5b90b7ee5f4c8a05dd069f5989`. It contains 30 target notes, 40 distractors and one Trash decoy. No question, expected answer or source was tuned after rankings. `node scripts/experiment-meaning.mjs` builds isolated workers and serves preverified public files over loopback in a fresh Chrome profile. Model fetches also verify hashes in the worker; dynamic runtime-module imports use the server's preverified buffers. This is an experiment boundary, not a production model installer.

### Observed results

[Initial report](../experiments/local-meaning-initial-2026-10-27.json) preserves the first measurement; the [bundled-runtime report](../experiments/local-meaning-bundled-2026-10-27.json) preserves the repeated baseline. The [latest report](../experiments/local-meaning-2026-10-27.json) records the complete repeated run on Apple M4, Chrome 156.0.8078.48, Node 26.4.0 and Darwin 25.6.0:

| Measurement | Observed result | Limit of the evidence |
| --- | --- | --- |
| Retrieval | 29 of 30 expected notes in top three for both semantic and hybrid ranking | Synthetic English cases, not Sandip's held-out dogfood set; q07 ranked 22 and remains unchanged |
| Cold pipeline and first vector | 422.110 ms | One observation after files were already downloaded, not a cold-download or p95 claim |
| Index | 70 non-Trash notes, 75 chunks in 1,922.875 ms | Not a 10,000-body index; longest note has six chunks and its tail is covered |
| Warm offline query round trip | 100 queries: p50 15.171 ms, p95 16.964 ms, max 27.877 ms | 10,000 vector rows are copies of fixture embeddings, not independently embedded 2 KiB bodies |
| Concurrent word search | All 20 correct queries finished while meaning indexing was active; p95 3.589 ms | Separate existing WordIndex worker over 71 fixtures, not full-app typing or 10,000-note word acceptance |
| Main thread | No observed tasks over 50 ms; synthetic textarea preserved | Proxy for responsiveness, not native or editor acceptance |
| Aggregate browser RSS | Baseline 926,253,056 bytes; peak 1,553,596,416 bytes across 42 samples | Sum of owned Chrome-process RSS every 100 ms, includes other workers/fixtures and can double-count shared pages; excludes Node server. Not unique model allocation or a passed RAM budget |

The experiment now selects the pinned ONNX package's `onnxruntime-web-use-extern-wasm` export condition, serving the same locked external runtime. The measured worker/shared JavaScript files total 659,239 bytes, separate from model/runtime artifacts. The [cache experiment](meaning-model-cache.md) identified and removed embedded WASM copies from its earlier 72 MB bootstrap. This does not establish a memory reduction: aggregate RSS remains as scoped above. Worker construction through first vector took 445.425 ms in one observation, including script bootstrap; the table's cold time is measured inside the worker.

The worker bounds source chunks to 224 payload tokens without splitting Unicode surrogate pairs, checks every chunk and fails incomplete indexing explicitly rather than silently truncating long notes. The measured maximum was 199 tokens. Ranking uses the strongest chunk per distinct note, applies lifecycle/tag filters before output and combines lexical/semantic ranks using reciprocal rank fusion. Unit fixtures cover source coverage, malformed inputs, dimensions, deterministic ties and filtering.

With the browser context offline, 100 queries passed using the resident model, with no further model fetches. Missing and corrupt artifact responses failed before model readiness in fresh workers. No unexpected local/external requests, page errors or app database opens were observed. That throughput runner alone does **not** establish a fresh worker or app launch from a persistent offline model cache. The separate [cache experiment](meaning-model-cache.md) now provides Chrome profile-reopen/fresh-worker evidence; app shell integration and the other platforms remain open. No real notes, search queries, tokens or databases enter the reports.

TypeScript, 81 shared unit cases, formatting and production web build pass. The app bundle remains 49 modules and 580.34 kB for its main JavaScript asset; the inference dependency is not imported into it. Native UI and existing stopped relay/WebKit probes were not rerun.

### Decision and next gate

Retain this pinned candidate for further isolated work. The [verified cache experiment](meaning-model-cache.md) now passes Chrome installation, interrupted/cancelled updates, stored integrity, replacement and fresh-worker offline inference. Do not select it as the public model yet: the browser RSS measurement still needs attribution and a device budget, and native WebKit/iPhone have no inference evidence. AC-06 and AC-14 remain open. Production shell/CSP integration, consent/download/pause UI, actual quota exhaustion, private incremental vector persistence/deletion, native/iPhone compatibility, supported-device performance and held-out dogfood quality remain separate gates.

A separate [OS sentence-embedding CLI experiment](os-sentence-embedding-experiment.md) found an installed Apple revision1 model with a smaller single-process footprint but only9/30 synthetic top-three retrieval. That configuration is not recommended or activated. It is a different model and process boundary, so its memory numbers are not a direct comparison with aggregate browser RSS. It does not resolve a native runtime for the pinned all-MiniLM candidate.

The same pinned q8 model subsequently passed28/30 in two fresh [native CPU host experiments](native-onnx-experiment.md), using the existing ONNX Runtime Node1.30.0 binding with networking denied. This supplies a native-engine feasibility result, not an app/iPhone bridge. The browser remains29/30; runtime/backend differences are retained in the evidence and derived-index fingerprints. Keep the stronger pinned model for bridge investigation while the public model/platform gates remain open.
