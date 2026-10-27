import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { collectCloudIdentityObservation } from "../infra/cloud/identity-observations.ts";

if (process.argv.length !== 4)
  throw Error(
    "Use an explicit existing SSO profile and UTC authorization cutoff",
  );
const root = fileURLToPath(new URL("../", import.meta.url));
try {
  await promisify(execFile)(
    "git",
    [
      "check-ignore",
      "--quiet",
      "--",
      "artifacts/cloud-identity/observation.json",
    ],
    { cwd: root, timeout: 5000, maxBuffer: 1024 },
  );
} catch {
  throw Error("Private identity output must remain ignored");
}
const observed = await collectCloudIdentityObservation({
  profile: process.argv[2],
  region: "us-east-1",
  authorizedUntil: process.argv[3],
});
if (observed.kind === "unavailable") {
  console.log(
    JSON.stringify({
      kind: observed.kind,
      code: observed.code,
      identityVerified: observed.identityVerified,
      resourceWrites: 0,
    }),
  );
} else {
  const output = join(root, "artifacts", "cloud-identity");
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
      refreshProven: false,
      resourceWrites: 0,
      observationFile: relative(root, file),
    }),
  );
}
