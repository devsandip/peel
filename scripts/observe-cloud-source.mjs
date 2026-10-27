import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { buildCloudLambda } from "./build-cloud-lambda.mjs";
import { collectCloudSourceObservation } from "../infra/cloud/source-observations.ts";

if (process.argv.length !== 2 || process.versions.node.split(".")[0] !== "24")
  throw Error("Cloud source observation requires Node 24 and no arguments");
const root = fileURLToPath(new URL("../", import.meta.url));
try {
  await promisify(execFile)(
    "git",
    [
      "check-ignore",
      "--quiet",
      "--",
      "artifacts/cloud-source/observation.json",
    ],
    { cwd: root, timeout: 5000, maxBuffer: 1024 },
  );
} catch {
  throw Error("Cloud source output must remain ignored");
}
const result = await collectCloudSourceObservation(
  { runId: randomUUID() },
  { build: buildCloudLambda },
);
if (result.kind === "unavailable") console.log(JSON.stringify(result));
else {
  try {
    const output = join(root, "artifacts", "cloud-source");
    await mkdir(output, { recursive: true, mode: 0o700 });
    const folder = await mkdtemp(join(output, "observed-"));
    for (const [name, data] of [
      ["observation.json", JSON.stringify(result.observation, null, 2) + "\n"],
      ["cloud-lambda.zip", result.zip],
      ["templates.json", result.templates],
    ])
      await writeFile(join(folder, name), data, { flag: "wx", mode: 0o600 });
    console.log(
      JSON.stringify({
        kind: result.kind,
        sourceVerified: true,
        checksVerified: true,
        reproducibleArtifact: true,
        resourceWrites: 0,
        observationFile: relative(root, join(folder, "observation.json")),
      }),
    );
  } catch {
    throw Error("Cloud source output unavailable");
  }
}
