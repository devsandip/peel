import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { cloudJournalV2Catalog } from "./journal-v2-catalog.ts";
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
type Version = 1 | 2;
type Genesis = ReturnType<typeof readCloudJournalGenesis>;
function header(files: Files, expected: Version = version) {
  const h = files.readDatabaseHeader();
  if (
    h.subarray(0, 16).toString() !== "SQLite format 3\0" ||
    h.readUInt16BE(16) !== 4096 ||
    h[18] !== 1 ||
    h[19] !== 1 ||
    h.readUInt32BE(68) !== appId ||
    h.readUInt32BE(60) !== expected
  )
    return fail("unrecognized");
}
function connect(
  files: Files,
  initialize: boolean,
  expected: Version = version,
) {
  files.verify();
  if (!initialize) header(files, expected);
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
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function snapshotV2(db: DatabaseSync, anchor: Anchor) {
  const rows = db
    .prepare(
      "SELECT type,name,tbl_name,CASE WHEN sql IS NULL THEN NULL WHEN length(CAST(sql AS BLOB))<=8192 THEN sql ELSE '' END AS sql FROM sqlite_schema ORDER BY type,name LIMIT 29",
    )
    .all();
  if (rows.length !== 28) return fail("unrecognized");
  const catalog = rows.map((r) => {
    if (
      typeof r.type !== "string" ||
      typeof r.name !== "string" ||
      typeof r.tbl_name !== "string" ||
      (r.sql !== null && typeof r.sql !== "string")
    )
      return fail("unrecognized");
    return {
      type: r.type,
      name: r.name,
      table: r.tbl_name,
      sqlSha256: r.sql === null ? null : digest(r.sql),
    };
  });
  if (
    digest(JSON.stringify(catalog)) !==
    "64ee8e6428b1f3d3aecd2a2bca6f2f8170e4a9940eeb205d32d41b3853dbca3f"
  )
    return fail("unrecognized");
  const state = db
    .prepare("SELECT id,revision FROM journal_state LIMIT 2")
    .all();
  if (state.length !== 1 || state[0].id !== 1 || state[0].revision !== 0)
    return fail("unrecognized");
  for (const table of [
    "journal_intents",
    "journal_fences",
    "journal_observations",
    "journal_teardown",
  ])
    if (db.prepare("SELECT 1 FROM " + table + " LIMIT 1").get())
      return fail("unrecognized");
  const genesis = db
    .prepare(
      "SELECT id,scope_sha256,genesis_sha256,genesis_json FROM journal_genesis LIMIT 2",
    )
    .all();
  if (
    genesis.length !== 1 ||
    genesis[0].id !== 1 ||
    typeof genesis[0].genesis_json !== "string"
  )
    return fail("unrecognized");
  const original = readCloudJournalGenesis(genesis[0].genesis_json, anchor);
  if (
    genesis[0].scope_sha256 !== original.scopeSha256 ||
    genesis[0].genesis_sha256 !== original.sha256 ||
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
  return Object.freeze({
    kind: "synkies-cloud-journal-v2-initial-snapshot" as const,
    storageVersion: 2 as const,
    journalRevision: 0 as const,
    ...original,
  });
}
function inspectWith<T extends Genesis>(
  anchor: Anchor,
  recovery: boolean,
  expected: Version,
  readSnapshot: (db: DatabaseSync, anchor: Anchor) => T,
) {
  const files = openCloudJournalFiles(anchor, recovery);
  try {
    const db = connect(files, false, expected);
    try {
      db.exec("BEGIN");
      const result = readSnapshot(db, anchor);
      db.exec("COMMIT");
      header(files, expected);
      return result;
    } finally {
      db.close();
    }
  } finally {
    files.close();
  }
}
function inspect(anchor: Anchor, recovery: boolean) {
  return inspectWith(anchor, recovery, 1, snapshot);
}
function bootstrap<T extends { read(): Genesis }>(
  input: Parameters<typeof createCloudJournalGenesis>[0],
  hooks: Hooks,
  expected: Version,
  makeStore: (anchor: unknown) => { store: T; anchor: Anchor },
) {
  return privateCall(() => {
    let original: ReturnType<typeof createCloudJournalGenesis>;
    try {
      original = createCloudJournalGenesis(input);
    } catch {
      return fail("invalid-input");
    }
    const { store, anchor } = makeStore(original.genesis.anchor),
      files = createCloudJournalFiles(anchor);
    let commitAttempted = false;
    try {
      const db = connect(files, true, expected);
      try {
        db.exec("BEGIN IMMEDIATE");
        db.exec(expected === 1 ? schema : cloudJournalV2Catalog.ddl);
        db.exec(
          `PRAGMA application_id=${appId}; PRAGMA user_version=${expected};`,
        );
        db.prepare("INSERT INTO journal_genesis VALUES(1,?,?,?)").run(
          original.scopeSha256,
          original.sha256,
          original.json,
        );
        if (expected === 2) db.exec("INSERT INTO journal_state VALUES(1,0)");
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
      try {
        files.close();
      } catch (error) {
        if (expected === 2 && commitAttempted) return fail("uncertain");
        throw error;
      }
    }
  });
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
    return bootstrap(input, hooks, 1, (anchor) => {
      const store = new CloudJournalGenesisStore(anchor);
      return { store, anchor: store.anchor };
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

/** Fixed original-byte persistence only. A successful store is not fresh lineage or permission. */
export class CloudJournalV2InitialStore {
  private readonly anchor: Anchor;
  private constructor(anchor: unknown) {
    this.anchor = normalizeCloudJournalAnchor(anchor);
    Object.freeze(this);
  }
  static bootstrap(input: Parameters<typeof createCloudJournalGenesis>[0]) {
    return bootstrap(input, {}, 2, (anchor) => {
      const store = new CloudJournalV2InitialStore(anchor);
      return { store, anchor: store.anchor };
    });
  }
  static open(anchor: unknown) {
    return privateCall(() => {
      const store = new CloudJournalV2InitialStore(anchor);
      store.read();
      return store;
    });
  }
  static inspect(anchor: unknown) {
    return privateCall(() =>
      inspectWith(normalizeCloudJournalAnchor(anchor), true, 2, snapshotV2),
    );
  }
  read() {
    return privateCall(() => inspectWith(this.anchor, false, 2, snapshotV2));
  }
}
