// Public locked artifacts only. Never reads notes, account tokens or credentials.
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
const folder = "scratch/meaning-m0-20261027";
const manifest = JSON.parse(
  await readFile(
    "docs/experiments/meaning-model-manifest-2026-10-27.json",
    "utf8",
  ),
);
const repo = "Xenova/all-MiniLM-L6-v2",
  revision = "751bff37182d3f1213fa05d7196b954e230abad9";
if (
  manifest.model !== repo ||
  manifest.revision !== revision ||
  manifest.runtime.transformers !== "4.3.1" ||
  manifest.runtime.onnx !== "1.31.0-dev.20260914-8d85527a0" ||
  manifest.files.length !== 8
)
  throw new Error(
    "Unrecognized model lock; update it explicitly before preparing another candidate",
  );
const expected = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
  "README.md",
]
  .map((path) => `models/${repo}/${path}`)
  .concat([
    "runtime/ort-wasm-simd-threaded.asyncify.mjs",
    "runtime/ort-wasm-simd-threaded.asyncify.wasm",
  ]);
if (
  new Set(manifest.files.map((file) => file.relative)).size !== 8 ||
  manifest.files.some(
    (file) =>
      !expected.includes(file.relative) ||
      file.path !== `/${file.relative}` ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      !Number.isInteger(file.bytes) ||
      file.bytes < 1 ||
      file.bytes > 30000000,
  )
)
  throw new Error("Model lock contains an unrecognized artifact");
const exists = async (path) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
};
const existing = await exists(folder);
if (existing) {
  if (
    !existing.isDirectory() ||
    existing.isSymbolicLink() ||
    (await readFile(join(folder, "synthetic-model.marker"), "utf8")).trim() !==
      "Peel synthetic meaning M0"
  )
    throw new Error("Unrecognized artifact folder; nothing was changed");
} else {
  await mkdir(folder, { mode: 0o700 });
  await writeFile(
    join(folder, "synthetic-model.marker"),
    "Peel synthetic meaning M0\n",
    { flag: "wx", mode: 0o600 },
  );
}
const require = createRequire(import.meta.url),
  packageRoot = dirname(dirname(require.resolve("@huggingface/transformers")));
const runtimeRoot = dirname(
  require.resolve("onnxruntime-web", { paths: [packageRoot] }),
);
for (const [path, version] of [
  [join(packageRoot, "package.json"), "4.3.1"],
  [join(dirname(runtimeRoot), "package.json"), manifest.runtime.onnx],
])
  if (JSON.parse(await readFile(path, "utf8")).version !== version)
    throw new Error("Unpinned installed inference runtime");
let downloaded = 0;
for (const file of manifest.files) {
  let directory = folder;
  for (const segment of file.relative.split("/").slice(0, -1)) {
    directory = join(directory, segment);
    const entry = await exists(directory);
    if (entry) {
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw new Error("Unrecognized artifact directory");
    } else await mkdir(directory, { mode: 0o700 });
  }
  const target = join(folder, file.relative),
    entry = await exists(target);
  if (entry && (!entry.isFile() || entry.isSymbolicLink()))
    throw new Error("Unrecognized artifact file");
  let bytes;
  if (entry) bytes = await readFile(target);
  else if (file.relative.startsWith("models/")) {
    const path = file.relative.slice(`models/${repo}/`.length);
    if (
      file.url !== `https://huggingface.co/${repo}/resolve/${revision}/${path}`
    )
      throw new Error("Unrecognized public model URL");
    const response = await fetch(file.url, {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error("Pinned public artifact unavailable");
    bytes = Buffer.from(await response.arrayBuffer());
    downloaded++;
  } else
    bytes = await readFile(
      join(runtimeRoot, file.relative.slice("runtime/".length)),
    );
  if (
    bytes.length !== file.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new Error(
      "Artifact differs from committed lock; existing files were preserved",
    );
  if (!entry) await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
}
const manifestPath = join(folder, "manifest.json"),
  previous = await exists(manifestPath);
if (previous) {
  if (
    !previous.isFile() ||
    previous.isSymbolicLink() ||
    JSON.stringify(JSON.parse(await readFile(manifestPath, "utf8"))) !==
      JSON.stringify(manifest)
  )
    throw new Error(
      "Unrecognized local manifest; preserve it and prepare a fresh directory",
    );
} else
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
console.log(
  JSON.stringify({
    folder,
    artifactsVerified: 8,
    downloaded,
    modelBytes: manifest.files
      .filter((file) => file.relative.startsWith("models/"))
      .reduce((sum, file) => sum + file.bytes, 0),
    runtimeBytes: manifest.files
      .filter((file) => file.relative.startsWith("runtime/"))
      .reduce((sum, file) => sum + file.bytes, 0),
    inferenceExecuted: false,
  }),
);
