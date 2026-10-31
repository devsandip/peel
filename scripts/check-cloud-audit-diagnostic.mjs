import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CANDIDATE_SHA256 =
  "918a9f49d574da9b7f6d5c4c5dc385eb67debaf46bbfe83b259e4b6fc6b9437c";
export const HARNESS_SHA256 =
  "1a38efac554b006ffc911dbd8ef76a9bfb6cd862b7cbc7a4d395c5a467621ad5";
export const EXPECTED_SYNTHETIC_TESTS = 28;
export const REFUSAL_MESSAGE =
  "Cloud audit diagnostic synthetic replay unavailable";

const PINNED_NODE_VERSION = "24.22.1";
const MAX_MARKDOWN_BYTES = 512 * 1024;
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const VITEST_TIMEOUT_MS = 120000;

function refuse() {
  throw new Error(REFUSAL_MESSAGE);
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function extractCloudAuditDiagnostic(markdown) {
  if (
    typeof markdown !== "string" ||
    markdown.length === 0 ||
    markdown.includes("\r") ||
    markdown.includes("\0") ||
    Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES
  ) {
    refuse();
  }

  const candidates = [];
  const harnesses = [];
  let activeFence = null;

  for (const line of markdown.split("\n")) {
    if (activeFence === null) {
      if (/^[ \t]+(`{3,}|~{3,})/.test(line) || /^~{3,}/.test(line)) {
        refuse();
      }
      const match = /^(`{3,})(.*)$/.exec(line);
      if (!match) {
        continue;
      }
      const ticks = match[1].length;
      const info = match[2];
      if (info.includes("`")) {
        refuse();
      }
      const trimmed = info.trim();
      if (info !== trimmed) {
        refuse();
      }
      if (
        trimmed.startsWith("javascript") &&
        (ticks !== 3 || info !== "javascript")
      ) {
        refuse();
      }
      if (trimmed.startsWith("text") && (ticks !== 3 || info !== "text")) {
        refuse();
      }
      activeFence = { ticks, tag: info, lines: [] };
      continue;
    }

    if (line === "`".repeat(activeFence.ticks)) {
      if (activeFence.tag === "javascript") {
        if (activeFence.lines.length === 0) {
          refuse();
        }
        candidates.push(activeFence.lines.join("\n") + "\n");
      } else if (activeFence.tag === "text") {
        if (activeFence.lines.length === 0) {
          refuse();
        }
        harnesses.push(activeFence.lines.join("\n") + "\n");
      }
      activeFence = null;
      continue;
    }

    const malformedClose = new RegExp(`^[ \\t]*\`{${activeFence.ticks},}`);
    if (malformedClose.test(line)) {
      refuse();
    }
    activeFence.lines.push(line);
  }

  if (
    activeFence !== null ||
    candidates.length !== 1 ||
    harnesses.length !== 1
  ) {
    refuse();
  }

  const candidate = candidates[0];
  const harness = harnesses[0];
  const candidateSha256 = sha256(candidate);
  const harnessSha256 = sha256(harness);

  if (candidateSha256 !== CANDIDATE_SHA256) {
    refuse();
  }
  if (harnessSha256 !== HARNESS_SHA256) {
    refuse();
  }

  return Object.freeze({
    candidate,
    harness,
    candidateSha256,
    harnessSha256,
  });
}

export function validateCloudAuditVitestReport(rawJson, expectedFolder) {
  if (
    typeof rawJson !== "string" ||
    rawJson.length === 0 ||
    typeof expectedFolder !== "string" ||
    expectedFolder.length === 0 ||
    Buffer.byteLength(rawJson, "utf8") > MAX_REPORT_BYTES
  ) {
    refuse();
  }

  let report;
  try {
    report = JSON.parse(rawJson);
  } catch {
    refuse();
  }

  if (
    !report ||
    typeof report !== "object" ||
    Array.isArray(report) ||
    report.success !== true ||
    !Number.isSafeInteger(report.numTotalTestSuites) ||
    report.numTotalTestSuites < 1 ||
    report.numPassedTestSuites !== report.numTotalTestSuites ||
    report.numFailedTestSuites !== 0 ||
    report.numPendingTestSuites !== 0 ||
    report.numTotalTests !== EXPECTED_SYNTHETIC_TESTS ||
    report.numPassedTests !== EXPECTED_SYNTHETIC_TESTS ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    report.numTodoTests !== 0 ||
    !Array.isArray(report.testResults) ||
    report.testResults.length !== 1
  ) {
    refuse();
  }

  const suite = report.testResults[0];
  if (
    !suite ||
    typeof suite !== "object" ||
    Array.isArray(suite) ||
    suite.status !== "passed" ||
    typeof suite.name !== "string" ||
    basename(suite.name) !== "candidate.test.ts" ||
    basename(dirname(suite.name)) !== expectedFolder ||
    !Array.isArray(suite.assertionResults) ||
    suite.assertionResults.length !== EXPECTED_SYNTHETIC_TESTS
  ) {
    refuse();
  }

  for (const item of suite.assertionResults) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      item.status !== "passed" ||
      typeof item.title !== "string" ||
      item.title.length === 0 ||
      !Array.isArray(item.failureMessages) ||
      item.failureMessages.length !== 0
    ) {
      refuse();
    }
  }

  return Object.freeze({
    passedTests: EXPECTED_SYNTHETIC_TESTS,
    failedTests: 0,
    pendingTests: 0,
    todoTests: 0,
  });
}

async function runCli() {
  if (
    process.argv.length !== 2 ||
    process.versions.node !== PINNED_NODE_VERSION
  ) {
    refuse();
  }

  const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const runbookPath = join(
    repoRoot,
    "docs",
    "features",
    "cloud-audit-bounded-diagnostic.md",
  );
  const vitestCliPath = join(repoRoot, "node_modules", "vitest", "vitest.mjs");
  const scratchDir = join(repoRoot, "scratch");

  let ownedDir = null;
  let failed = false;
  let childStdout = "";
  let summary = null;

  try {
    const markdown = await readFile(runbookPath, "utf8");
    const extracted = extractCloudAuditDiagnostic(markdown);

    await mkdir(scratchDir, { recursive: true });
    ownedDir = await mkdtemp(join(scratchDir, "audit-diagnostic-ci-"));
    const folderName = basename(ownedDir);
    if (!folderName.startsWith("audit-diagnostic-ci-")) {
      refuse();
    }

    const homeDir = join(ownedDir, "home");
    const awsDir = join(homeDir, ".aws");
    const xdgConfigDir = join(homeDir, ".config");
    const tmpDir = join(ownedDir, "tmp");
    const awsConfigFile = join(awsDir, "config");
    const awsCredentialsFile = join(awsDir, "credentials");
    const candidateFile = join(ownedDir, "candidate.mjs");
    const harnessFile = join(ownedDir, "candidate.test.ts");
    const configFile = join(ownedDir, "vitest.config.ts");
    const reportFile = join(ownedDir, "report.json");

    const relTestFile = `scratch/${folderName}/candidate.test.ts`;
    const relConfigFile = `scratch/${folderName}/vitest.config.ts`;
    const relReportFile = `scratch/${folderName}/report.json`;
    const vitestConfigSource = [
      'import { defineConfig } from "vitest/config";',
      "export default defineConfig({",
      "  test: {",
      `    include: [${JSON.stringify(relTestFile)}],`,
      "    maxWorkers: 4,",
      "    reporters: [",
      '      "default",',
      `      ["json", { outputFile: ${JSON.stringify(relReportFile)} }],`,
      "    ],",
      "  },",
      "});",
      "",
    ].join("\n");

    await mkdir(homeDir, { mode: 0o700 });
    await mkdir(awsDir, { mode: 0o700 });
    await mkdir(xdgConfigDir, { mode: 0o700 });
    await mkdir(tmpDir, { mode: 0o700 });
    await writeFile(awsConfigFile, "", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(awsCredentialsFile, "", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(candidateFile, extracted.candidate, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(harnessFile, extracted.harness, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await writeFile(configFile, vitestConfigSource, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    const child = spawnSync(
      process.execPath,
      [vitestCliPath, "run", "--config", relConfigFile],
      {
        cwd: repoRoot,
        shell: false,
        windowsHide: true,
        timeout: VITEST_TIMEOUT_MS,
        maxBuffer: MAX_REPORT_BYTES,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "",
          HOME: homeDir,
          USERPROFILE: homeDir,
          XDG_CONFIG_HOME: xdgConfigDir,
          TMPDIR: tmpDir,
          TMP: tmpDir,
          TEMP: tmpDir,
          AWS_CONFIG_FILE: awsConfigFile,
          AWS_SHARED_CREDENTIALS_FILE: awsCredentialsFile,
          AWS_EC2_METADATA_DISABLED: "true",
          CI: "true",
          NO_COLOR: "1",
        },
      },
    );

    if (
      child.error !== undefined ||
      child.signal !== null ||
      child.status !== 0
    ) {
      refuse();
    }

    const rawReport = await readFile(reportFile, "utf8");
    const counts = validateCloudAuditVitestReport(rawReport, folderName);
    const rawStdout = typeof child.stdout === "string" ? child.stdout : "";
    const relativeStdout = rawStdout.replaceAll(repoRoot + "/", "");
    childStdout = relativeStdout.replaceAll(repoRoot, ".");
    summary = Object.freeze({
      kind: "cloud-audit-diagnostic-synthetic-replay",
      status: "passed",
      runtime: PINNED_NODE_VERSION,
      ...counts,
      candidateSha256: extracted.candidateSha256,
      harnessSha256: extracted.harnessSha256,
      fullCoverage: "unproven",
      auditReady: false,
      resourceWrites: 0,
    });
  } catch {
    failed = true;
  } finally {
    if (ownedDir !== null) {
      try {
        await rm(ownedDir, { recursive: true, force: true });
      } catch {
        failed = true;
      }
    }
  }

  if (failed || summary === null) {
    refuse();
  }

  if (childStdout.length > 0) {
    process.stdout.write(childStdout);
    if (!childStdout.endsWith("\n")) {
      process.stdout.write("\n");
    }
  }
  console.log(JSON.stringify(summary));
}

if (
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runCli();
  } catch {
    console.error(REFUSAL_MESSAGE);
    process.exitCode = 1;
  }
}
