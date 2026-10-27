import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
const execute = promisify(execFile);
const folder = "scratch/meaning-m0-20261027",
  manifest = JSON.parse(await readFile(`${folder}/manifest.json`, "utf8"));
if (
  manifest.fixtureSHA256 !==
  createHash("sha256")
    .update(await readFile("tests/fixtures/meaning-corpus.ts"))
    .digest("hex")
)
  throw new Error("Frozen evaluation changed");
const files = new Map();
for (const asset of manifest.files) {
  const bytes = await readFile(`${folder}/${asset.relative}`);
  if (
    bytes.length !== asset.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  )
    throw new Error("Pinned artifact preflight failed");
  files.set(asset.path, { bytes, sha256: asset.sha256 });
}
await build({
  configFile: false,
  logLevel: "warn",
  resolve: {
    conditions: [
      "onnxruntime-web-use-extern-wasm",
      "browser",
      "module",
      "import",
    ],
  },
  build: {
    lib: {
      entry: {
        "meaning-worker": "tests/fixtures/meaning-worker.ts",
        "meaning-word-worker": "tests/fixtures/meaning-word-worker.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    outDir: "scratch/meaning-worker",
    emptyOutDir: true,
    minify: true,
  },
});
const bootstrapFiles = [];
for (const name of await readdir("scratch/meaning-worker")) {
  const bytes = await readFile(`scratch/meaning-worker/${name}`);
  files.set(`/${name}`, { bytes });
  bootstrapFiles.push({ name, bytes: bytes.length });
}
let fault = null,
  served = 0,
  unexpected = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const headers = {
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  if (req.method !== "GET" || url.search) {
    unexpected++;
    res.writeHead(400, headers);
    return res.end();
  }
  if (url.pathname === "/") {
    res.writeHead(200, { ...headers, "Content-Type": "text/html" });
    return res.end(
      '<!doctype html><title>Peel synthetic local embedding M0</title><textarea aria-label="Synthetic typing probe"></textarea>',
    );
  }
  const asset = files.get(url.pathname);
  if (!asset) {
    unexpected++;
    res.writeHead(404, headers);
    return res.end();
  }
  if (fault?.path === url.pathname && fault.kind === "missing") {
    res.writeHead(404, headers);
    return res.end();
  }
  let bytes = asset.bytes;
  if (fault?.path === url.pathname && fault.kind === "corrupt") {
    bytes = Buffer.from(bytes);
    bytes[0] ^= 1;
  }
  const type = url.pathname.endsWith(".wasm")
    ? "application/wasm"
    : /\.m?js$/.test(url.pathname)
      ? "text/javascript"
      : url.pathname.endsWith(".json")
        ? "application/json"
        : "application/octet-stream";
  served++;
  res.writeHead(200, {
    ...headers,
    "Content-Type": type,
    "Content-Length": bytes.length,
  });
  res.end(bytes);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser, context, monitor;
const memory = [];
let observing = false,
  blockedExternal = 0,
  pageErrors = 0;
const quantiles = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
    samples: values,
  };
};
try {
  browser = await chromium.launch({
    executablePath:
      process.env.PEEL_BROWSER_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
  context = await browser.newContext();
  await context.route("**/*", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (
      url.origin !== origin ||
      request.method() !== "GET" ||
      request.postData() ||
      url.search
    ) {
      blockedExternal++;
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", () => pageErrors++);
  const cdp = await browser.newBrowserCDPSession();
  const sampleMemory = async () => {
    if (observing) return;
    observing = true;
    try {
      const result = await cdp.send("SystemInfo.getProcessInfo"),
        ids = result.processInfo
          .map((value) => value.id)
          .filter(Number.isInteger);
      const { stdout } = await execute(
        "ps",
        ["-o", "rss=", "-p", ids.join(",")],
        { timeout: 3000 },
      );
      memory.push(
        stdout
          .trim()
          .split(/\s+/)
          .map(Number)
          .filter(Number.isFinite)
          .reduce((sum, n) => sum + n, 0) * 1024,
      );
    } catch {
    } finally {
      observing = false;
    }
  };
  await page.goto(origin);
  await sampleMemory();
  const baselineRSS = memory.at(-1) ?? null;
  monitor = setInterval(() => {
    void sampleMemory();
  }, 100);
  await page.evaluate(() => {
    globalThis.peelLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        globalThis.peelLongTasks.push(entry.duration);
    }).observe({ entryTypes: ["longtask"] });
    let next = 1;
    const pending = new Map();
    globalThis.peelWorkerStarted = performance.now();
    globalThis.peelWorker = new Worker("/meaning-worker.js", {
      type: "module",
    });
    globalThis.peelWorker.onmessage = ({ data }) => {
      if (data.kind === "progress") {
        globalThis.peelStage = data.stage;
        return;
      }
      if (
        data.kind === "result" &&
        typeof data.result?.coldReadyMs === "number"
      )
        data.result.workerStartToFirstVectorMs =
          performance.now() - globalThis.peelWorkerStarted;
      const waiter = pending.get(data.request);
      if (!waiter) return;
      pending.delete(data.request);
      clearTimeout(waiter.timer);
      data.kind === "result"
        ? waiter.resolve(data.result)
        : waiter.reject(new Error(`${data.stage}:${data.errorCode}`));
    };
    globalThis.peelCall = (command) =>
      new Promise((resolve, reject) => {
        const request = next++;
        const timer = setTimeout(() => {
          pending.delete(request);
          reject(new Error("Synthetic model request timed out"));
        }, 120000);
        pending.set(request, { resolve, reject, timer });
        globalThis.peelWorker.postMessage({ ...command, request });
      });
  });
  const call = (command) =>
    page.evaluate(async (command) => globalThis.peelCall(command), command);
  const init = await call({ kind: "init", assets: manifest.files });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const pending = new Map();
        let next = 1;
        globalThis.peelWordWorker = new Worker("/meaning-word-worker.js", {
          type: "module",
        });
        globalThis.peelWordWorker.onmessage = ({ data }) => {
          if (data.ready) {
            resolve();
            return;
          }
          if (
            data.kind === "result" &&
            typeof data.result?.coldReadyMs === "number"
          )
            data.result.workerStartToFirstVectorMs =
              performance.now() - globalThis.peelWorkerStarted;
          const waiter = pending.get(data.request);
          if (!waiter) return;
          pending.delete(data.request);
          clearTimeout(waiter.timer);
          waiter.resolve(data);
        };
        globalThis.peelWordCall = (query) =>
          new Promise((resolve, reject) => {
            const request = next++,
              timer = setTimeout(
                () => reject(new Error("Word worker timeout")),
                5000,
              );
            pending.set(request, { resolve, timer });
            globalThis.peelWordWorker.postMessage({ request, query });
          });
      }),
  );
  let indexingDone = false;
  const indexingPromise = call({ kind: "index" }).finally(() => {
    indexingDone = true;
  });
  await page.waitForFunction(
    () => globalThis.peelStage === "indexing-synthetic-notes",
  );
  const wordTimings = [];
  let concurrentWordResults = true,
    concurrentWordCount = 0;
  for (let query = 0; query < 20; query++) {
    const began = performance.now();
    const result = await page.evaluate(() =>
      globalThis.peelWordCall("printer"),
    );
    wordTimings.push(performance.now() - began);
    concurrentWordResults &&= result.ids.includes("printer");
    if (!indexingDone) concurrentWordCount++;
  }
  await page
    .locator("textarea")
    .fill("Synthetic main-thread edit while embeddings index");
  const indexing = await indexingPromise;
  const quality = [];
  for (let question = 0; question < 30; question++)
    quality.push(await call({ kind: "query", question }));
  const filters = await call({ kind: "filters" });
  const scale = await call({ kind: "scale" });
  await context.setOffline(true);
  const warm = [],
    workerWarm = [];
  for (let index = 0; index < 100; index++) {
    const began = performance.now();
    const result = await call({
      kind: "query",
      question: index % 30,
      scale: true,
    });
    warm.push(performance.now() - began);
    workerWarm.push(result.workerMs);
  }
  const fetchesAfter = await call({ kind: "query", question: 0 });
  await context.setOffline(false);
  const longTasks = await page.evaluate(() => globalThis.peelLongTasks);
  const typingPreserved =
    (await page.locator("textarea").inputValue()) ===
    "Synthetic main-thread edit while embeddings index";
  await page.evaluate(() => {
    globalThis.peelWorker.terminate();
    globalThis.peelWordWorker.terminate();
  });
  const negative = {};
  for (const kind of ["missing", "corrupt"]) {
    fault = { path: "/models/Xenova/all-MiniLM-L6-v2/config.json", kind };
    const result = await page.evaluate(async (assets) => {
      const worker = new Worker("/meaning-worker.js", { type: "module" });
      try {
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Artifact negative timeout")),
            20000,
          );
          worker.onmessage = ({ data }) => {
            if (data.kind === "progress") return;
            clearTimeout(timer);
            resolve({ kind: data.kind, errorCode: data.errorCode });
          };
          worker.postMessage({ kind: "init", request: 1, assets });
        });
      } finally {
        worker.terminate();
      }
    }, manifest.files);
    negative[kind] =
      result.kind === "failure" &&
      result.errorCode ===
        `${kind === "missing" ? "missing" : "corrupt"}-artifact`;
  }
  fault = null;
  clearInterval(monitor);
  await sampleMemory();
  const report = {
    scope:
      "M0 CPU/WASM embedding worker on synthetic notes in isolated Chrome; not app integration, native/iPhone, held-out dogfood quality or full target-device acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      browser: browser.version(),
      node: process.version,
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
    },
    model: {
      repository: manifest.model,
      revision: manifest.revision,
      runtime: manifest.runtime,
      fixtureSHA256: manifest.fixtureSHA256,
    },
    runtimeExportCondition: "onnxruntime-web-use-extern-wasm",
    bootstrapFiles,
    initialization: init,
    indexing,
    quality: {
      cases: quality.map((value) => ({
        caseId: value.caseId,
        semanticRank: value.semanticRank,
        hybridRank: value.hybridRank,
      })),
      semanticTop3: quality.filter(
        (value) => value.semanticRank > 0 && value.semanticRank <= 3,
      ).length,
      hybridTop3: quality.filter(
        (value) => value.hybridRank > 0 && value.hybridRank <= 3,
      ).length,
      total: 30,
      syntheticTop3ThresholdMet:
        quality.filter(
          (value) => value.semanticRank > 0 && value.semanticRank <= 3,
        ).length >= 24,
    },
    filters,
    scale,
    offlineWarmRoundtripMs: quantiles(warm),
    offlineWarmWorkerMs: quantiles(workerWarm),
    offlineResidentInferencePassed: true,
    noFurtherModelFetches: fetchesAfter.fetches === quality[0].fetches,
    memory: {
      boundary:
        "Sum of RSS for owned Chrome processes, sampled100ms; shared pages may be counted more than once. Excludes Node server. Not unique footprint or supported-device RAM acceptance.",
      baselineBytes: baselineRSS,
      peakBytes: memory.length ? Math.max(...memory) : null,
      samples: memory.length,
    },
    mainThread: {
      longTasksOver50ms: longTasks.filter((value) => value > 50).length,
      maxLongTaskMs: Math.max(0, ...longTasks),
      syntheticTypingPreserved: typingPreserved,
    },
    concurrentWordSearch: {
      queries: 20,
      completedWhileMeaningIndexed: concurrentWordCount,
      correctResults: concurrentWordResults,
      roundtripMs: quantiles(wordTimings),
      boundary:
        "Existing WordIndex in a separate worker over 71 fixture notes, not full app or 10000-note word acceptance",
    },
    artifactFailureControls: negative,
    blockedExternalRequests: blockedExternal,
    unexpectedLocalRequests: unexpected,
    pageErrors,
    applicationDatabasesOpened: 0,
    realNotesUsed: false,
  };
  await writeFile(
    "scratch/meaning-m0-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (
    !negative.missing ||
    !negative.corrupt ||
    blockedExternal ||
    unexpected ||
    pageErrors ||
    !typingPreserved ||
    !concurrentWordResults ||
    concurrentWordCount === 0 ||
    !report.quality.syntheticTop3ThresholdMet
  )
    process.exitCode = 1;
} finally {
  clearInterval(monitor);
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
