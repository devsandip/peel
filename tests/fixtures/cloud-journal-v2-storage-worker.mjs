import { readFileSync, writeSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";

// This instrumentation is confined to a fresh synthetic test child, before import.
const input = JSON.parse(readFileSync(process.argv[2], "utf8")),
  mode = process.argv[3],
  sqlite = createRequire(import.meta.url)("node:sqlite"),
  Actual = sqlite.DatabaseSync;
function block(label) {
  writeSync(1, label + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
sqlite.DatabaseSync = class extends Actual {
  exec(sql) {
    if (sql === "COMMIT" && mode === "before-commit") block("prepared");
    const result = super.exec(sql);
    if (sql === "COMMIT" && mode === "after-commit") block("committed");
    return result;
  }
};
syncBuiltinESMExports();
const { CloudJournalV2InitialStore } =
  await import("../../infra/cloud/journal-v2-storage.ts");
if (mode === "race") {
  writeSync(1, "ready\n");
  await new Promise((resolve) => process.stdin.once("data", resolve));
}
try {
  const result = CloudJournalV2InitialStore.bootstrap(input).read();
  writeSync(
    1,
    JSON.stringify({
      kind: "acknowledged",
      sha256: result.sha256,
      storageVersion: result.storageVersion,
      runAuthority: result.runAuthority,
    }) + "\n",
  );
} catch (error) {
  writeSync(
    1,
    JSON.stringify({ kind: "refused", code: error?.code ?? "unexpected" }) +
      "\n",
  );
}
