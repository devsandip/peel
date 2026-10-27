import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { join, resolve } from "node:path";
import { build as bundle } from "vite";

if (process.platform !== "darwin")
  throw new Error("This probe requires the Mac native runtime");
const build = spawn(
  "cargo",
  [
    "build",
    "--release",
    "--locked",
    "--features",
    "tauri/custom-protocol",
    "--manifest-path",
    "apps/native/src-tauri/Cargo.toml",
    "--example",
    "peer_probe",
  ],
  { stdio: "inherit" },
);
const built = await new Promise((resolve, reject) => {
  build.on("error", reject);
  build.on("exit", resolve);
});
if (built !== 0) throw new Error("Native probe build failed");
const folder = await mkdtemp(join(os.tmpdir(), "peel-synthetic-native-peer-"));
try {
  const token = randomUUID();
  await writeFile(join(folder, "synthetic-fixture.marker"), token, {
    mode: 0o600,
  });
  await bundle({
    configFile: false,
    logLevel: "warn",
    ssr: { noExternal: ["idb"] },
    build: {
      ssr: "tests/fixtures/bound-peer-channel.ts",
      outDir: join(folder, "fixture"),
      emptyOutDir: true,
    },
  });
  const child = spawn(
    resolve("apps/native/src-tauri/target/release/examples/peer_probe"),
    [],
    {
      env: {
        ...process.env,
        PEEL_M0_PROBE_ROOT: folder,
        PEEL_M0_PROBE_TOKEN: token,
        PEEL_DATA_DIR: join(folder, "unused-note-root"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", () => {});
  const timeout = setTimeout(() => child.kill("SIGKILL"), 40000);
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).finally(() => clearTimeout(timeout));
  const line = stdout
    .split("\n")
    .find((line) => line.startsWith("PEEL_M0_REPORT "));
  if (!line) throw new Error("Native probe exited without a report");
  const report = {
    ...JSON.parse(line.slice("PEEL_M0_REPORT ".length)),
    observedAt: new Date().toISOString(),
    environment: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
    },
    exitCode: code,
    assetRequests: Object.fromEntries(
      ["asset-index", "asset-module", "asset-other"].map((kind) => [
        kind,
        stdout.split("\n").filter((line) => line === "PEEL_M0_TRACE " + kind)
          .length,
      ]),
    ),
  };
  await mkdir("scratch", { recursive: true });
  await writeFile(
    "scratch/native-peer-runtime.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (code !== 0)
    throw new Error(
      "A native runtime capability remains unavailable; inspect the metadata-only report",
    );
} finally {
  await rm(folder, { recursive: true, force: true });
}
