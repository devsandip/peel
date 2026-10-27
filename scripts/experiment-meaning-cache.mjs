import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
const manifest = JSON.parse(
  await readFile(
    "docs/experiments/meaning-model-manifest-2026-10-27.json",
    "utf8",
  ),
);
if (
  createHash("sha256")
    .update(await readFile("tests/fixtures/meaning-corpus.ts"))
    .digest("hex") !== manifest.fixtureSHA256
)
  throw Error("Frozen corpus changed");
const descriptor = {
  identity: JSON.stringify({
    model: manifest.model,
    revision: manifest.revision,
    runtime: manifest.runtime,
  }),
  files: manifest.files.map(({ path, bytes, sha256 }) => ({
    path,
    bytes,
    sha256,
  })),
};
const assets = new Map();
for (const file of manifest.files) {
  const bytes = await readFile(`scratch/meaning-m0-20261027/${file.relative}`);
  if (
    bytes.length !== file.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw Error("Public artifact preflight failed");
  assets.set(file.path, bytes);
}
const temporary = await mkdtemp("scratch/meaning-cache-build-");
let browser, server, context;
const profile = await mkdtemp("scratch/meaning-cache-profile-");
let stage = "build",
  external = 0,
  unexpected = 0,
  artifactRequests = 0,
  pageErrors = 0;
try {
  const entries = [
    ["contract", "tests/fixtures/model-cache-contract.ts", "es"],
    ["install-worker", "tests/fixtures/model-cache-install-worker.ts", "es"],
    [
      "inference-worker",
      "tests/fixtures/model-cache-inference-worker.ts",
      "es",
    ],
  ];
  for (const [name, entry, format] of entries) {
    const outDir = `${temporary}/${name}`;
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
          entry,
          name: "PeelModelM0",
          formats: [format],
          fileName: () => `${name}.js`,
        },
        outDir,
        emptyOutDir: false,
        minify: true,
      },
    });
    const names = await readdir(outDir);
    if (names.length !== 1 || names[0] !== `${name}.js`)
      throw Error("Single-file worker bootstrap required");
    assets.set(`/${name}.js`, await readFile(`${outDir}/${name}.js`));
  }
  server = createServer((req, res) => {
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
        "<!doctype html><title>Peel isolated model cache M0</title>",
      );
    }
    const bytes = assets.get(url.pathname);
    if (!bytes) {
      unexpected++;
      res.writeHead(404, headers);
      return res.end();
    }
    if (
      url.pathname.startsWith("/models/") ||
      url.pathname.startsWith("/runtime/")
    )
      artifactRequests++;
    res.writeHead(200, {
      ...headers,
      "Content-Type": url.pathname.endsWith(".js")
        ? "text/javascript"
        : "application/octet-stream",
      "Content-Length": bytes.length,
    });
    res.end(bytes);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const launch = async () => {
    context = await chromium.launchPersistentContext(profile, {
      executablePath:
        process.env.PEEL_BROWSER_PATH ||
        (process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : undefined),
      headless: true,
    });
    browser = context.browser();
    await context.route("**/*", (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (
        url.origin !== origin ||
        request.method() !== "GET" ||
        request.postData() ||
        url.search
      ) {
        external++;
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", () => pageErrors++);
    page.setDefaultTimeout(30000);
    await page.goto(origin);
    return page;
  };
  let page = await launch();
  const names = {
    contract: `peel-m0-model-contract-${randomUUID()}`,
    interrupt: `peel-m0-model-interrupt-${randomUUID()}`,
    quota: `peel-m0-model-abort-${randomUUID()}`,
    model: `peel-m0-model-offline-${randomUUID()}`,
  };
  stage = "cache-contract";
  const contract = await page.evaluate(
    async (name) => (await import("/contract.js")).runModelCacheContract(name),
    names.contract,
  );
  stage = "interrupted-worker";
  await page.evaluate(async (name) => {
    const module = await import("/contract.js");
    await module.quotaSetup(name);
    globalThis.peelInterrupted = new Worker("/install-worker.js", {
      type: "module",
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("staging-watchdog")), 10000);
      globalThis.peelInterrupted.onerror = () => {
        clearTimeout(timer);
        reject(Error("staging-worker-failure"));
      };
      globalThis.peelInterrupted.onmessage = ({ data }) => {
        if (data.kind === "staged-and-blocked") {
          clearTimeout(timer);
          resolve();
        }
      };
      globalThis.peelInterrupted.postMessage({ name });
    });
  }, names.interrupt);
  const interruptedLock = await page.evaluate(
    async (name) =>
      (await navigator.locks.query()).held.some(
        (lock) => lock.name === `peel-public-model:${name}`,
      ),
    names.interrupt,
  );
  await page.evaluate(() => globalThis.peelInterrupted.terminate());
  const interrupted = await page.evaluate(
    async (name) => (await import("/contract.js")).interruptedRecovery(name),
    names.interrupt,
  );
  if (!interruptedLock)
    throw Error("Interrupted worker did not hold installation lock");
  stage = "aborted-storage-write";
  await page.evaluate(
    async (name) => (await import("/contract.js")).quotaSetup(name),
    names.quota,
  );
  const abortedWrite = await page.evaluate(
    async (name) => (await import("/contract.js")).abortedWrite(name),
    names.quota,
  );
  stage = "public-model-install";
  const installed = await page.evaluate(
    async ({ name, descriptor }) => {
      const { PublicModelCache } = await import("/contract.js");
      const cache = new PublicModelCache(name);
      const progress = [];
      const began = performance.now();
      const result = await cache.install(
        descriptor,
        (file, signal) =>
          fetch(file.path, { signal, credentials: "omit", cache: "no-store" }),
        { progress: (value) => progress.push(value) },
      );
      await cache.close();
      return {
        id: result.id,
        reused: result.reused,
        ms: performance.now() - began,
        progress,
      };
    },
    { name: names.model, descriptor },
  );
  await context.close();
  context = undefined;
  browser = undefined;
  page = await launch();
  // The same dedicated profile was closed and reopened; no model pipeline survived.
  const baselineArtifactRequests = artifactRequests;
  // Preload only the bootstrap JS; no inference pipeline or model has been created.
  await page.evaluate(async () => {
    const bytes = await (await fetch("/inference-worker.js")).arrayBuffer();
    globalThis.peelOfflineBootstrap = URL.createObjectURL(
      new Blob([bytes], { type: "text/javascript" }),
    );
  });
  await context.setOffline(true);
  stage = "fresh-offline-inference";
  const runs = [];
  for (let repeat = 0; repeat < 2; repeat++) {
    const result = await page.evaluate(
      async ({ name, origin, manifest }) => {
        const started = performance.now();
        let workerStartToFirstVectorMs = null;
        const worker = new Worker(globalThis.peelOfflineBootstrap, {
          type: "module",
        });
        try {
          return await new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error("offline-worker-watchdog")),
              30000,
            );
            worker.onerror = () => {
              clearTimeout(timer);
              reject(Error("offline-worker-bootstrap"));
            };
            worker.onmessage = ({ data }) => {
              if (data.kind === "ready") {
                workerStartToFirstVectorMs = performance.now() - started;
                return;
              }
              clearTimeout(timer);
              resolve({
                ...data,
                workerStartToFirstVectorMs,
                totalRoundtripMs: performance.now() - started,
              });
            };
            worker.postMessage({ name, origin, manifest });
          });
        } finally {
          worker.terminate();
        }
      },
      { name: names.model, origin, manifest: descriptor },
    );
    runs.push(result);
    if (
      result.kind !== "result" ||
      result.forbiddenFetches !== 0 ||
      result.top3 < 24 ||
      result.notes !== 70 ||
      result.dimensions !== 384
    )
      throw Error(
        `Fresh offline inference failed:${result.stage ?? "assertions"}`,
      );
  }
  if (
    artifactRequests !== baselineArtifactRequests ||
    external ||
    unexpected ||
    pageErrors
  )
    throw Error("Unexpected network or page error");
  const report = {
    scope:
      "Isolated Chrome public model cache and fresh-worker offline inference; no app integration, offline shell startup, native/iPhone or RAM acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      browser: browser.version(),
      node: process.version,
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model,
    },
    model: {
      repository: manifest.model,
      revision: manifest.revision,
      runtime: manifest.runtime,
      fixtureSHA256: manifest.fixtureSHA256,
    },
    contract,
    interrupted: {
      ...interrupted,
      heldLockObserved: interruptedLock,
      workerTerminated: true,
    },
    abortedWrite,
    quota: {
      passed: false,
      boundary:
        "Prior 64 KiB DevTools override did not confirm QuotaExceededError; real quota exhaustion remains open, no repeated unchanged override",
    },
    installation: installed,
    bootstrapBytes: assets.get("/inference-worker.js").length,
    runtimeExportCondition: "onnxruntime-web-use-extern-wasm",
    bootstrapBoundary:
      "Single-file module worker bytes loaded before network disable; actual app shell/CSP integration remains open",
    browserProfileClosedAndReopenedBeforeInference: true,
    offlineFreshWorkers: runs,
    artifactRequests: {
      install: baselineArtifactRequests,
      afterOffline: artifactRequests - baselineArtifactRequests,
    },
    blockedExternalRequests: external,
    unexpectedLocalRequests: unexpected,
    pageErrors,
    applicationDatabasesOpened: 0,
    realNotesUsed: false,
  };
  await writeFile(
    "scratch/meaning-cache-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      stage: "complete",
      contract: contract.count,
      interrupted: true,
      abortedWrite,
      offlineWorkers: runs.map(
        ({
          top3,
          total,
          initializedMs,
          totalMs,
          cacheReads,
          forbiddenFetches,
        }) => ({
          top3,
          total,
          initializedMs,
          totalMs,
          cacheReads,
          forbiddenFetches,
        }),
      ),
      report: "scratch/meaning-cache-result.json",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      errorCode: "model-cache-experiment-failed",
      detail: String(error).slice(0, 350),
    }),
  );
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(temporary, { recursive: true, force: true });
  await rm(profile, { recursive: true, force: true });
}
