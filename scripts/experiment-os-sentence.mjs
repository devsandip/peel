import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  meaningNotes,
  meaningQuestions,
} from "../tests/fixtures/meaning-corpus.ts";
const run = promisify(execFile);
const hash = createHash("sha256")
  .update(await readFile("tests/fixtures/meaning-corpus.ts"))
  .digest("hex");
if (
  process.platform !== "darwin" ||
  hash !== "8e04b40da6d95b30925a51b303e7feaed551cf5b90b7ee5f4c8a05dd069f5989"
)
  throw Error("Wrong platform or changed frozen fixture");
const directory = await mkdtemp("scratch/os-sentence-m0-");
await writeFile(
  `${directory}/fixture.json`,
  JSON.stringify({
    marker: "Peel synthetic OS sentence M0",
    sourceSHA256: hash,
    notes: meaningNotes,
    questions: meaningQuestions,
  }),
  { flag: "wx", mode: 0o600 },
);
await writeFile(
  `${directory}/synthetic.marker`,
  "Peel synthetic OS sentence M0\n",
  { flag: "wx", mode: 0o600 },
);
const compiled = await run(
  "/usr/bin/swiftc",
  [
    "-O",
    "scripts/experiment-os-sentence.swift",
    "-o",
    `${directory}/experiment`,
  ],
  { timeout: 60000, maxBuffer: 1024 * 1024 },
);
await writeFile(`${directory}/compile-stderr.log`, compiled.stderr, {
  flag: "wx",
  mode: 0o600,
});
const sandbox = "(version 1) (allow default) (deny network*)";
const result = await run(
  "/usr/bin/sandbox-exec",
  ["-p", sandbox, `${directory}/experiment`, `${directory}/fixture.json`],
  { timeout: 60000, maxBuffer: 1024 * 1024 },
);
await writeFile(`${directory}/stderr.log`, result.stderr, {
  flag: "wx",
  mode: 0o600,
});
const report = JSON.parse(result.stdout);
report.runner = {
  networkPolicy:
    "Own CLI launched with deny network* sandbox profile; no asset request API in source",
  swift: (await run("/usr/bin/swiftc", ["--version"])).stdout.trim(),
  binarySHA256: createHash("sha256")
    .update(await readFile(`${directory}/experiment`))
    .digest("hex"),
  fixtureExportSHA256: createHash("sha256")
    .update(await readFile(`${directory}/fixture.json`))
    .digest("hex"),
  boundary:
    "No AppKit/WebView/native app process, OS UI/lock change, real notes or cloud resource",
};
await writeFile(
  `${directory}/result.json`,
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
await writeFile(
  "scratch/os-sentence-result.json",
  JSON.stringify(report, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    directory,
    quality: report.quality,
    initialization: report.initialization,
    indexing: report.indexing,
    warm: report.warmQueryMs && {
      p50: report.warmQueryMs.p50,
      p95: report.warmQueryMs.p95,
      max: report.warmQueryMs.max,
    },
    memory: report.memory,
  }),
);
