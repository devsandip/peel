import { DatabaseSync } from "node:sqlite";
import {
  createCloudJournalFiles,
  openCloudJournalFiles,
  CloudJournalFilesError,
} from "./journal-files.ts";
import {
  createCloudJournalGenesis,
  normalizeCloudJournalAnchor,
  readCloudJournalGenesis,
} from "./journal-genesis.ts";

const appId = 0x53594a31,
  version = 1,
  schema =
    "CREATE TABLE journal_genesis(id INTEGER PRIMARY KEY CHECK(id=1), scope_sha256 TEXT NOT NULL, genesis_sha256 TEXT NOT NULL, genesis_json TEXT NOT NULL CHECK(length(CAST(genesis_json AS BLOB))<=1572864)) STRICT";
type Code =
  "invalid-input" | "unrecognized" | "exists" | "unavailable" | "uncertain";
export class CloudJournalStorageError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Original Cloud journal storage unavailable");
    this.code = code;
    Object.freeze(this);
  }
}
function fail(code: Code): never {
  throw new CloudJournalStorageError(code);
}
function privateCall<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof CloudJournalStorageError) throw error;
    if (error instanceof CloudJournalFilesError && error.code === "exists")
      return fail("exists");
    return fail("unavailable");
  }
}
type Files = ReturnType<typeof openCloudJournalFiles>;
type Anchor = ReturnType<typeof normalizeCloudJournalAnchor>;
type Hooks = { beforeCommit?: () => void; afterCommit?: () => void };
function header(files: Files) {
  const h = files.readDatabaseHeader();
  if (
    h.subarray(0, 16).toString() !== "SQLite format 3\0" ||
    h.readUInt16BE(16) !== 4096 ||
    h[18] !== 1 ||
    h[19] !== 1 ||
    h.readUInt32BE(68) !== appId ||
    h.readUInt32BE(60) !== version
  )
    return fail("unrecognized");
}
function connect(files: Files, initialize: boolean) {
  files.verify();
  if (!initialize) header(files);
  const db = new DatabaseSync(files.databasePath, {
    timeout: 0,
    allowExtension: false,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  try {
    files.verify();
    if (initialize)
      db.exec("PRAGMA page_size=4096; PRAGMA journal_mode=DELETE;");
    db.exec(
      "PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA max_page_count=512;",
    );
    const settings = [
      ["journal_mode", "delete"],
      ["synchronous", 2],
      ["fullfsync", 1],
      ["foreign_keys", 1],
      ["trusted_schema", 0],
      ["busy_timeout", 0],
      ["page_size", 4096],
      ["max_page_count", 512],
    ] as const;
    for (const [name, expected] of settings)
      if (
        db.prepare("PRAGMA " + name).get()?.[
          name === "busy_timeout" ? "timeout" : name
        ] !== expected
      )
        return fail("unrecognized");
    if (!initialize) db.exec("PRAGMA query_only=ON;");
    files.verify();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
function snapshot(db: DatabaseSync, anchor: Anchor) {
  const catalog = db
    .prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY name")
    .all();
  if (
    catalog.length !== 1 ||
    catalog[0].type !== "table" ||
    catalog[0].name !== "journal_genesis" ||
    catalog[0].sql !== schema
  )
    return fail("unrecognized");
  const rows = db
    .prepare(
      "SELECT id,scope_sha256,genesis_sha256,genesis_json FROM journal_genesis",
    )
    .all();
  if (
    rows.length !== 1 ||
    rows[0].id !== 1 ||
    typeof rows[0].genesis_json !== "string"
  )
    return fail("unrecognized");
  const result = readCloudJournalGenesis(rows[0].genesis_json, anchor);
  if (
    rows[0].scope_sha256 !== result.scopeSha256 ||
    rows[0].genesis_sha256 !== result.sha256 ||
    (db.prepare("PRAGMA page_count").get()!.page_count as number) > 512
  )
    return fail("unrecognized");
  const checks = db.prepare("PRAGMA quick_check").all();
  if (
    checks.length !== 1 ||
    checks[0].quick_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").all().length
  )
    return fail("unrecognized");
  return result;
}
function inspect(anchor: Anchor, recovery: boolean) {
  const files = openCloudJournalFiles(anchor, recovery);
  try {
    const db = connect(files, false);
    try {
      db.exec("BEGIN");
      const result = snapshot(db, anchor);
      db.exec("COMMIT");
      header(files);
      return result;
    } finally {
      db.close();
    }
  } finally {
    files.close();
  }
}

/** Internal original-byte persistence only; actual funding/source acknowledgements remain external. */
export class CloudJournalGenesisStore {
  private readonly anchor: Anchor;
  private constructor(anchor: unknown) {
    this.anchor = normalizeCloudJournalAnchor(anchor);
    Object.freeze(this);
  }
  static bootstrap(
    input: Parameters<typeof createCloudJournalGenesis>[0],
    hooks: Hooks = {},
  ) {
    return privateCall(() => {
      let original: ReturnType<typeof createCloudJournalGenesis>;
      try {
        original = createCloudJournalGenesis(input);
      } catch {
        return fail("invalid-input");
      }
      const store = new CloudJournalGenesisStore(original.genesis.anchor),
        files = createCloudJournalFiles(store.anchor);
      let commitAttempted = false;
      try {
        const db = connect(files, true);
        try {
          db.exec("BEGIN IMMEDIATE");
          db.exec(schema);
          db.exec(
            `PRAGMA application_id=${appId}; PRAGMA user_version=${version};`,
          );
          db.prepare("INSERT INTO journal_genesis VALUES(1,?,?,?)").run(
            original.scopeSha256,
            original.sha256,
            original.json,
          );
          hooks.beforeCommit?.();
          files.verify();
          commitAttempted = true;
          db.exec("COMMIT");
          hooks.afterCommit?.();
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch {}
          throw error;
        } finally {
          db.close();
        }
        files.sync();
        if (store.read().json !== original.json) return fail("unrecognized");
        return store;
      } catch {
        return fail(commitAttempted ? "uncertain" : "unavailable");
      } finally {
        files.close();
      }
    });
  }
  /** Open only. No bootstrap, new source/namespace sync claim or execution capability. */
  static open(anchor: unknown) {
    return privateCall(() => {
      const store = new CloudJournalGenesisStore(anchor);
      store.read();
      return store;
    });
  }
  /** Historical inspection may ignore extras; it cannot acknowledge new creation. */
  static inspect(anchor: unknown) {
    return privateCall(() =>
      inspect(normalizeCloudJournalAnchor(anchor), true),
    );
  }
  read() {
    return privateCall(() => inspect(this.anchor, false));
  }
}
