import { readFileSync, writeSync } from "node:fs";
import { CloudRunLedger } from "../../infra/cloud/run-ledger.ts";

const request = JSON.parse(readFileSync(process.argv[2], "utf8")),
  mode = process.argv[3];
const block = (label) => {
  writeSync(1, label + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
try {
  const ledger = CloudRunLedger.open(request.directory, request.authorization);
  const result = ledger.reserve(
    request.plan,
    request.observed,
    request.expectedSnapshotSha256,
    {
      clock: () => request.now,
      ...(mode === "before-commit"
        ? { beforeCommit: () => block("prepared") }
        : {}),
      ...(mode === "after-commit"
        ? { afterCommit: () => block("committed") }
        : {}),
    },
  );
  writeSync(1, JSON.stringify({ kind: "ok", runs: result.runs.length }) + "\n");
  if (mode === "after-ack") block("acknowledged");
} catch (error) {
  writeSync(
    1,
    JSON.stringify({ kind: "error", code: error?.code ?? "unexpected" }) + "\n",
  );
}
