import { DatabaseSync } from "node:sqlite";
import {
  registryHash,
  registryPath,
  registryTarget,
  registryTime,
  validateCloudConnectionRecord,
  type CloudConnectionRecord,
  type CloudConnectionRegistryStore,
} from "./connection-registry";

export const CONNECTION_REGISTRY_ROWS = 1024;
export const CONNECTIONS_PER_SESSION = 4;
export const CONNECTION_REGISTRY_RECLAIM = 32;
const meta = "m0_cloud_connection_meta",
  table = "m0_cloud_connections";
const schema = [
  [
    meta,
    `CREATE TABLE ${meta}(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, wall INTEGER NOT NULL)`,
  ],
  [
    table,
    `CREATE TABLE ${table}(target TEXT NOT NULL, domain TEXT NOT NULL, connection_id TEXT NOT NULL, session_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL, PRIMARY KEY(target,domain,connection_id))`,
  ],
  [
    "m0_cloud_connection_expiry",
    `CREATE INDEX m0_cloud_connection_expiry ON ${table}(expires_at,target,domain,connection_id)`,
  ],
  [
    "m0_cloud_connection_session",
    `CREATE INDEX m0_cloud_connection_session ON ${table}(session_hash,expires_at)`,
  ],
] as const;
const unavailable = (): never => {
  throw Error("Cloud connection registry storage unavailable");
};
/** Explicit isolated engine only. No hosted connection store or default database. */
export class SQLiteCloudConnectionRegistryStore implements CloudConnectionRegistryStore {
  private db!: DatabaseSync;
  constructor(
    path: string,
    private beforeCommit?: () => void,
  ) {
    try {
      registryPath(path);
      this.db = new DatabaseSync(path);
    } catch {
      return unavailable();
    }
    try {
      const found = this.db
        .prepare(
          "SELECT name,type,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'",
        )
        .all();
      if (
        found.length &&
        (found.length !== schema.length ||
          found.some(
            (row) =>
              !schema.some(
                ([name, sql]) =>
                  name === row.name &&
                  sql === row.sql &&
                  row.type ===
                    (name === meta || name === table ? "table" : "index"),
              ),
          ))
      )
        throw Error();
      if (found.length) this.check(0, false);
      this.db.exec(
        "PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE;",
      );
      if (!found.length) {
        for (const [, sql] of schema) this.db.exec(sql);
        this.db.prepare(`INSERT INTO ${meta} VALUES(1,1,0)`).run();
      }
      this.check(0, false);
      this.db.exec("COMMIT");
    } catch {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* No transaction. */
      }
      this.db.close();
      return unavailable();
    }
  }
  private check(now: number, monotonic = true) {
    const found = this.db
      .prepare(
        "SELECT name,type,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'",
      )
      .all();
    if (
      found.length !== schema.length ||
      found.some(
        (row) =>
          !schema.some(
            ([name, sql]) =>
              name === row.name &&
              sql === row.sql &&
              row.type ===
                (name === meta || name === table ? "table" : "index"),
          ),
      )
    )
      throw Error();
    const rows = this.db.prepare(`SELECT id,version,wall FROM ${meta}`).all();
    if (
      rows.length !== 1 ||
      rows[0].id !== 1 ||
      rows[0].version !== 1 ||
      !registryTime(rows[0].wall) ||
      (monotonic && now < rows[0].wall)
    )
      throw Error();
  }
  private transaction<T>(now: number, action: () => T) {
    if (!registryTime(now)) return unavailable();
    try {
      this.db.exec("BEGIN IMMEDIATE");
      this.check(now);
      const result = action();
      this.db.prepare(`UPDATE ${meta} SET wall=? WHERE id=1`).run(now);
      this.beforeCommit?.();
      this.db.exec("COMMIT");
      return result;
    } catch {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* No transaction. */
      }
      return unavailable();
    }
  }
  async insert(input: CloudConnectionRecord, now: number): Promise<boolean> {
    let record: CloudConnectionRecord;
    try {
      record = validateCloudConnectionRecord(input);
      if (
        !registryTime(now) ||
        now < record.registeredAt ||
        now >= record.expiresAt
      )
        throw Error();
    } catch {
      return unavailable();
    }
    return this.transaction(now, () => {
      this.db
        .prepare(
          `DELETE FROM ${table} WHERE (target,domain,connection_id) IN (SELECT target,domain,connection_id FROM ${table} WHERE expires_at<=? ORDER BY expires_at,target,domain,connection_id LIMIT ?)`,
        )
        .run(now, CONNECTION_REGISTRY_RECLAIM);
      if (
        Number(
          this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n,
        ) >= CONNECTION_REGISTRY_ROWS ||
        Number(
          this.db
            .prepare(
              `SELECT count(*) AS n FROM ${table} WHERE session_hash=? AND expires_at>?`,
            )
            .get(record.sessionHash, now)!.n,
        ) >= CONNECTIONS_PER_SESSION
      )
        return false;
      return (
        this.db
          .prepare(`INSERT OR IGNORE INTO ${table} VALUES(?,?,?,?,?,?)`)
          .run(
            record.connectArn,
            record.gatewayDomain,
            record.connectionId,
            record.sessionHash,
            record.expiresAt,
            JSON.stringify(record),
          ).changes === 1
      );
    });
  }
  async read(
    target: string,
    domain: string,
    connectionId: string,
    now: number,
  ): Promise<CloudConnectionRecord | null> {
    try {
      registryTarget(target, domain);
      if (
        !/^[A-Za-z0-9_+=/-]{1,128}(?![\s\S])/.test(connectionId) ||
        typeof connectionId !== "string"
      )
        throw Error();
    } catch {
      return unavailable();
    }
    return this.transaction(now, () => {
      const row = this.db
        .prepare(
          `SELECT session_hash,expires_at,state FROM ${table} WHERE target=? AND domain=? AND connection_id=?`,
        )
        .get(target, domain, connectionId);
      if (!row) return null;
      if (typeof row.state !== "string" || row.state.length > 4096)
        throw Error();
      const record = validateCloudConnectionRecord(JSON.parse(row.state));
      if (
        record.connectArn !== target ||
        record.gatewayDomain !== domain ||
        record.connectionId !== connectionId ||
        record.sessionHash !== row.session_hash ||
        record.expiresAt !== row.expires_at ||
        now < record.registeredAt
      )
        throw Error();
      return now < record.expiresAt ? record : null;
    });
  }
  async remove(input: CloudConnectionRecord, now: number): Promise<boolean> {
    let record: CloudConnectionRecord;
    try {
      record = validateCloudConnectionRecord(input);
      if (!registryHash(record.registrationId)) throw Error();
    } catch {
      return unavailable();
    }
    return this.transaction(
      now,
      () =>
        this.db
          .prepare(
            `DELETE FROM ${table} WHERE target=? AND domain=? AND connection_id=? AND session_hash=? AND expires_at=? AND state=?`,
          )
          .run(
            record.connectArn,
            record.gatewayDomain,
            record.connectionId,
            record.sessionHash,
            record.expiresAt,
            JSON.stringify(record),
          ).changes === 1,
    );
  }
  async close() {
    this.db.close();
  }
}
