import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  realpathSync,
  writeFileSync,
  readFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudJournalV2Catalog as c } from "../../infra/cloud/journal-v2-catalog.ts";
import golden from "../fixtures/cloud-journal-v2-catalog-golden.json";

const databases: DatabaseSync[] = [],
  parents: string[] = [],
  kinds = ["artifacts", "guard", "sentinel", "data"],
  a = "a".repeat(64),
  b = "b".repeat(64),
  d = "d".repeat(64),
  max = Number.MAX_SAFE_INTEGER,
  tables = [
    "journal_genesis",
    "journal_state",
    "journal_intents",
    "journal_fences",
    "journal_observations",
    "journal_teardown",
  ];
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function open(file = ":memory:") {
  const db = new DatabaseSync(file, {
    timeout: 0,
    allowExtension: false,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  databases.push(db);
  db.exec(
    "PRAGMA page_size=4096; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON; PRAGMA trusted_schema=OFF; PRAGMA recursive_triggers=OFF; PRAGMA max_page_count=512; PRAGMA application_id=1398360625; PRAGMA user_version=2;",
  );
  db.exec(c.ddl);
  return db;
}
function disk() {
  const parent = realpathSync(
      mkdtempSync(join(tmpdir(), "synkies-v2-catalog-")),
    ),
    file = join(parent, "capacity.sqlite");
  parents.push(parent);
  writeFileSync(file, "", { flag: "wx", mode: 0o600 });
  return { db: open(file), file };
}
function count(db: DatabaseSync, table: string) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n as number;
}
function digest(db: DatabaseSync) {
  return hash(
    JSON.stringify(
      tables.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()),
    ),
  );
}
function padding(n: number) {
  return JSON.stringify({
    padding: "x".repeat(n - JSON.stringify({ padding: "" }).length),
  });
}
function intent(
  db: DatabaseSync,
  kind = "guard",
  token = "synthetic-guard",
  large = false,
) {
  db.prepare("INSERT INTO journal_intents VALUES(?,?,?,?,?,?,?,?)").run(
    kind,
    token,
    a,
    large ? padding(4096) : "{}",
    b,
    d,
    large ? padding(16384) : "{}",
    large ? max - 1 : 1,
  );
}
function fence(
  db: DatabaseSync,
  kind = "guard",
  token = "synthetic-guard",
  revision = 2,
) {
  db.prepare("INSERT INTO journal_fences VALUES(?,?,?,?,?,?)").run(
    kind,
    token,
    a,
    b,
    d,
    revision,
  );
}
function observation(
  db: DatabaseSync,
  id: number,
  category = "ordinary",
  json = "{}",
  revision = 3,
) {
  db.prepare("INSERT INTO journal_observations VALUES(?,?,?,?)").run(
    id,
    category,
    json,
    revision,
  );
}
function seed(db: DatabaseSync) {
  db.prepare("INSERT INTO journal_genesis VALUES(1,?,?,?)").run(a, b, "{}");
  db.exec("INSERT INTO journal_state VALUES(1,0)");
  intent(db);
  fence(db);
  observation(db, 1);
  db.prepare("INSERT INTO journal_teardown VALUES(1,?,4)").run("{}");
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const p of parents.splice(0))
    rmSync(p, { recursive: true, force: true });
});

it("exports only frozen passive metadata and the independently planned DDL", () => {
  expect(Object.isFrozen(c)).toBe(true);
  expect(
    Object.values(c).some(
      (v) => typeof v === "function" || typeof v === "object",
    ),
  ).toBe(false);
  for (const key of [
    "format",
    "applicationId",
    "userVersion",
    "pageSize",
    "maxPages",
    "databaseLimit",
    "rollbackLimit",
    "observationJsonLimit",
  ] as const)
    expect(c[key]).toBe(golden[key]);
  expect(hash(c.ddl)).toBe(golden.ddlSha256);
});

it("matches the independent pre-artifact Python SQLite catalog without adoption", () => {
  const db = open(),
    objects = db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name",
      )
      .all()
      .map((r) => ({
        type: r.type,
        name: r.name,
        table: r.tbl_name,
        sqlSha256: r.sql === null ? null : hash(String(r.sql)),
      }));
  expect(objects).toEqual(golden.objects);
  expect(hash(JSON.stringify(objects))).toBe(golden.catalogSha256);
  expect(objects).toHaveLength(28);
  expect(() => db.exec(c.ddl)).toThrow();
  expect(
    db.prepare("PRAGMA recursive_triggers").get()!.recursive_triggers,
  ).toBe(0);
  expect(db.prepare("PRAGMA foreign_keys").get()!.foreign_keys).toBe(1);
  expect(db.prepare("PRAGMA trusted_schema").get()!.trusted_schema).toBe(0);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("blocks every immutable UPDATE, DELETE, REPLACE and IGNORE route without recursive delete triggers", () => {
  const db = open();
  seed(db);
  const before = digest(db);
  for (const table of tables.filter((t) => t !== "journal_state")) {
    expect(() =>
      db.exec(
        `UPDATE ${table} SET ${table === "journal_intents" || table === "journal_fences" ? "stack_kind=stack_kind" : table === "journal_observations" ? "observation_id=observation_id" : "id=id"}`,
      ),
    ).toThrow("Cloud journal write unavailable");
    expect(() => db.exec(`DELETE FROM ${table}`)).toThrow(
      "Cloud journal write unavailable",
    );
    for (const mode of ["REPLACE", "IGNORE"])
      expect(() =>
        db.exec(`INSERT OR ${mode} INTO ${table} SELECT * FROM ${table}`),
      ).toThrow("Cloud journal write unavailable");
    expect(digest(db)).toBe(before);
  }
});

it("permits only a one-step state revision and refuses replacement/reset/deletion", () => {
  const db = open();
  db.exec("INSERT INTO journal_state VALUES(1,0)");
  db.exec("UPDATE journal_state SET revision=1");
  for (const statement of [
    "UPDATE journal_state SET revision=0",
    "UPDATE journal_state SET revision=1",
    "UPDATE journal_state SET revision=3",
    "UPDATE journal_state SET id=2,revision=2",
    "DELETE FROM journal_state",
    "INSERT OR REPLACE INTO journal_state VALUES(1,0)",
    "INSERT OR IGNORE INTO journal_state VALUES(1,0)",
  ])
    expect(() => db.exec(statement)).toThrow("Cloud journal write unavailable");
  expect(db.prepare("SELECT revision FROM journal_state").get()!.revision).toBe(
    1,
  );
});

it("refuses a duplicate token under another kind including conflict replacement", () => {
  const db = open();
  intent(db, "guard", "synthetic-shared");
  const before = digest(db);
  for (const mode of ["", "OR REPLACE", "OR IGNORE"])
    expect(() =>
      db
        .prepare(`INSERT ${mode} INTO journal_intents VALUES(?,?,?,?,?,?,?,?)`)
        .run("data", "synthetic-shared", a, "{}", b, d, "{}", 1),
    ).toThrow("Cloud journal write unavailable");
  expect(count(db, "journal_intents")).toBe(1);
  expect(digest(db)).toBe(before);
});

it("requires the original immutable intent tuple and a later fence revision", () => {
  const db = open();
  expect(() => fence(db)).toThrow("Cloud journal write unavailable");
  intent(db);
  for (const values of [
    ["guard", "changed", a, b, d, 2],
    ["guard", "synthetic-guard", b, b, d, 2],
    ["guard", "synthetic-guard", a, a, d, 2],
    ["guard", "synthetic-guard", a, b, a, 2],
    ["guard", "synthetic-guard", a, b, d, 1],
    ["data", "synthetic-guard", a, b, d, 2],
  ])
    expect(() =>
      db
        .prepare("INSERT INTO journal_fences VALUES(?,?,?,?,?,?)")
        .run(...values),
    ).toThrow("Cloud journal write unavailable");
  expect(count(db, "journal_fences")).toBe(0);
  fence(db);
  expect(count(db, "journal_fences")).toBe(1);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
});

it("checks byte rather than character envelopes, strict columns and integer ranges", () => {
  const db = open();
  for (const values of [
    [0, "ordinary", "{}", 1],
    [97, "ordinary", "{}", 1],
    [1, "foreign", "{}", 1],
    [1, "ordinary", "", 1],
    [1, "ordinary", padding(1985), 1],
    [1, "ordinary", "界".repeat(662), 1],
    [1, "ordinary", "{}", 0],
    [1, "ordinary", "{}", max + 1],
    [1, "ordinary", "{}", "not-an-integer"],
  ])
    expect(() =>
      db
        .prepare("INSERT INTO journal_observations VALUES(?,?,?,?)")
        .run(...values),
    ).toThrow();
  expect(count(db, "journal_observations")).toBe(0);
  observation(db, 1, "ordinary", padding(1984), max);
  expect(() =>
    db.exec("INSERT INTO journal_observations(unknown_column) VALUES(1)"),
  ).toThrow();
  for (const json of ["", padding(1985)])
    expect(() =>
      db.prepare("INSERT INTO journal_teardown VALUES(1,?,1)").run(json),
    ).toThrow();
  db.prepare("INSERT INTO journal_teardown VALUES(1,?,?)").run(
    padding(1984),
    max,
  );
});

it("checks intent/request/genesis byte limits and all four fixed kind slots", () => {
  const db = open();
  for (const values of [
    ["foreign", "t", a, "{}", b, d, "{}", 1],
    ["guard", "", a, "{}", b, d, "{}", 1],
    ["guard", "x".repeat(129), a, "{}", b, d, "{}", 1],
    ["guard", "t", "a".repeat(63), "{}", b, d, "{}", 1],
    ["guard", "t", a, padding(4097), b, d, "{}", 1],
    ["guard", "t", a, "{}", b, d, padding(16385), 1],
    ["guard", "t", a, "{}", b, d, "{}", 0],
  ])
    expect(() =>
      db
        .prepare("INSERT INTO journal_intents VALUES(?,?,?,?,?,?,?,?)")
        .run(...values),
    ).toThrow();
  for (const kind of kinds)
    intent(db, kind, (kind + "x".repeat(128)).slice(0, 128), true);
  expect(count(db, "journal_intents")).toBe(4);
  expect(() =>
    db
      .prepare("INSERT INTO journal_genesis VALUES(1,?,?,?)")
      .run(a, b, padding(1572865)),
  ).toThrow();
  expect(() =>
    db
      .prepare("INSERT INTO journal_genesis VALUES(1,?,?,?)")
      .run("a".repeat(63), b, "{}"),
  ).toThrow();
  db.prepare("INSERT INTO journal_genesis VALUES(1,?,?,?)").run(
    a,
    b,
    padding(1572864),
  );
});

it("refuses ordinary capacity overflow while keeping all32 cleanup slots available", () => {
  const db = open();
  for (let id = 1; id <= 64; id++) observation(db, id);
  const before = digest(db);
  expect(() => observation(db, 65)).toThrow("Cloud journal write unavailable");
  expect(digest(db)).toBe(before);
  for (let id = 65; id <= 96; id++) observation(db, id, "cleanup");
  expect(count(db, "journal_observations")).toBe(96);
});

it("does not allow cleanup overflow to borrow ordinary capacity", () => {
  const db = open();
  for (let id = 1; id <= 32; id++) observation(db, id, "cleanup");
  expect(() => observation(db, 33, "cleanup")).toThrow(
    "Cloud journal write unavailable",
  );
  for (let id = 33; id <= 96; id++) observation(db, id);
  expect(count(db, "journal_observations")).toBe(96);
});

it("measures full SQL-valid envelopes and reserved cleanup under actual page/rollback bounds", () => {
  const { db, file } = disk();
  db.exec("BEGIN IMMEDIATE");
  db.prepare("INSERT INTO journal_genesis VALUES(1,?,?,?)").run(
    a,
    b,
    padding(1572864),
  );
  db.prepare("INSERT INTO journal_state VALUES(1,?)").run(max - 1);
  for (const kind of kinds) {
    const token = (kind + "x".repeat(128)).slice(0, 128);
    intent(db, kind, token, true);
    fence(db, kind, token, max);
  }
  for (let id = 1; id <= 64; id++)
    observation(db, id, "ordinary", padding(1984), max);
  db.exec("COMMIT");
  const ordinaryPages = db.prepare("PRAGMA page_count").get()!
    .page_count as number;
  expect(() => observation(db, 65, "ordinary", padding(1984), max)).toThrow(
    "Cloud journal write unavailable",
  );
  db.exec("BEGIN IMMEDIATE; UPDATE journal_state SET revision=revision+1;");
  for (let id = 65; id <= 96; id++)
    observation(db, id, "cleanup", padding(1984), max);
  db.prepare("INSERT INTO journal_teardown VALUES(1,?,?)").run(
    padding(1984),
    max,
  );
  const rollbackBytes = statSync(file + "-journal").size;
  expect(rollbackBytes).toBeGreaterThan(0);
  expect(rollbackBytes).toBeLessThanOrEqual(c.rollbackLimit);
  db.exec("COMMIT");
  const pages = db.prepare("PRAGMA page_count").get()!.page_count as number,
    bytes = statSync(file).size;
  expect(pages).toBeLessThanOrEqual(c.maxPages);
  expect(bytes).toBe(pages * c.pageSize);
  expect(bytes).toBeLessThanOrEqual(c.databaseLimit);
  expect(count(db, "journal_intents")).toBe(4);
  expect(count(db, "journal_fences")).toBe(4);
  expect(count(db, "journal_observations")).toBe(96);
  expect(count(db, "journal_teardown")).toBe(1);
  const before = digest(db);
  expect(() => observation(db, 97, "cleanup", padding(1984), max)).toThrow();
  expect(digest(db)).toBe(before);
  expect(db.prepare("PRAGMA quick_check").get()!.quick_check).toBe("ok");
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  const header = readFileSync(file).subarray(0, 100),
    observationMaxPayload = db
      .prepare(
        "SELECT MAX(mx_payload) AS n FROM dbstat WHERE name='journal_observations'",
      )
      .get()!.n as number,
    teardownMaxPayload = db
      .prepare(
        "SELECT MAX(mx_payload) AS n FROM dbstat WHERE name='journal_teardown'",
      )
      .get()!.n as number;
  expect(header.readUInt32BE(68)).toBe(c.applicationId);
  expect(header.readUInt32BE(60)).toBe(c.userVersion);
  expect(header.readUInt16BE(16)).toBe(c.pageSize);
  expect(observationMaxPayload).toBeGreaterThanOrEqual(c.observationJsonLimit);
  expect(observationMaxPayload).toBeLessThanOrEqual(2048);
  expect(teardownMaxPayload).toBeLessThanOrEqual(2048);
  console.info(
    "Synthetic v2 SQL capacity",
    JSON.stringify({
      ordinaryPages,
      pages,
      bytes,
      rollbackBytes,
      observationMaxPayload,
      teardownMaxPayload,
    }),
  );
});

it("enforces the engine page cap with a separate deliberately foreign growth probe", () => {
  const { db, file } = disk();
  // This extra table is deliberately outside the v2 catalog. No namespace/store reader adopts it.
  db.exec("CREATE TABLE growth_probe(bytes BLOB) STRICT");
  expect(() =>
    db
      .prepare("INSERT INTO growth_probe VALUES(zeroblob(?))")
      .run(c.databaseLimit * 2),
  ).toThrow();
  expect(count(db, "growth_probe")).toBe(0);
  expect(db.prepare("PRAGMA max_page_count").get()!.max_page_count).toBe(
    c.maxPages,
  );
  expect(
    db.prepare("PRAGMA page_count").get()!.page_count as number,
  ).toBeLessThanOrEqual(c.maxPages);
  expect(statSync(file).size).toBeLessThanOrEqual(c.databaseLimit);
});
