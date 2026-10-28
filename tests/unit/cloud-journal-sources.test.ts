import { afterEach, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudSourceBoundJournalStore,
  CloudJournalSourceError,
} from "../../infra/cloud/journal-sources.ts";
import { CloudRunLedger } from "../../infra/cloud/run-ledger.ts";
import { CloudRunManifestStore } from "../../infra/cloud/manifest-storage.ts";
import { CloudRunContextStore } from "../../infra/cloud/run-context-storage.ts";
import { createCloudRunPlanContext } from "../../infra/cloud/run-plan-context.ts";
import { cloudNormalizedPlanFixture } from "../fixtures/cloud-normalized-plan.ts";
import {
  cloudLedgerPlan,
  ledgerRunIds,
} from "../fixtures/cloud-ledger-plan.ts";
import * as policy from "../../infra/cloud/deployment-plan.ts";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as manifestCodec from "../../infra/cloud/run-manifest.ts";

const effects = vi.hoisted(() => ({
  fds: new Map<number, string>(),
  databases: new Set<object>(),
  syncs: [] as string[],
  refuseSync: undefined as undefined | ((path: string) => boolean),
  opens: 0,
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: (path: string, ...args: [number, number?]) => {
      const fd = actual.openSync(path, ...args);
      effects.fds.set(fd, path);
      effects.opens++;
      return fd;
    },
    closeSync: (fd: number) => {
      actual.closeSync(fd);
      effects.fds.delete(fd);
    },
    fsyncSync: (fd: number) => {
      const path = effects.fds.get(fd)!;
      effects.syncs.push(path);
      if (effects.refuseSync?.(path))
        throw Error("synthetic private source fsync");
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
        effects.databases.add(this);
      }
      close() {
        super.close();
        effects.databases.delete(this);
      }
    },
  };
});
const parents: string[] = [],
  children: ChildProcess[] = [],
  now = Date.parse("2026-10-27T12:00:00.000Z");
function sample(second = false, id = ledgerRunIds[0], time = now) {
  const value = cloudNormalizedPlanFixture(second, id, time),
    context = createCloudRunPlanContext(value),
    run = cloudLedgerPlan(id, time);
  run.plan.source.templatesSha256 = context.plan.source.templatesSha256;
  run.observed.source.templatesSha256 = context.plan.source.templatesSha256;
  return { value, context, run };
}
function fixture() {
  const parent = realpathSync(
      mkdtempSync(join(tmpdir(), "synkies-journal-source-")),
    ),
    workspace = join(parent, "run");
  parents.push(parent);
  mkdirSync(workspace, { mode: 0o700 });
  const s = sample(),
    ledgerDirectory = join(parent, "funding"),
    manifestDirectory = join(workspace, "recipe"),
    contextDirectory = join(workspace, "context"),
    ledger = CloudRunLedger.create(ledgerDirectory, s.run.authorization);
  ledger.reserve(s.run.plan, s.run.observed, ledger.read().snapshotSha256, {
    clock: () => s.run.now,
  });
  CloudRunManifestStore.create(manifestDirectory, s.value.manifest);
  const expected = {
    contextSha256: s.context.contextSha256,
    manifest: { directory: manifestDirectory, pin: s.value.manifest.pin },
    ledger: { directory: ledgerDirectory, authority: s.run.authorization },
  };
  CloudRunContextStore.create(contextDirectory, {
    json: s.context.json,
    expected,
  });
  const selection = {
      workspaceDirectory: workspace,
      ledgerDirectory,
      authority: s.run.authorization,
      runId: ledgerRunIds[0],
    },
    value = {
      selection,
      manifest: { directory: manifestDirectory, pin: s.value.manifest.pin },
      context: { directory: contextDirectory, sha256: s.context.contextSha256 },
    };
  effects.syncs.length = 0;
  return {
    parent,
    workspace,
    s,
    ledger,
    ledgerDirectory,
    manifestDirectory,
    contextDirectory,
    expected,
    selection,
    value,
    directory: join(workspace, "journal-" + selection.runId),
  };
}
function refused(work: () => unknown, code?: string) {
  try {
    work();
  } catch (e) {
    expect(e).toBeInstanceOf(CloudJournalSourceError);
    const error = e as CloudJournalSourceError;
    expect(error.message).toBe("Original Cloud journal sources unavailable");
    expect(error.cause).toBeUndefined();
    expect(Object.keys(error)).toEqual(["code"]);
    expect(Object.isFrozen(error)).toBe(true);
    if (code) expect(error.code).toBe(code);
    return;
  }
  throw Error("expected private source refusal");
}
const hash = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
async function exited(c: ChildProcess) {
  if (c.exitCode === null && c.signalCode === null) await once(c, "exit");
}
function worker(f: ReturnType<typeof fixture>, mode: string) {
  const request = join(f.parent, mode + "-" + children.length + ".json");
  writeFileSync(request, JSON.stringify(f.value), { mode: 0o600 });
  const child = spawn(
    process.execPath,
    ["tests/fixtures/cloud-journal-sources-worker.mjs", request, mode],
    { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] },
  );
  children.push(child);
  let output = "";
  const waiting: {
    label: string;
    resolve: (s: string) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  function deliver() {
    for (const w of [...waiting]) {
      const line = output
        .split("\n")
        .find((s) =>
          w.label === "result" ? s.startsWith("{") : s === w.label,
        );
      if (line) {
        clearTimeout(w.timer);
        waiting.splice(waiting.indexOf(w), 1);
        w.resolve(line);
      }
    }
  }
  child.stdout!.on("data", (chunk) => {
    output += chunk;
    deliver();
  });
  child.stderr!.on("data", () => {});
  function fail() {
    deliver();
    for (const w of waiting.splice(0)) {
      clearTimeout(w.timer);
      w.reject(Error("source worker unavailable"));
    }
  }
  child.on("error", fail);
  child.on("close", fail);
  const line = (label: string) =>
    new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("source worker checkpoint timeout")),
        10000,
      );
      waiting.push({ label, resolve, reject, timer });
      deliver();
    });
  return { child, line };
}
afterEach(async () => {
  effects.refuseSync = undefined;
  effects.syncs.length = 0;
  vi.restoreAllMocks();
  for (const c of children.splice(0)) {
    if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
    await exited(c);
  }
  expect(effects.fds.size).toBe(0);
  expect(effects.databases.size).toBe(0);
  for (const p of parents.splice(0))
    rmSync(p, { recursive: true, force: true });
});

it("binds actual independent funding and distinct source acknowledgements, retaining exact original bytes", () => {
  const f = fixture(),
    tuple = f.ledger.readReservation(f.selection.runId),
    before = hash(join(f.ledgerDirectory, "runs.sqlite")),
    store = CloudSourceBoundJournalStore.bootstrap(f.value),
    observed = store.read();
  expect(Object.isFrozen(store)).toBe(true);
  expect(observed.genesis.anchor.reservation).toEqual(tuple);
  expect(observed.genesis.manifest.json).toBe(f.s.value.manifest.json);
  expect(observed.genesis.context.json).toBe(f.s.context.json);
  expect(observed).toMatchObject({
    ownership: "unproven",
    runAuthority: "unproven",
    resourceWrites: 0,
  });
  expect(
    effects.syncs.filter(
      (p) => p === join(f.manifestDirectory, "manifest.json"),
    ).length,
  ).toBeGreaterThanOrEqual(3);
  expect(
    effects.syncs.filter((p) => p === join(f.contextDirectory, "context.json"))
      .length,
  ).toBeGreaterThanOrEqual(3);
  expect(hash(join(f.ledgerDirectory, "runs.sqlite"))).toBe(before);
  expect(CloudSourceBoundJournalStore.open(f.selection).read()).toEqual(
    observed,
  );
  refused(() => CloudSourceBoundJournalStore.bootstrap(f.value), "exists");
});

it("does not substitute context-only synchronization for an independently acknowledged recipe", () => {
  const f = fixture(),
    recipe = join(f.manifestDirectory, "manifest.json");
  effects.refuseSync = (p) => p === recipe;
  CloudRunContextStore.open(f.contextDirectory, f.expected); // The actual context opener does not re-sync the recipe.
  expect(effects.syncs).not.toContain(recipe);
  expect(effects.syncs).toContain(join(f.contextDirectory, "context.json"));
  refused(() => CloudSourceBoundJournalStore.bootstrap(f.value));
  expect(effects.syncs).toContain(recipe);
  expect(existsSync(f.directory)).toBe(false);
  expect(f.ledger.readReservation(f.selection.runId)?.slot).toBe(1);
});

it("refuses failed context acknowledgement before journal creation and preserves both sources", () => {
  const f = fixture(),
    recipe = join(f.manifestDirectory, "manifest.json"),
    context = join(f.contextDirectory, "context.json"),
    before = [hash(recipe), hash(context)];
  effects.refuseSync = (p) => p === context;
  refused(() => CloudSourceBoundJournalStore.bootstrap(f.value));
  expect(effects.syncs).toContain(recipe);
  expect(existsSync(f.directory)).toBe(false);
  expect([hash(recipe), hash(context)]).toEqual(before);
});

it("captures strict independent inputs before filesystem access and never accepts supplied rows or owned flags", () => {
  const f = fixture(),
    reads = effects.opens,
    getter = vi.fn(() => "private");
  for (const value of [
    { ...f.value, owned: true },
    { ...f.value, selection: { ...f.selection, reservation: { slot: 1 } } },
    {
      ...f.value,
      manifest: {
        ...f.value.manifest,
        pin: { ...f.value.manifest.pin, secret: "private" },
      },
    },
    { ...f.value, context: { ...f.value.context, sha256: "F".repeat(64) } },
    {
      ...f.value,
      selection: { ...f.selection, workspaceDirectory: "relative" },
    },
    Object.defineProperty({ ...f.value }, "context", {
      enumerable: true,
      get: getter,
    }),
  ])
    refused(
      () => CloudSourceBoundJournalStore.bootstrap(value as never),
      "invalid-input",
    );
  expect(effects.opens).toBe(reads);
  expect(getter).not.toHaveBeenCalled();
  expect(existsSync(f.directory)).toBe(false);
});

it("refuses aliases, changed actual funding authority/run and wrong source pins without a replacement journal", () => {
  const f = fixture(),
    alias = join(f.parent, "alias");
  symlinkSync(f.workspace, alias);
  for (const value of [
    { ...f.value, selection: { ...f.selection, workspaceDirectory: alias } },
    {
      ...f.value,
      selection: {
        ...f.selection,
        authority: {
          ...f.selection.authority,
          identity: {
            ...f.selection.authority.identity,
            accountId: "999900001111",
          },
        },
      },
    },
    { ...f.value, selection: { ...f.selection, runId: ledgerRunIds[2] } },
    { ...f.value, context: { ...f.value.context, sha256: "a".repeat(64) } },
  ])
    refused(() => CloudSourceBoundJournalStore.bootstrap(value));
  const sourceAlias = join(f.workspace, "source-alias");
  symlinkSync(f.manifestDirectory, sourceAlias);
  refused(() =>
    CloudSourceBoundJournalStore.bootstrap({
      ...f.value,
      manifest: { ...f.value.manifest, directory: sourceAlias },
    }),
  );
  expect(existsSync(f.directory)).toBe(false);
});

it("rechecks source acknowledgements before commit and preserves the incomplete namespace on failure", () => {
  const f = fixture();
  refused(() =>
    CloudSourceBoundJournalStore.bootstrap(f.value, {
      beforeCommit: () => {
        effects.refuseSync = (p) =>
          p === join(f.manifestDirectory, "manifest.json");
      },
    }),
  );
  effects.refuseSync = undefined;
  expect(existsSync(f.directory)).toBe(true);
  refused(() => CloudSourceBoundJournalStore.inspect(f.selection));
  refused(() => CloudSourceBoundJournalStore.bootstrap(f.value), "exists");
});

it("rechecks exact actual funding time around commit without silently repairing a changed reservation", () => {
  const f = fixture(),
    changed = "2026-10-27T12:00:00.001Z";
  refused(() =>
    CloudSourceBoundJournalStore.bootstrap(f.value, {
      beforeCommit: () => {
        const db = new DatabaseSync(join(f.ledgerDirectory, "runs.sqlite"));
        try {
          db.prepare(
            "UPDATE reservations SET reserved_at=? WHERE run_id=?",
          ).run(changed, f.selection.runId);
        } finally {
          db.close();
        }
      },
    }),
  );
  expect(f.ledger.readReservation(f.selection.runId)?.reservedAt).toBe(changed);
  refused(() => CloudSourceBoundJournalStore.inspect(f.selection));
});

it("retains exact committed history after post-commit source loss and never calls it a source acknowledgement", () => {
  const f = fixture();
  refused(
    () =>
      CloudSourceBoundJournalStore.bootstrap(f.value, {
        afterCommit: () =>
          renameSync(f.manifestDirectory, join(f.parent, "saved-recipe")),
      }),
    "uncertain",
  );
  const historical = CloudSourceBoundJournalStore.inspect(f.selection);
  expect(historical.genesis.manifest.json).toBe(f.s.value.manifest.json);
  expect(historical.runAuthority).toBe("unproven");
  refused(() => CloudSourceBoundJournalStore.open(f.selection));
  expect(readdirSync(f.directory).sort()).toEqual([
    "journal.sqlite",
    "owner.json",
  ]);
});

it("reopens from retained pins after caller memory changes and distinguishes source reads from sync", () => {
  const f = fixture(),
    independent = structuredClone(f.selection),
    store = CloudSourceBoundJournalStore.bootstrap(f.value),
    expected = store.read();
  f.value.context.sha256 = "b".repeat(64);
  f.value.manifest.directory = join(f.parent, "missing");
  f.value.selection.runId = ledgerRunIds[2];
  effects.syncs.length = 0;
  expect(store.read()).toEqual(expected);
  expect(effects.syncs).toEqual([]);
  expect(CloudSourceBoundJournalStore.open(independent).read()).toEqual(
    expected,
  );
  expect(effects.syncs).toContain(join(f.contextDirectory, "context.json"));
});

it("preserves old-run identity after actual cleanup and a second independently reserved run", () => {
  const f = fixture(),
    store = CloudSourceBoundJournalStore.bootstrap(f.value),
    before = store.read();
  f.ledger.recordCleanup(
    {
      runId: ledgerRunIds[0],
      planSha256: f.s.context.planSha256,
      inventorySha256: "9".repeat(64),
      checkedAt: new Date(now + 1000).toISOString(),
    },
    f.ledger.read().snapshotSha256,
    { clock: () => now + 1000 },
  );
  const second = sample(true, ledgerRunIds[1], now + 10000);
  f.ledger.reserve(
    second.run.plan,
    second.run.observed,
    f.ledger.read().snapshotSha256,
    { clock: () => second.run.now },
  );
  expect(CloudSourceBoundJournalStore.open(f.selection).read()).toEqual(before);
  expect(CloudSourceBoundJournalStore.inspect(f.selection)).toEqual(before);
});

it("recovers expired original history with missing sources/current helpers and refuses damaged funding or copied journals", () => {
  const f = fixture(),
    store = CloudSourceBoundJournalStore.bootstrap(f.value),
    before = store.read();
  renameSync(f.contextDirectory, join(f.parent, "saved-context"));
  const unavailable = () => {
    throw Error("synthetic private current helper unavailable");
  };
  vi.spyOn(current, "cloudExpectedInventory").mockImplementation(unavailable);
  vi.spyOn(policy, "validateCloudDeploymentPlan").mockImplementation(
    unavailable,
  );
  vi.spyOn(manifestCodec, "createCloudRunManifest").mockImplementation(
    unavailable,
  );
  vi.spyOn(Date, "now").mockImplementation(unavailable);
  let read: unknown;
  try {
    read = CloudSourceBoundJournalStore.inspect(f.selection);
  } finally {
    vi.restoreAllMocks();
  }
  expect(read).toEqual(before);
  refused(() => store.read());
  const saved = join(f.workspace, "saved-journal");
  renameSync(f.directory, saved);
  cpSync(saved, f.directory, { recursive: true });
  refused(() => CloudSourceBoundJournalStore.inspect(f.selection));
  rmSync(f.directory, { recursive: true });
  renameSync(saved, f.directory);
  renameSync(f.ledgerDirectory, join(f.parent, "saved-funding"));
  refused(() => CloudSourceBoundJournalStore.inspect(f.selection));
});

it("keeps strict sources separate from explicit journal recovery and preserves unknown extras", () => {
  const f = fixture(),
    store = CloudSourceBoundJournalStore.bootstrap(f.value),
    before = store.read(),
    extra = join(f.directory, "unknown");
  writeFileSync(extra, "synthetic untouched", { mode: 0o600 });
  refused(() => store.read());
  expect(CloudSourceBoundJournalStore.inspect(f.selection)).toEqual(before);
  expect(readFileSync(extra, "utf8")).toBe("synthetic untouched");
});

it("keeps actual source-bound SIGKILL/lost-ack recovery independent of caller pins and new bootstrap", async () => {
  for (const mode of ["before-commit", "after-commit"]) {
    const f = fixture(),
      w = worker(f, mode);
    await w.line(mode === "before-commit" ? "prepared" : "committed");
    w.child.kill("SIGKILL");
    await exited(w.child);
    if (mode === "before-commit")
      refused(() => CloudSourceBoundJournalStore.inspect(f.selection));
    else {
      renameSync(f.contextDirectory, join(f.parent, "lost-source"));
      expect(
        CloudSourceBoundJournalStore.inspect(f.selection).genesis.context.json,
      ).toBe(f.s.context.json);
      refused(() => CloudSourceBoundJournalStore.open(f.selection));
    }
  }
}, 20000);

it("allows one actual source-bound creator with exact retained bytes and no run grant", async () => {
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
  const observed = CloudSourceBoundJournalStore.open(f.selection).read();
  expect(results.filter((r) => r.kind === "acknowledged")).toEqual([
    { kind: "acknowledged", sha256: observed.sha256, runAuthority: "unproven" },
  ]);
  expect(results.filter((r) => r.kind === "refused")).toEqual([
    { kind: "refused", code: "exists" },
  ]);
}, 20000);
