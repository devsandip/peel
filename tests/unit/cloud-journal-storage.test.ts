import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudJournalGenesisStore,
  CloudJournalStorageError,
} from "../../infra/cloud/journal-storage.ts";
import {
  cloudJournalLocation,
  createCloudJournalGenesis,
} from "../../infra/cloud/journal-genesis.ts";
import { createCloudJournalFiles } from "../../infra/cloud/journal-files.ts";
import { cloudJournalInput } from "../fixtures/cloud-journal-input.ts";
import * as factories from "../../infra/cloud/expected-inventory.ts";
import * as policy from "../../infra/cloud/deployment-plan.ts";
import * as manifests from "../../infra/cloud/run-manifest.ts";

const effects = vi.hoisted(() => ({
  fds: new Map<number, string>(),
  databases: new Set<object>(),
  opens: 0,
  beforeSync: undefined as undefined | ((path: string) => void),
  atCommit: undefined as
    undefined | ((db: import("node:sqlite").DatabaseSync) => void),
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
      actual.closeSync(fd);
      effects.fds.delete(fd);
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
      }
      exec(sql: string) {
        if (sql === "COMMIT") effects.atCommit?.(this);
        return super.exec(sql);
      }
    },
  };
});
const parents: string[] = [],
  children: ChildProcess[] = [];
function fixture() {
  const workspace = realpathSync(
    mkdtempSync(join(tmpdir(), "synkies-journal-storage-")),
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
function refused(work: () => unknown, code?: string) {
  try {
    work();
  } catch (e) {
    expect(e).toBeInstanceOf(CloudJournalStorageError);
    const error = e as CloudJournalStorageError;
    expect(error.message).toBe("Original Cloud journal storage unavailable");
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error)).toEqual(["code"]);
    expect(Object.isFrozen(error)).toBe(true);
    if (code) expect(error.code).toBe(code);
    return;
  }
  throw Error("expected private storage refusal");
}
const hash = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
function change(f: ReturnType<typeof fixture>, sql: string) {
  const db = new DatabaseSync(f.database);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}
async function exited(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null)
    await once(child, "exit");
}
function worker(f: ReturnType<typeof fixture>, mode: string) {
  const request = join(f.workspace, mode + "-" + children.length + ".json");
  writeFileSync(request, JSON.stringify(f.input), { mode: 0o600 });
  const child = spawn(
    process.execPath,
    ["tests/fixtures/cloud-journal-storage-worker.mjs", request, mode],
    { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
  );
  children.push(child);
  let output = "";
  const waiters: {
    label: string;
    resolve: (s: string) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  function deliver() {
    for (const w of [...waiters]) {
      const found = output
        .split("\n")
        .find((line) =>
          w.label === "result" ? line.startsWith("{") : line === w.label,
        );
      if (found) {
        clearTimeout(w.timer);
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(found);
      }
    }
  }
  child.stdout!.on("data", (chunk) => {
    output += chunk;
    deliver();
  });
  child.stderr!.on("data", () => {});
  child.on("error", () => {
    for (const w of waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(Error("synthetic worker failed"));
    }
  });
  child.on("close", () => {
    deliver();
    for (const w of waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(Error("worker exited before checkpoint"));
    }
  });
  function line(label: string) {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("worker checkpoint timeout")),
        10000,
      );
      waiters.push({ label, resolve, reject, timer });
      deliver();
    });
  }
  return { child, line };
}
afterEach(async () => {
  effects.beforeSync = effects.atCommit = undefined;
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited(child);
  }
  expect(effects.fds.size).toBe(0);
  expect(effects.databases.size).toBe(0);
  for (const p of parents.splice(0))
    rmSync(p, { recursive: true, force: true });
});

it("atomically persists exact immutable original bytes/header/schema/settings and remains unproven", () => {
  const f = fixture(),
    expected = createCloudJournalGenesis(f.input),
    settings: unknown[] = [];
  effects.atCommit = (db) => {
    if (db.prepare("PRAGMA query_only").get()?.query_only === 0)
      settings.push(
        [
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
            db.prepare("PRAGMA " + name).get()?.[
              name === "busy_timeout" ? "timeout" : name
            ],
        ),
      );
  };
  const store = CloudJournalGenesisStore.bootstrap(f.input);
  expect(Object.isFrozen(store)).toBe(true);
  expect(store.read()).toEqual(expected);
  expect(settings).toEqual([["delete", 2, 1, 1, 0, 0, 4096, 512]]);
  expect(store.read()).toMatchObject({
    ownership: "unproven",
    runAuthority: "unproven",
    resourceWrites: 0,
  });
  const bytes = readFileSync(f.database);
  expect(bytes.subarray(0, 16).toString()).toBe("SQLite format 3\0");
  expect(bytes.readUInt32BE(68)).toBe(0x53594a31);
  expect(bytes.readUInt32BE(60)).toBe(1);
  expect(CloudJournalGenesisStore.open(f.input.anchor).read()).toEqual(
    expected,
  );
  expect(CloudJournalGenesisStore.inspect(f.input.anchor)).toEqual(expected);
  refused(() => CloudJournalGenesisStore.bootstrap(f.input), "exists");
});

it("refuses unknown/empty headers before any SQLite open and never initializes on re-entry", () => {
  const f = fixture();
  refused(() => CloudJournalGenesisStore.open(f.input.anchor));
  expect(readdirSync(f.workspace)).toEqual([]);
  createCloudJournalFiles(f.input.anchor).close();
  const opens = effects.opens;
  refused(() => CloudJournalGenesisStore.open(f.input.anchor));
  expect(effects.opens).toBe(opens);
  expect(readFileSync(f.database).length).toBe(0);
  refused(() => CloudJournalGenesisStore.bootstrap(f.input), "exists");
  const g = fixture();
  CloudJournalGenesisStore.bootstrap(g.input);
  const original = readFileSync(g.database);
  for (const offset of [0, 16, 18, 19, 60, 68]) {
    const damaged = Buffer.from(original);
    damaged[offset] ^= 1;
    writeFileSync(g.database, damaged);
    const before = hash(g.database),
      count = effects.opens;
    refused(() => CloudJournalGenesisStore.open(g.input.anchor));
    expect(effects.opens).toBe(count);
    expect(hash(g.database)).toBe(before);
  }
});

it("rejects invalid original inputs before filesystem creation or SQLite access", () => {
  const f = fixture(),
    opens = effects.opens;
  refused(
    () =>
      CloudJournalGenesisStore.bootstrap({
        ...f.input,
        context: {
          ...f.input.context,
          json: "synthetic private invalid context",
        },
      }),
    "invalid-input",
  );
  expect(readdirSync(f.workspace)).toEqual([]);
  expect(effects.opens).toBe(opens);
});

it("preserves unknown schema/rows/digests/anchors and never turns read failure into bootstrap", () => {
  for (const sql of [
    "CREATE TABLE extra(x TEXT) STRICT",
    "DELETE FROM journal_genesis",
    "UPDATE journal_genesis SET genesis_sha256='bad'",
    "UPDATE journal_genesis SET scope_sha256='bad'",
    "UPDATE journal_genesis SET genesis_json='{}'",
  ]) {
    const f = fixture();
    CloudJournalGenesisStore.bootstrap(f.input);
    change(f, sql);
    const before = hash(f.database);
    refused(() => CloudJournalGenesisStore.open(f.input.anchor));
    expect(hash(f.database)).toBe(before);
    refused(() => CloudJournalGenesisStore.bootstrap(f.input), "exists");
  }
  const f = fixture();
  CloudJournalGenesisStore.bootstrap(f.input);
  const altered = structuredClone(f.input.anchor);
  altered.reservation.planSha256 = "b".repeat(64);
  refused(() => CloudJournalGenesisStore.open(altered));
  const copied = join(f.workspace, "saved");
  renameSync(f.directory, copied);
  cpSync(copied, f.directory, { recursive: true });
  refused(() => CloudJournalGenesisStore.open(f.input.anchor));
});

it("keeps strict reads separate from historical inspection and closes all handles after refusal", () => {
  const f = fixture(),
    store = CloudJournalGenesisStore.bootstrap(f.input),
    extra = join(f.directory, "unknown");
  writeFileSync(extra, "synthetic untouched", { mode: 0o600 });
  refused(() => store.read());
  expect(CloudJournalGenesisStore.inspect(f.input.anchor)).toEqual(
    createCloudJournalGenesis(f.input),
  );
  expect(readFileSync(extra, "utf8")).toBe("synthetic untouched");
});

it("recovers exact expired originals without current factories, new-run policy or clock", () => {
  const f = fixture(),
    expected = createCloudJournalGenesis(f.input);
  CloudJournalGenesisStore.bootstrap(f.input);
  const unavailable = () => {
    throw Error("synthetic private current helper unavailable");
  };
  vi.spyOn(factories, "cloudExpectedInventory").mockImplementation(unavailable);
  vi.spyOn(policy, "validateCloudDeploymentPlan").mockImplementation(
    unavailable,
  );
  vi.spyOn(policy, "cloudDevelopmentCost").mockImplementation(unavailable);
  vi.spyOn(manifests, "createCloudRunManifest").mockImplementation(unavailable);
  vi.spyOn(Date, "now").mockImplementation(unavailable);
  let actual: unknown;
  try {
    actual = CloudJournalGenesisStore.inspect(f.input.anchor);
  } finally {
    vi.restoreAllMocks();
  }
  expect(actual).toEqual(expected);
});

it("acknowledges no failed/uncertain bootstrap, retaining incomplete or exact committed state", () => {
  const f = fixture();
  refused(
    () =>
      CloudJournalGenesisStore.bootstrap(f.input, {
        beforeCommit: () => {
          throw Error("synthetic private before commit failure");
        },
      }),
    "unavailable",
  );
  refused(() => CloudJournalGenesisStore.open(f.input.anchor));
  refused(() => CloudJournalGenesisStore.bootstrap(f.input), "exists");
  const g = fixture();
  refused(
    () =>
      CloudJournalGenesisStore.bootstrap(g.input, {
        afterCommit: () => {
          throw Error("synthetic private lost acknowledgement");
        },
      }),
    "uncertain",
  );
  expect(CloudJournalGenesisStore.inspect(g.input.anchor)).toEqual(
    createCloudJournalGenesis(g.input),
  );
  for (const stage of [
    "journal.sqlite",
    "owner.json",
    "directory",
    "workspace",
  ]) {
    const h = fixture();
    let committed = false;
    const target =
      stage === "directory"
        ? h.directory
        : stage === "workspace"
          ? h.workspace
          : join(h.directory, stage);
    effects.beforeSync = (p) => {
      if (committed && p === target)
        throw Error("synthetic private post-commit fsync failure");
    };
    refused(
      () =>
        CloudJournalGenesisStore.bootstrap(h.input, {
          afterCommit: () => {
            committed = true;
          },
        }),
      "uncertain",
    );
    effects.beforeSync = undefined;
    expect(CloudJournalGenesisStore.inspect(h.input.anchor).json).toBe(
      createCloudJournalGenesis(h.input).json,
    );
    refused(() => CloudJournalGenesisStore.bootstrap(h.input), "exists");
  }
});

it("proves fixed schema payload/page capacity separately from semantic genesis, without raising limits", () => {
  const f = fixture();
  CloudJournalGenesisStore.bootstrap(f.input);
  const db = new DatabaseSync(f.database);
  try {
    db.exec(
      "PRAGMA max_page_count=512; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;",
    );
    db.prepare("UPDATE journal_genesis SET genesis_json=?").run(
      "x".repeat(1536 * 1024),
    );
    expect(
      db
        .prepare(
          "SELECT length(CAST(genesis_json AS BLOB)) AS n FROM journal_genesis",
        )
        .get()?.n,
    ).toBe(1536 * 1024);
    expect(statSync(f.database).size).toBeLessThanOrEqual(2 * 1024 * 1024);
    db.exec("BEGIN IMMEDIATE");
    db.prepare("UPDATE journal_genesis SET genesis_json=?").run(
      "y".repeat(1536 * 1024),
    );
    expect(statSync(f.database + "-journal").size).toBeLessThanOrEqual(
      4 * 1024 * 1024,
    );
    db.exec("COMMIT");
    expect(() =>
      db
        .prepare("UPDATE journal_genesis SET genesis_json=?")
        .run("x".repeat(1536 * 1024 + 1)),
    ).toThrow();
    db.exec("CREATE TABLE capacity(x BLOB) STRICT");
    let refusalCode: unknown;
    try {
      db.prepare("INSERT INTO capacity VALUES(?)").run(
        Buffer.alloc(1024 * 1024),
      );
    } catch (error) {
      refusalCode = (error as { errcode?: unknown }).errcode;
    }
    expect(refusalCode).toBe(13); // Actual SQLITE_FULL, not an unrelated refusal.
    expect(
      db.prepare("PRAGMA page_count").get()!.page_count as number,
    ).toBeLessThanOrEqual(512);
    expect(statSync(f.database).size).toBeLessThanOrEqual(2 * 1024 * 1024);
  } finally {
    db.close();
  }
  refused(() => CloudJournalGenesisStore.open(f.input.anchor)); // Capacity payload is intentionally not semantic genesis.
});

it("preserves actual before/after-commit SIGKILL state without a second bootstrap or run grant", async () => {
  for (const mode of ["before-commit", "after-commit"]) {
    const f = fixture(),
      w = worker(f, mode);
    await w.line(mode === "before-commit" ? "prepared" : "committed");
    w.child.kill("SIGKILL");
    await exited(w.child);
    if (mode === "before-commit")
      refused(() => CloudJournalGenesisStore.inspect(f.input.anchor));
    else
      expect(CloudJournalGenesisStore.inspect(f.input.anchor)).toEqual(
        createCloudJournalGenesis(f.input),
      );
    refused(() => CloudJournalGenesisStore.bootstrap(f.input), "exists");
  }
}, 20000);

it("lets actual independent creators acknowledge at most one exact original genesis", async () => {
  const f = fixture(),
    a = worker(f, "race"),
    b = worker(f, "race");
  await Promise.all([a.line("ready"), b.line("ready")]);
  a.child.stdin!.end("go");
  b.child.stdin!.end("go");
  const results = (await Promise.all([a.line("result"), b.line("result")])).map(
    (s) => JSON.parse(s),
  );
  await Promise.all([exited(a.child), exited(b.child)]);
  expect(results.filter((r) => r.kind === "acknowledged")).toEqual([
    {
      kind: "acknowledged",
      sha256: createCloudJournalGenesis(f.input).sha256,
      runAuthority: "unproven",
    },
  ]);
  expect(results.filter((r) => r.kind === "refused")).toEqual([
    { kind: "refused", code: "exists" },
  ]);
  expect(CloudJournalGenesisStore.inspect(f.input.anchor)).toEqual(
    createCloudJournalGenesis(f.input),
  );
}, 20000);
