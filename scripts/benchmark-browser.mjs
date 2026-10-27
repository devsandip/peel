import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { writeFile, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import { wordFixtures, wordQueries } from "./word-fixtures.mjs";
const origin = "http://127.0.0.1:4321";
const server = spawn(
  "pnpm",
  [
    "--filter",
    "@peel/web",
    "exec",
    "vite",
    "preview",
    "--host",
    "127.0.0.1",
    "--port",
    "4321",
    "--strictPort",
  ],
  { stdio: "ignore" },
);
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null)
      throw new Error("Benchmark preview server could not start");
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("Benchmark preview server timed out");
  browser = await chromium.launch({
    executablePath:
      process.env.PEEL_BROWSER_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.peelLongTasks = [];
    new PerformanceObserver((list) =>
      window.peelLongTasks.push(
        ...list
          .getEntries()
          .map((e) => ({ start: e.startTime, ms: e.duration })),
      ),
    ).observe({ type: "longtask", buffered: true });
  });
  await page.goto(origin);
  const notes = wordFixtures();
  await page.evaluate(async (notes) => {
    const open = indexedDB.open("peel-local-v1", 1);
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction("notes", "readwrite");
    for (const note of notes) tx.objectStore("notes").put(note);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, notes);
  await page.reload();
  await page
    .locator('.library-main[aria-busy="false"] .note-card')
    .first()
    .waitFor({ timeout: 30000 });
  const cold = await page.evaluate(() => ({
    readyMs: performance.now(),
    longTasks: window.peelLongTasks.splice(0),
  }));
  await page.context().setOffline(true);
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const sample = await page.evaluate(
      (query) =>
        new Promise((resolve, reject) => {
          const main = document.querySelector(".library-main");
          const input = document.querySelector("#note-search");
          let busy = false;
          const start = performance.now();
          const timer = setTimeout(() => {
            observer.disconnect();
            reject(new Error("Search result timed out"));
          }, 10000);
          const observer = new MutationObserver(() => {
            if (main.getAttribute("aria-busy") === "true") busy = true;
            if (busy && main.getAttribute("aria-busy") === "false") {
              observer.disconnect();
              clearTimeout(timer);
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  resolve({
                    ms: performance.now() - start,
                    total: Number(
                      document
                        .querySelector(".result-label")
                        .textContent.match(/^\d+/)?.[0],
                    ),
                    rendered: document.querySelectorAll(".note-card").length,
                  }),
                ),
              );
            }
          });
          observer.observe(main, {
            attributes: true,
            attributeFilter: ["aria-busy"],
          });
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          ).set.call(input, query);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }),
      wordQueries[i % wordQueries.length],
    );
    samples.push({ queryId: (i % wordQueries.length) + 1, ...sample });
  }
  const cached = await page.evaluate(() => ({
    longTasks: window.peelLongTasks,
    mainThreadHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    userAgent: navigator.userAgent,
  }));
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const report = {
    generatedAt: new Date().toISOString(),
    buildAssets: (await readdir("apps/web/dist/assets"))
      .filter((f) => f.endsWith(".js"))
      .sort(),
    scope:
      "Production browser build, synthetic component corpus; partial AC-14 evidence, not native/mobile acceptance",
    measurement:
      "Input event to ranked results and two animation frames; no debounce; 100 warm offline interactions, one cold library rebuild",
    device: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
      memoryGiB: Math.round(os.totalmem() / 2 ** 30),
      viewport: "1440x1000",
      browser: await browser.version(),
    },
    noteCount: notes.length,
    averageBytes: Math.round(
      notes.reduce((n, x) => n + Buffer.byteLength(x.bodyMarkdown), 0) /
        notes.length,
    ),
    tags: 500,
    archivedPercent: 10,
    cold,
    p50Ms: sorted[49],
    p95Ms: sorted[94],
    maxMs: sorted[99],
    ...cached,
    errors,
    samples,
  };
  await mkdir("scratch", { recursive: true });
  await writeFile(
    "scratch/word-search-browser.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      { ...report, samples: undefined, userAgent: undefined },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
