import { readFileSync, writeSync } from "node:fs";
import {
  CloudRunContextStore,
  CloudContextStorageError,
} from "../../infra/cloud/run-context-storage.ts";
const { directory, value, mode } = JSON.parse(readFileSync(0, "utf8"));
const pause = (checkpoint) => {
  writeSync(1, checkpoint + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
try {
  CloudRunContextStore.create(directory, value, {
    beforeCommit: () => {
      if (mode === "before-commit") pause("prepared");
    },
    afterCommit: () => {
      if (mode === "after-commit") pause("committed");
    },
  });
  if (mode === "after-ack") pause("acknowledged");
  writeSync(1, '{"kind":"ok"}\n');
} catch (error) {
  writeSync(
    1,
    JSON.stringify({
      kind: "error",
      code:
        error instanceof CloudContextStorageError ? error.code : "unexpected",
    }) + "\n",
  );
}
