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

/** Repository-internal fixed wrapper configuration, never user options or JSON. */
type Scope = { readonly directory: string; readonly scopeSha256: string };
type Namespace<S extends Scope> = {
  readonly appId: number;
  readonly userVersion: number;
  readonly dbName: string;
  readonly markerName: string;
  readonly markerKind: string;
  readonly maxDbBytes: number;
  readonly schema: readonly (readonly [string, string])[];
  readonly fail: (code: "invalid-input" | "unrecognized") => never;
  readonly readMarker: (value: unknown) => Record<string, unknown>;
  readonly initializeMetadata: (db: DatabaseSync, scope: S) => void;
  readonly validateMetadata: (db: DatabaseSync, scope: S) => void;
};

/** Legacy SQLite mechanics only; no reservation, execution or repair authority. */
export function createOwnedSqliteMechanics<S extends Scope>(
  namespace: Namespace<S>,
) {
  const {
    appId,
    userVersion,
    dbName,
    markerName,
    markerKind,
    maxDbBytes,
    schema,
    fail,
  } = namespace;
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

  function initialize(ledger: S, readback: () => void) {
    try {
      mkdirSync(ledger.directory, { mode: 0o700 });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        readback();
        return;
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
        kind: markerKind,
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
      db.exec(
        `PRAGMA application_id=${appId}; PRAGMA user_version=${userVersion};`,
      );
      namespace.initializeMetadata(db, ledger);
      db.exec("COMMIT");
    } finally {
      db.close();
    }
    syncDirectory(ledger.directory);
    syncDirectory(dirname(ledger.directory));
    readback();
  }
  function connect(ledger: S, strict: boolean) {
    const root = owned(ledger.directory, true),
      file = owned(join(ledger.directory, dbName));
    let marker: Record<string, unknown>;
    try {
      marker = namespace.readMarker(
        JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            readOwned(join(ledger.directory, markerName), 4096),
          ),
        ),
      );
    } catch {
      return fail("unrecognized");
    }
    if (
      marker.format !== 1 ||
      marker.kind !== markerKind ||
      marker.scopeSha256 !== ledger.scopeSha256 ||
      marker.directoryDevice !== String(root.dev) ||
      marker.directoryInode !== String(root.ino) ||
      marker.databaseDevice !== String(file.dev) ||
      marker.databaseInode !== String(file.ino) ||
      file.size > BigInt(maxDbBytes)
    )
      return fail("unrecognized");
    const names = readdirSync(ledger.directory),
      allowed = [markerName, dbName, dbName + "-journal"];
    if (strict && names.some((n) => !allowed.includes(n)))
      return fail("unrecognized");
    if (names.includes(dbName + "-journal")) {
      const bytes = readOwned(
        join(ledger.directory, dbName + "-journal"),
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
      join(ledger.directory, dbName),
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
        h.readUInt32BE(60) !== userVersion
      )
        return fail("unrecognized");
    } finally {
      closeSync(fd);
    }
    const db = new DatabaseSync(join(ledger.directory, dbName));
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
      namespace.validateMetadata(db, ledger);
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
  return Object.freeze({ canonicalDirectory, initialize, connect });
}
