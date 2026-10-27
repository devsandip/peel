import { writeSync } from "node:fs";
import {
  SQLiteReplicaStore,
  DurableReplica,
  newNote,
  library,
  device,
  phone,
  wall,
} from "../scratch/peer-store-node/peer-store-node.js";

const [path, scenario] = process.argv.slice(2);
let block = false;
const store = new SQLiteReplicaStore(path, () => {
  if (block) {
    writeSync(1, JSON.stringify({ stage: "transaction-open" }) + "\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
    throw new Error("Crash experiment was not terminated in time");
  }
});
const engine = new DurableReplica(store, library, device);
const input = {
  ...newNote(),
  noteId: "crash-fixture",
  bodyMarkdown: "Synthetic acknowledged crash fixture",
};
const draftScenario = scenario.startsWith("draft-");
const note = draftScenario
  ? await engine.saveDraft(input, 0, "crash-draft")
  : await engine.saveLocal(input, 0, wall, "crash-committed", [phone]);
if (scenario === "committed" || scenario === "draft-committed") {
  writeSync(1, JSON.stringify({ stage: "committed" }) + "\n");
  setInterval(() => {}, 30000);
} else if (scenario === "draft-publish-uncommitted") {
  block = true;
  await engine.publishDraft(
    note.noteId,
    "crash-draft",
    1,
    wall,
    "crash-published",
    [phone],
  );
} else if (scenario === "uncommitted") {
  block = true;
  await engine.saveLocal(
    { ...note, bodyMarkdown: "Synthetic uncommitted replacement" },
    1,
    wall + 1,
    "crash-uncommitted",
    [phone],
  );
} else throw new Error("Unknown synthetic crash scenario");
