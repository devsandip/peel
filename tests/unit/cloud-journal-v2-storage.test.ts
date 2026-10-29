import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudJournalV2InitialStore as Store,
  CloudJournalStorageError,
} from "../../infra/cloud/journal-v2-storage.ts";
import {
  CloudJournalGenesisStore,
  CloudJournalStorageError as LegacyError,
} from "../../infra/cloud/journal-storage.ts";
import {
  cloudJournalLocation,
  createCloudJournalGenesis,
} from "../../infra/cloud/journal-genesis.ts";
import { cloudJournalInput } from "../fixtures/cloud-journal-input.ts";
import golden from "../fixtures/cloud-journal-v2-catalog-golden.json";

const effects = vi.hoisted(() => ({
  fds: new Map<number, string>(),
  databases: new Set<import("node:sqlite").DatabaseSync>(),
  opens: 0,
  commits: 0,
  sqlCloses: 0,
  beforeExec: undefined as
    undefined | ((sql: string, db: import("node:sqlite").DatabaseSync) => void),
  afterCommit: undefined as undefined | (() => void),
  afterSqlClose: undefined as undefined | (() => void),
  beforeSync: undefined as undefined | ((p: string) => void),
  afterClose: undefined as undefined | ((p: string) => void),
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: (p: string, ...args: [number, number?]) => {
      const fd = actual.openSync(p, ...args);
      effects.fds.set(fd, p);
      return fd;
    },
    closeSync: (fd: number) => {
      const p = effects.fds.get(fd)!;
      actual.closeSync(fd);
      effects.fds.delete(fd);
      effects.afterClose?.(p);
    },
    fsyncSync: (fd: number) => {
      effects.beforeSync?.(effects.fds.get(fd)!);
      actual.fsyncSync(fd);
    },
  };
});
vi.mock("node:sqlite", async (original) => {
  const actual = await original<typeof import("node:sqlite")>();
  return {
    ...actual,
    DatabaseSync: class extends actual.DatabaseSync {
      constructor(...args: ConstructorParameters<typeof actual.DatabaseSync>) {
        super(...args);
        effects.opens++;
        effects.databases.add(this);
      }
      close() {
        super.close();
        effects.databases.delete(this);
        effects.sqlCloses++;
        effects.afterSqlClose?.();
      }
      exec(sql: string) {
        effects.beforeExec?.(sql, this);
        const result = super.exec(sql);
        if (sql === "COMMIT") {
          effects.commits++;
          effects.afterCommit?.();
        }
        return result;
      }
    },
  };
});
const parents: string[] = [],
  children: { child: ChildProcess; closed: Promise<unknown> }[] = [];
function fixture() {
  const workspace = realpathSync(
    mkdtempSync(join(tmpdir(), "synkies-v2-initial-")),
  );
  parents.push(workspace);
  const input = cloudJournalInput(workspace),
    directory = cloudJournalLocation(input.anchor).directory;
  return {
    workspace,
    input,
    directory,
    database: join(directory, "journal.sqlite"),
  };
}
const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
const fileHash = (p: string) => hash(readFileSync(p));
function refused(work: () => unknown, code?: string) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(CloudJournalStorageError);
    const e = error as CloudJournalStorageError;
    expect(e.message).toBe("Original Cloud journal storage unavailable");
    expect(e.cause).toBeUndefined();
    expect(Object.keys(e)).toEqual(["code"]);
    expect(Object.isFrozen(e)).toBe(true);
    if (code) expect(e.code).toBe(code);
    return;
  }
  throw Error("expected fixed-v2 refusal");
}
function raw(f: ReturnType<typeof fixture>, work: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(f.database);
  try {
    work(db);
  } finally {
    db.close();
  }
}
function withoutTrigger(db: DatabaseSync, name: string, sql: string) {
  const saved = db
    .prepare("SELECT sql FROM sqlite_schema WHERE name=?")
    .get(name)!.sql as string;
  db.exec("DROP TRIGGER " + name);
  db.exec(sql);
  db.exec(saved);
}
function worker(f: ReturnType<typeof fixture>, mode: string) {
  const request = join(f.workspace, "request-" + children.length + ".json");
  writeFileSync(request, JSON.stringify(f.input), { mode: 0o600 });
  const child = spawn(
    process.execPath,
    ["tests/fixtures/cloud-journal-v2-storage-worker.mjs", request, mode],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  const closed = new Promise((resolve) => child.once("close", resolve));
  children.push({ child, closed });
  let output = "";
  const pending = new Set<() => void>();
  child.stdout!.on("data", (chunk) => {
    output += chunk;
    for (const check of pending) check();
  });
  child.stderr!.on("data", () => {});
  function line(label: string) {
    return new Promise<string>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        pending.delete(check);
      };
      const check = () => {
        const found = output
          .split("\n")
          .find((s) => (label === "result" ? s.startsWith("{") : s === label));
        if (found) {
          done();
          resolve(found);
        } else if (
          output.length > 8192 ||
          child.exitCode !== null ||
          child.signalCode !== null
        ) {
          done();
          reject(Error("synthetic worker checkpoint unavailable"));
        }
      };
      const timer = setTimeout(() => {
        done();
        reject(Error("synthetic worker checkpoint deadline"));
      }, 3000);
      pending.add(check);
      closed.then(check);
      check();
    });
  }
  return { child, closed, line };
}
afterEach(async () => {
  effects.beforeExec =
    effects.afterCommit =
    effects.afterSqlClose =
    effects.beforeSync =
    effects.afterClose =
      undefined;
  for (const c of children.splice(0)) {
    if (c.child.exitCode === null && c.child.signalCode === null)
      c.child.kill("SIGKILL");
    await c.closed;
  }
  const leaked = { files: effects.fds.size, databases: effects.databases.size };
  for (const db of [...effects.databases]) db.close();
  for (const fd of [...effects.fds.keys()]) closeSync(fd);
  for (const p of parents.splice(0))
    rmSync(p, { recursive: true, force: true });
  effects.opens = effects.commits = effects.sqlCloses = 0;
  expect(leaked).toEqual({ files: 0, databases: 0 });
});

it("persists exact original initial state under the protected fixed catalog/settings and grants nothing", () => {
  const f = fixture(),
    original = createCloudJournalGenesis(f.input);
  let settings: unknown[] = [];
  effects.beforeExec = (sql, db) => {
    if (sql === "BEGIN IMMEDIATE")
      settings = [
        "journal_mode",
        "synchronous",
        "fullfsync",
        "foreign_keys",
        "trusted_schema",
        "busy_timeout",
        "page_size",
        "max_page_count",
      ].map(
        (name) =>
          db.prepare("PRAGMA " + name).get()![
            name === "busy_timeout" ? "timeout" : name
          ],
      );
  };
  const store = Store.bootstrap(f.input),
    result = store.read();
  effects.beforeExec = undefined;
  expect(settings).toEqual(["delete", 2, 1, 1, 0, 0, 4096, 512]);
  expect(result).toEqual({
    kind: "synkies-cloud-journal-v2-initial-snapshot",
    storageVersion: 2,
    journalRevision: 0,
    ...original,
  });
  expect(result.genesis.revision).toBe(0);
  expect(result.ownership).toBe("unproven");
  expect(result.runAuthority).toBe("unproven");
  expect(result.resourceWrites).toBe(0);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.genesis.anchor)).toBe(true);
  expect(Object.isFrozen(store)).toBe(true);
  expect(CloudJournalStorageError).toBe(LegacyError);
  const header = readFileSync(f.database).subarray(0, 100);
  expect(header.readUInt32BE(68)).toBe(0x53594a31);
  expect(header.readUInt32BE(60)).toBe(2);
  expect(header.readUInt16BE(16)).toBe(4096);
  raw(f, (db) => {
    const objects = db
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
    expect(db.prepare("SELECT * FROM journal_state").all()).toEqual([
      { id: 1, revision: 0 },
    ]);
  });
  const before = fileHash(f.database);
  expect(Store.open(f.input.anchor).read()).toEqual(result);
  expect(Store.inspect(f.input.anchor)).toEqual(result);
  expect(fileHash(f.database)).toBe(before);
  refused(() => Store.bootstrap(f.input), "exists");
});

it("refuses v1 and unknown headers before SQLite without changing bytes while preserving the old v1 reader", () => {
  const f = fixture();
  const old = CloudJournalGenesisStore.bootstrap(f.input).read();
  for (const userVersion of [1, 3, 0]) {
    const bytes = readFileSync(f.database);
    bytes.writeUInt32BE(userVersion, 60);
    writeFileSync(f.database, bytes);
    const before = fileHash(f.database),
      opens = effects.opens;
    refused(() => Store.open(f.input.anchor), "unrecognized");
    expect(effects.opens).toBe(opens);
    expect(fileHash(f.database)).toBe(before);
  }
  const bytes = readFileSync(f.database);
  bytes.writeUInt32BE(1, 60);
  writeFileSync(f.database, bytes);
  expect(CloudJournalGenesisStore.open(f.input.anchor).read()).toEqual(old);
  const g = fixture();
  Store.bootstrap(g.input);
  const before = fileHash(g.database),
    opens = effects.opens;
  refused(() => CloudJournalGenesisStore.open(g.input.anchor), "unrecognized");
  expect(effects.opens).toBe(opens);
  expect(fileHash(g.database)).toBe(before);
});

it("refuses added, missing and changed catalog object families without repairing them", () => {
  for (const change of [
    "CREATE TABLE extra(id INTEGER)",
    "DROP TRIGGER journal_genesis_no_update",
    "ALTER TABLE journal_state ADD COLUMN extra TEXT",
    "DROP INDEX journal_intent_token; CREATE INDEX journal_intent_token ON journal_intents(client_request_token)",
  ]) {
    const f = fixture();
    Store.bootstrap(f.input);
    raw(f, (db) => db.exec(change));
    const before = fileHash(f.database);
    refused(() => Store.open(f.input.anchor), "unrecognized");
    expect(fileHash(f.database)).toBe(before);
  }
  for (const replacement of ["changed", "oversized"]) {
    const f = fixture();
    Store.bootstrap(f.input);
    raw(f, (db) => {
      let sql = db
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE name='journal_genesis_no_update'",
        )
        .get()!.sql as string;
      sql =
        replacement === "changed"
          ? sql.replace("RAISE(ABORT", "RAISE(FAIL")
          : sql.replace(" BEGIN ", " BEGIN /*" + "x".repeat(8192) + "*/ ");
      db.exec("DROP TRIGGER journal_genesis_no_update");
      db.exec(sql);
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema").get()!.n,
      ).toBe(28);
    });
    refused(() => Store.open(f.input.anchor), "unrecognized");
  }
});

it("refuses a supported-catalog ordinary observation at revision zero", () => {
  const f = fixture();
  Store.bootstrap(f.input);
  raw(f, (db) =>
    db.exec("INSERT INTO journal_observations VALUES(1,'ordinary','{}',1)"),
  );
  const before = fileHash(f.database);
  refused(() => Store.open(f.input.anchor), "unrecognized");
  expect(fileHash(f.database)).toBe(before);
});

it("preserves unsupported later state and nonempty future tables without accepting generic JSON", () => {
  for (const sql of [
    "UPDATE journal_state SET revision=1",
    "INSERT INTO journal_intents VALUES('guard','synthetic','" +
      "a".repeat(64) +
      "','{}','" +
      "b".repeat(64) +
      "','" +
      "c".repeat(64) +
      "','{}',1)",
    "INSERT INTO journal_teardown VALUES(1,'{}',1)",
    "INSERT INTO journal_observations VALUES(1,'cleanup','{}',1)",
  ]) {
    const f = fixture();
    Store.bootstrap(f.input);
    raw(f, (db) => db.exec(sql));
    const before = fileHash(f.database);
    refused(() => Store.inspect(f.input.anchor));
    expect(fileHash(f.database)).toBe(before);
  }
  const f = fixture();
  Store.bootstrap(f.input);
  raw(f, (db) => {
    db.exec(
      "INSERT INTO journal_intents VALUES('guard','synthetic','" +
        "a".repeat(64) +
        "','{}','" +
        "b".repeat(64) +
        "','" +
        "c".repeat(64) +
        "','{}',1)",
    );
    db.exec(
      "INSERT INTO journal_fences VALUES('guard','synthetic','" +
        "a".repeat(64) +
        "','" +
        "b".repeat(64) +
        "','" +
        "c".repeat(64) +
        "',2)",
    );
  });
  refused(() => Store.open(f.input.anchor));
});

it("requires exactly the original genesis, independent anchor and one zero state row", () => {
  for (const [trigger, sql] of [
    ["journal_state_no_delete", "DELETE FROM journal_state"],
    ["journal_genesis_no_delete", "DELETE FROM journal_genesis"],
    [
      "journal_genesis_no_update",
      "UPDATE journal_genesis SET genesis_json='{}'",
    ],
    [
      "journal_genesis_no_update",
      "UPDATE journal_genesis SET genesis_sha256='" + "f".repeat(64) + "'",
    ],
    [
      "journal_genesis_no_update",
      "UPDATE journal_genesis SET scope_sha256='" + "f".repeat(64) + "'",
    ],
  ]) {
    const f = fixture();
    Store.bootstrap(f.input);
    raw(f, (db) => withoutTrigger(db, trigger, sql));
    refused(() => Store.open(f.input.anchor));
  }
  const f = fixture();
  Store.bootstrap(f.input);
  refused(() =>
    Store.open({
      ...f.input.anchor,
      reservation: {
        ...f.input.anchor.reservation,
        reservedAt: "2026-10-27T12:00:11.000Z",
      },
    }),
  );
  const g = fixture(),
    input = cloudJournalInput(join(g.workspace, "absent"));
  refused(
    () =>
      Store.bootstrap({
        ...input,
        manifest: { ...input.manifest, json: "{}" },
      }),
    "invalid-input",
  );
  expect(existsSync(input.anchor.workspaceDirectory)).toBe(false);
});

it("keeps strict namespace/copy/alias refusals and explicit extra-preserving historical inspection", () => {
  const f = fixture(),
    original = Store.bootstrap(f.input).read();
  const extra = join(f.directory, "foreign.txt");
  writeFileSync(extra, "unrecognized synthetic bytes", { mode: 0o600 });
  refused(() => Store.open(f.input.anchor));
  expect(Store.inspect(f.input.anchor)).toEqual(original);
  expect(readFileSync(extra, "utf8")).toBe("unrecognized synthetic bytes");
  const g = fixture();
  cpSync(f.directory, g.directory, { recursive: true });
  refused(() => Store.inspect(g.input.anchor));
  const alias = join(g.workspace, "alias");
  symlinkSync(f.workspace, alias);
  refused(() => Store.open({ ...f.input.anchor, workspaceDirectory: alias }));
});

it("preserves pre-commit failure and lost commit/SQL-close/readback acknowledgements without a successful store", () => {
  for (const stage of ["before", "after", "sql-close", "readback"]) {
    const f = fixture();
    effects.commits = effects.sqlCloses = 0;
    if (stage === "before")
      effects.beforeExec = (sql) => {
        if (sql.startsWith("CREATE TABLE"))
          throw Error("synthetic pre-commit failure");
      };
    if (stage === "after")
      effects.afterCommit = () => {
        throw Error("synthetic lost commit ACK");
      };
    if (stage === "sql-close")
      effects.afterSqlClose = () => {
        if (effects.sqlCloses === 1)
          throw Error("synthetic lost SQL close ACK");
      };
    if (stage === "readback")
      effects.beforeExec = (sql) => {
        if (sql === "BEGIN" && effects.commits > 0)
          throw Error("synthetic readback failure");
      };
    refused(
      () => Store.bootstrap(f.input),
      stage === "before" ? "unavailable" : "uncertain",
    );
    effects.beforeExec =
      effects.afterCommit =
      effects.afterSqlClose =
        undefined;
    if (stage === "before") refused(() => Store.open(f.input.anchor));
    else
      expect(Store.open(f.input.anchor).read().json).toBe(
        createCloudJournalGenesis(f.input).json,
      );
    refused(() => Store.bootstrap(f.input), "exists");
  }
});

it("refuses every post-commit sync ACK loss and final descriptor-close ACK loss as uncertain", () => {
  for (const stage of [
    "journal.sqlite",
    "owner.json",
    "directory",
    "workspace",
    "final-close",
  ]) {
    const f = fixture();
    effects.commits = effects.sqlCloses = 0;
    const target =
      stage === "directory"
        ? f.directory
        : stage === "workspace" || stage === "final-close"
          ? f.workspace
          : join(f.directory, stage);
    if (stage === "final-close") {
      let closes = 0;
      effects.afterClose = (p) => {
        if (p === f.workspace && ++closes === 2)
          throw Error("synthetic lost final close ACK");
      };
    } else
      effects.beforeSync = (p) => {
        if (effects.commits > 0 && p === target)
          throw Error("synthetic post-commit fsync failure");
      };
    refused(() => Store.bootstrap(f.input), "uncertain");
    effects.beforeSync = effects.afterClose = undefined;
    expect(Store.inspect(f.input.anchor).json).toBe(
      createCloudJournalGenesis(f.input).json,
    );
    refused(() => Store.bootstrap(f.input), "exists");
    expect(effects.fds.size).toBe(0);
    expect(effects.databases.size).toBe(0);
  }
});

it("permits exactly one acknowledged independent creator in an actual process race", async () => {
  const f = fixture(),
    a = worker(f, "race"),
    b = worker(f, "race");
  await Promise.all([a.line("ready"), b.line("ready")]);
  a.child.stdin!.end("go");
  b.child.stdin!.end("go");
  const results = (await Promise.all([a.line("result"), b.line("result")])).map(
    (s) => JSON.parse(s),
  );
  await Promise.all([a.closed, b.closed]);
  expect(results.filter((r) => r.kind === "acknowledged")).toEqual([
    {
      kind: "acknowledged",
      sha256: createCloudJournalGenesis(f.input).sha256,
      storageVersion: 2,
      runAuthority: "unproven",
    },
  ]);
  expect(results.filter((r) => r.kind === "refused")).toEqual([
    { kind: "refused", code: "exists" },
  ]);
});

it("preserves actual SIGKILL before/after commit without restart bootstrap or fresh authority", async () => {
  for (const mode of ["before-commit", "after-commit"]) {
    const f = fixture(),
      c = worker(f, mode);
    await c.line(mode === "before-commit" ? "prepared" : "committed");
    c.child.kill("SIGKILL");
    await c.closed;
    expect(c.child.signalCode).toBe("SIGKILL");
    if (mode === "before-commit") refused(() => Store.open(f.input.anchor));
    else {
      const result = Store.inspect(f.input.anchor);
      expect(result.json).toBe(createCloudJournalGenesis(f.input).json);
      expect(result.runAuthority).toBe("unproven");
      expect(result.journalRevision).toBe(0);
    }
    refused(() => Store.bootstrap(f.input), "exists");
  }
});
