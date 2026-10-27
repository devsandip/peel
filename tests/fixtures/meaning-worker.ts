import { pipeline, env, LogLevel } from "@huggingface/transformers";
import {
  chunkForEmbedding,
  rankSemantic,
  fuseRanks,
  type EmbeddedNote,
} from "../../packages/meaning/src/index";
import { WordIndex } from "../../packages/search/src/index";
import { newNote } from "../../packages/core/src/index";
import { meaningNotes, meaningQuestions } from "./meaning-corpus";
interface Asset {
  path: string;
  bytes: number;
  sha256: string;
}
type Request =
  | { request: number; kind: "init"; assets: Asset[] }
  | { request: number; kind: "index" }
  | { request: number; kind: "query"; question: number; scale?: boolean }
  | { request: number; kind: "scale" }
  | { request: number; kind: "filters" };
let extractor: Awaited<ReturnType<typeof pipeline<"feature-extraction">>>;
let embedded: EmbeddedNote[] = [],
  scaled: EmbeddedNote[] = [];
const words = new WordIndex();
let busy = false,
  stage = "boot",
  assetFailure = "",
  fetches = 0,
  verifiedBytes = 0;
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
const progress = (value: string) => {
  stage = value;
  self.postMessage({ kind: "progress", stage });
};
async function embed(texts: string[]) {
  if (
    texts.some(
      (text) =>
        extractor.tokenizer.encode(text, { add_special_tokens: false }).length >
        224,
    )
  )
    throw new Error("Token budget exceeded");
  const result = await extractor(texts, { pooling: "mean", normalize: true });
  if (
    result.dims.length !== 2 ||
    result.dims[0] !== texts.length ||
    result.dims[1] !== 384 ||
    !(result.data instanceof Float32Array)
  )
    throw new Error("Unexpected embedding dimensions");
  const vectors = texts.map((_, i) =>
    (result.data as Float32Array).slice(i * 384, (i + 1) * 384),
  );
  if (
    vectors.some(
      (vector) =>
        Math.abs(
          Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) - 1,
        ) > 0.005,
    )
  )
    throw new Error("Embedding normalization failed");
  result.dispose();
  return vectors;
}
self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if (busy) {
    self.postMessage({
      request: data.request,
      kind: "failure",
      stage,
      errorCode: "worker-busy",
    });
    return;
  }
  busy = true;
  try {
    let result: unknown;
    if (data.kind === "init") {
      progress("verified-artifact-loading");
      const allowed = new Map(data.assets.map((asset) => [asset.path, asset]));
      const original = globalThis.fetch.bind(globalThis);
      const guarded: typeof fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          self.location.href,
        );
        const asset = allowed.get(url.pathname);
        if (
          url.origin !== self.location.origin ||
          url.search ||
          !asset ||
          (init?.method ?? "GET") !== "GET"
        ) {
          assetFailure = "unexpected-network-request";
          throw new Error("Unexpected model request");
        }
        fetches++;
        const response = await original(input, init);
        if (!response.ok) {
          assetFailure = "missing-artifact";
          throw new Error("Pinned artifact missing");
        }
        const bytes = await response.arrayBuffer();
        if (
          bytes.byteLength !== asset.bytes ||
          hex(await crypto.subtle.digest("SHA-256", bytes)) !== asset.sha256
        ) {
          assetFailure = "corrupt-artifact";
          throw new Error("Pinned artifact integrity failed");
        }
        verifiedBytes += bytes.byteLength;
        return new Response(bytes, {
          status: response.status,
          headers: response.headers,
        });
      };
      globalThis.fetch = guarded;
      env.fetch = guarded;
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = "/models/";
      env.useBrowserCache = false;
      env.useWasmCache = false;
      env.logLevel = LogLevel.ERROR;
      env.backends.onnx.wasm!.numThreads = 1;
      env.backends.onnx.wasm!.proxy = false;
      env.backends.onnx.wasm!.wasmPaths = {
        mjs: "/runtime/ort-wasm-simd-threaded.asyncify.mjs",
        wasm: "/runtime/ort-wasm-simd-threaded.asyncify.wasm",
      };
      const began = performance.now();
      extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        { dtype: "q8", device: "wasm", local_files_only: true },
      );
      const probe = await embed(["Synthetic initialization vector"]);
      result = {
        coldReadyMs: performance.now() - began,
        dimensions: probe[0].length,
        fetches,
        verifiedBytes,
      };
      progress("model-ready");
    } else if (data.kind === "index") {
      progress("indexing-synthetic-notes");
      const began = performance.now();
      let chunkCount = 0,
        maxTokens = 0;
      embedded = [];
      for (const note of meaningNotes) {
        if (note.state === "trashed") continue;
        const chunks = chunkForEmbedding(
          note.body,
          (text) =>
            extractor.tokenizer.encode(text, { add_special_tokens: false })
              .length,
        );
        const vectors: Float32Array[] = [];
        for (let start = 0; start < chunks.length; start += 2) {
          vectors.push(
            ...(await embed(
              chunks.slice(start, start + 2).map((chunk) => chunk.text),
            )),
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        chunkCount += chunks.length;
        maxTokens = Math.max(maxTokens, ...chunks.map((chunk) => chunk.tokens));
        embedded.push({
          noteId: note.noteId,
          state: note.state,
          tags: note.tags,
          vectors,
        });
      }
      words.apply(
        meaningNotes.map((note) => ({
          ...newNote("local", note.body),
          noteId: note.noteId,
          state: note.state,
        })),
        [],
      );
      const long = meaningNotes.find((note) => note.noteId === "kettle")!;
      const chunks = chunkForEmbedding(
        long.body,
        (text) =>
          extractor.tokenizer.encode(text, { add_special_tokens: false })
            .length,
      );
      result = {
        indexMs: performance.now() - began,
        notes: embedded.length,
        chunks: chunkCount,
        maxTokens,
        longNoteChunks: chunks.length,
        longNoteTailCovered: chunks.at(-1)?.end === long.body.length,
        trashExcluded: !embedded.some((note) => note.state === "trashed"),
      };
      progress("index-ready");
    } else if (data.kind === "scale") {
      scaled = Array.from({ length: 10000 }, (_, index) => ({
        ...embedded[index % embedded.length],
        noteId: `scale-${index}`,
        state: index % 10 === 0 ? "archived" : "active",
        tags: [`tag-${index % 500}`],
        vectors: embedded[index % embedded.length].vectors.map((vector) =>
          vector.slice(),
        ),
      }));
      result = {
        rows: scaled.length,
        vectorCopies: true,
        source:
          "Cycled fixture embeddings only; not 10000 independently embedded note bodies",
      };
    } else if (data.kind === "query") {
      const question = meaningQuestions[data.question];
      if (!question) throw new Error("Unknown synthetic question");
      const began = performance.now(),
        [query] = await embed([question.query]);
      const semantic = rankSemantic(data.scale ? scaled : embedded, query, {
        limit: 30,
      });
      const lexical = data.scale
        ? []
        : words
            .search({ query: question.query }, 30)
            .results.map((result) => result.note.noteId);
      const hybrid = fuseRanks(semantic, lexical, 30);
      result = {
        workerMs: performance.now() - began,
        caseId: question.caseId,
        semanticRank:
          semantic.findIndex((match) => match.noteId === question.noteId) + 1,
        hybridRank:
          hybrid.findIndex((match) => match.noteId === question.noteId) + 1,
        semanticTop3: semantic.slice(0, 3).map((match) => match.noteId),
        hybridTop3: hybrid.slice(0, 3).map((match) => match.noteId),
        fetches,
      };
    } else {
      const [query] = await embed([meaningQuestions[28].query]);
      result = {
        activeOnlyExcludesArchive: !rankSemantic(embedded, query, {
          activeOnly: true,
        }).some((match) => match.noteId === "festival"),
        tagFilterRespected:
          rankSemantic(embedded, query, { tags: ["nonexistent-tag"] })
            .length === 0,
        trashExcluded: !rankSemantic(embedded, query).some(
          (match) => match.noteId === "deleted-picnic",
        ),
      };
    }
    self.postMessage({ request: data.request, kind: "result", result });
  } catch {
    self.postMessage({
      request: data.request,
      kind: "failure",
      stage,
      errorCode: assetFailure || "local-runtime-failure",
    });
  } finally {
    busy = false;
  }
};
