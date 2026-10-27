import { DatabaseSync } from "node:sqlite";
import { validateCloudServerTransition } from "./server-transition";
import {
  validateCloudAccount,
  validateCloudHead,
  validateCloudReceipt,
  validateCloudChange,
  validateServerSubject,
  type CloudAccount,
  type CloudHead,
  type CloudReceipt,
  type CloudServerStore,
  type CloudServerCommit,
} from "./server";
import { CLOUD_PAGE_ITEMS, type CloudPullServerStore } from "./pull";

// Isolated transactional server fixture. Not a DynamoDB adapter or public account admin API.
const tables = [
  "m0_cloud_server_schema",
  "m0_cloud_server_accounts",
  "m0_cloud_server_notes",
  "m0_cloud_server_tombstones",
  "m0_cloud_server_ops",
  "m0_cloud_server_changes",
];
const stored = <T>(read: () => T): T => {
  try {
    return read();
  } catch {
    throw Error("Unrecognized stored Cloud server record");
  }
};
export class SQLiteCloudServerStore
  implements CloudServerStore, CloudPullServerStore
{
  private db: DatabaseSync;
  constructor(
    path: string,
    private beforeCommit?: () => void,
  ) {
    this.db = new DatabaseSync(path);
    try {
      const found = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all();
      if (found.some((row) => !tables.includes(String(row.name))))
        throw Error("Refusing non-M0 Cloud server database");
      if (
        found.length &&
        (found.length !== tables.length ||
          this.db
            .prepare("SELECT version FROM m0_cloud_server_schema WHERE id=1")
            .get()?.version !== 1)
      )
        throw Error("Unrecognized M0 Cloud server schema");
      this.db
        .exec(`PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS m0_cloud_server_schema(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
        INSERT OR IGNORE INTO m0_cloud_server_schema VALUES(1,1);
        CREATE TABLE IF NOT EXISTS m0_cloud_server_accounts(owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS m0_cloud_server_notes(owner TEXT NOT NULL, note_id TEXT NOT NULL, head TEXT NOT NULL, PRIMARY KEY(owner,note_id));
        CREATE TABLE IF NOT EXISTS m0_cloud_server_tombstones(owner TEXT NOT NULL, note_id TEXT NOT NULL, head TEXT NOT NULL, PRIMARY KEY(owner,note_id));
        CREATE TABLE IF NOT EXISTS m0_cloud_server_ops(owner TEXT NOT NULL, op_id TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(owner,op_id));
        CREATE TABLE IF NOT EXISTS m0_cloud_server_changes(owner TEXT NOT NULL, sequence INTEGER NOT NULL, change TEXT NOT NULL, PRIMARY KEY(owner,sequence));
        COMMIT;`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private schema() {
    if (
      this.db
        .prepare("SELECT version FROM m0_cloud_server_schema WHERE id=1")
        .get()?.version !== 1
    )
      throw Error("Unrecognized M0 Cloud server schema");
  }
  private account(owner: string): CloudAccount | null {
    const row = this.db
      .prepare(
        "SELECT revision,state FROM m0_cloud_server_accounts WHERE owner=?",
      )
      .get(owner);
    if (!row) return null;
    const account = stored(() =>
      validateCloudAccount(JSON.parse(String(row.state))),
    );
    if (account.ownerSubject !== owner || account.revision !== row.revision)
      throw Error("Cloud server account mismatch");
    return account;
  }
  private head(
    owner: string,
    noteId: string,
    account: CloudAccount | null,
  ): CloudHead {
    const note = this.db
      .prepare(
        "SELECT head FROM m0_cloud_server_notes WHERE owner=? AND note_id=?",
      )
      .get(owner, noteId);
    const tomb = this.db
      .prepare(
        "SELECT head FROM m0_cloud_server_tombstones WHERE owner=? AND note_id=?",
      )
      .get(owner, noteId);
    if (note && tomb)
      throw Error("Cloud server note has a permanent tombstone and content");
    if (!note && !tomb) return { kind: "missing", noteId, revision: 0 };
    const head = stored(() =>
      validateCloudHead(JSON.parse(String((note ?? tomb)!.head))),
    );
    if (
      !account ||
      head.noteId !== noteId ||
      head.kind !== (note ? "note" : "purged") ||
      (head.kind === "note" &&
        head.snapshot.collectionId !== account.collectionId)
    )
      throw Error("Cloud server head scope mismatch");
    return head;
  }
  private receipt(owner: string, opId: string): CloudReceipt | null {
    const row = this.db
      .prepare(
        "SELECT receipt FROM m0_cloud_server_ops WHERE owner=? AND op_id=?",
      )
      .get(owner, opId);
    if (!row) return null;
    const receipt = stored(() =>
      validateCloudReceipt(JSON.parse(String(row.receipt))),
    );
    if (receipt.opId !== opId) throw Error("Cloud server receipt key mismatch");
    return receipt;
  }
  async read(owner: string, noteId: string, opId?: string) {
    validateServerSubject(owner);
    if (
      !/^[a-zA-Z0-9-]{1,128}$/.test(noteId) ||
      (opId !== undefined && !/^[a-zA-Z0-9-]{1,128}$/.test(opId))
    )
      throw Error("Invalid Cloud server read key");
    this.db.exec("BEGIN");
    try {
      this.schema();
      const account = this.account(owner),
        head = this.head(owner, noteId, account);
      const receipt = opId === undefined ? null : this.receipt(owner, opId);
      this.db.exec("COMMIT");
      return { account, head, receipt };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async commit(owner: string, noteId: string, input: CloudServerCommit) {
    validateServerSubject(owner);
    const transition = structuredClone(input);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.schema();
      const account = this.account(owner);
      const read = {
        account,
        head: this.head(owner, noteId, account),
        receipt: transition.receipt
          ? this.receipt(owner, transition.receipt.opId)
          : null,
      };
      if (!validateCloudServerTransition(owner, noteId, transition, read)) {
        this.db.exec("ROLLBACK");
        return false;
      }
      const { account: next, head: nextHead, receipt, change } = transition;
      if (nextHead) {
        if (nextHead.kind === "note")
          this.db
            .prepare(
              `INSERT INTO m0_cloud_server_notes VALUES(?,?,?)
          ON CONFLICT(owner,note_id) DO UPDATE SET head=excluded.head`,
            )
            .run(owner, noteId, JSON.stringify(nextHead));
        else {
          this.db
            .prepare(
              "DELETE FROM m0_cloud_server_notes WHERE owner=? AND note_id=?",
            )
            .run(owner, noteId);
          this.db
            .prepare("INSERT INTO m0_cloud_server_tombstones VALUES(?,?,?)")
            .run(owner, noteId, JSON.stringify(nextHead));
        }
      }
      if (change)
        this.db
          .prepare("INSERT INTO m0_cloud_server_changes VALUES(?,?,?)")
          .run(owner, change.sequence, JSON.stringify(change));
      if (receipt)
        this.db
          .prepare(
            `INSERT INTO m0_cloud_server_ops VALUES(?,?,?)
        ON CONFLICT(owner,op_id) DO UPDATE SET receipt=excluded.receipt`,
          )
          .run(owner, receipt.opId, JSON.stringify(receipt));
      this.db
        .prepare(
          "UPDATE m0_cloud_server_accounts SET revision=?,state=? WHERE owner=?",
        )
        .run(next.revision, JSON.stringify(next), owner);
      this.beforeCommit?.();
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  /** Capture the sequence and scan bounds in one consistent metadata read. */
  async pullMetadata(owner: string) {
    validateServerSubject(owner);
    this.db.exec("BEGIN");
    try {
      this.schema();
      const account = this.account(owner);
      const upper = (table: string) => {
        const value = this.db
          .prepare(
            `SELECT max(note_id) AS upper_id FROM ${table} WHERE owner=?`,
          )
          .get(owner)?.upper_id;
        return value === null || value === undefined ? null : String(value);
      };
      const result = {
        account,
        noteUpperId: upper("m0_cloud_server_notes"),
        tombUpperId: upper("m0_cloud_server_tombstones"),
      };
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async headKeys(
    owner: string,
    phase: "notes" | "tombstones",
    after: string | null,
    upper: string | null,
    limit: number,
  ) {
    validateServerSubject(owner);
    if (
      !["notes", "tombstones"].includes(phase) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > CLOUD_PAGE_ITEMS ||
      [after, upper].some(
        (id) =>
          id !== null &&
          (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(id)),
      )
    )
      throw Error("Invalid Cloud server page bounds");
    this.db.exec("BEGIN");
    try {
      this.schema();
      const account = this.account(owner);
      const rows =
        upper === null
          ? []
          : this.db
              .prepare(
                `SELECT note_id FROM m0_cloud_server_${phase} WHERE owner=? AND note_id>? AND note_id<=? ORDER BY note_id LIMIT ?`,
              )
              .all(owner, after ?? "", upper, limit + 1);
      const result = {
        account,
        keys: rows.slice(0, limit).map((row) => String(row.note_id)),
        hasMore: rows.length > limit,
      };
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async changesPage(
    owner: string,
    after: number,
    upper: number,
    limit: number,
  ) {
    validateServerSubject(owner);
    if (
      ![after, upper].every((n) => Number.isSafeInteger(n) && n >= 0) ||
      after > upper ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > CLOUD_PAGE_ITEMS
    )
      throw Error("Invalid Cloud server sequence bounds");
    this.db.exec("BEGIN");
    try {
      this.schema();
      const account = this.account(owner);
      const rows = this.db
        .prepare(
          "SELECT sequence,change FROM m0_cloud_server_changes WHERE owner=? AND sequence>? AND sequence<=? ORDER BY sequence LIMIT ?",
        )
        .all(owner, after, upper, limit + 1);
      const changes = rows.slice(0, limit).map((row) => {
        const change = stored(() =>
          validateCloudChange(JSON.parse(String(row.change))),
        );
        if (change.sequence !== row.sequence)
          throw Error("Cloud server change key mismatch");
        return change;
      });
      this.db.exec("COMMIT");
      return { account, changes, hasMore: rows.length > limit };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  /** Fixture administration only. A production adapter needs verified identity and billing authority. */
  async seedAccount(input: CloudAccount) {
    this.schema();
    const account = validateCloudAccount(input);
    if (account.revision !== 1 || account.sequence !== 0 || account.wall !== 0)
      throw Error("Invalid initial fixture account");
    this.db
      .prepare("INSERT INTO m0_cloud_server_accounts VALUES(?,?,?)")
      .run(account.ownerSubject, 1, JSON.stringify(account));
  }
  /** Fixture administration only; never exposed to note clients. */
  async setPolicy(
    owner: string,
    status: CloudAccount["status"],
    entitlement: CloudAccount["entitlement"],
  ) {
    validateServerSubject(owner);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.schema();
      const account = this.account(owner);
      if (!account) throw Error("Fixture account missing");
      if (account.status === "deleted" && status !== "deleted")
        throw Error("Deleted fixture identity cannot be reactivated");
      const next = validateCloudAccount({
        ...account,
        revision: account.revision + 1,
        status,
        entitlement,
      });
      this.db
        .prepare(
          "UPDATE m0_cloud_server_accounts SET revision=?,state=? WHERE owner=?",
        )
        .run(next.revision, JSON.stringify(next), owner);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async close() {
    this.db.close();
  }
}
