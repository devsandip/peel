import { openDB, type IDBPDatabase } from "idb";
import type { ReplicaStore, Row, Change, Snapshot } from "./durable";
import {
  validateScan,
  projectMetadata,
  finishMetadataPage,
  type ScanRequest,
} from "./inventory";

/** Explicitly isolated M0 storage. Never opens peel-local-v1. */
export class IndexedDBReplicaStore implements ReplicaStore {
  private db: Promise<IDBPDatabase>;
  constructor(
    name: string,
    private beforeCommit?: () => void,
  ) {
    if (!/^peel-m0-peer-[a-zA-Z0-9_-]+$/.test(name))
      throw new Error("Use an isolated peel-m0-peer- database name");
    this.db = openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("meta");
        db.createObjectStore("rows", { keyPath: "key" }).createIndex(
          "noteId",
          "noteId",
        );
      },
    }).then((db) => {
      if (
        db.objectStoreNames.length !== 2 ||
        !db.objectStoreNames.contains("meta") ||
        !db.objectStoreNames.contains("rows")
      ) {
        db.close();
        throw new Error("Unrecognized M0 peer schema");
      }
      return db;
    });
  }
  async read(noteId: string | null, keys: string[]): Promise<Snapshot> {
    const tx = (await this.db).transaction(["meta", "rows"], "readonly");
    const revision = tx.objectStore("meta").get("revision");
    const rows = tx.objectStore("rows");
    const requests = keys.map((key) => rows.get(key));
    const related =
      noteId === null
        ? Promise.resolve([])
        : rows.index("noteId").getAll(noteId);
    const [storedRevision, relatedRows, keyedRows] = await Promise.all([
      revision,
      related,
      Promise.all(requests),
      tx.done,
    ]);
    const records = new Map<string, Row>();
    for (const row of [...relatedRows, ...keyedRows])
      if (row) records.set(row.key, row);
    return { revision: storedRevision ?? 0, rows: [...records.values()] };
  }
  async commit(expectedRevision: number, changes: Change[]) {
    const tx = (await this.db).transaction(["meta", "rows"], "readwrite", {
      durability: "strict",
    });
    const writes: Promise<unknown>[] = [];
    const done = tx.done;
    void done.catch(() => {});
    try {
      const current = (await tx.objectStore("meta").get("revision")) ?? 0;
      if (current !== expectedRevision) {
        tx.abort();
        await tx.done.catch(() => {});
        return false;
      }
      if (!Number.isSafeInteger(current + 1))
        throw new Error("Peer store revision exhausted");
      for (const c of changes) {
        if (c.row) {
          if (c.row.key !== c.key) throw new Error("Peer store key mismatch");
          writes.push(tx.objectStore("rows").put(c.row));
        } else writes.push(tx.objectStore("rows").delete(c.key));
      }
      writes.push(tx.objectStore("meta").put(current + 1, "revision"));
      const written = Promise.all(writes);
      void written.catch(() => {});
      this.beforeCommit?.();
      await written;
      await done;
      return true;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* It may already have aborted. */
      }
      await Promise.allSettled(writes);
      await done.catch(() => {});
      throw error;
    }
  }
  async close() {
    (await this.db).close();
  }
  async scan(request: ScanRequest) {
    request = structuredClone(request);
    const { prefix, end } = validateScan(request);
    const tx = (await this.db).transaction(["meta", "rows"], "readonly");
    const done = tx.done;
    void done.catch(() => {});
    try {
      const revision = tx.objectStore("meta").get("revision");
      const identity = tx.objectStore("rows").get("meta/identity");
      const range = IDBKeyRange.bound(
        request.after ?? prefix,
        end,
        request.after !== null,
        true,
      );
      let cursor = await tx.objectStore("rows").openCursor(range);
      const rows: Row[] = [];
      let scanned = 0,
        lastKey: string | null = null;
      while (cursor && scanned < request.limit) {
        const row = projectMetadata(request, cursor.value);
        if (row) rows.push(row);
        lastKey = String(cursor.key);
        scanned++;
        cursor = await cursor.continue();
      }
      const page = finishMetadataPage(
        (await revision) ?? 0,
        await identity,
        rows,
        scanned,
        cursor ? lastKey : null,
      );
      await done;
      return page;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* It may have completed. */
      }
      await done.catch(() => {});
      throw error;
    }
  }
}
