import { readFileSync, writeSync } from "node:fs";
import { CloudJournalGenesisStore } from "../../infra/cloud/journal-storage.ts";

const input = JSON.parse(readFileSync(process.argv[2], "utf8")),
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
  const store = CloudJournalGenesisStore.bootstrap(input, {
    ...(mode === "before-commit"
      ? { beforeCommit: () => block("prepared") }
      : {}),
    ...(mode === "after-commit"
      ? { afterCommit: () => block("committed") }
      : {}),
  });
  writeSync(
    1,
    JSON.stringify({
      kind: "acknowledged",
      sha256: store.read().sha256,
      runAuthority: store.read().runAuthority,
    }) + "\n",
  );
} catch (error) {
  writeSync(
    1,
    JSON.stringify({ kind: "refused", code: error?.code ?? "unexpected" }) +
      "\n",
  );
}
