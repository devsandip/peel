import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  fstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudJournalFilesError,
  createCloudJournalFiles,
  openCloudJournalFiles,
} from "../../infra/cloud/journal-files.ts";
import { cloudJournalLocation } from "../../infra/cloud/journal-genesis.ts";

const effects = vi.hoisted(() => ({
  fds: new Map<number, string>(),
  syncs: [] as string[],
  beforeOpen: undefined as undefined | ((path: string) => void),
  afterOpen: undefined as undefined | ((path: string) => void),
  beforeStat: undefined as undefined | ((fd: number) => void),
  beforeSync: undefined as undefined | ((path: string) => void),
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: (path: string, ...args: [number, number?]) => {
      effects.beforeOpen?.(path);
      const fd = actual.openSync(path, ...args);
      effects.fds.set(fd, path);
      effects.afterOpen?.(path);
      return fd;
    },
    closeSync: (fd: number) => {
      actual.closeSync(fd);
      effects.fds.delete(fd);
    },
    fstatSync: (fd: number, options: { bigint: true }) => {
      effects.beforeStat?.(fd);
      return actual.fstatSync(fd, options);
    },
    fsyncSync: (fd: number) => {
      const path = effects.fds.get(fd)!;
      effects.syncs.push(path);
      effects.beforeSync?.(path);
      actual.fsyncSync(fd);
    },
  };
});

const parents: string[] = [],
  handles: ReturnType<typeof createCloudJournalFiles>[] = [];
function fixture() {
  const parent = realpathSync(
      mkdtempSync(join(tmpdir(), "synkies-journal-files-")),
    ),
    workspace = join(parent, "workspace");
  parents.push(parent);
  mkdirSync(workspace, { mode: 0o700 });
  const anchor = {
    workspaceDirectory: workspace,
    ledgerDirectory: join(parent, "funding"),
    authority: {
      identity: {
        profile: "synthetic",
        accountId: "111122223333",
        region: "us-east-1",
      },
      authorizedUntil: "2026-10-27T18:00:00.000Z",
    },
    reservation: {
      slot: 1,
      runId: "00000000-0000-4000-8000-000000000001",
      planSha256: "a".repeat(64),
      reservedAt: "2026-10-27T12:00:00.000Z",
    },
  };
  const directory = cloudJournalLocation(anchor).directory;
  return {
    parent,
    workspace,
    anchor,
    directory,
    database: join(directory, "journal.sqlite"),
    marker: join(directory, "owner.json"),
  };
}
function create(f: ReturnType<typeof fixture>) {
  const h = createCloudJournalFiles(f.anchor);
  handles.push(h);
  return h;
}
function open(f: ReturnType<typeof fixture>, inspection = false) {
  const h = openCloudJournalFiles(f.anchor, inspection);
  handles.push(h);
  return h;
}
function refused(work: () => unknown, code?: string) {
  try {
    work();
  } catch (e) {
    expect(e).toBeInstanceOf(CloudJournalFilesError);
    const error = e as CloudJournalFilesError;
    expect(error.message).toBe("Cloud journal files unavailable");
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error)).toEqual(["code"]);
    expect(Object.isFrozen(error)).toBe(true);
    if (code) expect(error.code).toBe(code);
    return;
  }
  throw Error("expected private refusal");
}
afterEach(() => {
  vi.restoreAllMocks();
  effects.beforeOpen =
    effects.afterOpen =
    effects.beforeStat =
    effects.beforeSync =
      undefined;
  for (const h of handles.splice(0)) h.close();
  expect(effects.fds.size).toBe(0);
  effects.syncs.length = 0;
  for (const p of parents.splice(0))
    rmSync(p, { recursive: true, force: true });
});

it("exclusively creates exact private files/marker and syncs held descriptors in order, without SQLite", () => {
  const f = fixture(),
    h = create(f);
  expect(Object.isFrozen(h)).toBe(true);
  expect(h).toMatchObject({
    directory: f.directory,
    databasePath: f.database,
    runAuthority: "unproven",
    resourceWrites: 0,
  });
  expect(readdirSync(f.directory).sort()).toEqual([
    "journal.sqlite",
    "owner.json",
  ]);
  expect(readFileSync(f.database).length).toBe(0); // Still an incomplete SQLite journal.
  for (const p of [f.workspace, f.directory])
    expect(statSync(p).mode & 0o7777).toBe(0o700);
  for (const p of [f.database, f.marker])
    expect(statSync(p).mode & 0o7777).toBe(0o600);
  const ws = statSync(f.workspace, { bigint: true }),
    ds = statSync(f.directory, { bigint: true }),
    db = statSync(f.database, { bigint: true });
  expect(readFileSync(f.marker, "utf8")).toBe(
    JSON.stringify({
      format: 1,
      kind: "synkies-cloud-journal-files",
      scopeSha256: h.scopeSha256,
      workspaceDevice: String(ws.dev),
      workspaceInode: String(ws.ino),
      directoryDevice: String(ds.dev),
      directoryInode: String(ds.ino),
      databaseDevice: String(db.dev),
      databaseInode: String(db.ino),
    }) + "\n",
  );
  expect(effects.fds.size).toBe(4);
  expect(effects.syncs).toEqual([
    f.database,
    f.marker,
    f.directory,
    f.workspace,
  ]);
  h.close();
  h.close();
  expect(effects.fds.size).toBe(0);
  refused(() => h.verify(), "unavailable");
  refused(() => h.sync(), "unavailable");
  expect(open(f).scopeSha256).toBe(h.scopeSha256);
  refused(() => createCloudJournalFiles(f.anchor), "exists");
});

it("never initializes on open or adopts existing/partial data on create", () => {
  const f = fixture();
  refused(() => openCloudJournalFiles(f.anchor));
  expect(readdirSync(f.workspace)).toEqual([]);
  mkdirSync(f.directory, { mode: 0o700 });
  writeFileSync(f.database, "synthetic unknown", { mode: 0o600 });
  refused(() => createCloudJournalFiles(f.anchor), "exists");
  refused(() => openCloudJournalFiles(f.anchor));
  expect(readFileSync(f.database, "utf8")).toBe("synthetic unknown");
  expect(readdirSync(f.directory)).toEqual(["journal.sqlite"]);
});

it("refuses invalid anchors before touching files and keeps the independent input detached", () => {
  const f = fixture();
  effects.beforeOpen = () => {
    throw Error("must not reach filesystem");
  };
  refused(() =>
    createCloudJournalFiles({ ...f.anchor, secret: "synthetic private" }),
  );
  expect(effects.fds.size).toBe(0);
  effects.beforeOpen = undefined;
  const h = create(f);
  f.anchor.reservation.planSha256 = "b".repeat(64);
  h.verify();
  refused(() => openCloudJournalFiles(f.anchor));
});

it("refuses a workspace alias or nonprivate/special modes without repairing them", () => {
  const f = fixture(),
    alias = join(f.parent, "alias");
  symlinkSync(f.workspace, alias);
  refused(() =>
    createCloudJournalFiles({ ...f.anchor, workspaceDirectory: alias }),
  );
  const ancestorAlias = join(f.parent, "parent-alias");
  symlinkSync(f.parent, ancestorAlias);
  refused(() =>
    createCloudJournalFiles({
      ...f.anchor,
      workspaceDirectory: join(ancestorAlias, "workspace"),
    }),
  );
  for (const mode of [0o755, 0o1700]) {
    chmodSync(f.workspace, mode);
    refused(() => createCloudJournalFiles(f.anchor));
    expect(statSync(f.workspace).mode & 0o7777).toBe(mode);
  }
  expect(readdirSync(f.workspace)).toEqual([]);
});

it("refuses changed directory/file modes, links and symlinks without changing targets", () => {
  const linked = fixture(),
    targetDirectory = join(linked.parent, "target-directory");
  mkdirSync(targetDirectory, { mode: 0o700 });
  symlinkSync(targetDirectory, linked.directory);
  refused(() => createCloudJournalFiles(linked.anchor), "exists");
  refused(() => openCloudJournalFiles(linked.anchor));
  expect(readdirSync(targetDirectory)).toEqual([]);
  for (const name of [".", "journal.sqlite", "owner.json"]) {
    for (const special of [false, true]) {
      const f = fixture();
      create(f).close();
      const p = join(f.directory, name),
        mode = (name === "." ? 0o700 : 0o600) | (special ? 0o1000 : 0o044);
      chmodSync(p, mode);
      refused(() => openCloudJournalFiles(f.anchor));
      expect(statSync(p).mode & 0o7777).toBe(mode);
    }
  }
  for (const name of ["journal.sqlite", "owner.json"]) {
    const f = fixture();
    create(f).close();
    const p = join(f.directory, name),
      target = join(f.parent, "target");
    renameSync(p, target);
    symlinkSync(target, p);
    const before = readFileSync(target);
    refused(() => openCloudJournalFiles(f.anchor));
    expect(readFileSync(target)).toEqual(before);
    rmSync(p);
    linkSync(target, p);
    refused(() => openCloudJournalFiles(f.anchor));
    expect(readFileSync(target)).toEqual(before);
  }
});

it("rejects copied database/directory/workspace identities and rechecks live parent replacement", () => {
  for (const target of ["database", "directory", "workspace"] as const) {
    const f = fixture(),
      h = create(f),
      p = f[target],
      saved = join(f.parent, "saved");
    renameSync(p, saved);
    if (target === "database") copyFileSync(saved, p);
    else cpSync(saved, p, { recursive: true });
    refused(() => h.verify());
    refused(() => openCloudJournalFiles(f.anchor));
  }
});

it("refuses changed canonical marker bytes including BOM, private keys, whitespace and oversized data", () => {
  for (const transform of [
    (s: string) => "\ufeff" + s,
    (s: string) => s.trim(),
    (s: string) => s.replace("{", '{"secret":"synthetic",'),
    (s: string) => s.replace('"format":1', '"format":2'),
    () => "x".repeat(4097),
    () => Buffer.from([0xff]),
  ]) {
    const f = fixture();
    create(f).close();
    writeFileSync(f.marker, transform(readFileSync(f.marker, "utf8")));
    const before = readFileSync(f.marker);
    refused(() => openCloudJournalFiles(f.anchor));
    expect(readFileSync(f.marker)).toEqual(before);
  }
});

it("checks database/rollback bounds and private rollback headers without reading extra files", () => {
  const f = fixture(),
    h = create(f),
    rollback = f.database + "-journal";
  truncateSync(f.database, 2 * 1024 * 1024);
  h.verify();
  truncateSync(f.database, 2 * 1024 * 1024 + 1);
  refused(() => h.verify());
  truncateSync(f.database, 0);
  for (const header of [
    Buffer.alloc(8),
    Buffer.from("d9d505f920a163d7", "hex"),
    Buffer.alloc(0),
  ]) {
    writeFileSync(rollback, header, { mode: 0o600 });
    h.verify();
  }
  truncateSync(rollback, 4 * 1024 * 1024);
  h.verify();
  truncateSync(rollback, 4 * 1024 * 1024 + 1);
  refused(() => h.verify());
  writeFileSync(rollback, "bad");
  refused(() => h.verify());
  writeFileSync(rollback, Buffer.alloc(8));
  chmodSync(rollback, 0o644);
  refused(() => h.verify());
  rmSync(rollback);
  const rollbackTarget = join(f.parent, "rollback-target");
  writeFileSync(rollbackTarget, Buffer.alloc(8), { mode: 0o600 });
  symlinkSync(rollbackTarget, rollback);
  refused(() => h.verify());
  rmSync(rollback);
  linkSync(rollbackTarget, rollback);
  refused(() => h.verify());
  rmSync(rollback);
  const extra = join(f.directory, "unrecognized"),
    outside = join(f.parent, "private");
  writeFileSync(outside, "synthetic untouched");
  symlinkSync(outside, extra);
  refused(() => h.verify());
  refused(() => openCloudJournalFiles(f.anchor));
  open(f, true).verify();
  refused(() => open(f, true).sync());
  expect(readFileSync(outside, "utf8")).toBe("synthetic untouched");
});

it("closes every descriptor after each failed sync stage and preserves partial files", () => {
  for (const stage of [
    "journal.sqlite",
    "owner.json",
    "directory",
    "workspace",
  ]) {
    const f = fixture(),
      selected =
        stage === "directory"
          ? f.directory
          : stage === "workspace"
            ? f.workspace
            : join(f.directory, stage);
    effects.beforeSync = (p) => {
      if (p === selected) throw Error("synthetic private fsync failure");
    };
    refused(() => createCloudJournalFiles(f.anchor), "unavailable");
    expect(effects.fds.size).toBe(0);
    effects.beforeSync = undefined;
    expect(readdirSync(f.directory).sort()).toEqual([
      "journal.sqlite",
      "owner.json",
    ]);
    open(f).close();
    refused(() => createCloudJournalFiles(f.anchor), "exists");
  }
});

it("checks actual fstat identity/modes after open and closes failed newly opened handles", () => {
  const f = fixture();
  create(f).close();
  effects.afterOpen = (p) => {
    if (p !== f.database) return;
    effects.afterOpen = undefined;
    renameSync(p, join(f.parent, "original"));
    writeFileSync(p, "replacement", { mode: 0o600 });
  };
  refused(() => openCloudJournalFiles(f.anchor));
  expect(effects.fds.size).toBe(0);
  const g = fixture();
  create(g).close();
  effects.beforeStat = (fd) => {
    if (effects.fds.get(fd) !== g.marker) return;
    effects.beforeStat = undefined;
    throw Error("synthetic private fstat failure");
  };
  refused(() => openCloudJournalFiles(g.anchor));
  expect(effects.fds.size).toBe(0);
});

it("refuses wrong UID and changed descriptor permissions after path validation", () => {
  const f = fixture();
  create(f).close();
  const uid = process.getuid!();
  vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
  refused(() => openCloudJournalFiles(f.anchor));
  expect(effects.fds.size).toBe(0);
  vi.restoreAllMocks();
  effects.afterOpen = (p) => {
    if (p !== f.marker) return;
    effects.afterOpen = undefined;
    chmodSync(p, 0o644);
  };
  refused(() => openCloudJournalFiles(f.anchor));
  expect(effects.fds.size).toBe(0);
  expect(statSync(f.marker).mode & 0o7777).toBe(0o644);
});

it("retains partial exclusive creation when marker creation fails and never fills it on re-entry", () => {
  const f = fixture();
  effects.beforeOpen = (p) => {
    if (p === f.marker) throw Error("synthetic private marker failure");
  };
  refused(() => createCloudJournalFiles(f.anchor));
  expect(effects.fds.size).toBe(0);
  effects.beforeOpen = undefined;
  expect(readdirSync(f.directory)).toEqual(["journal.sqlite"]);
  expect(readFileSync(f.database).length).toBe(0);
  refused(() => createCloudJournalFiles(f.anchor), "exists");
  refused(() => openCloudJournalFiles(f.anchor));
  expect(readdirSync(f.directory)).toEqual(["journal.sqlite"]);
});

it("revalidates around synchronization and closes transient rollback handles on validation failure", () => {
  const f = fixture(),
    h = create(f);
  effects.beforeSync = () => {
    effects.beforeSync = undefined;
    chmodSync(f.workspace, 0o755);
  };
  refused(() => h.sync());
  chmodSync(f.workspace, 0o700);
  const rollback = f.database + "-journal";
  writeFileSync(rollback, Buffer.alloc(8), { mode: 0o600 });
  effects.beforeStat = (fd) => {
    if (effects.fds.get(fd) !== rollback) return;
    effects.beforeStat = undefined;
    throw Error("synthetic rollback descriptor failure");
  };
  refused(() => h.verify());
  expect(effects.fds.size).toBe(4);
  h.verify();
  for (const fd of effects.fds.keys())
    expect(fstatSync(fd, { bigint: true }).uid).toBe(BigInt(process.getuid!()));
});

it("allows exactly one namespace creator across actual independent processes, with no run grant", async () => {
  const f = fixture(),
    request = join(f.parent, "request.json");
  writeFileSync(request, JSON.stringify(f.anchor), { mode: 0o600 });
  const children = [0, 1].map(() => {
    const child = spawn(
      process.execPath,
      ["tests/fixtures/cloud-journal-files-worker.mjs", request],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      errors = "";
    const ready = new Promise<void>((resolve) =>
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes("ready\n")) resolve();
      }),
    );
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    const done = new Promise<string>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve(output) : reject(Error(errors)),
      );
    });
    return { child, ready, done };
  });
  try {
    await Promise.all(children.map((c) => c.ready));
    for (const c of children) c.child.stdin.end("go");
    const results = (await Promise.all(children.map((c) => c.done))).map((s) =>
      JSON.parse(s.trim().split("\n").at(-1)!),
    );
    expect(results.filter((r) => r.kind === "files-created")).toEqual([
      { kind: "files-created", runAuthority: "unproven" },
    ]);
    expect(results.filter((r) => r.kind === "refused")).toEqual([
      { kind: "refused", code: "exists" },
    ]);
    expect(readFileSync(f.database).length).toBe(0);
    open(f).verify();
  } finally {
    for (const c of children) c.child.kill("SIGKILL");
  }
}, 15000);
