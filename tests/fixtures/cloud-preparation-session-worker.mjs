import { readFileSync, writeSync } from "node:fs";
import { CloudPreparationSession } from "../../infra/cloud/preparation-session.ts";
import { CloudRunLedger } from "../../infra/cloud/run-ledger.ts";
import { CloudSourceBoundJournalStore } from "../../infra/cloud/journal-sources.ts";

const { input, now } = JSON.parse(readFileSync(process.argv[2], "utf8")),
  mode = process.argv[3];
// Synthetic test clock only. The production initializer accepts no clock/callback.
Date.now = () => now;
function block(label) {
  writeSync(1, label + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
if (mode.startsWith("reserve-")) {
  const reserve = CloudRunLedger.prototype.reserve;
  CloudRunLedger.prototype.reserve = function (plan, observed, pin) {
    return reserve.call(this, plan, observed, pin, {
      ...(mode === "reserve-before"
        ? { beforeCommit: () => block("prepared") }
        : {}),
      ...(mode === "reserve-after"
        ? { afterCommit: () => block("committed") }
        : {}),
    });
  };
}
if (mode.startsWith("genesis-")) {
  const bootstrap = CloudSourceBoundJournalStore.bootstrap;
  CloudSourceBoundJournalStore.bootstrap = function (value) {
    return bootstrap(value, {
      ...(mode === "genesis-before"
        ? { beforeCommit: () => block("prepared") }
        : {}),
      ...(mode === "genesis-after"
        ? { afterCommit: () => block("committed") }
        : {}),
    });
  };
}
if (mode === "race") {
  writeSync(1, "ready\n");
  await new Promise((resolve) => process.stdin.once("data", resolve));
}
try {
  const session = CloudPreparationSession.start(input),
    value = session.read();
  writeSync(
    1,
    JSON.stringify({
      kind: "acknowledged",
      sha256: value.sha256,
      runAuthority: value.runAuthority,
      resourceWrites: value.resourceWrites,
    }) + "\n",
  );
} catch (e) {
  writeSync(
    1,
    JSON.stringify({ kind: "refused", code: e?.code ?? "unexpected" }) + "\n",
  );
}
