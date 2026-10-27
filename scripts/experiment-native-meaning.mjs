import { build } from "vite";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile),
  require = createRequire(import.meta.url);
if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error("This M0 runner expects Mac ARM64");
const fixtureSHA = createHash("sha256")
  .update(await readFile("tests/fixtures/meaning-corpus.ts"))
  .digest("hex");
if (
  fixtureSHA !==
  "8e04b40da6d95b30925a51b303e7feaed551cf5b90b7ee5f4c8a05dd069f5989"
)
  throw Error("Frozen questions changed");
const tfRoot = dirname(dirname(require.resolve("@huggingface/transformers"))),
  nativeRoot = dirname(
    dirname(require.resolve("onnxruntime-node", { paths: [tfRoot] })),
  );
const tfPackage = JSON.parse(
    await readFile(join(tfRoot, "package.json"), "utf8"),
  ),
  nativePackage = JSON.parse(
    await readFile(join(nativeRoot, "package.json"), "utf8"),
  );
if (tfPackage.version !== "4.3.1" || nativePackage.version !== "1.30.0")
  throw Error("Unpinned native experiment runtime");
const binaries = [];
for (const file of [
  "libonnxruntime.1.30.0.dylib",
  "libonnxruntime.1.dylib",
  "onnxruntime_binding.node",
]) {
  const bytes = await readFile(
    join(nativeRoot, "bin/napi-v6/darwin/arm64", file),
  );
  binaries.push({
    file,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
const directory = await mkdtemp("scratch/native-meaning-m0-");
await writeFile(
  `${directory}/synthetic.marker`,
  "Peel synthetic native-host meaning M0\n",
  { flag: "wx", mode: 0o600 },
);
await build({
  configFile: false,
  logLevel: "warn",
  build: {
    ssr: "tests/fixtures/native-meaning-node.ts",
    outDir: directory,
    emptyOutDir: false,
    minify: false,
    rolldownOptions: {
      external: ["@huggingface/transformers"],
      output: { entryFileNames: "experiment.mjs" },
    },
  },
});
const result = await run(
  "/usr/bin/sandbox-exec",
  [
    "-p",
    "(version 1) (allow default) (deny network*)",
    process.execPath,
    `${directory}/experiment.mjs`,
    resolve("scratch/meaning-m0-20261027"),
  ],
  { timeout: 60000, maxBuffer: 2 * 1024 * 1024 },
);
await writeFile(`${directory}/stderr.log`, result.stderr, {
  flag: "wx",
  mode: 0o600,
});
const report = JSON.parse(result.stdout);
report.runner = {
  parentExcludedFromMemory: true,
  networkPolicy:
    "Own inference child denied network*; remote model loading/cache/fetch disabled",
  transformers: { version: tfPackage.version, license: tfPackage.license },
  nativeRuntime: {
    version: nativePackage.version,
    license: nativePackage.license,
    binaries,
  },
  compiledEntrySHA256: createHash("sha256")
    .update(await readFile(`${directory}/experiment.mjs`))
    .digest("hex"),
  sourceFixtureSHA256: fixtureSHA,
};
await writeFile(
  `${directory}/result.json`,
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
await writeFile(
  "scratch/native-meaning-result.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    directory,
    quality: {
      semantic: report.quality.semanticTop3,
      hybrid: report.quality.hybridTop3,
      total: report.quality.total,
    },
    cold: report.initialization,
    index: report.indexing,
    warm: {
      p50: report.warmQueryMs.p50,
      p95: report.warmQueryMs.p95,
      max: report.warmQueryMs.max,
    },
    memory: report.memory,
  }),
);
