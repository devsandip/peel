import { DatabaseSync } from "node:sqlite";
import {
  connectionTicketHash,
  connectionTicketTime,
  validateCloudConnectionTicket,
  type CloudConnectionTicket,
  type CloudConnectionTicketStore,
} from "./connection-tickets";

export const CONNECTION_TICKET_ROWS = 1024;
export const CONNECTION_TICKETS_PER_SESSION = 4;
export const CONNECTION_TICKET_RECLAIM = 32;
const meta = "m0_cloud_ticket_meta",
  tickets = "m0_cloud_tickets";
/** Isolated explicit-path engine evidence, not a hosted ticket store. */
export class SQLiteCloudConnectionTicketStore implements CloudConnectionTicketStore {
  private db: DatabaseSync;
  constructor(
    path: string,
    private beforeCommit?: () => void,
  ) {
    this.db = new DatabaseSync(path);
    try {
      const found = this.db
        .prepare(
          "SELECT name,type FROM sqlite_master WHERE type IN ('table','view','trigger')",
        )
        .all();
      if (
        found.some(
          (row) =>
            row.type !== "table" || ![meta, tickets].includes(String(row.name)),
        ) ||
        (found.length &&
          (found.length !== 2 ||
            this.db.prepare(`SELECT version,wall FROM ${meta} WHERE id=1`).get()
              ?.version !== 1))
      )
        throw Error();
      if (found.length) {
        for (const [table, expected] of [
          [meta, "id:INTEGER:1,version:INTEGER:0,wall:INTEGER:0"],
          [
            tickets,
            "id_hash:TEXT:1,session_hash:TEXT:0,expires_at:INTEGER:0,state:TEXT:0",
          ],
        ]) {
          const columns = this.db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((row) => `${row.name}:${row.type}:${row.pk}`)
            .join(",");
          if (columns !== expected) throw Error();
        }
        if (this.db.prepare(`SELECT count(*) AS n FROM ${meta}`).get()!.n !== 1)
          throw Error();
        this.check(0, false);
      }
      this.db
        .exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS ${meta}(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, wall INTEGER NOT NULL);
        INSERT OR IGNORE INTO ${meta} VALUES(1,1,0);
        CREATE TABLE IF NOT EXISTS ${tickets}(id_hash TEXT PRIMARY KEY NOT NULL, session_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, state TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS m0_cloud_ticket_expiry ON ${tickets}(expires_at,id_hash);
        CREATE INDEX IF NOT EXISTS m0_cloud_ticket_session ON ${tickets}(session_hash,expires_at);
        COMMIT;`);
      this.check(0, false);
    } catch {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* No active transaction. */
      }
      this.db.close();
      throw Error("Cloud connection ticket storage unavailable");
    }
  }
  private check(now: number, monotonic = true) {
    const row = this.db
      .prepare(`SELECT version,wall FROM ${meta} WHERE id=1`)
      .get();
    if (
      !row ||
      row.version !== 1 ||
      typeof row.wall !== "number" ||
      !connectionTicketTime(row.wall) ||
      (monotonic && now < row.wall)
    )
      throw Error();
  }
  private transaction<T>(now: number, operation: () => T): T {
    if (!connectionTicketTime(now))
      throw Error("Cloud connection ticket storage unavailable");
    try {
      this.db.exec("BEGIN IMMEDIATE");
      this.check(now);
      const result = operation();
      this.db.prepare(`UPDATE ${meta} SET wall=? WHERE id=1`).run(now);
      this.beforeCommit?.();
      this.db.exec("COMMIT");
      return result;
    } catch {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* No active transaction. */
      }
      throw Error("Cloud connection ticket storage unavailable");
    }
  }
  async insert(input: CloudConnectionTicket, now: number): Promise<boolean> {
    const record = validateCloudConnectionTicket(input);
    if (
      !connectionTicketTime(now) ||
      now < record.issuedAt ||
      now >= record.expiresAt
    )
      throw Error("Cloud connection ticket storage unavailable");
    return this.transaction(now, () => {
      this.db
        .prepare(
          `DELETE FROM ${tickets} WHERE id_hash IN (SELECT id_hash FROM ${tickets} WHERE expires_at<=? ORDER BY expires_at,id_hash LIMIT ?)`,
        )
        .run(now, CONNECTION_TICKET_RECLAIM);
      const total = this.db
          .prepare(`SELECT count(*) AS n FROM ${tickets}`)
          .get()!.n,
        session = this.db
          .prepare(
            `SELECT count(*) AS n FROM ${tickets} WHERE session_hash=? AND expires_at>?`,
          )
          .get(record.sessionHash, now)!.n;
      if (
        Number(total) >= CONNECTION_TICKET_ROWS ||
        Number(session) >= CONNECTION_TICKETS_PER_SESSION
      )
        return false;
      return (
        this.db
          .prepare(`INSERT OR IGNORE INTO ${tickets} VALUES(?,?,?,?)`)
          .run(
            record.idHash,
            record.sessionHash,
            record.expiresAt,
            JSON.stringify(record),
          ).changes === 1
      );
    });
  }
  async take(
    idHash: string,
    sessionHash: string,
    now: number,
  ): Promise<CloudConnectionTicket | null> {
    if (!connectionTicketHash(idHash) || !connectionTicketHash(sessionHash))
      throw Error("Cloud connection ticket storage unavailable");
    return this.transaction(now, () => {
      const row = this.db
        .prepare(
          `SELECT expires_at,state FROM ${tickets} WHERE id_hash=? AND session_hash=?`,
        )
        .get(idHash, sessionHash);
      if (!row) return null;
      const record = validateCloudConnectionTicket(
        JSON.parse(String(row.state)),
      );
      if (
        record.idHash !== idHash ||
        record.sessionHash !== sessionHash ||
        record.expiresAt !== row.expires_at ||
        now < record.issuedAt
      )
        throw Error();
      if (
        this.db
          .prepare(`DELETE FROM ${tickets} WHERE id_hash=? AND session_hash=?`)
          .run(idHash, sessionHash).changes !== 1
      )
        throw Error();
      return now < record.expiresAt ? record : null;
    });
  }
  async close() {
    this.db.close();
  }
}
