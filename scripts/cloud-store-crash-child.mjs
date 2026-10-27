import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [modulePath, databasePath, scenario] = process.argv.slice(2);
const {
  SQLiteCloudStateStore,
  DurableCloudClient,
  cloudScope,
  cloudDraft,
  cloudAck,
  DurableCloudPull,
  cloudScopeHash,
} = await import(pathToFileURL(modulePath).href);
let block = false;
const store = new SQLiteCloudStateStore(databasePath, () => {
  if (block) {
    writeSync(1, JSON.stringify({ stage: "transaction-open" }) + "\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
    throw Error("Synthetic crash child was not terminated");
  }
});
const repo = new DurableCloudClient(store, cloudScope);
const saved = await repo.save(
  "synthetic-note",
  { kind: "upsert", snapshot: cloudDraft("Synthetic committed Cloud draft") },
  null,
);
if (scenario === "pull-uncommitted" || scenario === "pull-committed") {
  const pull = new DurableCloudPull(store, cloudScope),
    scopeHash = await cloudScopeHash(cloudScope),
    roundId = "5".repeat(32);
  await pull.begin(
    {
      version: 1,
      kind: "bootstrap",
      scopeHash,
      roundId,
      fromSequence: 0,
      upperSequence: null,
      next: { kind: "heads", token: "crash-heads" },
    },
    null,
  );
  await pull.apply({
    version: 1,
    kind: "heads",
    scopeHash,
    roundId,
    from: "crash-heads",
    fromSequence: 0,
    upperSequence: 2,
    throughSequence: 0,
    heads: [],
    next: { kind: "changes", token: "crash-page" },
    checkpoint: null,
  });
  block = scenario === "pull-uncommitted";
  await pull.apply({
    version: 1,
    kind: "changes",
    scopeHash,
    roundId,
    from: "crash-page",
    fromSequence: 0,
    upperSequence: 2,
    throughSequence: 2,
    heads: ["synthetic-note", "synthetic-downloaded"].map((noteId) => ({
      kind: "note",
      noteId,
      revision: 1,
      snapshot: {
        ...cloudDraft("Synthetic downloaded head"),
        noteId,
        serverRevision: 1,
      },
    })),
    next: null,
    checkpoint: "crash-checkpoint",
  });
  writeSync(1, JSON.stringify({ stage: "committed" }) + "\n");
} else if (scenario === "prepare-uncommitted") {
  block = true;
  await repo.prepare("synthetic-note", saved.generation, "crash-op");
} else if (scenario === "draft-committed") {
  writeSync(1, JSON.stringify({ stage: "committed" }) + "\n");
} else if (scenario === "ack-uncommitted" || scenario === "ack-committed") {
  const prepared = await repo.prepare(
    "synthetic-note",
    saved.generation,
    "crash-op",
  );
  await repo.save(
    "synthetic-note",
    { kind: "upsert", snapshot: cloudDraft("Synthetic later Cloud draft") },
    prepared.generation,
  );
  block = scenario === "ack-uncommitted";
  await repo.acknowledge("synthetic-note", cloudAck(prepared));
  writeSync(1, JSON.stringify({ stage: "committed" }) + "\n");
} else throw Error("Unknown synthetic Cloud crash scenario");
setInterval(() => {}, 30000);
