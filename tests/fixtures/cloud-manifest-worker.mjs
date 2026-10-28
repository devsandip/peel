import { readFileSync, writeSync } from "node:fs";
import {
  CloudRunManifestStore,
  CloudManifestStorageError,
} from "../../infra/cloud/manifest-storage.ts";
const { directory, captured, mode } = JSON.parse(readFileSync(0, "utf8"));
const pause = (checkpoint) => {
  writeSync(1, checkpoint + "\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
try {
  CloudRunManifestStore.create(directory, captured, {
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
        error instanceof CloudManifestStorageError ? error.code : "unexpected",
    }) + "\n",
  );
}
