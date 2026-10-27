import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";

const folder = await mkdtemp("scratch/cloud-client-build-");
let server, browser, context;
let stage = "build",
  external = 0,
  unexpected = 0,
  pageErrors = 0;
try {
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      lib: {
        entry: "tests/fixtures/cloud-client-interop.ts",
        formats: ["es"],
        fileName: () => "interop.js",
      },
      outDir: folder,
      emptyOutDir: false,
      minify: false,
    },
  });
  const source = await readFile(`${folder}/interop.js`);
  stage = "node";
  const nodeModule = await import(
    pathToFileURL(resolve(folder, "interop.js")).href
  );
  const node = await nodeModule.runCloudClientInterop();
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method !== "GET" || url.search) {
      unexpected++;
      res.writeHead(400);
      return res.end();
    }
    if (url.pathname === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-store",
      });
      return res.end(
        "<!doctype html><title>Peel synthetic Cloud client</title>",
      );
    }
    if (url.pathname !== "/interop.js") {
      unexpected++;
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      "Content-Type": "text/javascript",
      "Cache-Control": "no-store",
    });
    res.end(source);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  stage = "chrome";
  browser = await chromium.launch({
    executablePath:
      process.env.PEEL_BROWSER_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
  context = await browser.newContext();
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      url.origin !== origin ||
      request.method() !== "GET" ||
      url.search ||
      request.postData()
    ) {
      external++;
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", () => pageErrors++);
  await page.goto(origin);
  let watchdog;
  const chrome = await Promise.race([
    page.evaluate(async () =>
      (await import("/interop.js")).runCloudClientInterop(),
    ),
    new Promise((_, reject) => {
      watchdog = setTimeout(
        () => reject(Error("Cloud client browser watchdog")),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(watchdog));
  if (
    JSON.stringify(node) !== JSON.stringify(chrome) ||
    !node.retryUnchanged ||
    node.afterAck.status !== "waiting" ||
    node.afterAck.pendingText !== "Later 原文 ##work" ||
    node.afterConflict.status !== "conflict" ||
    node.mergedBaseRevision !== 2 ||
    node.mergedText !== "Explicit merge" ||
    external ||
    unexpected ||
    pageErrors
  )
    throw Error("Cloud client cross-runtime contract failed");
  const report = {
    scope:
      "Isolated M0 Cloud client reducer and content hash on the same deterministic synthetic fixture in Node and Chrome; no backend, authentication, paid entitlement, app storage or network sync",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      browser: browser.version(),
      platform: os.platform(),
      release: os.release(),
    },
    fixtureSHA256: createHash("sha256").update(source).digest("hex"),
    node,
    chromeMatchesNode: true,
    blockedExternalRequests: external,
    unexpectedLocalRequests: unexpected,
    pageErrors,
  };
  await writeFile(
    "scratch/cloud-client-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      stage: "complete",
      chromeMatchesNode: true,
      report: "scratch/cloud-client-result.json",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      errorCode: "cloud-client-experiment-failed",
      detail: String(error).slice(0, 300),
    }),
  );
  process.exitCode = 1;
} finally {
  try {
    await context?.close();
  } finally {
    try {
      await browser?.close();
    } finally {
      try {
        if (server) await new Promise((resolve) => server.close(resolve));
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    }
  }
}
