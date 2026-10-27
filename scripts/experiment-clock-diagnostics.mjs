import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
const directory = await mkdtemp("scratch/clock-diagnostic-build-");
let server,
  browser,
  context,
  stage = "build",
  external = 0,
  unexpected = 0,
  pageErrors = 0;
try {
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      lib: {
        entry: "tests/fixtures/clock-diagnostic-contract.ts",
        formats: ["es"],
        fileName: () => "contract.js",
      },
      outDir: directory,
      emptyOutDir: false,
      minify: false,
    },
  });
  const bytes = await readFile(`${directory}/contract.js`);
  stage = "node-contract";
  const nodeModule = await import(
    pathToFileURL(resolve(directory, "contract.js")).href
  );
  const node = await nodeModule.runClockDiagnosticContract();
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
        "<!doctype html><title>Peel synthetic clock diagnostics</title>",
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
    res.end(bytes);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
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
  stage = "chrome-contract";
  let watchdog;
  const chrome = await Promise.race([
    page.evaluate(async () =>
      (await import("/contract.js")).runClockDiagnosticContract(),
    ),
    new Promise((_, reject) => {
      watchdog = setTimeout(
        () => reject(Error("Clock browser watchdog")),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(watchdog));
  stage = "cross-runtime-rpc";
  const YEAR = 365 * 24 * 60 * 60 * 1000;
  const local = await nodeModule.createClockEndpoint();
  const remote = await page.evaluate(async (offset) => {
    globalThis.peelClockEndpoint = await (
      await import("/contract.js")
    ).createClockEndpoint(offset);
    return {
      deviceId: globalThis.peelClockEndpoint.deviceId,
      spki: globalThis.peelClockEndpoint.spki,
    };
  }, YEAR);
  await local.confirm(remote.spki);
  await page.evaluate(
    async (spki) => globalThis.peelClockEndpoint.confirm(spki),
    local.spki,
  );
  const random = () => randomBytes(32).toString("hex");
  const binding = {
    version: 1,
    libraryId: "fixture-library",
    sessionId: random(),
    initiatorId: local.deviceId,
    responderId: remote.deviceId,
    initiatorNonce: random(),
    responderNonce: random(),
    offerHash: random(),
    answerHash: random(),
    expiresAt: 1800000300000,
  };
  const request = await local.begin(binding);
  const response = await page.evaluate(
    async ({ request, binding }) => {
      globalThis.peelClockEndpoint.at(10);
      return globalThis.peelClockEndpoint.respond(request, binding);
    },
    { request, binding },
  );
  local.at(100);
  const forward = await local.complete(response, binding);
  const reverseRequest = await page.evaluate(async (binding) => {
    globalThis.peelClockEndpoint.at(200);
    return globalThis.peelClockEndpoint.begin(binding);
  }, binding);
  local.at(210);
  const reverseReply = await local.respond(reverseRequest, binding);
  const reverse = await page.evaluate(
    async ({ reply, binding }) => {
      globalThis.peelClockEndpoint.at(300);
      return globalThis.peelClockEndpoint.complete(reply, binding);
    },
    { reply: reverseReply, binding },
  );
  const crossRuntime = {
    boundary:
      "Fixture RPC transfers public SPKI and signed messages between Node and Chrome; simulated clocks, no DTLS or native app",
    publicKeysCrossedRuntimes: true,
    privateKeysExported: false,
    forward,
    reverse,
  };
  if (
    forward.assessment !== "large-relative-skew" ||
    reverse.assessment !== "large-relative-skew" ||
    forward.lowerOffsetMs > YEAR ||
    forward.upperOffsetMs < YEAR ||
    reverse.lowerOffsetMs > -YEAR ||
    reverse.upperOffsetMs < -YEAR
  )
    throw Error("Cross-runtime signed clock exchange failed");
  if (
    node.count !== 9 ||
    chrome.count !== 9 ||
    external ||
    unexpected ||
    pageErrors
  )
    throw Error("Clock contract assertions failed");
  const report = {
    scope:
      "In-memory signed peer-relative diagnostics on simulated clocks using real Node/Chrome Web Crypto; no durable trust, clock repair, wire/app/native/iPhone acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      browser: browser.version(),
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model,
    },
    sameContractSHA256: createHash("sha256").update(bytes).digest("hex"),
    node,
    chrome,
    crossRuntime,
    blockedExternalRequests: external,
    unexpectedLocalRequests: unexpected,
    pageErrors,
    applicationDatabasesOpened: 0,
    realNotesUsed: false,
  };
  await writeFile(
    "scratch/clock-diagnostic-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      stage: "complete",
      node: node.count,
      chrome: chrome.count,
      report: "scratch/clock-diagnostic-result.json",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      errorCode: "clock-diagnostic-experiment-failed",
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
        if (server) await new Promise((r) => server.close(r));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
