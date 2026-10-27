import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";

await build({
  configFile: false,
  logLevel: "warn",
  ssr: { noExternal: ["idb"] },
  build: {
    ssr: "tests/fixtures/bound-peer-channel.ts",
    outDir: "scratch/bound-channel",
    emptyOutDir: true,
  },
});
const module = await readFile("scratch/bound-channel/bound-peer-channel.js");
const server = createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": req.url === "/fixture.js" ? "text/javascript" : "text/html",
    "Cache-Control": "no-store",
  });
  res.end(
    req.url === "/fixture.js"
      ? module
      : "<!doctype html><title>Peel isolated bound channel experiment</title>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.PEEL_BROWSER_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
  const page = await browser.newPage(),
    pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  let watchdog;
  const result = await Promise.race([
    page.evaluate(async () =>
      (await import("/fixture.js")).runBoundChannelExperiment(),
    ),
    new Promise((_, reject) => {
      watchdog = setTimeout(async () => {
        let observationTimer;
        const stage = await Promise.race([
          page
            .evaluate(() => globalThis.peelFlowStage ?? "baseline")
            .catch(() => "page-unavailable"),
          new Promise((resolve) => {
            observationTimer = setTimeout(
              () => resolve("page-unresponsive"),
              500,
            );
          }),
        ]).finally(() => clearTimeout(observationTimer));
        reject(new Error(`Bound channel watchdog at fixed stage: ${stage}`));
      }, 45000);
    }),
  ]).finally(() => clearTimeout(watchdog));
  const report = {
    scope:
      "M0 same-page ephemeral trusted peer proofs bound to installed WebRTC descriptions and isolated IndexedDB commits; not production pairing/signaling, cross-network/relay or native/iPhone acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      browser: await browser.version(),
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
    },
    ...result,
    pageErrors,
  };
  await mkdir("scratch", { recursive: true });
  await writeFile(
    "scratch/bound-channel.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (pageErrors.length || Object.values(result.checks).some((v) => !v))
    process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
