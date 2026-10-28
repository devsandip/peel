import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createOwnedSqliteMechanics } from "./owned-sqlite-storage.ts";

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
/** Normalize original local ledger scope only; no reservation or execution authority. */
export function normalizeCloudLedgerAuthority(value: unknown) {
  return privateCall(() => authorization(value));
}
const mechanics = createOwnedSqliteMechanics<CloudLedgerStore>({
  appId,
  userVersion: 1,
  dbName,
  markerName,
  markerKind: "peel-cloud-dev-ledger",
  maxDbBytes,
  schema,
  fail,
  readMarker: (value) =>
    record(value, [
      "format",
      "kind",
      "scopeSha256",
      "directoryDevice",
      "directoryInode",
      "databaseDevice",
      "databaseInode",
    ]),
  initializeMetadata(db, ledger) {
    db.prepare("INSERT INTO ledger_meta VALUES(1,?)").run(
      JSON.stringify(ledger.authority),
    );
  },
  validateMetadata(db, ledger) {
    const meta = db.prepare("SELECT id,authorization FROM ledger_meta").all();
    if (
      meta.length !== 1 ||
      meta[0].id !== 1 ||
      meta[0].authorization !== JSON.stringify(ledger.authority)
    )
      return fail("unrecognized");
  },
});
/** Internal owned SQLite connection boundary; no run reservation or AWS authority. */
export class CloudLedgerStore {
  readonly directory: string;
  readonly authority: ReturnType<typeof authorization>;
  readonly scopeSha256: string;
  private constructor(directory: string, authority: unknown) {
    this.directory = mechanics.canonicalDirectory(directory);
    this.authority = authorization(authority);
    this.scopeSha256 = hash(JSON.stringify(this.authority));
  }
  static create(directory: string, authority: unknown) {
    return privateCall(() => {
      const ledger = new CloudLedgerStore(directory, authority);
      mechanics.initialize(ledger, () => ledger.use(true, () => undefined));
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
    return mechanics.connect(this, strict);
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
