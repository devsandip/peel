import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";

const folder = await mkdtemp("scratch/bound-clock-channel-build-");
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
        entry: "tests/fixtures/bound-clock-channel.ts",
        formats: ["es"],
        fileName: () => "fixture.js",
      },
      outDir: folder,
      emptyOutDir: false,
      minify: false,
    },
  });
  const source = await readFile(`${folder}/fixture.js`);
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
        "<!doctype html><title>Peel synthetic bound clock channel</title>",
      );
    }
    if (url.pathname !== "/fixture.js") {
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
      (await import("/fixture.js")).runBoundClockChannelExperiment(),
    ),
    new Promise((_, reject) => {
      watchdog = setTimeout(
        () => reject(Error("Bound clock channel watchdog")),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(watchdog));
  if (
    Object.keys(result.checks).length !== 10 ||
    Object.values(result.checks).some((value) => value !== true) ||
    result.realNotesUsed ||
    result.applicationDatabasesOpened ||
    result.durableDiagnosticWrites ||
    external ||
    unexpected ||
    pageErrors
  )
    throw Error("Bound clock channel contract failed");
  const report = {
    scope:
      "Same-page Chrome host-host WebRTC channel with independent installed-description bindings, durable confirmed keys and simulated year-skew clocks; no native, different-network, relay or OS-clock acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      browser: browser.version(),
      platform: os.platform(),
      release: os.release(),
    },
    fixtureSHA256: createHash("sha256").update(source).digest("hex"),
    ...result,
    blockedExternalRequests: external,
    unexpectedLocalRequests: unexpected,
    pageErrors,
  };
  await writeFile(
    "scratch/bound-clock-channel-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      stage: "complete",
      checks: Object.keys(result.checks).length,
      report: "scratch/bound-clock-channel-result.json",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      errorCode: "bound-clock-channel-failed",
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
