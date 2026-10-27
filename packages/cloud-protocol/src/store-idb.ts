import { openDB, type IDBPDatabase } from "idb";
import type { CloudClientState } from "./index";
import {
  assertCloudScope,
  cloudStateInScope,
  cloudStateWrite,
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
  type CloudStateStore,
} from "./durable";
import {
  validatePullProgress,
  validatePullWrite,
  type CloudPullStateStore,
  type CloudPullProgress,
  type CloudPageStateWrite,
} from "./pull-local";

/** Isolated M0 database. Never opens peel-local-v1 or changes application storage. */
export class IndexedDBCloudStateStore
  implements CloudStateStore, CloudPullStateStore
{
  private db: Promise<IDBPDatabase>;
  constructor(
    name: string,
    private beforeCommit?: () => void,
  ) {
    if (!/^peel-m0-cloud-[a-zA-Z0-9_-]+$/.test(name))
      throw Error("Use an isolated peel-m0-cloud- database");
    this.db = openDB(name, 2, {
      upgrade(db, oldVersion, _newVersion, tx) {
        // idb creates this promise when wrapping the upgrade transaction.
        // An intentional abort must reject the open request without leaving
        // a second unhandled rejection in the browser.
        void tx.done.catch(() => {});
        if (oldVersion === 0) {
          db.createObjectStore("meta");
          db.createObjectStore("states", { keyPath: "noteId" });
        } else {
          if (
            oldVersion !== 1 ||
            db.objectStoreNames.length !== 2 ||
            !db.objectStoreNames.contains("meta") ||
            !db.objectStoreNames.contains("states") ||
            tx.objectStore("states").keyPath !== "noteId" ||
            tx.objectStore("meta").keyPath !== null ||
            tx.objectStore("states").autoIncrement ||
            tx.objectStore("meta").autoIncrement ||
            tx.objectStore("states").indexNames.length ||
            tx.objectStore("meta").indexNames.length
          ) {
            tx.abort();
            return;
          }
          void (async () => {
            const rawScope = await tx.objectStore("meta").get("scope");
            const scope =
              rawScope === undefined ? null : validateCloudScope(rawScope);
            if ((await tx.objectStore("meta").get("pull")) !== undefined)
              throw Error("Unrecognized legacy pull metadata");
            let cursor = await tx.objectStore("states").openCursor();
            while (cursor) {
              if (!scope || cursor.value?.version !== 1)
                throw Error("Unrecognized legacy Cloud state");
              cloudStateInScope(scope, String(cursor.primaryKey), cursor.value);
              cursor = await cursor.continue();
            }
            beforeCommit?.();
          })().catch(() => {
            try {
              tx.abort();
            } catch {
              /* Already aborted. */
            }
          });
        }
      },
    }).then((db) => {
      if (
        db.objectStoreNames.length !== 2 ||
        !db.objectStoreNames.contains("meta") ||
        !db.objectStoreNames.contains("states")
      ) {
        db.close();
        throw Error("Unrecognized M0 Cloud schema");
      }
      const schema = db.transaction(["meta", "states"], "readonly");
      const meta = schema.objectStore("meta"),
        states = schema.objectStore("states");
      if (
        meta.keyPath !== null ||
        meta.autoIncrement ||
        meta.indexNames.length ||
        states.keyPath !== "noteId" ||
        states.autoIncrement ||
        states.indexNames.length
      ) {
        db.close();
        throw Error("Unrecognized M0 Cloud schema");
      }
      return db;
    });
    void this.db.catch(() => {});
  }
  async read(input: CloudScope, noteId: string) {
    const scope = validateCloudScope(input);
    validateCloudNoteId(noteId);
    const tx = (await this.db).transaction(["meta", "states"], "readonly");
    const done = tx.done;
    void done.catch(() => {});
    try {
      const rawScope = await tx.objectStore("meta").get("scope");
      const storedScope =
        rawScope === undefined ? null : validateCloudScope(rawScope);
      assertCloudScope(storedScope, scope);
      if (
        !storedScope &&
        ((await tx.objectStore("states").count()) ||
          (await tx.objectStore("meta").get("pull")) !== undefined)
      )
        throw Error("Cloud local states have no owning scope");
      const stored = await tx.objectStore("states").get(noteId);
      const state =
        stored === undefined ? null : cloudStateInScope(scope, noteId, stored);
      await done;
      return state;
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
  async commit(
    input: CloudScope,
    noteId: string,
    expectedGeneration: number | null,
    inputState: CloudClientState,
  ) {
    const scope = validateCloudScope(input);
    const next = cloudStateWrite(scope, noteId, expectedGeneration, inputState);
    const tx = (await this.db).transaction(["meta", "states"], "readwrite", {
      durability: "strict",
    });
    const done = tx.done;
    void done.catch(() => {});
    const writes: Promise<unknown>[] = [];
    try {
      const rawScope = await tx.objectStore("meta").get("scope");
      const storedScope =
        rawScope === undefined ? null : validateCloudScope(rawScope);
      assertCloudScope(storedScope, scope);
      if (
        !storedScope &&
        ((await tx.objectStore("states").count()) ||
          (await tx.objectStore("meta").get("pull")) !== undefined)
      )
        throw Error("Cloud local states have no owning scope");
      const stored = await tx.objectStore("states").get(noteId);
      const previous =
        stored === undefined ? null : cloudStateInScope(scope, noteId, stored);
      if ((previous?.generation ?? null) !== expectedGeneration) {
        tx.abort();
        await done.catch(() => {});
        return false;
      }
      if (!storedScope) writes.push(tx.objectStore("meta").put(scope, "scope"));
      writes.push(tx.objectStore("states").put(next));
      const queued = Promise.all(writes);
      void queued.catch(() => {});
      this.beforeCommit?.();
      await queued;
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
  async readPull(input: CloudScope, noteIds: string[]) {
    const scope = validateCloudScope(input),
      ids = [...noteIds];
    if (ids.length > 32 || new Set(ids).size !== ids.length)
      throw Error("Invalid Cloud page note set");
    ids.forEach(validateCloudNoteId);
    const tx = (await this.db).transaction(["meta", "states"], "readonly"),
      done = tx.done;
    void done.catch(() => {});
    try {
      const rawScope = await tx.objectStore("meta").get("scope"),
        storedScope =
          rawScope === undefined ? null : validateCloudScope(rawScope);
      assertCloudScope(storedScope, scope);
      const rawProgress = await tx.objectStore("meta").get("pull"),
        progress =
          rawProgress === undefined ? null : validatePullProgress(rawProgress);
      if (
        !storedScope &&
        (progress || (await tx.objectStore("states").count()))
      )
        throw Error("Cloud pull has no owning scope");
      const states: Record<string, CloudClientState | null> =
        Object.create(null);
      for (const id of ids) {
        const raw = await tx.objectStore("states").get(id);
        states[id] =
          raw === undefined ? null : cloudStateInScope(scope, id, raw);
      }
      await done;
      return { progress, states };
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* May have completed. */
      }
      await done.catch(() => {});
      throw error;
    }
  }
  async commitPull(
    input: CloudScope,
    expectedGeneration: number | null,
    inputProgress: CloudPullProgress,
    inputWrites: CloudPageStateWrite[],
  ) {
    const scope = validateCloudScope(input),
      { next, writes } = validatePullWrite(
        scope,
        expectedGeneration,
        inputProgress,
        inputWrites,
      );
    const tx = (await this.db).transaction(["meta", "states"], "readwrite", {
        durability: "strict",
      }),
      done = tx.done;
    void done.catch(() => {});
    const queued: Promise<unknown>[] = [];
    try {
      const rawScope = await tx.objectStore("meta").get("scope"),
        storedScope =
          rawScope === undefined ? null : validateCloudScope(rawScope);
      assertCloudScope(storedScope, scope);
      const rawProgress = await tx.objectStore("meta").get("pull"),
        previous =
          rawProgress === undefined ? null : validatePullProgress(rawProgress);
      if (
        !storedScope &&
        (previous || (await tx.objectStore("states").count()))
      )
        throw Error("Cloud pull has no owning scope");
      if ((previous?.generation ?? null) !== expectedGeneration) {
        tx.abort();
        await done.catch(() => {});
        return false;
      }
      for (const write of writes) {
        const raw = await tx.objectStore("states").get(write.noteId),
          previous =
            raw === undefined
              ? null
              : cloudStateInScope(scope, write.noteId, raw);
        if ((previous?.generation ?? null) !== write.expectedGeneration) {
          tx.abort();
          await done.catch(() => {});
          return false;
        }
      }
      if (!storedScope) queued.push(tx.objectStore("meta").put(scope, "scope"));
      for (const write of writes)
        queued.push(tx.objectStore("states").put(write.next));
      queued.push(tx.objectStore("meta").put(next, "pull"));
      const written = Promise.all(queued);
      void written.catch(() => {});
      this.beforeCommit?.();
      await written;
      await done;
      return true;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* May have aborted. */
      }
      await Promise.allSettled(queued);
      await done.catch(() => {});
      throw error;
    }
  }
}
