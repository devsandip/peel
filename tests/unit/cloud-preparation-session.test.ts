import { afterEach, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
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
  CloudPreparationSession,
  CloudPreparationSessionError,
} from "../../infra/cloud/preparation-session.ts";
import { CloudRunLedger } from "../../infra/cloud/run-ledger.ts";
import { CloudLedgerStore } from "../../infra/cloud/ledger-store.ts";
import { CloudRunManifestStore } from "../../infra/cloud/manifest-storage.ts";
import { CloudRunContextStore } from "../../infra/cloud/run-context-storage.ts";
import { CloudSourceBoundJournalStore } from "../../infra/cloud/journal-sources.ts";
import { createCloudRunPlanContext } from "../../infra/cloud/run-plan-context.ts";
import { cloudNormalizedPlanFixture } from "../fixtures/cloud-normalized-plan.ts";
import {
  cloudLedgerPlan,
  ledgerRunIds,
} from "../fixtures/cloud-ledger-plan.ts";

const effects = vi.hoisted(() => ({
  fds: new Map<number, string>(),
  accesses: 0,
  syncFailure: undefined as undefined | ((p: string) => boolean),
  closeFailure: undefined as undefined | ((p: string, fd: number) => boolean),
  onOpen: undefined as undefined | (() => void),
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync: (...a: Parameters<typeof actual.lstatSync>) => {
      effects.accesses++;
      return actual.lstatSync(...a);
    },
    openSync: (p: string, ...a: [number, number?]) => {
      const fd = actual.openSync(p, ...a);
      effects.fds.set(fd, p);
      effects.onOpen?.();
      return fd;
    },
    closeSync: (fd: number) => {
      const p = effects.fds.get(fd)!;
      actual.closeSync(fd);
      effects.fds.delete(fd);
      if (effects.closeFailure?.(p, fd))
        throw Error("synthetic close acknowledgement lost");
    },
    fsyncSync: (fd: number) => {
      if (effects.syncFailure?.(effects.fds.get(fd)!))
        throw Error("synthetic private sync failure");
      actual.fsyncSync(fd);
    },
  };
});
const parents: string[] = [],
  children: ChildProcess[] = [],
  now = Date.parse("2026-10-27T12:00:00.000Z");
function sample(second = false, id = ledgerRunIds[0]) {
  const original = cloudNormalizedPlanFixture(second, id, now),
    context = createCloudRunPlanContext(original),
    run = cloudLedgerPlan(id, now);
  run.plan.source.templatesSha256 = context.plan.source.templatesSha256;
  run.observed.source.templatesSha256 = context.plan.source.templatesSha256;
  return { original, context, run };
}
function fixture() {
  const parent = realpathSync(
      mkdtempSync(join(tmpdir(), "synkies-preparation-session-")),
    ),
    ledgerDirectory = join(parent, "funding"),
    s = sample();
  parents.push(parent);
  const ledger = CloudRunLedger.create(ledgerDirectory, s.run.authorization),
    workspaceDirectory = join(parent, "run"),
    input = {
      workspaceDirectory,
      ledgerDirectory,
      authority: s.run.authorization,
      expectedSnapshotSha256: ledger.read().snapshotSha256,
      plan: s.run.plan,
      observed: s.run.observed,
      original: {
        contextJson: s.context.json,
        contextSha256: s.context.contextSha256,
        manifest: s.original.manifest,
      },
    };
  vi.spyOn(Date, "now").mockReturnValue(now);
  effects.accesses = 0;
  return { parent, ledgerDirectory, workspaceDirectory, s, ledger, input };
}
function selection(f: ReturnType<typeof fixture>) {
  return {
    workspaceDirectory: f.workspaceDirectory,
    ledgerDirectory: f.ledgerDirectory,
    authority: f.s.run.authorization,
    runId: f.s.context.plan.runId,
  };
}
function refused(work: () => unknown, code?: string) {
  let error: unknown;
  try {
    work();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(CloudPreparationSessionError);
  expect((error as Error).message).toBe(
    "Fresh Cloud preparation session unavailable",
  );
  expect((error as Error).cause).toBeUndefined();
  expect(Object.keys(error as object)).toEqual(["code"]);
  expect(Object.isFrozen(error)).toBe(true);
  if (code) expect((error as CloudPreparationSessionError).code).toBe(code);
}
async function exited(c: ChildProcess) {
  if (c.exitCode === null && c.signalCode === null) await once(c, "exit");
}
function worker(f: ReturnType<typeof fixture>, mode: string, input = f.input) {
  const request = join(f.parent, `worker-${children.length}.json`);
  writeFileSync(request, JSON.stringify({ input, now }), { mode: 0o600 });
  const child = spawn(
    process.execPath,
    ["tests/fixtures/cloud-preparation-session-worker.mjs", request, mode],
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
      const line = output
        .split("\n")
        .find((s) =>
          w.label === "result" ? s.startsWith("{") : s === w.label,
        );
      if (line) {
        clearTimeout(w.timer);
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(line);
      }
    }
  }
  child.stdout!.on("data", (b) => {
    output += b;
    deliver();
  });
  child.stderr!.on("data", () => {});
  function unavailable() {
    deliver();
    for (const w of waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(Error("synthetic session worker unavailable"));
    }
  }
  child.on("error", unavailable);
  child.on("close", unavailable);
  function line(label: string) {
    return new Promise<string>((resolve, reject) => {
      const w = {
        label,
        resolve,
        reject,
        timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(Error("synthetic session barrier unavailable"));
        }, 12000),
      };
      waiters.push(w);
      deliver();
    });
  }
  return { child, line };
}
async function contend(
  f: ReturnType<typeof fixture>,
  release: "loser-first" | "writer-first",
) {
  const a = worker(f, "race-writer");
  await a.line("prepared");
  const b = worker(f, "race-reader", {
    ...f.input,
    workspaceDirectory: join(f.parent, "other"),
  });
  await b.line("reader-open");
  const [first, second] = release === "loser-first" ? [b, a] : [a, b];
  first.child.stdin!.end();
  await first.line("result");
  // The expected writer must not COMMIT against the contender's live read lock.
  await exited(first.child);
  second.child.stdin!.end();
  const results = (await Promise.all([a.line("result"), b.line("result")])).map(
    (s) => JSON.parse(s),
  );
  return { a, b, results };
}
afterEach(async () => {
  effects.syncFailure = undefined;
  effects.closeFailure = undefined;
  effects.onOpen = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const c of children) {
    c.kill("SIGKILL");
    await exited(c);
  }
  children.length = 0;
  expect(effects.fds.size).toBe(0);
  for (const p of parents) rmSync(p, { recursive: true, force: true });
  parents.length = 0;
});

it("obtains its own actual reserve/source/genesis acknowledgements in an exclusive workspace", () => {
  const f = fixture(),
    session = CloudPreparationSession.start(f.input),
    value = session.read();
  expect(value.genesis.context.json).toBe(f.s.context.json);
  expect(value.genesis.manifest.json).toBe(f.s.original.manifest.json);
  expect(value).toMatchObject({
    ownership: "unproven",
    runAuthority: "unproven",
    resourceWrites: 0,
  });
  expect(value.genesis.anchor.reservation).toEqual({
    slot: 1,
    runId: f.s.context.plan.runId,
    planSha256: f.s.context.planSha256,
    reservedAt: new Date(now).toISOString(),
  });
  expect(f.ledger.read().runs.length).toBe(1);
  expect(readdirSync(f.workspaceDirectory).sort()).toEqual([
    "context",
    "journal-" + f.s.context.plan.runId,
    "recipe",
  ]);
  expect(Object.isFrozen(session)).toBe(true);
  expect(Object.keys(session)).toEqual([]);
  expect(JSON.stringify(session)).toBe("{}");
  const source = CloudSourceBoundJournalStore.open(selection(f));
  expect(source.read().sha256).toBe(value.sha256);
});

it("uses the actual prior ledger for a second slot after a matching synthetic cleanup receipt", () => {
  const f = fixture(),
    first = CloudPreparationSession.start(f.input).read(),
    prior = f.ledger.read(),
    run = prior.runs[0];
  f.ledger.recordCleanup(
    {
      runId: run.runId,
      planSha256: run.planSha256,
      inventorySha256: first.genesis.manifest.pin.inventorySha256,
      checkedAt: new Date(now).toISOString(),
    },
    prior.snapshotSha256,
    { clock: () => now },
  );
  const s = sample(true, ledgerRunIds[1]),
    input = {
      ...f.input,
      workspaceDirectory: join(f.parent, "second"),
      expectedSnapshotSha256: f.ledger.read().snapshotSha256,
      plan: s.run.plan,
      observed: s.run.observed,
      original: {
        contextJson: s.context.json,
        contextSha256: s.context.contextSha256,
        manifest: s.original.manifest,
      },
    };
  expect(
    CloudPreparationSession.start(input).read().genesis.anchor.reservation.slot,
  ).toBe(2);
  expect(f.ledger.read().runs.length).toBe(2);
});

it("rejects accessors, callbacks, extras, prototypes, bounds and mismatched original pins before FS", () => {
  const f = fixture(),
    getter = vi.fn(() => f.input.observed),
    deep: any = {};
  let x = deep;
  for (let i = 0; i < 18; i++) x = x.child = {};
  for (const value of [
    null,
    { ...f.input, approved: true },
    {
      ...f.input,
      observed: { ...f.input.observed, token: "synthetic private extra" },
    },
    {
      ...f.input,
      observed: {
        ...f.input.observed,
        credentials: {
          ...f.input.observed.credentials,
          token: "synthetic private extra",
        },
      },
    },
    {
      ...f.input,
      plan: {
        ...f.input.plan,
        source: { ...f.input.plan.source, refunded: true },
      },
    },
    { ...f.input, hooks: { clock: () => now } },
    Object.defineProperty({ ...f.input }, "observed", { get: getter }),
    { ...f.input, observed: deep },
    { ...f.input, plan: new Date() },
    {
      ...f.input,
      original: { ...f.input.original, contextSha256: "f".repeat(64) },
    },
    {
      ...f.input,
      original: { ...f.input.original, contextJson: "x".repeat(524289) },
    },
    { ...f.input, workspaceDirectory: f.workspaceDirectory + "/../run" },
  ]) {
    effects.accesses = 0;
    refused(() => CloudPreparationSession.start(value as never));
    expect(effects.accesses).toBe(0);
  }
  expect(getter).not.toHaveBeenCalled();
  expect(existsSync(f.workspaceDirectory)).toBe(false);
  expect(f.ledger.read().runs).toEqual([]);
});

it("refuses existing or aliased namespaces and missing funding without adopting or changing them", () => {
  const f = fixture();
  mkdirSync(f.workspaceDirectory, { mode: 0o700 });
  const file = join(f.workspaceDirectory, "foreign");
  writeFileSync(file, "preserve synthetic foreign bytes");
  const reserve = vi.spyOn(CloudRunLedger.prototype, "reserve");
  refused(() => CloudPreparationSession.start(f.input));
  expect(reserve).not.toHaveBeenCalled();
  expect(readFileSync(file, "utf8")).toBe("preserve synthetic foreign bytes");
  const alias = join(f.parent, "alias");
  symlinkSync(f.parent, alias, "dir");
  refused(() =>
    CloudPreparationSession.start({
      ...f.input,
      workspaceDirectory: join(alias, "new"),
    }),
  );
  refused(() =>
    CloudPreparationSession.start({
      ...f.input,
      workspaceDirectory: join(f.parent, "missing-funding"),
      ledgerDirectory: join(f.parent, "unknown"),
    }),
  );
  expect(existsSync(join(f.parent, "missing-funding"))).toBe(false);
  expect(f.ledger.read().runs).toEqual([]);
});

it("rejects stale snapshots and an actual normalized-plan mismatch before creating a workspace", () => {
  const f = fixture();
  refused(() =>
    CloudPreparationSession.start({
      ...f.input,
      expectedSnapshotSha256: "f".repeat(64),
    }),
  );
  const plan = structuredClone(f.input.plan),
    observed = structuredClone(f.input.observed);
  plan.source.commit = "b".repeat(40);
  observed.source.commit = plan.source.commit;
  observed.mainCommit = plan.source.commit;
  observed.testedCommit = plan.source.commit;
  refused(() => CloudPreparationSession.start({ ...f.input, plan, observed }));
  expect(existsSync(f.workspaceDirectory)).toBe(false);
  expect(f.ledger.read().runs).toEqual([]);
});

it("never substitutes an existing reservation observation when there is no journal or workspace", () => {
  const f = fixture();
  f.ledger.reserve(
    f.input.plan,
    f.input.observed,
    f.input.expectedSnapshotSha256,
    { clock: () => now },
  );
  const input = {
      ...f.input,
      expectedSnapshotSha256: f.ledger.read().snapshotSha256,
    },
    bootstrap = vi.spyOn(CloudSourceBoundJournalStore, "bootstrap");
  refused(() => CloudPreparationSession.start(input), "recovery-required");
  expect(bootstrap).not.toHaveBeenCalled();
  expect(existsSync(f.workspaceDirectory)).toBe(false);
  expect(f.ledger.read().runs.length).toBe(1);
});

it("captures caller data before path effects and cannot accept forged, copied or discarded live sessions", () => {
  const f = fixture(),
    original = structuredClone(f.input);
  effects.onOpen = () => {
    effects.onOpen = undefined;
    f.input.original.contextJson = "changed caller bytes";
    f.input.plan.runId = ledgerRunIds[2];
  };
  const session = CloudPreparationSession.start(f.input);
  expect(session.read().genesis.context.json).toBe(
    original.original.contextJson,
  );
  for (const fake of [
    { ...session },
    JSON.parse(JSON.stringify(session)),
    Object.create(CloudPreparationSession.prototype),
    CloudSourceBoundJournalStore.open(selection(f)),
    session.read(),
  ])
    refused(() => CloudPreparationSession.prototype.read.call(fake));
  refused(
    () => Reflect.construct(CloudPreparationSession, [{}]),
    "invalid-input",
  );
  session.discard();
  session.discard();
  refused(() => session.read());
  expect(
    CloudSourceBoundJournalStore.inspect(selection(f)).genesis.context.json,
  ).toBe(original.original.contextJson);
});

it("preserves a fresh workspace and consumes no slot when its creation sync fails", () => {
  const f = fixture();
  effects.syncFailure = (p) => p === f.workspaceDirectory;
  refused(() => CloudPreparationSession.start(f.input), "recovery-required");
  effects.syncFailure = undefined;
  expect(existsSync(f.workspaceDirectory)).toBe(true);
  expect(f.ledger.read().runs).toEqual([]);
  refused(() => CloudPreparationSession.start(f.input));
  expect(f.ledger.read().runs).toEqual([]);
});

it("loses the live session after an actual reserve commit acknowledgement is lost", () => {
  const f = fixture(),
    reserve = CloudRunLedger.prototype.reserve;
  vi.spyOn(CloudRunLedger.prototype, "reserve").mockImplementation(function (
    this: CloudRunLedger,
    plan,
    observed,
    pin,
  ) {
    return reserve.call(this, plan, observed, pin, {
      afterCommit: () => {
        throw Error("synthetic reserve ACK lost");
      },
    });
  });
  refused(() => CloudPreparationSession.start(f.input), "recovery-required");
  expect(f.ledger.read().runs.length).toBe(1);
  expect(readdirSync(f.workspaceDirectory)).toEqual([]);
  refused(() => CloudPreparationSession.start(f.input));
});

it.each(["manifest", "context"] as const)(
  "requires a separate actual %s sync acknowledgement after publication",
  (kind) => {
    const f = fixture();
    const klass =
        kind === "manifest" ? CloudRunManifestStore : CloudRunContextStore,
      method = klass.open;
    vi.spyOn(klass, "open").mockImplementation(((...a: any[]) => {
      effects.syncFailure = (p) =>
        p.endsWith(
          kind === "manifest" ? "recipe/manifest.json" : "context/context.json",
        );
      return (method as any)(...a);
    }) as any);
    refused(() => CloudPreparationSession.start(f.input), "recovery-required");
    effects.syncFailure = undefined;
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(f.ledger.read().runs.length).toBe(1);
    expect(
      existsSync(
        join(f.workspaceDirectory, "journal-" + f.s.context.plan.runId),
      ),
    ).toBe(false);
  },
);

it.each(["commit", "close"])(
  "preserves committed genesis without a live session on %s acknowledgement loss",
  (kind) => {
    const f = fixture(),
      method = CloudSourceBoundJournalStore.bootstrap;
    if (kind === "commit") {
      vi.spyOn(CloudSourceBoundJournalStore, "bootstrap").mockImplementation(
        (value) =>
          method(value, {
            afterCommit: () => {
              throw Error("synthetic genesis ACK lost");
            },
          }),
      );
    } else {
      vi.spyOn(CloudSourceBoundJournalStore, "bootstrap").mockImplementation(
        (value) => {
          const store = method(value),
            held = [...effects.fds].find(
              ([, p]) => p === f.workspaceDirectory,
            )![0];
          effects.closeFailure = (_, fd) => fd === held;
          return store;
        },
      );
    }
    refused(() => CloudPreparationSession.start(f.input), "recovery-required");
    effects.closeFailure = undefined;
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now);
    expect(
      CloudSourceBoundJournalStore.inspect(selection(f)).genesis.context.json,
    ).toBe(f.s.context.json);
    expect(f.ledger.read().runs.length).toBe(1);
    refused(() => CloudPreparationSession.start(f.input));
  },
);

it.each(["extra", "workspace", "ledger", "parent"])(
  "invalidates permanently on changed %s identity or membership",
  (kind) => {
    const f = fixture(),
      session = CloudPreparationSession.start(f.input),
      original = kind === "ledger" ? f.ledgerDirectory : f.workspaceDirectory;
    if (kind === "extra") {
      writeFileSync(join(original, "foreign"), "private synthetic extra");
      refused(() => session.read());
      expect(readFileSync(join(original, "foreign"), "utf8")).toBe(
        "private synthetic extra",
      );
      rmSync(join(original, "foreign"));
    } else if (kind === "parent") {
      const moved = f.parent + "-moved";
      renameSync(f.parent, moved);
      parents.push(moved);
      mkdirSync(f.parent, { mode: 0o700 });
      renameSync(join(moved, "funding"), f.ledgerDirectory);
      renameSync(join(moved, "run"), f.workspaceDirectory);
      // Sources and original child inodes remain recognized at the same canonical paths.
      expect(
        CloudSourceBoundJournalStore.inspect(selection(f)).resourceWrites,
      ).toBe(0);
      refused(() => session.read());
    } else {
      renameSync(original, original + "-moved");
      symlinkSync(original + "-moved", original, "dir");
      refused(() => session.read());
      rmSync(original);
      renameSync(original + "-moved", original);
    }
    refused(() => session.read());
    expect(
      CloudSourceBoundJournalStore.inspect(selection(f)).resourceWrites,
    ).toBe(0);
  },
);

it("preserves an unused workspace when a real competing SQL writer makes reserve busy", () => {
  const f = fixture(),
    held = CloudLedgerStore.open(f.ledgerDirectory, f.s.run.authorization);
  held.use(true, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      refused(
        () => CloudPreparationSession.start(f.input),
        "recovery-required",
      );
    } finally {
      db.exec("ROLLBACK");
    }
  });
  expect(readdirSync(f.workspaceDirectory)).toEqual([]);
  expect(f.ledger.read().runs).toEqual([]);
  refused(() => CloudPreparationSession.start(f.input));
});

it("preserves an acknowledged recipe when its publication return is lost, without creating context", () => {
  const f = fixture(),
    create = CloudRunManifestStore.create;
  vi.spyOn(CloudRunManifestStore, "create").mockImplementation(
    (directory, value) =>
      create(directory, value, {
        afterCommit: () => {
          throw Error("synthetic publication ACK lost");
        },
      }),
  );
  refused(() => CloudPreparationSession.start(f.input), "recovery-required");
  expect(
    CloudRunManifestStore.inspect(
      join(f.workspaceDirectory, "recipe"),
      f.s.original.manifest.pin,
    ).json,
  ).toBe(f.s.original.manifest.json);
  expect(existsSync(join(f.workspaceDirectory, "context"))).toBe(false);
  expect(f.ledger.read().runs.length).toBe(1);
});

it("lets only one actual competing process acknowledge the shared reservation", async () => {
  const f = fixture(),
    { a, b, results } = await contend(f, "loser-first");
  expect(results.filter((r) => r.kind === "acknowledged")).toHaveLength(1);
  expect(results.filter((r) => r.kind === "refused")).toHaveLength(1);
  await Promise.all([exited(a.child), exited(b.child)]);
  expect(f.ledger.read().runs.length).toBe(1);
}, 20000);

it("refuses both processes when COMMIT precedes release of the competing reader", async () => {
  const f = fixture(),
    { a, b, results } = await contend(f, "writer-first");
  expect(results).toEqual([
    { kind: "refused", code: "recovery-required" },
    { kind: "refused", code: "recovery-required" },
  ]);
  await Promise.all([exited(a.child), exited(b.child)]);
  expect(f.ledger.read().runs).toEqual([]);
  expect(readdirSync(f.workspaceDirectory)).toEqual([]);
  expect(readdirSync(join(f.parent, "other"))).toEqual([]);
  refused(() => CloudPreparationSession.start(f.input));
  refused(() =>
    CloudPreparationSession.start({
      ...f.input,
      workspaceDirectory: join(f.parent, "other"),
    }),
  );
}, 20000);

it("preserves actual process-loss states before and after reserve/genesis COMMIT without a restart session", async () => {
  for (const mode of [
    "reserve-before",
    "reserve-after",
    "genesis-before",
    "genesis-after",
  ]) {
    const f = fixture(),
      w = worker(f, mode);
    await w.line(mode.endsWith("before") ? "prepared" : "committed");
    w.child.kill("SIGKILL");
    await exited(w.child);
    expect(existsSync(f.workspaceDirectory)).toBe(true);
    expect(f.ledger.read().runs.length).toBe(mode === "reserve-before" ? 0 : 1);
    const reserve = vi.spyOn(CloudRunLedger.prototype, "reserve");
    refused(() =>
      CloudPreparationSession.start({
        ...f.input,
        expectedSnapshotSha256: f.ledger.read().snapshotSha256,
      }),
    );
    expect(reserve).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(now);
    if (mode === "genesis-after")
      expect(
        CloudSourceBoundJournalStore.inspect(selection(f)).resourceWrites,
      ).toBe(0);
  }
}, 20000);

it("cannot recreate process-local lineage from an acknowledged child's metadata or surviving originals", async () => {
  const f = fixture(),
    w = worker(f, "normal"),
    result = JSON.parse(await w.line("result"));
  await exited(w.child);
  expect(result.kind).toBe("acknowledged");
  expect(result).toMatchObject({ resourceWrites: 0, runAuthority: "unproven" });
  const historical = CloudSourceBoundJournalStore.open(selection(f)).read();
  expect(historical.sha256).toBe(result.sha256);
  refused(() => CloudPreparationSession.prototype.read.call(historical));
  refused(() => CloudPreparationSession.start(f.input));
  expect(f.ledger.read().runs.length).toBe(1);
}, 15000);

it("reads the original local snapshot after expiry without treating clock or network as a fresh gate", () => {
  const f = fixture(),
    session = CloudPreparationSession.start(f.input),
    before = session.read(),
    network = vi.fn(() => {
      throw Error("synthetic network unavailable");
    });
  vi.stubGlobal("fetch", network);
  vi.spyOn(Date, "now").mockReturnValue(now + 24 * 60 * 60000);
  expect(session.read().sha256).toBe(before.sha256);
  vi.spyOn(Date, "now").mockImplementation(() => {
    throw Error("synthetic current clock unavailable");
  });
  const after = session.read();
  expect(after.sha256).toBe(before.sha256);
  expect(after.runAuthority).toBe("unproven");
  expect(network).not.toHaveBeenCalled();
});
