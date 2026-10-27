import { build } from "vite";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
await mkdir("scratch", { recursive: true });
const folder = await mkdtemp("scratch/cloud-server-crash-build-");
let stage = "build";
async function killAtBoundary(modulePath, path, scenario) {
  const child = spawn(
    process.execPath,
    ["scripts/cloud-server-crash-child.mjs", modulePath, path, scenario],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const exited = new Promise((done) =>
    child.once("exit", (code, signal) => done({ code, signal })),
  );
  let timer,
    output = "";
  try {
    await new Promise((done, reject) => {
      timer = setTimeout(
        () => reject(Error("Server crash child boundary timeout")),
        10000,
      );
      child.once("error", reject);
      child.once("exit", () =>
        reject(Error("Server crash child exited before boundary")),
      );
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.length > 4096)
          return reject(Error("Unexpected server child output"));
        if (
          output.includes('"stage":"committed"') ||
          output.includes('"stage":"transaction-open"')
        )
          done();
      });
      child.stderr.resume();
    });
    child.kill("SIGKILL");
    if ((await exited).signal !== "SIGKILL")
      throw Error("Server child missed SIGKILL boundary");
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
      ssr: "tests/fixtures/cloud-server-node.ts",
      outDir: `${folder}/node`,
      emptyOutDir: false,
      minify: false,
    },
  });
  const modulePath = resolve(folder, "node/cloud-server-node.js");
  const mod = await import(pathToFileURL(modulePath).href);
  const checks = {};
  for (const scenario of [
    "committed",
    "update-uncommitted",
    "purge-uncommitted",
  ]) {
    stage = scenario;
    const path = resolve(folder, `${scenario}.sqlite3`);
    await killAtBoundary(modulePath, path, scenario);
    const store = new mod.SQLiteCloudServerStore(path);
    try {
      const state = await store.read(
        mod.cloudScope.ownerSubject,
        "synthetic-note",
        "server-crash-op-2",
      );
      if (
        state.head.kind !== "note" ||
        state.head.revision !== 1 ||
        state.head.snapshot.bodyMarkdown !==
          "Synthetic committed server source" ||
        state.account?.sequence !== 1 ||
        state.receipt !== null
      )
        throw Error("Partial server state survived termination");
      const raw = new DatabaseSync(path, { readOnly: true });
      try {
        if (
          raw
            .prepare("SELECT count(*) AS count FROM m0_cloud_server_changes")
            .get().count !== 1 ||
          raw
            .prepare("SELECT count(*) AS count FROM m0_cloud_server_tombstones")
            .get().count !== 0
        )
          throw Error("Partial server event or tombstone survived termination");
      } finally {
        raw.close();
      }
      const payload = {
        version: 1,
        opId:
          scenario === "committed" ? "server-crash-op-1" : "server-crash-op-2",
        noteId: "synthetic-note",
        baseRevision: scenario === "committed" ? 0 : 1,
        kind: scenario === "purge-uncommitted" ? "purge" : "upsert",
        snapshot:
          scenario === "purge-uncommitted"
            ? null
            : mod.cloudDraft(
                scenario === "committed"
                  ? "Synthetic committed server source"
                  : "Synthetic uncommitted server source",
              ),
      };
      const result = await new mod.CloudMutationService(
        store,
        () => 1800000000000,
      ).mutate(mod.cloudScope.ownerSubject, {
        version: 1,
        collectionId: mod.cloudScope.collectionId,
        modeGeneration: 1,
        mutation: { ...payload, contentHash: await mod.mutationHash(payload) },
      });
      if (
        result.receipt.outcome !== "applied" ||
        result.replayed !== (scenario === "committed") ||
        result.receipt.sequence !== (scenario === "committed" ? 1 : 2) ||
        result.head.kind !==
          (scenario === "purge-uncommitted" ? "purged" : "note")
      )
        throw Error("Server retry after termination failed");
      checks[scenario] = true;
    } finally {
      await store.close();
    }
  }
  const report = {
    scope:
      "Actual SIGKILL/reopen boundaries of the isolated Node SQLite Cloud server transaction; not DynamoDB, hosted auth, physical power loss or app sync acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      sqlite: process.versions.sqlite,
      platform: os.platform(),
      release: os.release(),
    },
    fixtureSHA256: createHash("sha256")
      .update(await readFile(modulePath))
      .digest("hex"),
    sqliteSIGKILLBoundaries: checks,
    retryAfterRestartPassed: true,
    realNotesUsed: false,
    applicationDatabasesOpened: 0,
    awsResourcesCreated: false,
  };
  await writeFile(
    "scratch/cloud-server-crash-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      stage: "complete",
      sigkillBoundaries: 3,
      report: "scratch/cloud-server-crash-result.json",
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      stage,
      errorCode: "cloud-server-crash-failed",
      detail: String(error).slice(0, 300),
    }),
  );
  process.exitCode = 1;
} finally {
  await rm(folder, { recursive: true, force: true });
}
