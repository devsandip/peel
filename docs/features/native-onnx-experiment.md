# Native-host ONNX inference experiment

## Requirements and plan

FR-06/08/14 and AC-06/14. The browser q8 all-MiniLM candidate retrieves29/30 synthetic answers, while the small Apple sentence-model configuration retrieves9/30. Keep the stronger model unchanged and evaluate the already installed native CPU runtime in a fresh isolated Node host. This is not a Tauri/app integration or an iPhone result.

1. Reuse the exact pinned model/tokenizer/config files and frozen question hash. Verify public artifact sizes/hashes before loading. Use the existing dev-only Transformers.js4.3.1 and its installed ONNX Runtime Node1.30.0 dependency; record the native binding/library bytes, hashes and MIT license metadata. No new install script, dependency, asset download or infrastructure.
2. Use the [official Node CPU binding](https://onnxruntime.ai/docs/get-started/with-javascript/node.html) on Mac ARM64 with one intra/inter-op thread. Build only the synthetic experiment entry, keeping native dependencies external, then run it in a fresh owned child process with networking denied. Disable all remote model loading, FS/browser caches and fetch fallback. Public model paths are fixed; no real app/database inputs.
3. Reuse source-complete chunks bounded by model tokens, normalized 384-dimensional vectors, distinct-note ranking and the unchanged 30-question corpus. Record quality without tuning expected answers. Reuse the same 10,000 copied-vector latency workload and 100 queries, distinguishing it from independent body indexing. Word/editor availability and production bridge work remain separate.
4. Record model/first-vector time, indexing, warm p50/p95/max, process resident/heap/ArrayBuffer bytes and explicitly scoped peak process memory. Keep parent/bundler memory outside the inference child. Do not compare one host process directly with aggregate browser RSS or call this full native-device/app acceptance.
5. Preserve failures and stop after bounded attempts. No stopped WebKit/peer experiment, native UI interaction, OS setting, AWS resource or billing change. A public native bridge/runtime choice still needs packaging/license/installer validation, cancellation/incremental indexing, app memory, iPhone and held-out dogfood gates.

The first native run retrieved28/30 rather than the browser's29/30 with the same locked model files. Do not assume backend vectors are interchangeable or tune the corpus to erase that difference. Repeat in a fresh native host, preserve both reports and record per-case changes. Define a derived-index fingerprint including model/tokenizer, runtime/backend and chunk/pooling/batch policy before persistence; a changed fingerprint requires a rebuild while source notes and word search stay available. This is a future integration requirement, not a claim that private vectors are persisted now.

## Evidence

### Runtime and reproducible boundary, 27 October 2026

`node scripts/experiment-native-meaning.mjs` builds an isolated synthetic SSR entry, leaving Transformers/native dependencies external, then starts a fresh Node26.4 child under a network-deny sandbox. Model files are read only from the fixed public-artifact scratch root and verified against the committed lock. Remote loading, filesystem/browser caches and JavaScript fetch are disabled. No app database, WebView, OS UI or cloud account is opened. Parent/bundler memory is outside the child measurements.

The existing locked packages supply Transformers.js4.3.1 (Apache-2.0 metadata) and ONNX Runtime Node1.30.0 (MIT metadata). Native CPU options request one intra-op and one inter-op thread with sequential execution. The reports pin the ARM64 binding and library hashes: `libonnxruntime.1.30.0.dylib` is44,589,928 bytes, SHA-256 `685d2be5dba1309c89d3a5324b7fd06a5c42f1a61bfea32d14c4cc28d072121d`; `onnxruntime_binding.node` is266,840 bytes, SHA-256 `a3f993357759b06ae2411f70af60f5e041d04521ea7f0d12cb7546e411a527dd`. The alternate library filename has the same content hash; do not sum duplicate names as a chosen application package size. No new package or installer script was run for this experiment.

[Initial report](../experiments/native-meaning-initial-2026-10-27.json) and [repeat report](../experiments/native-meaning-2026-10-27.json) both retrieve28/30 expected notes in the top three for semantic and hybrid ranks. The repeated run records:

| Measurement | Observed result | Limit |
| --- | --- | --- |
| Model plus first vector | 79.793 ms | After module/native-binding import in a fresh process; OS/file caches may be warm, not whole-app startup |
| Index | 70 notes/75 chunks in262.036 ms | Maximum199 tokens, six chunks cover the long note tail; not10,000 independent bodies |
| Warm queries | 100 samples: p50 7.203 ms, p95 8.081 ms, max32.545 ms | Same10,000 copied-vector workload, includes query embedding/ranking but no app IPC/rendering |
| Final resident bytes | 293,519,360 | Entire Node inference host, including runtime, model, tokenizer and synthetic vectors |
| Peak reported RSS | 286,640 KiB | Node process resourceUsage; not a unique model allocation or supported-device/app RAM result |

Archive/Trash/tag filters and long-source coverage checks pass. All vectors are checked for384 dimensions/normalization. No JavaScript fetch attempt was observed, and the OS sandbox denies networking for the inference process. Heap/external/ArrayBuffer counters are separate; ArrayBuffers are included in external and must not be added again.

The unchanged misses are q04 at rank4 and q07 at rank17. Browser WASM ranked these3 and22 respectively, and q01 ranks2 here versus1 there. The exact numerical cause is not established: backend/runtime/version behavior cannot be assumed interchangeable from identical weight hashes. Keep the per-case evidence and the canonical SPEC's derived-index fingerprint/rebuild requirement. There is no persisted private vector index yet.

### Decision and next gate

Retain q8 all-MiniLM as the next native-bridge candidate: this host proves the pinned model can infer locally through a native CPU runtime, clearing the synthetic24/30 guard in two fresh processes. Do not ship a Node process as the chosen Mac architecture or call this Tauri/iPhone acceptance. A C/Rust/Apple bridge, packaging/installer/license review, app cancellation/resource limits, private incremental indexes and actual Mac/iPhone performance/held-out quality still require evidence. The runtime differs from browser ONNX Runtime Web1.31-dev; preserve distinct fingerprints and rebuild rather than mixing vectors. No production app model choice or public AC-06/14 gate is complete.
