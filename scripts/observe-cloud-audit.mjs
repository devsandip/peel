import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { collectCloudAuditObservation } from "../infra/cloud/audit-observations.ts";

if (process.argv.length !== 4 || process.versions.node.split(".")[0] !== "24")
  throw Error(
    "Use Node 24, an explicit existing SSO profile and UTC authorization cutoff",
  );
const root = fileURLToPath(new URL("../", import.meta.url));
try {
  await promisify(execFile)(
    "git",
    ["check-ignore", "--quiet", "--", "artifacts/cloud-audit/observation.json"],
    { cwd: root, timeout: 5000, maxBuffer: 1024 },
  );
} catch {
  throw Error("Private audit output must remain ignored");
}
const observed = await collectCloudAuditObservation({
  profile: process.argv[2],
  region: "us-east-1",
  authorizedUntil: process.argv[3],
});
if (observed.kind === "unavailable") console.log(JSON.stringify(observed));
else {
  try {
    const output = join(root, "artifacts", "cloud-audit");
    await mkdir(output, { recursive: true, mode: 0o700 });
    const folder = await mkdtemp(join(output, "observed-")),
      file = join(folder, "observation.json");
    await writeFile(file, JSON.stringify(observed, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        kind: observed.kind,
        ...observed.summary,
        resourceWrites: 0,
        observationFile: relative(root, file),
      }),
    );
  } catch {
    throw Error("Private audit output unavailable");
  }
}
