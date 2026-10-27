import { build } from "vite";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

for (const kind of ["node", "browser"]) {
  await build({
    configFile: false,
    logLevel: "warn",
    ssr: { noExternal: ["idb"] },
    build: {
      ssr: `tests/fixtures/peer-store-${kind}.ts`,
      outDir: `scratch/peer-store-${kind}`,
      emptyOutDir: true,
    },
  });
}
const mod = await import("../scratch/peer-store-node/peer-store-node.js");
const folder = await mkdtemp(join(os.tmpdir(), "peel-synthetic-durability-"));
const module = await readFile(
  "scratch/peer-store-browser/peer-store-browser.js",
);
const server = createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": req.url === "/fixture.js" ? "text/javascript" : "text/html",
    "Cache-Control": "no-store",
  });
  res.end(
    req.url === "/fixture.js"
      ? module
      : "<!doctype html><title>Peel isolated durability experiment</title>",
  );
});
let browser;
const killAt = async (path, scenario) => {
  const child = spawn(
    process.execPath,
    ["scripts/peer-store-crash-child.mjs", path, scenario],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    let stdout = "",
      stderr = "",
      killed = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Synthetic crash fixture timed out"));
    }, 10000);
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const line = stdout.split("\n")[0];
      if (!stdout.includes("\n")) return;
      const expected = scenario.endsWith("uncommitted")
        ? "transaction-open"
        : "committed";
      if (JSON.parse(line).stage !== expected) return;
      killed = child.kill("SIGKILL");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      if (killed && signal === "SIGKILL") resolve(true);
      else
        reject(
          new Error(`Crash fixture failed: ${code}, ${signal}, ${stderr}`),
        );
    });
  });
};
try {
  const sqlite = await mod.runStoreContract(
    (name, hook) =>
      new mod.SQLiteReplicaStore(join(folder, `${name}.sqlite3`), hook),
  );
  const sqliteCurrentTrust = await mod.runTrustedContract(
    (name, hook) =>
      new mod.SQLiteReplicaStore(join(folder, `trusted-${name}.sqlite3`), hook),
  );
  const sqliteInventory = await mod.runInventoryContract(
    (name, hook) =>
      new mod.SQLiteReplicaStore(join(folder, `${name}.sqlite3`), hook),
  );
  const crashChecks = {};
  for (const scenario of [
    "committed",
    "uncommitted",
    "draft-committed",
    "draft-publish-uncommitted",
  ]) {
    const path = join(folder, `crash-${scenario}.sqlite3`);
    await killAt(path, scenario);
    const store = new mod.SQLiteReplicaStore(path);
    try {
      const view = await new mod.DurableReplica(
        store,
        mod.library,
        mod.device,
      ).view("crash-fixture");
      const draftScenario = scenario.startsWith("draft-");
      const okay =
        view.note?.bodyMarkdown === "Synthetic acknowledged crash fixture" &&
        view.note.localRevision === 1 &&
        view.history.length === 0 &&
        (draftScenario
          ? view.draft?.generation === "crash-draft" &&
            !view.head &&
            !view.delivery &&
            view.clock.physical === 0
          : view.head?.editId === "crash-committed" &&
            view.delivery?.generation === "crash-committed");
      if (!okay)
        throw new Error(`SQLite SIGKILL recovery failed for ${scenario}`);
      crashChecks[
        {
          committed: "acknowledgedEditSurvivesSIGKILL",
          uncommitted: "SIGKILLDuringTransactionRollsBackAllState",
          "draft-committed": "unstampedDraftSurvivesSIGKILL",
          "draft-publish-uncommitted":
            "SIGKILLDuringPublicationKeepsDraftWithoutPartialHead",
        }[scenario]
      ] = true;
    } finally {
      await store.close();
    }
  }
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({
    executablePath:
      process.env.PEEL_BROWSER_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const indexedDB = await page.evaluate(async () => {
    const mod = await import("/fixture.js");
    return mod.runStoreContract(
      (name, hook) =>
        new mod.IndexedDBReplicaStore(`peel-m0-peer-${name}`, hook),
    );
  });
  const indexedDBCurrentTrust = await page.evaluate(async () => {
    const mod = await import("/fixture.js");
    return mod.runTrustedContract(
      (name, hook) =>
        new mod.IndexedDBReplicaStore(`peel-m0-peer-trusted-${name}`, hook),
    );
  });
  const indexedDBInventory = await page.evaluate(async () => {
    const mod = await import("/fixture.js");
    return mod.runInventoryContract(
      (name, hook) =>
        new mod.IndexedDBReplicaStore(`peel-m0-peer-${name}`, hook),
    );
  });
  await page.reload();
  const reloaded = await page.evaluate(async () => {
    const mod = await import("/fixture.js"),
      store = new mod.IndexedDBReplicaStore("peel-m0-peer-restart");
    try {
      const view = await new mod.DurableReplica(
        store,
        mod.library,
        mod.device,
      ).view("synthetic-note");
      return (
        view.note?.localRevision === 2 &&
        view.head?.editId === "remote-1" &&
        view.history.length === 1
      );
    } finally {
      await store.close();
    }
  });
  const draftReloaded = await page.evaluate(async () => {
    const mod = await import("/fixture.js"),
      store = new mod.IndexedDBReplicaStore("peel-m0-peer-draft-clock");
    try {
      const view = await new mod.DurableReplica(
        store,
        mod.library,
        mod.device,
      ).view("unstamped-reload");
      return (
        view.note?.bodyMarkdown === "Synthetic pending reload draft" &&
        view.note.localRevision === 1 &&
        view.draft?.generation === "reload-generation" &&
        !view.head &&
        !view.delivery
      );
    } finally {
      await store.close();
    }
  });
  if (!reloaded || !draftReloaded || errors.length)
    throw new Error(`Browser reload/page errors: ${JSON.stringify(errors)}`);
  const report = {
    scope:
      "M0 isolated Node SQLite and Chrome IndexedDB durability contract; not native Rust, Safari/iPhone, real pairing, transport or production app acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      sqlite: process.versions.sqlite,
      browser: await browser.version(),
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
    },
    sqlite,
    indexedDB,
    sqliteCurrentTrust,
    indexedDBCurrentTrust,
    sqliteInventory,
    indexedDBInventory,
    ...crashChecks,
    browserProjectionSurvivesPageReload: reloaded,
    browserUnstampedDraftSurvivesPageReload: draftReloaded,
    databases:
      "Fresh synthetic temporary paths and isolated temporary browser profile only",
    appDatabasesOpened: 0,
    networkSyncEnabled: false,
    errors,
  };
  await mkdir("scratch", { recursive: true });
  await writeFile(
    "scratch/peer-durability.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await rm(folder, { recursive: true, force: true });
}
