import { writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
const [modulePath, path, scenario] = process.argv.slice(2);
const {
  SQLiteCloudServerStore,
  CloudMutationService,
  mutationHash,
  cloudDraft,
  cloudScope,
} = await import(pathToFileURL(modulePath).href);
let block = false;
const store = new SQLiteCloudServerStore(path, () => {
  if (block) {
    writeSync(1, JSON.stringify({ stage: "transaction-open" }) + "\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
    throw Error("Synthetic server crash child was not terminated");
  }
});
await store.seedAccount({
  version: 1,
  ownerSubject: cloudScope.ownerSubject,
  collectionId: cloudScope.collectionId,
  modeGeneration: 1,
  status: "active",
  entitlement: "active",
  revision: 1,
  sequence: 0,
  wall: 0,
});
const service = new CloudMutationService(store, () => 1800000000000);
const make = async (opId, baseRevision, snapshot) => {
  const payload = {
    version: 1,
    opId,
    noteId: "synthetic-note",
    baseRevision,
    kind: snapshot ? "upsert" : "purge",
    snapshot,
  };
  return {
    version: 1,
    collectionId: cloudScope.collectionId,
    modeGeneration: 1,
    mutation: { ...payload, contentHash: await mutationHash(payload) },
  };
};
await service.mutate(
  cloudScope.ownerSubject,
  await make(
    "server-crash-op-1",
    0,
    cloudDraft("Synthetic committed server source"),
  ),
);
if (scenario === "committed")
  writeSync(1, JSON.stringify({ stage: "committed" }) + "\n");
else if (
  scenario === "update-uncommitted" ||
  scenario === "purge-uncommitted"
) {
  block = true;
  await service.mutate(
    cloudScope.ownerSubject,
    await make(
      "server-crash-op-2",
      1,
      scenario === "purge-uncommitted"
        ? null
        : cloudDraft("Synthetic uncommitted server source"),
    ),
  );
} else throw Error("Unknown synthetic server crash scenario");
setInterval(() => {}, 30000);
