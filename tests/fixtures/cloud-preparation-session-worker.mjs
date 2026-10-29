import { readFileSync, writeSync } from "node:fs";
import { CloudPreparationSession } from "../../infra/cloud/preparation-session.ts";
import { CloudRunLedger } from "../../infra/cloud/run-ledger.ts";
import { CloudLedgerStore } from "../../infra/cloud/ledger-store.ts";
import { CloudSourceBoundJournalStore } from "../../infra/cloud/journal-sources.ts";

const { input, now } = JSON.parse(readFileSync(process.argv[2], "utf8")),
  mode = process.argv[3];
// Synthetic test clock only. The production initializer accepts no clock/callback.
Date.now = () => now;
function block(label) {
  writeSync(1, label + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
}
function untilEOF(label) {
  writeSync(1, label + "\n");
  // Raw stdin is never wrapped as an async stream in these two test modes.
  // EOF remains observable even if the parent releases before this read starts.
  readFileSync(0);
}
if (mode.startsWith("reserve-") || mode === "race-writer") {
  const reserve = CloudRunLedger.prototype.reserve;
  CloudRunLedger.prototype.reserve = function (plan, observed, pin) {
    return reserve.call(this, plan, observed, pin, {
      ...(mode === "reserve-before"
        ? { beforeCommit: () => block("prepared") }
        : {}),
      ...(mode === "reserve-after"
        ? { afterCommit: () => block("committed") }
        : {}),
      ...(mode === "race-writer"
        ? { beforeCommit: () => untilEOF("prepared") }
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
function result() {
  try {
    const session = CloudPreparationSession.start(input),
      value = session.read();
    return {
      kind: "acknowledged",
      sha256: value.sha256,
      runAuthority: value.runAuthority,
      resourceWrites: value.resourceWrites,
    };
  } catch (e) {
    return { kind: "refused", code: e?.code ?? "unexpected" };
  }
}
try {
  const value =
    mode === "race-reader"
      ? CloudLedgerStore.open(input.ledgerDirectory, input.authority).use(
          false,
          (db) => {
            db.exec("BEGIN");
            try {
              db.prepare("SELECT slot FROM reservations").all();
              untilEOF("reader-open");
              return result();
            } finally {
              db.exec("ROLLBACK");
            }
          },
        )
      : result();
  writeSync(1, JSON.stringify(value) + "\n");
} catch (e) {
  writeSync(
    1,
    JSON.stringify({ kind: "refused", code: e?.code ?? "unexpected" }) + "\n",
  );
}
