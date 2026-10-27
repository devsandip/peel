import { pipeline, env, LogLevel } from "@huggingface/transformers";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  chunkForEmbedding,
  rankSemantic,
  fuseRanks,
  type EmbeddedNote,
} from "../../packages/meaning/src/index";
import { WordIndex } from "../../packages/search/src/index";
import { newNote } from "../../packages/core/src/index";
import { meaningNotes, meaningQuestions } from "./meaning-corpus";
const root = resolve(process.argv[2]);
const manifest = JSON.parse(
  await readFile(
    "docs/experiments/meaning-model-manifest-2026-10-27.json",
    "utf8",
  ),
);
if (
  root !== resolve("scratch/meaning-m0-20261027") ||
  manifest.revision !== "751bff37182d3f1213fa05d7196b954e230abad9"
)
  throw Error("Unrecognized public model root");
for (const file of manifest.files.filter((f: { relative: string }) =>
  f.relative.startsWith("models/"),
)) {
  const bytes = await readFile(`${root}/${file.relative}`);
  if (
    bytes.length !== file.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw Error("Pinned model integrity failed");
}
let forbiddenFetches = 0;
const deny: typeof fetch = async () => {
  forbiddenFetches++;
  throw Error("native-model-network-disabled");
};
globalThis.fetch = deny;
env.fetch = deny;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = `${root}/models/`;
env.useFSCache = false;
env.useBrowserCache = false;
env.useWasmCache = false;
env.logLevel = LogLevel.ERROR;
const memory = () => ({
  ...process.memoryUsage(),
  peakRSSReportedKiB: process.resourceUsage().maxRSS,
});
const before = memory(),
  began = performance.now();
const extractor = await pipeline(
  "feature-extraction",
  "Xenova/all-MiniLM-L6-v2",
  {
    dtype: "q8",
    device: "cpu",
    local_files_only: true,
    session_options: {
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      executionMode: "sequential",
    },
  },
);
async function embed(texts: string[]) {
  if (
    texts.some(
      (text) =>
        extractor.tokenizer.encode(text, { add_special_tokens: false }).length >
        224,
    )
  )
    throw Error("Token budget exceeded");
  const tensor = await extractor(texts, { pooling: "mean", normalize: true });
  if (
    tensor.dims[0] !== texts.length ||
    tensor.dims[1] !== 384 ||
    !(tensor.data instanceof Float32Array)
  )
    throw Error("Dimensions changed");
  const vectors = texts.map((_, i) =>
    (tensor.data as Float32Array).slice(i * 384, (i + 1) * 384),
  );
  tensor.dispose();
  if (
    vectors.some(
      (vector) =>
        Math.abs(Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) - 1) > 0.005,
    )
  )
    throw Error("Invalid normalization");
  return vectors;
}
await embed(["Synthetic initialization vector"]);
const coldReadyMs = performance.now() - began,
  afterReady = memory();
const started = performance.now(),
  embedded: EmbeddedNote[] = [];
let chunks = 0,
  maxTokens = 0,
  longNoteChunks = 0,
  longNoteTailCovered = false;
for (const note of meaningNotes) {
  if (note.state === "trashed") continue;
  const parts = chunkForEmbedding(
    note.body,
    (text) =>
      extractor.tokenizer.encode(text, { add_special_tokens: false }).length,
  );
  if (note.noteId === "kettle") {
    longNoteChunks = parts.length;
    longNoteTailCovered = parts.at(-1)!.end === note.body.length;
  }
  const vectors: Float32Array[] = [];
  for (let start = 0; start < parts.length; start += 2)
    vectors.push(
      ...(await embed(parts.slice(start, start + 2).map((p) => p.text))),
    );
  embedded.push({
    noteId: note.noteId,
    state: note.state,
    tags: note.tags,
    vectors,
  });
  chunks += parts.length;
  maxTokens = Math.max(maxTokens, ...parts.map((p) => p.tokens));
}
const indexMs = performance.now() - started,
  afterIndex = memory();
const words = new WordIndex();
words.apply(
  meaningNotes.map((note) => ({
    ...newNote("local", note.body),
    noteId: note.noteId,
    state: note.state,
  })),
  [],
);
const cases = [];
for (const question of meaningQuestions) {
  const vector = (await embed([question.query]))[0],
    semantic = rankSemantic(embedded, vector, { limit: 70 });
  const hybrid = fuseRanks(
    semantic,
    words
      .search({ query: question.query }, 70)
      .results.map((r) => r.note.noteId),
    70,
  );
  cases.push({
    caseId: question.caseId,
    semanticRank: semantic.findIndex((r) => r.noteId === question.noteId) + 1,
    hybridRank: hybrid.findIndex((r) => r.noteId === question.noteId) + 1,
  });
}
const query = (await embed([meaningQuestions[0].query]))[0];
const filters = {
  trashExcluded: !embedded.some((note) => note.state === "trashed"),
  activeOnly: rankSemantic(embedded, query, { activeOnly: true }).every(
    (match) =>
      embedded.find((note) => note.noteId === match.noteId)!.state === "active",
  ),
  tag: rankSemantic(embedded, query, { tags: ["fixture"] }).every((match) =>
    embedded
      .find((note) => note.noteId === match.noteId)!
      .tags.includes("fixture"),
  ),
};
const scale = Array.from({ length: 10000 }, (_, index) => {
  const source = embedded[index % embedded.length];
  return {
    noteId: `scale-${String(index).padStart(5, "0")}`,
    state: index % 10 === 0 ? ("archived" as const) : ("active" as const),
    tags: [`tag-${index % 500}`],
    vectors: source.vectors.map((vector) => vector.slice()),
  };
});
const afterScale = memory(),
  timings = [];
for (let index = 0; index < 100; index++) {
  const started = performance.now(),
    vector = (
      await embed([meaningQuestions[index % meaningQuestions.length].query])
    )[0];
  if (rankSemantic(scale, vector, { limit: 30 }).length !== 30)
    throw Error("Result bound failed");
  timings.push(performance.now() - started);
}
const sorted = [...timings].sort((a, b) => a - b);
const semanticTop3 = cases.filter(
    (c) => c.semanticRank > 0 && c.semanticRank <= 3,
  ).length,
  hybridTop3 = cases.filter(
    (c) => c.hybridRank > 0 && c.hybridRank <= 3,
  ).length;
const report = {
  scope:
    "Isolated native ONNX CPU inference in a fresh Node host, not a Tauri/app/iPhone bridge or supported-device acceptance",
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  model: {
    repository: manifest.model,
    revision: manifest.revision,
    runtime: "onnxruntime-node1.30.0",
    dtype: "q8",
    dimensions: 384,
    pooling: "mean",
    normalize: true,
    intraOpThreads: 1,
    interOpThreads: 1,
    executionMode: "sequential",
  },
  fixtureSHA256: manifest.fixtureSHA256,
  initialization: {
    coldReadyMs,
    boundary:
      "After module/native-binding load through model and first vector; fresh process with OS/file caches potentially warm, not app startup",
  },
  indexing: {
    notes: embedded.length,
    chunks,
    maxTokens,
    longNoteChunks,
    longNoteTailCovered,
    indexMs,
  },
  quality: {
    cases,
    semanticTop3,
    hybridTop3,
    total: cases.length,
    syntheticTop3ThresholdMet: semanticTop3 >= 24,
  },
  filters,
  scale: {
    rows: scale.length,
    independentVectorCopies: true,
    source: "Cycled fixture vectors, not10000 independently embedded bodies",
  },
  warmQueryMs: {
    count: timings.length,
    p50: sorted[49],
    p95: sorted[94],
    max: sorted.at(-1),
    samples: timings,
  },
  memory: {
    beforeModel: before,
    afterReady,
    afterIndex,
    afterScale,
    final: memory(),
    boundary:
      "One Node inference child; RSS/heap/external/ArrayBuffer fields are bytes, maxRSS is Node-reported KiB. External includes ArrayBuffers, do not sum them. Excludes parent bundler/other OS processes and full-app/device acceptance.",
  },
  forbiddenFetches,
  applicationDatabasesOpened: 0,
  realNotesUsed: false,
};
await extractor.dispose();
console.log(JSON.stringify(report));
if (
  forbiddenFetches ||
  !longNoteTailCovered ||
  !Object.values(filters).every(Boolean) ||
  semanticTop3 < 24
)
  process.exitCode = 1;
