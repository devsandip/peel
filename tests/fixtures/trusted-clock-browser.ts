import { IndexedDBReplicaStore } from "../../packages/peer-protocol/src/store-idb";
import { runTrustedClockContract } from "./trusted-clock-contract";

export async function runBrowserTrustedClockContract() {
  const suffix = [...crypto.getRandomValues(new Uint8Array(8))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  const names: string[] = [];
  try {
    return await runTrustedClockContract((name) => {
      const database = `peel-m0-peer-clocktrust-${suffix}-${name}`;
      names.push(database);
      return new IndexedDBReplicaStore(database);
    });
  } finally {
    for (const name of names)
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(name);
        deletion.onsuccess = () => resolve();
        deletion.onerror = () => reject(deletion.error);
        deletion.onblocked = () =>
          reject(Error("Synthetic database still open"));
      });
  }
}
