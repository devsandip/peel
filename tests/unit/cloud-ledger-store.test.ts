import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudLedgerStore,
  CloudRunLedgerError,
} from "../../infra/cloud/ledger-store.ts";

const parents: string[] = [];
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "peel-ledger-namespace-"));
  parents.push(parent);
  return {
    parent,
    directory: join(parent, "ledger"),
    authority: {
      identity: {
        profile: "synthetic-dev",
        accountId: "111122223333",
        region: "us-east-1",
      },
      authorizedUntil: "2026-10-28T03:30:00.000Z",
    },
  };
}
const hash = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const refusal = (work: () => unknown) =>
  expect(work).toThrow("Cloud run ledger unavailable");
afterEach(() => {
  for (const parent of parents.splice(0))
    rmSync(parent, { recursive: true, force: true });
});
describe("Private Cloud ledger namespace", () => {
  it("creates restrictive owned files, recognizes exact schema/authority and reads back durability settings", () => {
    const f = fixture(),
      store = CloudLedgerStore.create(f.directory, f.authority);
    expect(store.directory).toBe(realpathSync(f.directory));
    expect(statSync(f.directory).mode & 0o777).toBe(0o700);
    for (const name of ["owner.json", "runs.sqlite"])
      expect(statSync(join(f.directory, name)).mode & 0o777).toBe(0o600);
    const facts = store.use(true, (db) => ({
      rows: db.prepare("SELECT count(*) as n FROM reservations").get()?.n,
      receiptRows: db
        .prepare("SELECT count(*) as n FROM cleanup_receipts")
        .get()?.n,
      mode: db.prepare("PRAGMA journal_mode").get()?.journal_mode,
      synchronous: db.prepare("PRAGMA synchronous").get()?.synchronous,
      fullfsync: db.prepare("PRAGMA fullfsync").get()?.fullfsync,
      foreignKeys: db.prepare("PRAGMA foreign_keys").get()?.foreign_keys,
    }));
    expect(facts).toEqual({
      rows: 0,
      receiptRows: 0,
      mode: "delete",
      synchronous: 2,
      fullfsync: 1,
      foreignKeys: 1,
    });
    expect(CloudLedgerStore.open(f.directory, f.authority).scopeSha256).toBe(
      store.scopeSha256,
    );
    expect(CloudLedgerStore.create(f.directory, f.authority).scopeSha256).toBe(
      store.scopeSha256,
    );
    expect(readdirSync(f.directory).sort()).toEqual([
      "owner.json",
      "runs.sqlite",
    ]);
  });
  it("captures independent authority, rejects other accounts and excludes extra/private input fields", () => {
    const f = fixture(),
      original = structuredClone(f.authority),
      store = CloudLedgerStore.create(f.directory, f.authority);
    f.authority.identity.accountId = "999900001111";
    expect(store.authority).toEqual(original);
    expect(Object.isFrozen(store.authority.identity)).toBe(true);
    refusal(() => CloudLedgerStore.open(f.directory, f.authority));
    expect(CloudLedgerStore.open(f.directory, original).authority).toEqual(
      original,
    );
    const g = fixture();
    refusal(() =>
      CloudLedgerStore.create(g.directory, {
        ...g.authority,
        token: "synthetic-private",
      }),
    );
    expect(readdirSync(g.parent)).toEqual([]);
    let accessed = false;
    refusal(() =>
      CloudLedgerStore.create(
        g.directory,
        Object.defineProperty({ ...g.authority }, "identity", {
          get() {
            accessed = true;
            return g.authority.identity;
          },
        }),
      ),
    );
    expect(accessed).toBe(false);
  });
  it("preserves an existing foreign directory and never creates or opens its database", () => {
    const f = fixture();
    mkdirSync(f.directory, { mode: 0o700 });
    const file = join(f.directory, "runs.sqlite");
    writeFileSync(file, "synthetic foreign content", { mode: 0o600 });
    const before = hash(file);
    refusal(() => CloudLedgerStore.create(f.directory, f.authority));
    refusal(() => CloudLedgerStore.open(f.directory, f.authority));
    expect(hash(file)).toBe(before);
    expect(readdirSync(f.directory)).toEqual(["runs.sqlite"]);
  });
  it("rejects permissive directories/markers/databases without changing their permissions", () => {
    for (const name of [".", "owner.json", "runs.sqlite"]) {
      const f = fixture();
      CloudLedgerStore.create(f.directory, f.authority);
      const target = join(f.directory, name),
        mode = name === "." ? 0o755 : 0o644;
      chmodSync(target, mode);
      refusal(() => CloudLedgerStore.open(f.directory, f.authority));
      expect(statSync(target).mode & 0o777).toBe(mode);
    }
  });
  it("rejects directory/database symlinks and hardlinks without following or altering the target", () => {
    const f = fixture(),
      outside = join(f.parent, "outside");
    mkdirSync(outside, { mode: 0o700 });
    const foreign = join(outside, "keep");
    writeFileSync(foreign, "synthetic foreign", { mode: 0o600 });
    const before = hash(foreign);
    symlinkSync(outside, f.directory);
    refusal(() => CloudLedgerStore.create(f.directory, f.authority));
    expect(hash(foreign)).toBe(before);
    const g = fixture();
    CloudLedgerStore.create(g.directory, g.authority);
    const original = join(g.parent, "original.sqlite"),
      db = join(g.directory, "runs.sqlite");
    renameSync(db, original);
    symlinkSync(original, db);
    const originalHash = hash(original);
    refusal(() => CloudLedgerStore.open(g.directory, g.authority));
    expect(hash(original)).toBe(originalHash);
    const h = fixture();
    CloudLedgerStore.create(h.directory, h.authority);
    const hdb = join(h.directory, "runs.sqlite");
    linkSync(hdb, join(h.parent, "copy.sqlite"));
    const hhash = hash(hdb);
    refusal(() => CloudLedgerStore.open(h.directory, h.authority));
    expect(hash(hdb)).toBe(hhash);
  });
  it("refuses extra files for new work while cleanup inspection leaves those files untouched", () => {
    const f = fixture(),
      store = CloudLedgerStore.create(f.directory, f.authority),
      extra = join(f.directory, "keep.txt");
    writeFileSync(extra, "synthetic private extra");
    const before = hash(extra);
    refusal(() => store.use(true, () => undefined));
    refusal(() => CloudLedgerStore.create(f.directory, f.authority));
    expect(
      CloudLedgerStore.open(f.directory, f.authority).use(
        false,
        (db) => db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
      ),
    ).toBe(0);
    expect(hash(extra)).toBe(before);
  });
  it("refuses changed authority/schema/header and foreign journals without repairing their bytes", () => {
    for (const change of ["authority", "schema", "header", "journal"]) {
      const f = fixture();
      CloudLedgerStore.create(f.directory, f.authority);
      const file = join(f.directory, "runs.sqlite");
      if (change === "schema" || change === "authority") {
        const db = new DatabaseSync(file);
        if (change === "schema")
          db.exec("CREATE TABLE sqliteXforeign(value TEXT)");
        else
          db.prepare("UPDATE ledger_meta SET authorization=?").run(
            "synthetic changed authority",
          );
        db.close();
      } else if (change === "header") {
        const data = readFileSync(file);
        data.writeUInt32BE(0, 68);
        writeFileSync(file, data);
      } else
        writeFileSync(file + "-journal", "synthetic foreign journal", {
          mode: 0o600,
        });
      const before = hash(file),
        journal = change === "journal" ? hash(file + "-journal") : null;
      refusal(() => CloudLedgerStore.open(f.directory, f.authority));
      expect(hash(file)).toBe(before);
      if (journal) expect(hash(file + "-journal")).toBe(journal);
    }
  });
  it("allows old authorization to be inspected without applying a new-run time policy", () => {
    const f = fixture();
    f.authority.authorizedUntil = "2020-01-01T00:00:00.000Z";
    const store = CloudLedgerStore.create(f.directory, f.authority);
    expect(
      store.use(
        false,
        (db) => db.prepare("SELECT count(*) AS n FROM reservations").get()?.n,
      ),
    ).toBe(0);
    expect(
      CloudLedgerStore.open(f.directory, f.authority).authority.authorizedUntil,
    ).toBe(f.authority.authorizedUntil);
  });
  it("returns fixed errors without raw callback messages or rejected values", () => {
    const f = fixture(),
      store = CloudLedgerStore.create(f.directory, f.authority);
    try {
      store.use(true, () => {
        throw Error("synthetic private cause");
      });
      throw Error("not refused");
    } catch (error) {
      expect(error).toBeInstanceOf(CloudRunLedgerError);
      expect((error as Error).message).toBe("Cloud run ledger unavailable");
      expect(error).not.toHaveProperty("cause");
    }
    refusal(() => CloudLedgerStore.create("../synthetic-private", f.authority));
  });
});
