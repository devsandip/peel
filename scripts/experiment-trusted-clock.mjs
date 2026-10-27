import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";

const folder = await mkdtemp("scratch/trusted-clock-build-");
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
        entry: "tests/fixtures/trusted-clock-browser.ts",
        formats: ["es"],
        fileName: () => "contract.js",
      },
      outDir: folder,
      emptyOutDir: false,
      minify: false,
    },
  });
  const source = await readFile(`${folder}/contract.js`);
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
        "<!doctype html><title>Peel synthetic durable clock trust</title>",
      );
    }
    if (url.pathname !== "/contract.js") {
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
  const result = await Promise.race([
    page.evaluate(async () =>
      (await import("/contract.js")).runBrowserTrustedClockContract(),
    ),
    new Promise((_, reject) => {
      watchdog = setTimeout(
        () => reject(Error("Browser trusted-clock watchdog")),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(watchdog));
  if (
    result.count !== 4 ||
    result.realNotesUsed ||
    result.durableDiagnosticWrites ||
    external ||
    unexpected ||
    pageErrors
  )
    throw Error("Durable clock trust contract failed");
  const report = {
    scope:
      "Isolated M0 current durable trust plus signed peer-relative clock diagnostics in Chrome IndexedDB. No note, session authorization, network transport or app integration.",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      browser: browser.version(),
      platform: os.platform(),
      release: os.release(),
    },
    bundleSHA256: createHash("sha256").update(source).digest("hex"),
    chrome: result,
    blockedExternalRequests: external,
    unexpectedLocalRequests: unexpected,
    pageErrors,
    applicationDatabasesOpened: 0,
  };
  await writeFile(
    "scratch/trusted-clock-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      stage: "complete",
      checks: result.count,
      report: "scratch/trusted-clock-result.json",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      errorCode: "trusted-clock-experiment-failed",
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
