import { DatabaseSync } from "node:sqlite";
import type { ReplicaStore, Row, Change, Snapshot } from "./durable";
import {
  validateScan,
  projectMetadata,
  finishMetadataPage,
  type ScanRequest,
} from "./inventory";

/** Node-only M0 SQLite contract, not the native Rust repository. */
export class SQLiteReplicaStore implements ReplicaStore {
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
          (t) => !["m0_peer_meta", "m0_peer_rows"].includes(String(t.name)),
        )
      )
        throw new Error("Refusing to modify a non-M0 peer database");
      if (
        tables.length &&
        (tables.length !== 2 ||
          this.db.prepare("SELECT schema FROM m0_peer_meta WHERE id=1").get()
            ?.schema !== 1)
      )
        throw new Error("Unrecognized M0 peer schema");
      this.db
        .exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS m0_peer_meta(id INTEGER PRIMARY KEY CHECK(id=1), schema INTEGER NOT NULL, revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO m0_peer_meta VALUES(1,1,0);
        CREATE TABLE IF NOT EXISTS m0_peer_rows(key TEXT PRIMARY KEY, note_id TEXT, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS m0_peer_note ON m0_peer_rows(note_id);
        COMMIT;`);
      if (
        this.db.prepare("SELECT schema FROM m0_peer_meta WHERE id=1").get()
          ?.schema !== 1
      )
        throw new Error("Unrecognized M0 peer schema");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  async read(noteId: string | null, keys: string[]): Promise<Snapshot> {
    this.db.exec("BEGIN");
    try {
      const revision = Number(
        this.db.prepare("SELECT revision FROM m0_peer_meta WHERE id=1").get()!
          .revision,
      );
      const records = new Map<string, Row>();
      const parse = (r: Record<string, unknown>) => {
        const key = String(r.key);
        records.set(key, {
          key,
          ...(r.note_id === null ? {} : { noteId: String(r.note_id) }),
          value: JSON.parse(String(r.value)),
        });
      };
      if (noteId !== null)
        for (const row of this.db
          .prepare("SELECT * FROM m0_peer_rows WHERE note_id=?")
          .all(noteId))
          parse(row);
      for (const key of keys) {
        const row = this.db
          .prepare("SELECT * FROM m0_peer_rows WHERE key=?")
          .get(key);
        if (row) parse(row);
      }
      this.db.exec("COMMIT");
      return { revision, rows: [...records.values()] };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async commit(expectedRevision: number, changes: Change[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = Number(
        this.db.prepare("SELECT revision FROM m0_peer_meta WHERE id=1").get()!
          .revision,
      );
      if (current !== expectedRevision) {
        this.db.exec("ROLLBACK");
        return false;
      }
      if (!Number.isSafeInteger(current + 1))
        throw new Error("Peer store revision exhausted");
      const put = this.db.prepare(
        "INSERT INTO m0_peer_rows(key,note_id,value) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET note_id=excluded.note_id,value=excluded.value",
      );
      const remove = this.db.prepare("DELETE FROM m0_peer_rows WHERE key=?");
      for (const c of changes) {
        if (c.row) {
          if (c.row.key !== c.key) throw new Error("Peer store key mismatch");
          put.run(c.key, c.row.noteId ?? null, JSON.stringify(c.row.value));
        } else remove.run(c.key);
      }
      this.db
        .prepare("UPDATE m0_peer_meta SET revision=? WHERE id=1")
        .run(current + 1);
      this.beforeCommit?.();
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async scan(request: ScanRequest) {
    request = structuredClone(request);
    const { prefix, end } = validateScan(request);
    this.db.exec("BEGIN");
    try {
      const revision = Number(
        this.db.prepare("SELECT revision FROM m0_peer_meta WHERE id=1").get()!
          .revision,
      );
      const storedIdentity = this.db
        .prepare("SELECT value FROM m0_peer_rows WHERE key='meta/identity'")
        .get();
      const identity = storedIdentity
        ? {
            key: "meta/identity",
            value: JSON.parse(String(storedIdentity.value)),
          }
        : undefined;
      // JSON projection keeps note source on SQLite's side of the binding.
      const selected =
        request.phase === "head"
          ? `json_object(
        'protocol', json_extract(value, '$.protocol'),
        'libraryId', json_extract(value, '$.libraryId'),
        'editId', json_extract(value, '$.editId'),
        'stamp', json_extract(value, '$.stamp'),
        'note', json_object('noteId', json_extract(value, '$.note.noteId')))`
          : "value";
      const found = this.db
        .prepare(
          `SELECT key,note_id,${selected} AS metadata FROM m0_peer_rows
        WHERE key>=? AND key<? AND (? IS NULL OR key>?) ORDER BY key LIMIT ?`,
        )
        .all(prefix, end, request.after, request.after, request.limit + 1);
      const rows: Row[] = [];
      for (const stored of found.slice(0, request.limit)) {
        const row = projectMetadata(request, {
          key: String(stored.key),
          ...(stored.note_id === null
            ? {}
            : { noteId: String(stored.note_id) }),
          value: JSON.parse(String(stored.metadata)),
        });
        if (row) rows.push(row);
      }
      const page = finishMetadataPage(
        revision,
        identity,
        rows,
        Math.min(found.length, request.limit),
        found.length > request.limit
          ? String(found[request.limit - 1].key)
          : null,
      );
      this.db.exec("COMMIT");
      return page;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async close() {
    this.db.close();
  }
}
