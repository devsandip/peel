import { DatabaseSync } from "node:sqlite";
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
import {
  CloudLibraryPageBuilder,
  type CloudLibraryStateStore,
  type CloudLibraryRequest,
} from "./library-local";

/** Node M0 SQLite adapter. It never opens the native application's schema. */
export class SQLiteCloudStateStore
  implements CloudStateStore, CloudPullStateStore, CloudLibraryStateStore
{
  private db: DatabaseSync;
  constructor(
    path: string,
    private beforeCommit?: () => void,
  ) {
    this.db = new DatabaseSync(path);
    try {
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();
      if (
        tables.some(
          (row) =>
            !["m0_cloud_meta", "m0_cloud_states"].includes(String(row.name)),
        )
      )
        throw Error("Refusing to modify a non-M0 Cloud database");
      const previousSchema =
        tables.length === 2
          ? this.db.prepare("SELECT schema FROM m0_cloud_meta WHERE id=1").get()
              ?.schema
          : null;
      if (
        tables.length &&
        (tables.length !== 2 || ![1, 2].includes(Number(previousSchema)))
      )
        throw Error("Unrecognized M0 Cloud schema");
      if (previousSchema === 1) {
        const meta = this.db
          .prepare("SELECT scope FROM m0_cloud_meta WHERE id=1")
          .get();
        const scope =
          meta?.scope === null
            ? null
            : validateCloudScope(JSON.parse(String(meta?.scope)));
        for (const row of this.db
          .prepare("SELECT note_id,generation,state FROM m0_cloud_states")
          .iterate()) {
          const raw = JSON.parse(String(row.state));
          if (
            !scope ||
            raw?.version !== 1 ||
            cloudStateInScope(scope, String(row.note_id), raw).generation !==
              row.generation
          )
            throw Error("Unrecognized legacy Cloud state");
        }
      }
      this.db
        .exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS m0_cloud_meta(id INTEGER PRIMARY KEY CHECK(id=1), schema INTEGER NOT NULL, scope TEXT, pull_state TEXT);
        INSERT OR IGNORE INTO m0_cloud_meta(id,schema,scope) VALUES(1,2,NULL);
        CREATE TABLE IF NOT EXISTS m0_cloud_states(note_id TEXT PRIMARY KEY, generation INTEGER NOT NULL, state TEXT NOT NULL);
        `);
      if (previousSchema === 1) {
        this.db.exec(
          "ALTER TABLE m0_cloud_meta ADD COLUMN pull_state TEXT; UPDATE m0_cloud_meta SET schema=2 WHERE id=1;",
        );
        this.beforeCommit?.();
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* No transaction may be active. */
      }
      this.db.close();
      throw error;
    }
  }
  private checkScope(scope: CloudScope) {
    const meta = this.db
      .prepare("SELECT schema,scope,pull_state FROM m0_cloud_meta WHERE id=1")
      .get();
    if (!meta || meta.schema !== 2) throw Error("Unrecognized M0 Cloud schema");
    const stored =
      meta.scope === null
        ? null
        : validateCloudScope(JSON.parse(String(meta.scope)));
    assertCloudScope(stored, scope);
    if (
      !stored &&
      (this.db.prepare("SELECT 1 FROM m0_cloud_states LIMIT 1").get() ||
        meta.pull_state !== null)
    )
      throw Error("Cloud local states have no owning scope");
    return stored;
  }
  private state(scope: CloudScope, noteId: string): CloudClientState | null {
    const row = this.db
      .prepare("SELECT generation,state FROM m0_cloud_states WHERE note_id=?")
      .get(noteId);
    if (!row) return null;
    const state = cloudStateInScope(
      scope,
      noteId,
      JSON.parse(String(row.state)),
    );
    if (row.generation !== state.generation)
      throw Error("Cloud local row generation mismatch");
    return state;
  }
  async read(input: CloudScope, noteId: string) {
    const scope = validateCloudScope(input);
    validateCloudNoteId(noteId);
    this.db.exec("BEGIN");
    try {
      this.checkScope(scope);
      const state = this.state(scope, noteId);
      this.db.exec("COMMIT");
      return state;
    } catch (error) {
      this.db.exec("ROLLBACK");
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const storedScope = this.checkScope(scope);
      const previous = this.state(scope, noteId);
      if ((previous?.generation ?? null) !== expectedGeneration) {
        this.db.exec("ROLLBACK");
        return false;
      }
      if (!storedScope)
        this.db
          .prepare("UPDATE m0_cloud_meta SET scope=? WHERE id=1")
          .run(JSON.stringify(scope));
      this.db
        .prepare(
          `INSERT INTO m0_cloud_states(note_id,generation,state) VALUES(?,?,?)
        ON CONFLICT(note_id) DO UPDATE SET generation=excluded.generation,state=excluded.state`,
        )
        .run(noteId, next.generation, JSON.stringify(next));
      this.beforeCommit?.();
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async close() {
    this.db.close();
  }
  async listLibrary(scope: CloudScope, request: CloudLibraryRequest) {
    const page = new CloudLibraryPageBuilder(scope, request);
    this.db.exec("BEGIN");
    try {
      this.checkScope(page.scope);
      for (const row of this.db
        .prepare("SELECT note_id,generation,state FROM m0_cloud_states")
        .iterate()) {
        const state = JSON.parse(String(row.state));
        if (state.generation !== row.generation)
          throw Error("Cloud local row generation mismatch");
        page.add(String(row.note_id), state);
      }
      const result = page.finish(this.progress());
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  private progress(): CloudPullProgress | null {
    const raw = this.db
      .prepare("SELECT pull_state FROM m0_cloud_meta WHERE id=1")
      .get()?.pull_state;
    return raw === null ? null : validatePullProgress(JSON.parse(String(raw)));
  }
  async readPull(input: CloudScope, noteIds: string[]) {
    const scope = validateCloudScope(input),
      ids = [...noteIds];
    if (ids.length > 32 || new Set(ids).size !== ids.length)
      throw Error("Invalid Cloud page note set");
    ids.forEach(validateCloudNoteId);
    this.db.exec("BEGIN");
    try {
      this.checkScope(scope);
      const progress = this.progress(),
        states: Record<string, CloudClientState | null> = Object.create(null);
      for (const id of ids) states[id] = this.state(scope, id);
      this.db.exec("COMMIT");
      return { progress, states };
    } catch (error) {
      this.db.exec("ROLLBACK");
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const storedScope = this.checkScope(scope),
        previous = this.progress();
      if (
        (previous?.generation ?? null) !== expectedGeneration ||
        writes.some(
          (write) =>
            (this.state(scope, write.noteId)?.generation ?? null) !==
            write.expectedGeneration,
        )
      ) {
        this.db.exec("ROLLBACK");
        return false;
      }
      if (!storedScope)
        this.db
          .prepare("UPDATE m0_cloud_meta SET scope=? WHERE id=1")
          .run(JSON.stringify(scope));
      const statement = this.db
        .prepare(`INSERT INTO m0_cloud_states(note_id,generation,state) VALUES(?,?,?)
        ON CONFLICT(note_id) DO UPDATE SET generation=excluded.generation,state=excluded.state`);
      for (const write of writes)
        statement.run(
          write.noteId,
          write.next.generation,
          JSON.stringify(write.next),
        );
      this.db
        .prepare("UPDATE m0_cloud_meta SET pull_state=? WHERE id=1")
        .run(JSON.stringify(next));
      this.beforeCommit?.();
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
