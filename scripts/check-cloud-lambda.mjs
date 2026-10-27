import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";
import { buildCloudLambda } from "./build-cloud-lambda.mjs";

assert.equal(
  process.versions.node.split(".")[0],
  "24",
  "Use Node 24 for smoke",
);
const first = await buildCloudLambda(),
  second = await buildCloudLambda();
assert.deepEqual(first.zip, second.zip, "ZIP must reproduce byte for byte");
assert.deepEqual(first.manifest, second.manifest);
const published = await readFile(
  new URL("../artifacts/cloud-lambda/cloud-lambda.zip", import.meta.url),
);
assert.deepEqual(
  new Uint8Array(published),
  first.zip,
  "Built artifact must match verified source",
);
assert.deepEqual(
  JSON.parse(
    await readFile(
      new URL("../artifacts/cloud-lambda/manifest.json", import.meta.url),
    ),
  ),
  first.manifest,
);
const directory = await realpath(
  await mkdtemp(join(tmpdir(), "peel-cloud-artifact-")),
);
try {
  const files = unzipSync(published);
  assert.ok(files["handler.cjs"]);
  assert.ok(files["THIRD_PARTY_NOTICES.txt"]);
  for (const [name, content] of Object.entries(files)) {
    assert.ok(
      [
        "handler.cjs",
        "handler.cjs.LEGAL.txt",
        "THIRD_PARTY_NOTICES.txt",
      ].includes(name),
    );
    assert.equal(
      createHash("sha256").update(content).digest("hex"),
      first.manifest.files[name],
    );
    await writeFile(join(directory, name), content, { mode: 0o644 });
  }
  await writeFile(
    join(directory, "smoke.cjs"),
    await readFile(new URL("./cloud-lambda-smoke-child.cjs", import.meta.url)),
  );
  for (const mode of ["missing", "invalid", "valid"]) {
    const child = spawnSync(
      process.execPath,
      ["--permission", "--allow-fs-read=" + directory, "smoke.cjs", mode],
      {
        cwd: directory,
        timeout: 15000,
        maxBuffer: 4096,
        encoding: "utf8",
        env: {
          AWS_ACCESS_KEY_ID: "syntheticlocalkey",
          AWS_SECRET_ACCESS_KEY: "syntheticlocalkey",
          AWS_EC2_METADATA_DISABLED: "true",
          AWS_SHARED_CREDENTIALS_FILE: join(directory, "absent-credentials"),
          AWS_CONFIG_FILE: join(directory, "absent-config"),
        },
      },
    );
    assert.equal(child.error, undefined, "Packaged subprocess must complete");
    assert.equal(child.status, 0, "Packaged subprocess must pass");
    assert.equal(child.stderr, "", "No runtime warnings or private errors");
    assert.equal(child.stdout, "packaged-" + mode + "-passed\n");
  }
  console.log(
    JSON.stringify({
      runtime: process.version,
      deterministicZip: true,
      isolatedPackagedModes: 3,
      networkAttempts: 0,
      zipBytes: first.manifest.zipBytes,
      zipSha256: first.manifest.zipSha256,
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
