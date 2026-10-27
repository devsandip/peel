import { createHash } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  readSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const appId = 0x504c524c,
  dbName = "runs.sqlite",
  markerName = "owner.json",
  maxDbBytes = 1024 * 1024;
const schema = [
  [
    "ledger_meta",
    "CREATE TABLE ledger_meta(id INTEGER PRIMARY KEY CHECK(id=1), authorization TEXT NOT NULL) STRICT",
  ],
  [
    "reservations",
    "CREATE TABLE reservations(slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 1 AND 2), run_id TEXT NOT NULL UNIQUE, plan_sha256 TEXT NOT NULL, reserved_at TEXT NOT NULL) STRICT",
  ],
  [
    "cleanup_receipts",
    "CREATE TABLE cleanup_receipts(run_id TEXT PRIMARY KEY REFERENCES reservations(run_id), plan_sha256 TEXT NOT NULL, inventory_sha256 TEXT NOT NULL, checked_at TEXT NOT NULL) STRICT",
  ],
] as const;
type Code =
  | "invalid-input"
  | "unrecognized"
  | "unavailable"
  | "busy"
  | "stale"
  | "duplicate"
  | "exhausted"
  | "unresolved"
  | "policy-refused"
  | "uncertain"
  | "receipt-conflict";
export class CloudRunLedgerError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud run ledger unavailable");
    this.code = code;
  }
}
function fail(code: Code): never {
  throw new CloudRunLedgerError(code);
}
function privateCall<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof CloudRunLedgerError) throw error;
    if (
      error &&
      typeof error === "object" &&
      "errcode" in error &&
      error.errcode === 5
    )
      return fail("busy");
    return fail("unavailable");
  }
}
const hash = (data: string) => createHash("sha256").update(data).digest("hex");
const full = (value: unknown, re: RegExp): value is string =>
  typeof value === "string" && re.exec(value)?.[0] === value;
function record(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return fail("invalid-input");
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(d).sort().join() !== [...keys].sort().join() ||
    Object.values(d).some((v) => !v.enumerable || !("value" in v))
  )
    return fail("invalid-input");
  return Object.fromEntries(keys.map((k) => [k, d[k].value])) as Record<
    string,
    unknown
  >;
}
function iso(value: unknown) {
  if (
    !full(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) ||
    !Number.isSafeInteger(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return fail("invalid-input");
  return value;
}
function authorization(value: unknown) {
  const a = record(value, ["identity", "authorizedUntil"]),
    i = record(a.identity, ["profile", "accountId", "region"]);
  if (
    !full(i.profile, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/) ||
    !full(i.accountId, /^\d{12}$/) ||
    i.region !== "us-east-1"
  )
    return fail("invalid-input");
  return Object.freeze({
    identity: Object.freeze({
      profile: i.profile,
      accountId: i.accountId,
      region: "us-east-1" as const,
    }),
    authorizedUntil: iso(a.authorizedUntil),
  });
}
function canonicalDirectory(value: string) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === dirname(value)
  )
    return fail("invalid-input");
  return join(realpathSync(dirname(value)), basename(value));
}
function owned(path: string, directory = false) {
  const s = lstatSync(path, { bigint: true }),
    uid = process.getuid?.();
  if (
    uid === undefined ||
    s.uid !== BigInt(uid) ||
    (s.mode & 0o777n) !== (directory ? 0o700n : 0o600n) ||
    (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1n)
  )
    return fail("unrecognized");
  return s;
}
function readOwned(path: string, max: number) {
  const before = owned(path),
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(fd, { bigint: true });
    if (
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.size > BigInt(max)
    )
      return fail("unrecognized");
    const bytes = Buffer.alloc(max + 1),
      length = readSync(fd, bytes, 0, bytes.length, 0);
    if (length > max || BigInt(length) !== current.size)
      return fail("unrecognized");
    return bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}
function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function exclusiveFile(path: string, data: string) {
  const fd = openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, data, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/** Internal owned SQLite connection boundary; no run reservation or AWS authority. */
export class CloudLedgerStore {
  readonly directory: string;
  readonly authority: ReturnType<typeof authorization>;
  readonly scopeSha256: string;
  private constructor(directory: string, authority: unknown) {
    this.directory = canonicalDirectory(directory);
    this.authority = authorization(authority);
    this.scopeSha256 = hash(JSON.stringify(this.authority));
  }
  static create(directory: string, authority: unknown) {
    return privateCall(() => {
      const ledger = new CloudLedgerStore(directory, authority);
      try {
        mkdirSync(ledger.directory, { mode: 0o700 });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "EEXIST"
        ) {
          ledger.use(true, () => undefined);
          return ledger;
        }
        throw error;
      }
      owned(ledger.directory, true);
      exclusiveFile(join(ledger.directory, dbName), "");
      const root = owned(ledger.directory, true),
        file = owned(join(ledger.directory, dbName));
      exclusiveFile(
        join(ledger.directory, markerName),
        JSON.stringify({
          format: 1,
          kind: "peel-cloud-dev-ledger",
          scopeSha256: ledger.scopeSha256,
          directoryDevice: String(root.dev),
          directoryInode: String(root.ino),
          databaseDevice: String(file.dev),
          databaseInode: String(file.ino),
        }) + "\n",
      );
      syncDirectory(ledger.directory);
      syncDirectory(dirname(ledger.directory));
      const db = new DatabaseSync(join(ledger.directory, dbName));
      try {
        db.exec(
          "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;",
        );
        for (const [, sql] of schema) db.exec(sql);
        db.exec(`PRAGMA application_id=${appId}; PRAGMA user_version=1;`);
        db.prepare("INSERT INTO ledger_meta VALUES(1,?)").run(
          JSON.stringify(ledger.authority),
        );
        db.exec("COMMIT");
      } finally {
        db.close();
      }
      syncDirectory(ledger.directory);
      syncDirectory(dirname(ledger.directory));
      ledger.use(true, () => undefined);
      return ledger;
    });
  }
  static open(directory: string, authority: unknown) {
    return privateCall(() => {
      const ledger = new CloudLedgerStore(directory, authority),
        db = ledger.connect(false);
      db.close();
      return ledger;
    });
  }
  private connect(strict: boolean) {
    const root = owned(this.directory, true),
      file = owned(join(this.directory, dbName));
    let marker: Record<string, unknown>;
    try {
      marker = record(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            readOwned(join(this.directory, markerName), 4096),
          ),
        ),
        [
          "format",
          "kind",
          "scopeSha256",
          "directoryDevice",
          "directoryInode",
          "databaseDevice",
          "databaseInode",
        ],
      );
    } catch {
      return fail("unrecognized");
    }
    if (
      marker.format !== 1 ||
      marker.kind !== "peel-cloud-dev-ledger" ||
      marker.scopeSha256 !== this.scopeSha256 ||
      marker.directoryDevice !== String(root.dev) ||
      marker.directoryInode !== String(root.ino) ||
      marker.databaseDevice !== String(file.dev) ||
      marker.databaseInode !== String(file.ino) ||
      file.size > BigInt(maxDbBytes)
    )
      return fail("unrecognized");
    const names = readdirSync(this.directory),
      allowed = [markerName, dbName, dbName + "-journal"];
    if (strict && names.some((n) => !allowed.includes(n)))
      return fail("unrecognized");
    if (names.includes(dbName + "-journal")) {
      const bytes = readOwned(
        join(this.directory, dbName + "-journal"),
        2 * maxDbBytes,
      );
      if (
        bytes.length &&
        (bytes.length < 8 ||
          (!bytes.subarray(0, 8).equals(Buffer.alloc(8)) &&
            bytes.subarray(0, 8).toString("hex") !== "d9d505f920a163d7"))
      )
        return fail("unrecognized");
    }
    // Check the owned file header before opening SQLite, including rollback format and namespace.
    const fd = openSync(
      join(this.directory, dbName),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const h = Buffer.alloc(100),
        s = fstatSync(fd, { bigint: true });
      if (
        s.dev !== file.dev ||
        s.ino !== file.ino ||
        readSync(fd, h, 0, h.length, 0) !== 100 ||
        h.subarray(0, 16).toString() !== "SQLite format 3\0" ||
        h[18] !== 1 ||
        h[19] !== 1 ||
        h.readUInt32BE(68) !== appId ||
        h.readUInt32BE(60) !== 1
      )
        return fail("unrecognized");
    } finally {
      closeSync(fd);
    }
    const db = new DatabaseSync(join(this.directory, dbName));
    try {
      db.exec(
        "PRAGMA busy_timeout=0; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;",
      );
      if (
        db.prepare("PRAGMA journal_mode").get()?.journal_mode !== "delete" ||
        db.prepare("PRAGMA synchronous").get()?.synchronous !== 2 ||
        db.prepare("PRAGMA fullfsync").get()?.fullfsync !== 1 ||
        db.prepare("PRAGMA foreign_keys").get()?.foreign_keys !== 1
      )
        return fail("unrecognized");
      const found = db
        .prepare(
          "SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name",
        )
        .all();
      if (
        found.length !== schema.length ||
        found.some(
          (r) =>
            r.type !== "table" ||
            !schema.some(([name, sql]) => name === r.name && sql === r.sql),
        )
      )
        return fail("unrecognized");
      const meta = db.prepare("SELECT id,authorization FROM ledger_meta").all();
      if (
        meta.length !== 1 ||
        meta[0].id !== 1 ||
        meta[0].authorization !== JSON.stringify(this.authority)
      )
        return fail("unrecognized");
      const checks = db.prepare("PRAGMA quick_check").all();
      if (
        checks.length !== 1 ||
        checks[0].quick_check !== "ok" ||
        db.prepare("PRAGMA foreign_key_check").all().length
      )
        return fail("unrecognized");
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  use<T>(strict: boolean, work: (db: DatabaseSync) => T): T {
    return privateCall(() => {
      const db = this.connect(strict);
      try {
        return work(db);
      } finally {
        db.close();
      }
    });
  }
}
