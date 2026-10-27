import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// AWS's official download, pinned by content. A runtime update requires review.
const url =
  "https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz";
const sha256 =
  "7a94eb65f81aee270738751a4e5e3e6a7ad02a5d25194f55b83e08ec2ba6342b";
const folder = await mkdtemp(join(tmpdir(), "peel-synthetic-dynamodb-"));
let runtime, tests;
const controller = new AbortController();
const stop = () => {
  controller.abort();
  runtime?.kill("SIGTERM");
  tests?.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  const response = await fetch(url, {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]),
  });
  if (!response.ok) throw Error("DynamoDB Local download failed");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 100 * 1024 * 1024)
      throw Error("DynamoDB Local download exceeds bound");
    chunks.push(chunk);
  }
  const archive = Buffer.concat(chunks);
  if (createHash("sha256").update(archive).digest("hex") !== sha256)
    throw Error(
      "DynamoDB Local checksum changed; review the new runtime before testing",
    );
  const archivePath = join(folder, "runtime.tar.gz");
  await writeFile(archivePath, archive);
  execFileSync("tar", ["-xzf", archivePath, "-C", folder]);
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  const endpoint = `http://127.0.0.1:${port}`;
  runtime = spawn(
    "java",
    [
      `-Djava.library.path=${join(folder, "DynamoDBLocal_lib")}`,
      "-jar",
      join(folder, "DynamoDBLocal.jar"),
      "-inMemory",
      "-sharedDb",
      "-disableTelemetry",
      "-port",
      String(port),
    ],
    { cwd: folder, stdio: "ignore" },
  );
  let runtimeError;
  runtime.once("error", (error) => {
    runtimeError = error;
  });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    controller.signal.throwIfAborted();
    if (
      runtimeError ||
      runtime.exitCode !== null ||
      runtime.signalCode !== null
    )
      throw Error(
        "DynamoDB Local failed to start; Java 17 or newer is required",
      );
    try {
      await fetch(endpoint, { signal: AbortSignal.timeout(200) });
      ready = true;
      break;
    } catch {}
    await delay(100);
  }
  if (!ready) throw Error("DynamoDB Local startup timed out");
  console.log(
    "DynamoDB Local 3.3.2: checksum verified, telemetry off, disposable in-memory tables",
  );
  tests = spawn(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "vitest.dynamodb.config.ts",
    ],
    {
      stdio: "inherit",
      env: { ...process.env, PEEL_DYNAMODB_ENDPOINT: endpoint },
    },
  );
  const [code] = await once(tests, "exit");
  if (code !== 0) throw Error("DynamoDB Local integration tests failed");
} finally {
  if (runtime && runtime.exitCode === null && runtime.signalCode === null) {
    runtime.kill("SIGTERM");
    await once(runtime, "exit");
  }
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  await rm(folder, { recursive: true, force: true });
}
