import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CANDIDATE_SHA256,
  EXPECTED_SYNTHETIC_TESTS,
  HARNESS_SHA256,
  REFUSAL_MESSAGE,
  extractCloudAuditDiagnostic,
  validateCloudAuditVitestReport,
} from "../../scripts/check-cloud-audit-diagnostic.mjs";

const PINNED_CANDIDATE_SHA256 =
  "918a9f49d574da9b7f6d5c4c5dc385eb67debaf46bbfe83b259e4b6fc6b9437c";
const PINNED_HARNESS_SHA256 =
  "1a38efac554b006ffc911dbd8ef76a9bfb6cd862b7cbc7a4d395c5a467621ad5";
const FIXED_REFUSAL = "Cloud audit diagnostic synthetic replay unavailable";
const RUNBOOK_URL = new URL(
  "../../docs/features/cloud-audit-bounded-diagnostic.md",
  import.meta.url,
);

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function replaceOnce(source, target, replacement) {
  const first = source.indexOf(target);
  const end = first + target.length;
  assert.notEqual(first, -1);
  assert.equal(source.indexOf(target, end), -1);
  const updated = source.slice(0, first) + replacement + source.slice(end);
  assert.notEqual(updated, source);
  return updated;
}

function assertRefused(action, forbidden = []) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, FIXED_REFUSAL);
    assert.equal(error.cause, undefined);
    assert.equal("cause" in error, false);
    for (const secret of forbidden) {
      assert.equal(error.message.includes(secret), false);
    }
    return true;
  });
}

function makeReport(folderName = "audit-diagnostic-ci-abc123") {
  const assertionResults = Array.from({ length: 28 }, (_, index) => ({
    ancestorTitles: [],
    fullName: `synthetic case ${index + 1}`,
    status: "passed",
    title: `synthetic case ${index + 1}`,
    duration: 1,
    failureMessages: [],
  }));
  return {
    numTotalTestSuites: 1,
    numPassedTestSuites: 1,
    numFailedTestSuites: 0,
    numPendingTestSuites: 0,
    numTotalTests: 28,
    numPassedTests: 28,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    success: true,
    testResults: [
      {
        assertionResults,
        startTime: 1,
        endTime: 2,
        status: "passed",
        message: "",
        name: `/repo/scratch/${folderName}/candidate.test.ts`,
      },
    ],
  };
}

test("extracts canonical candidate and synthetic harness", async () => {
  const canonical = await readFile(RUNBOOK_URL, "utf8");
  assert.ok(canonical.includes("````python\n"));
  assert.ok(canonical.includes('parts = source.split("```javascript\\n")'));
  assert.ok(canonical.includes('parts = source.split("```text\\n")'));

  assert.equal(CANDIDATE_SHA256, PINNED_CANDIDATE_SHA256);
  assert.equal(HARNESS_SHA256, PINNED_HARNESS_SHA256);
  assert.equal(EXPECTED_SYNTHETIC_TESTS, 28);
  assert.equal(REFUSAL_MESSAGE, FIXED_REFUSAL);

  const extracted = extractCloudAuditDiagnostic(canonical);
  assert.equal(Object.isFrozen(extracted), true);
  assert.equal(extracted.candidateSha256, PINNED_CANDIDATE_SHA256);
  assert.equal(extracted.harnessSha256, PINNED_HARNESS_SHA256);
  assert.equal(sha256(extracted.candidate), PINNED_CANDIDATE_SHA256);
  assert.equal(sha256(extracted.harness), PINNED_HARNESS_SHA256);

  const candidateHeader = 'import childProcess from "node:child_process";\n';
  const harnessHeader = 'import cp from "node:child_process";\n';
  const harnessImport = 'import { diagnose } from "./candidate.mjs";';
  assert.ok(extracted.candidate.startsWith(candidateHeader));
  assert.ok(extracted.candidate.endsWith("\n"));
  assert.equal(extracted.candidate.includes("```"), false);
  assert.ok(extracted.harness.startsWith(harnessHeader));
  assert.ok(extracted.harness.includes(harnessImport));
  assert.ok(extracted.harness.endsWith("\n"));
  assert.equal(extracted.harness.includes("```"), false);
});

test("refuses changed candidate bytes with fixed public error", async () => {
  const canonical = await readFile(RUNBOOK_URL, "utf8");
  const originalTarget =
    'Object.freeze(["us-east-1", "us-west-2", "af-south-1"])';
  const tamperedTarget =
    'Object.freeze(["us-east-1", "us-west-2", "eu-west-1"])';
  const tampered = replaceOnce(canonical, originalTarget, tamperedTarget);
  const secrets = ["eu-west-1", "af-south-1", PINNED_CANDIDATE_SHA256];
  assertRefused(() => extractCloudAuditDiagnostic(tampered), secrets);
});

test("refuses changed harness bytes with fixed public error", async () => {
  const canonical = await readFile(RUNBOOK_URL, "utf8");
  const originalClock = 'Date.parse("2026-10-31T01:00:00.000Z")';
  const tamperedClock = 'Date.parse("2026-10-31T02:00:00.000Z")';
  const tampered = replaceOnce(canonical, originalClock, tamperedClock);
  const secrets = ["2026-10-31T02:00:00.000Z", PINNED_HARNESS_SHA256];
  assertRefused(() => extractCloudAuditDiagnostic(tampered), secrets);
});

test("refuses missing or duplicate blocks", async () => {
  const canonical = await readFile(RUNBOOK_URL, "utf8");
  const extracted = extractCloudAuditDiagnostic(canonical);

  const noJs = replaceOnce(canonical, "\n```javascript\n", "\n```js\n");
  assertRefused(() => extractCloudAuditDiagnostic(noJs));

  const noText = replaceOnce(canonical, "\n```text\n", "\n```txt\n");
  assertRefused(() => extractCloudAuditDiagnostic(noText));

  const untaggedJs = replaceOnce(canonical, "\n```javascript\n", "\n```\n");
  assertRefused(() => extractCloudAuditDiagnostic(untaggedJs));

  const extraJs = "\n```javascript\n" + extracted.candidate + "```\n";
  const extraText = "\n```text\n" + extracted.harness + "```\n";
  assertRefused(() => extractCloudAuditDiagnostic(canonical + extraJs));
  assertRefused(() => extractCloudAuditDiagnostic(canonical + extraText));
});

test("refuses unterminated or malformed fences", async () => {
  const canonical = await readFile(RUNBOOK_URL, "utf8");

  const candidateEnd = "  console.log(JSON.stringify(value));\n}\n```\n";
  const unclosedJs = replaceOnce(
    canonical,
    candidateEnd,
    "  console.log(JSON.stringify(value));\n}\n",
  );
  assertRefused(() => extractCloudAuditDiagnostic(unclosedJs));

  const textEnd = "safe(result);\n});\n```";
  const unclosedText = replaceOnce(canonical, textEnd, "safe(result);\n});");
  assertRefused(() => extractCloudAuditDiagnostic(unclosedText));

  const pythonEnd =
    "print(hashlib.sha256(target.read_bytes()).hexdigest())\n````\n";
  const unclosedPython = replaceOnce(
    canonical,
    pythonEnd,
    "print(hashlib.sha256(target.read_bytes()).hexdigest())\n",
  );
  assertRefused(() => extractCloudAuditDiagnostic(unclosedPython));

  const quadJsOpen = replaceOnce(
    canonical,
    "\n```javascript\n",
    "\n````javascript\n",
  );
  const quadJs = replaceOnce(
    quadJsOpen,
    candidateEnd,
    "  console.log(JSON.stringify(value));\n}\n````\n",
  );
  assertRefused(() => extractCloudAuditDiagnostic(quadJs));

  const quadTextOpen = replaceOnce(canonical, "\n```text\n", "\n````text\n");
  const quadText = replaceOnce(
    quadTextOpen,
    textEnd,
    "safe(result);\n});\n````",
  );
  assertRefused(() => extractCloudAuditDiagnostic(quadText));

  const extraTokens = ["private-extra"];
  const extraJsInfo = replaceOnce(
    canonical,
    "\n```javascript\n",
    "\n```javascript private-extra\n",
  );
  assertRefused(() => extractCloudAuditDiagnostic(extraJsInfo), extraTokens);

  const badTextInfo = replaceOnce(
    canonical,
    "\n```text\n",
    "\n```text private-extra\n",
  );
  assertRefused(() => extractCloudAuditDiagnostic(badTextInfo), extraTokens);

  const indentedJs = replaceOnce(
    canonical,
    "\n```javascript\n",
    "\n  ```javascript\n",
  );
  assertRefused(() => extractCloudAuditDiagnostic(indentedJs));

  const tildeJsOpen = replaceOnce(
    canonical,
    "\n```javascript\n",
    "\n~~~javascript\n",
  );
  const tildeJs = replaceOnce(
    tildeJsOpen,
    candidateEnd,
    "  console.log(JSON.stringify(value));\n}\n~~~\n",
  );
  assertRefused(() => extractCloudAuditDiagnostic(tildeJs));

  const badJsClose = replaceOnce(
    canonical,
    candidateEnd,
    "  console.log(JSON.stringify(value));\n}\n````\n",
  );
  assertRefused(() => extractCloudAuditDiagnostic(badJsClose));
});

test("refuses invalid types, crlf, nul, and oversized input", async () => {
  const canonical = await readFile(RUNBOOK_URL, "utf8");
  for (const invalid of [undefined, null, false, 42, {}, [], ""]) {
    assertRefused(() => extractCloudAuditDiagnostic(invalid));
  }
  const crlf = canonical.replaceAll("\n", "\r\n");
  assertRefused(() => extractCloudAuditDiagnostic(crlf));
  assertRefused(() => extractCloudAuditDiagnostic(canonical + "\0"));
  const oversized = "a".repeat(512 * 1024 + 1);
  assertRefused(() => extractCloudAuditDiagnostic(oversized));
});

test("validates structured 28-case Vitest JSON report strictly", () => {
  const folder = "audit-diagnostic-ci-abc123";
  const validJson = JSON.stringify(makeReport(folder));
  const counts = validateCloudAuditVitestReport(validJson, folder);
  assert.equal(Object.isFrozen(counts), true);
  assert.deepEqual(counts, {
    passedTests: 28,
    failedTests: 0,
    pendingTests: 0,
    todoTests: 0,
  });

  const jsonSecret = ["private-json"];
  for (const badRaw of [undefined, null, "", "{private-json"]) {
    const runBad = () => validateCloudAuditVitestReport(badRaw, folder);
    assertRefused(runBad, jsonSecret);
  }
  assertRefused(() => validateCloudAuditVitestReport(validJson, ""));
  assertRefused(() => validateCloudAuditVitestReport(validJson, "other-dir"));

  const zeroTests = {
    ...makeReport(folder),
    numTotalTests: 0,
    numPassedTests: 0,
  };
  zeroTests.testResults[0].assertionResults = [];
  const zeroJson = JSON.stringify(zeroTests);
  assertRefused(() => validateCloudAuditVitestReport(zeroJson, folder));

  const shortTests = {
    ...makeReport(folder),
    numTotalTests: 27,
    numPassedTests: 27,
  };
  shortTests.testResults[0].assertionResults.pop();
  const shortJson = JSON.stringify(shortTests);
  assertRefused(() => validateCloudAuditVitestReport(shortJson, folder));

  const failedCase = makeReport(folder);
  failedCase.success = false;
  failedCase.numPassedTests = 27;
  failedCase.numFailedTests = 1;
  failedCase.testResults[0].status = "failed";
  failedCase.testResults[0].assertionResults[0].status = "failed";
  failedCase.testResults[0].assertionResults[0].failureMessages = [
    "private failure detail",
  ];
  const failedJson = JSON.stringify(failedCase);
  const runFail = () => validateCloudAuditVitestReport(failedJson, folder);
  assertRefused(runFail, ["private failure detail"]);

  const skippedCase = makeReport(folder);
  skippedCase.numPassedTests = 27;
  skippedCase.numPendingTests = 1;
  skippedCase.testResults[0].assertionResults[0].status = "skipped";
  const skippedJson = JSON.stringify(skippedCase);
  assertRefused(() => validateCloudAuditVitestReport(skippedJson, folder));

  const todoCase = makeReport(folder);
  todoCase.numPassedTests = 27;
  todoCase.numTodoTests = 1;
  todoCase.testResults[0].assertionResults[0].status = "todo";
  const todoJson = JSON.stringify(todoCase);
  assertRefused(() => validateCloudAuditVitestReport(todoJson, folder));
});
