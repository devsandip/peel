import { readFileSync, writeSync } from "node:fs";
import { CloudSourceBoundJournalStore } from "../../infra/cloud/journal-sources.ts";
const value = JSON.parse(readFileSync(process.argv[2], "utf8")),
  mode = process.argv[3];
function block(label) {
  writeSync(1, label + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
if (mode === "race") {
  writeSync(1, "ready\n");
  await new Promise((resolve) => process.stdin.once("data", resolve));
}
try {
  const store = CloudSourceBoundJournalStore.bootstrap(value, {
    ...(mode === "before-commit"
      ? { beforeCommit: () => block("prepared") }
      : {}),
    ...(mode === "after-commit"
      ? { afterCommit: () => block("committed") }
      : {}),
  });
  const observed = store.read();
  writeSync(
    1,
    JSON.stringify({
      kind: "acknowledged",
      sha256: observed.sha256,
      runAuthority: observed.runAuthority,
    }) + "\n",
  );
} catch (error) {
  writeSync(
    1,
    JSON.stringify({ kind: "refused", code: error?.code ?? "unexpected" }) +
      "\n",
  );
}
