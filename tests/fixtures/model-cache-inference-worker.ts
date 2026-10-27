import { pipeline, env, LogLevel } from "@huggingface/transformers";
import {
  PublicModelCache,
  type ModelManifest,
} from "../../packages/meaning/src/model-cache";
import {
  chunkForEmbedding,
  rankSemantic,
  type EmbeddedNote,
} from "../../packages/meaning/src/index";
import { meaningNotes, meaningQuestions } from "./meaning-corpus";
self.onmessage = async ({
  data,
}: MessageEvent<{ name: string; origin: string; manifest: ModelManifest }>) => {
  let forbiddenFetches = 0,
    cacheReads = 0,
    stage = "cache-verification";
  const cache = new PublicModelCache(data.name);
  try {
    const began = performance.now();
    const ready = await cache.openReady(data.manifest);
    const readiedMs = performance.now() - began;
    const deny: typeof fetch = async () => {
      forbiddenFetches++;
      throw Error("model-network-disabled");
    };
    globalThis.fetch = deny;
    env.fetch = deny;
    env.useCustomCache = true;
    env.useBrowserCache = false;
    env.useFSCache = false;
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.useWasmCache = true;
    env.logLevel = LogLevel.ERROR;
    env.localModelPath = data.origin + "/models/";
    env.customCache = {
      match: async (request: string) => {
        const url = new URL(request, data.origin + "/");
        if (
          url.origin !== data.origin ||
          url.search ||
          !data.manifest.files.some((f) => f.path === url.pathname)
        )
          return undefined;
        const bytes = await ready.read(url.pathname);
        cacheReads++;
        return new Response(bytes, {
          headers: {
            "Content-Type": url.pathname.endsWith(".mjs")
              ? "text/javascript"
              : "application/octet-stream",
            "Content-Length": String(bytes.byteLength),
          },
        });
      },
      put: async () => {
        throw Error("read-only-model-cache");
      },
    };
    env.backends.onnx.wasm!.numThreads = 1;
    env.backends.onnx.wasm!.proxy = false;
    env.backends.onnx.wasm!.wasmPaths = {
      mjs: data.origin + "/runtime/ort-wasm-simd-threaded.asyncify.mjs",
      wasm: data.origin + "/runtime/ort-wasm-simd-threaded.asyncify.wasm",
    };
    stage = "fresh-pipeline";
    const extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { dtype: "q8", device: "wasm", local_files_only: true },
    );
    const embed = async (text: string) => {
      const result = await extractor(text, {
        pooling: "mean",
        normalize: true,
      });
      if (result.dims.at(-1) !== 384 || !(result.data instanceof Float32Array))
        throw Error("dimensions");
      const vector = result.data.slice();
      result.dispose();
      return vector;
    };
    await embed("Synthetic initialization vector");
    const initializedMs = performance.now() - began;
    self.postMessage({ kind: "ready" });
    stage = "synthetic-index";
    const notes: EmbeddedNote[] = [];
    for (const source of meaningNotes) {
      if (source.state === "trashed") continue;
      const chunks = chunkForEmbedding(
        source.body,
        (text) =>
          extractor.tokenizer.encode(text, { add_special_tokens: false })
            .length,
      );
      const vectors: Float32Array[] = [];
      for (const chunk of chunks) vectors.push(await embed(chunk.text));
      notes.push({
        noteId: source.noteId,
        state: source.state,
        tags: source.tags,
        vectors,
      });
    }
    stage = "offline-retrieval";
    let top3 = 0;
    for (const question of meaningQuestions) {
      const result = rankSemantic(notes, await embed(question.query), {
        limit: 3,
      });
      if (result.some((r) => r.noteId === question.noteId)) top3++;
    }
    await extractor.dispose();
    self.postMessage({
      kind: "result",
      readiedMs,
      initializedMs,
      totalMs: performance.now() - began,
      notes: notes.length,
      top3,
      total: meaningQuestions.length,
      cacheReads,
      forbiddenFetches,
      dimensions: 384,
    });
  } catch (error) {
    self.postMessage({
      kind: "failure",
      stage,
      errorCode:
        (error as { code?: string }).code ?? "offline-inference-failed",
      forbiddenFetches,
      cacheReads,
    });
  } finally {
    await cache.close();
  }
};
