import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";

await mkdir("scratch", { recursive: true });
const folder = await mkdtemp("scratch/cloud-durability-build-");
let browser, context, server;
let stage = "build",
  external = 0,
  unexpected = 0,
  pageErrors = 0;
async function terminateAtBoundary(modulePath, databasePath, scenario) {
  const child = spawn(
    process.execPath,
    ["scripts/cloud-store-crash-child.mjs", modulePath, databasePath, scenario],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = new Promise((done) =>
    child.once("exit", (code, signal) => done({ code, signal })),
  );
  let output = "",
    timer;
  try {
    await new Promise((done, reject) => {
      timer = setTimeout(
        () => reject(Error("Cloud crash child boundary timeout")),
        10000,
      );
      child.once("error", reject);
      child.once("exit", () =>
        reject(Error("Cloud crash child exited before boundary")),
      );
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 4096)
          return reject(Error("Unexpected crash child output"));
        if (
          output.includes('"stage":"transaction-open"') ||
          output.includes('"stage":"committed"')
        )
          done();
      });
      child.stderr.resume();
    });
    child.kill("SIGKILL");
    const result = await exited;
    if (result.signal !== "SIGKILL")
      throw Error("Cloud child did not end at SIGKILL boundary");
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}
try {
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      ssr: "tests/fixtures/cloud-store-node.ts",
      outDir: `${folder}/node`,
      emptyOutDir: false,
      minify: false,
    },
  });
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      lib: {
        entry: "tests/fixtures/cloud-store-browser.ts",
        formats: ["es"],
        fileName: () => "fixture.js",
      },
      outDir: `${folder}/browser`,
      emptyOutDir: false,
      minify: false,
    },
  });
  const nodePath = resolve(folder, "node/cloud-store-node.js");
  const mod = await import(pathToFileURL(nodePath).href);
  await mkdir(`${folder}/sqlite`);
  stage = "sqlite-contract";
  const sqlite = await mod.runCloudDurableContract(
    (name, hook) =>
      new mod.SQLiteCloudStateStore(
        join(folder, "sqlite", `${name}.sqlite3`),
        hook,
      ),
  );
  const sqliteHead = await mod.runCloudHeadContract(
    (name, hook) =>
      new mod.SQLiteCloudStateStore(
        join(folder, "sqlite", `head-${name}.sqlite3`),
        hook,
      ),
  );
  const sqlitePull = await mod.runCloudPullContract(
    (name, hook) =>
      new mod.SQLiteCloudStateStore(
        join(folder, "sqlite", `pull-${name}.sqlite3`),
        hook,
      ),
  );
  stage = "sqlite-process-termination";
  const crash = {};
  for (const scenario of [
    "draft-committed",
    "prepare-uncommitted",
    "ack-uncommitted",
    "ack-committed",
    "pull-uncommitted",
    "pull-committed",
  ]) {
    const path = resolve(folder, `${scenario}.sqlite3`);
    await terminateAtBoundary(nodePath, path, scenario);
    const store = new mod.SQLiteCloudStateStore(path);
    try {
      const state = await new mod.DurableCloudClient(store, mod.cloudScope).get(
        "synthetic-note",
      );
      let passed = false;
      if (
        scenario === "draft-committed" ||
        scenario === "prepare-uncommitted"
      ) {
        passed =
          state?.generation === 1 &&
          state.baseRevision === 0 &&
          !state.inFlight &&
          state.pending?.snapshot?.bodyMarkdown ===
            "Synthetic committed Cloud draft";
      } else if (scenario === "ack-uncommitted") {
        passed =
          state?.baseRevision === 0 &&
          state.inFlight?.opId === "crash-op" &&
          state.inFlight.snapshot?.bodyMarkdown ===
            "Synthetic committed Cloud draft" &&
          state.current?.snapshot?.bodyMarkdown ===
            "Synthetic later Cloud draft" &&
          state.pending?.snapshot?.bodyMarkdown ===
            "Synthetic later Cloud draft";
      } else if (scenario.startsWith("pull-")) {
        const progress = await new mod.DurableCloudPull(
            store,
            mod.cloudScope,
          ).progress(),
          downloaded = await new mod.DurableCloudClient(
            store,
            mod.cloudScope,
          ).get("synthetic-downloaded");
        passed =
          scenario === "pull-uncommitted"
            ? progress?.generation === 2 &&
              progress.next?.token === "crash-page" &&
              !progress.checkpoint &&
              !downloaded &&
              state?.pending?.snapshot?.bodyMarkdown ===
                "Synthetic committed Cloud draft" &&
              !state.conflict
            : progress?.generation === 3 &&
              progress.next === null &&
              progress.checkpoint === "crash-checkpoint" &&
              downloaded?.baseRevision === 1 &&
              state?.conflict?.local.snapshot?.bodyMarkdown ===
                "Synthetic committed Cloud draft" &&
              state.conflict.remote?.bodyMarkdown ===
                "Synthetic downloaded head";
      } else {
        passed =
          state?.baseRevision === 1 &&
          !state.inFlight &&
          state.current?.snapshot?.bodyMarkdown ===
            "Synthetic later Cloud draft" &&
          state.pending?.snapshot?.bodyMarkdown ===
            "Synthetic later Cloud draft";
      }
      if (!passed) throw Error(`Cloud crash recovery failed: ${scenario}`);
      crash[scenario] = true;
    } finally {
      await store.close();
    }
  }
  const source = await readFile(`${folder}/browser/fixture.js`);
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
        "<!doctype html><title>Peel synthetic Cloud durability</title>",
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
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
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
    const req = route.request(),
      url = new URL(req.url());
    if (
      url.origin !== origin ||
      req.method() !== "GET" ||
      url.search ||
      req.postData()
    ) {
      external++;
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", () => pageErrors++);
  await page.goto(origin);
  stage = "indexeddb-contract";
  let watchdog;
  const indexedDB = await Promise.race([
    page.evaluate(
      async (suffix) =>
        (await import("/fixture.js")).runBrowserCloudDurability(suffix),
      randomBytes(8).toString("hex"),
    ),
    new Promise((_, reject) => {
      watchdog = setTimeout(
        () => reject(Error("Cloud browser contract watchdog")),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(watchdog));
  stage = "indexeddb-head-contract";
  const indexedDBHead = await Promise.race([
    page.evaluate(
      async (suffix) =>
        (await import("/fixture.js")).runBrowserCloudHeadContract(suffix),
      randomBytes(8).toString("hex"),
    ),
    new Promise((_, reject) => {
      watchdog = setTimeout(
        () => reject(Error("Cloud head browser watchdog")),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(watchdog));
  stage = "indexeddb-pull-contract";
  const indexedDBPull = await Promise.race([
    page.evaluate(
      async (suffix) =>
        (await import("/fixture.js")).runBrowserCloudPullContract(suffix),
      randomBytes(8).toString("hex"),
    ),
    new Promise((_, reject) => {
      watchdog = setTimeout(
        () => reject(Error("Cloud pull browser watchdog")),
        30000,
      );
    }),
  ]).finally(() => clearTimeout(watchdog));
  stage = "browser-reload";
  const reloadName = `peel-m0-cloud-reload-${randomBytes(8).toString("hex")}`;
  await page.evaluate(
    async (name) =>
      (await import("/fixture.js")).prepareBrowserCloudReload(name),
    reloadName,
  );
  await page.reload();
  const reload = await page.evaluate(
    async (name) =>
      (await import("/fixture.js")).verifyBrowserCloudReload(name),
    reloadName,
  );
  if (
    Object.keys(sqlite.checks).length !== 8 ||
    Object.keys(indexedDB.checks).length !== 8 ||
    Object.keys(sqliteHead.checks).length !== 4 ||
    Object.keys(indexedDBHead.checks).length !== 4 ||
    Object.keys(sqlitePull.checks).length !== 4 ||
    Object.keys(indexedDBPull.checks).length !== 4 ||
    [
      ...Object.values(sqlite.checks),
      ...Object.values(indexedDB.checks),
      ...Object.values(sqliteHead.checks),
      ...Object.values(indexedDBHead.checks),
      ...Object.values(sqlitePull.checks),
      ...Object.values(indexedDBPull.checks),
      indexedDBPull.legacyMigrationAndAbortPreserveSource,
      indexedDBPull.oldVersionRefusedAfterUpgrade,
      ...Object.values(crash),
      ...Object.values(reload),
    ].some((value) => value !== true) ||
    external ||
    unexpected ||
    pageErrors
  )
    throw Error(
      JSON.stringify({
        code: "durability-assertion",
        counts: [
          Object.keys(sqlite.checks).length,
          Object.keys(indexedDB.checks).length,
          Object.keys(sqliteHead.checks).length,
          Object.keys(indexedDBHead.checks).length,
          Object.keys(sqlitePull.checks).length,
          Object.keys(indexedDBPull.checks).length,
        ],
        external,
        unexpected,
        pageErrors,
        failedChecks: [
          sqlite.checks,
          indexedDB.checks,
          sqliteHead.checks,
          indexedDBHead.checks,
          sqlitePull.checks,
          indexedDBPull.checks,
          crash,
          reload,
        ].flatMap((group) =>
          Object.entries(group)
            .filter(([, value]) => value !== true)
            .map(([key]) => key),
        ),
      }),
    );
  const report = {
    scope:
      "Isolated M0 Node SQLite and Chrome IndexedDB Cloud state/outbox durability; not native Rust, Safari/iPhone, production app, physical storage failure, authenticated account or hosted acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      sqlite: process.versions.sqlite,
      browser: browser.version(),
      platform: os.platform(),
      release: os.release(),
    },
    browserFixtureSHA256: createHash("sha256").update(source).digest("hex"),
    sqlite,
    indexedDB,
    sqliteHead,
    indexedDBHead,
    sqlitePull,
    indexedDBPull,
    sqliteSIGKILLBoundaries: crash,
    browserReload: reload,
    externalRequests: external,
    unexpectedLocalRequests: unexpected,
    pageErrors,
    realNotesUsed: false,
    applicationDatabasesOpened: 0,
    awsResourcesCreated: false,
  };
  await writeFile(
    "scratch/cloud-durability-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      stage: "complete",
      sqliteScenarios: 8,
      indexedDBScenarios: 8,
      headScenariosPerAdapter: 4,
      pullScenariosPerAdapter: 4,
      sigkillBoundaries: 6,
      report: "scratch/cloud-durability-result.json",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      errorCode: "cloud-durability-experiment-failed",
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
        if (server) await new Promise((done) => server.close(done));
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    }
  }
}
