import { createHash } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { normalizeCloudLedgerAuthority } from "./ledger-store.ts";
import { CloudRunLedger } from "./run-ledger.ts";
import { validateCloudDeploymentPlan } from "./deployment-plan.ts";
import { normalizeCloudRunManifestPin } from "./run-manifest.ts";
import { readCloudRunPlanContext } from "./run-plan-context.ts";
import { CloudRunManifestStore } from "./manifest-storage.ts";
import { CloudRunContextStore } from "./run-context-storage.ts";
import { CloudSourceBoundJournalStore } from "./journal-sources.ts";

type Original = {
  contextJson: string;
  contextSha256: string;
  manifest: {
    json: string;
    pin: ReturnType<typeof normalizeCloudRunManifestPin>;
  };
};
type Input = {
  workspaceDirectory: string;
  ledgerDirectory: string;
  authority: unknown;
  expectedSnapshotSha256: string;
  plan: unknown;
  observed: unknown;
  original: Original;
};
type Code =
  "invalid-input" | "unrecognized" | "unavailable" | "recovery-required";
export class CloudPreparationSessionError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Fresh Cloud preparation session unavailable");
    this.code = code;
    Object.freeze(this);
  }
}
function fail(code: Code): never {
  throw new CloudPreparationSessionError(code);
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > max ||
    Buffer.from(value).toString("utf8") !== value
  )
    return fail("invalid-input");
  return value;
}
function digest(value: unknown) {
  const s = text(value, 64);
  if (s.length !== 64 || !/^[a-f0-9]{64}$/.test(s))
    return fail("invalid-input");
  return s;
}
function record(value: any, keys: readonly string[]): Record<string, any> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...keys].sort())
  )
    return fail("invalid-input");
  return value;
}
/** Reject accessors/prototypes/non-data before any path access, then detach everything. */
function data(value: unknown, budget = { nodes: 0, bytes: 0 }, depth = 0): any {
  if (++budget.nodes > 1024 || depth > 16) return fail("invalid-input");
  if (typeof value === "string") {
    const s = text(value, 512 * 1024);
    budget.bytes += Buffer.byteLength(s);
    if (budget.bytes > 1024 * 1024) return fail("invalid-input");
    return s;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return fail("invalid-input");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 128 ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      return fail("invalid-input");
    return Array.from({ length: value.length }, (_, i) => {
      const d = descriptors[i];
      if (!d?.enumerable || !("value" in d)) return fail("invalid-input");
      return data(d.value, budget, depth + 1);
    });
  }
  if (
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length > 64 ||
    Reflect.ownKeys(value).length !== Object.keys(descriptors).length
  )
    return fail("invalid-input");
  return Object.fromEntries(
    Object.entries(descriptors).map(([k, d]) => {
      text(k, 128);
      if (!d.enumerable || !("value" in d)) return fail("invalid-input");
      return [k, data(d.value, budget, depth + 1)];
    }),
  );
}
function path(value: unknown) {
  const s = text(value, 4096);
  if (
    !isAbsolute(s) ||
    resolve(s) !== s ||
    dirname(s) === s ||
    /[\x00-\x1f\x7f]/.test(s)
  )
    return fail("invalid-input");
  return s;
}
function captured(value: unknown) {
  const r = record(data(value), [
    "workspaceDirectory",
    "ledgerDirectory",
    "authority",
    "expectedSnapshotSha256",
    "plan",
    "observed",
    "original",
  ]);
  text(JSON.stringify(r), 1024 * 1024);
  const o = record(r.original, ["contextJson", "contextSha256", "manifest"]),
    m = record(o.manifest, ["json", "pin"]),
    manifest = {
      json: text(m.json, 512 * 1024),
      pin: normalizeCloudRunManifestPin(m.pin),
    },
    contextJson = text(o.contextJson, 32 * 1024),
    contextSha256 = digest(o.contextSha256),
    context = readCloudRunPlanContext(contextJson, manifest),
    authority = normalizeCloudLedgerAuthority(r.authority),
    workspaceDirectory = path(r.workspaceDirectory),
    ledgerDirectory = path(r.ledgerDirectory);
  if (
    hash(contextJson) !== contextSha256 ||
    r.plan?.runId !== context.plan.runId ||
    JSON.stringify(authority.identity) !== JSON.stringify(context.plan.identity)
  )
    return fail("invalid-input");
  for (const [a, b] of [
    [workspaceDirectory, ledgerDirectory],
    [ledgerDirectory, workspaceDirectory],
  ]) {
    const rel = relative(a, b);
    if (
      !rel ||
      (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel))
    )
      return fail("invalid-input");
  }
  return {
    workspaceDirectory,
    ledgerDirectory,
    authority,
    expectedSnapshotSha256: digest(r.expectedSnapshotSha256),
    plan: r.plan,
    observed: r.observed,
    original: { contextJson, contextSha256, manifest },
    context,
  };
}
type Captured = ReturnType<typeof captured>;
type Stamp = { device: bigint; inode: bigint };
function owned(s: ReturnType<typeof fstatSync>, stamp?: Stamp) {
  const uid = process.getuid?.();
  if (
    uid === undefined ||
    !s.isDirectory() ||
    BigInt(s.uid) !== BigInt(uid) ||
    (BigInt(s.mode) & 0o7777n) !== 0o700n ||
    (stamp && (BigInt(s.dev) !== stamp.device || BigInt(s.ino) !== stamp.inode))
  )
    return fail("unrecognized");
  return { device: BigInt(s.dev), inode: BigInt(s.ino) };
}
function directory(p: string, stamp?: Stamp) {
  const s = lstatSync(p, { bigint: true });
  if (realpathSync(p) !== p) return fail("unrecognized");
  return owned(s, stamp);
}
function openDirectory(p: string, stamp?: Stamp) {
  const expected = directory(p, stamp),
    fd = openSync(
      p,
      constants.O_RDONLY |
        constants.O_DIRECTORY |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK,
    );
  try {
    owned(fstatSync(fd, { bigint: true }), expected);
    directory(p, expected);
    return fd;
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}
function absent(p: string) {
  try {
    lstatSync(p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  return fail("unrecognized");
}
function children(p: string, expected: string[]) {
  const d = opendirSync(p),
    names: string[] = [];
  try {
    for (;;) {
      const entry = d.readSync();
      if (!entry) break;
      if (names.length === 3) return fail("unrecognized");
      names.push(entry.name);
    }
  } finally {
    d.closeSync();
  }
  if (JSON.stringify(names.sort()) !== JSON.stringify([...expected].sort()))
    return fail("unrecognized");
}
function check(
  p: string,
  parent: Stamp,
  workspace: Stamp,
  fd: number,
  parentFd: number,
  names: string[],
) {
  directory(dirname(p), parent);
  directory(p, workspace);
  owned(fstatSync(fd, { bigint: true }), workspace);
  owned(fstatSync(parentFd, { bigint: true }), parent);
  children(p, names);
}
type State = {
  captured: Captured;
  parent: Stamp;
  workspace: Stamp;
  ledger: Stamp;
  ledgerSha256: string;
  store: CloudSourceBoundJournalStore;
  genesisSha256: string;
};
function names(s: Captured) {
  return ["recipe", "context", "journal-" + s.context.plan.runId];
}
function validate(s: State) {
  const p = s.captured.workspaceDirectory,
    parentFd = openDirectory(dirname(p), s.parent);
  let fd: number | undefined;
  try {
    fd = openDirectory(p, s.workspace);
    check(p, s.parent, s.workspace, fd, parentFd, names(s.captured));
    directory(s.captured.ledgerDirectory, s.ledger);
    const ledger = CloudRunLedger.open(
      s.captured.ledgerDirectory,
      s.captured.authority,
    ).read();
    if (ledger.snapshotSha256 !== s.ledgerSha256) return fail("unrecognized");
    const observed = s.store.read();
    if (observed.sha256 !== s.genesisSha256) return fail("unrecognized");
    check(p, s.parent, s.workspace, fd, parentFd, names(s.captured));
    return observed;
  } finally {
    try {
      if (fd !== undefined) closeSync(fd);
    } finally {
      closeSync(parentFd);
    }
  }
}
const constructorKey = Object.freeze({}),
  live = new WeakMap<object, State>();

/** Local acknowledgement lineage only. No provider approval, preparation or execution permission. */
export class CloudPreparationSession {
  private constructor(key: object) {
    if (key !== constructorKey) return fail("invalid-input");
    Object.freeze(this);
  }
  static start(value: Input) {
    let began = false;
    try {
      const c = captured(value),
        p = c.workspaceDirectory,
        parent = directory(dirname(p));
      const ledgerIdentity = directory(c.ledgerDirectory);
      absent(p);
      const ledger = CloudRunLedger.open(c.ledgerDirectory, c.authority),
        prior = ledger.read();
      if (prior.runs.some((r) => r.runId === c.context.plan.runId))
        return fail("recovery-required");
      if (prior.snapshotSha256 !== c.expectedSnapshotSha256)
        return fail("unrecognized");
      const approved = validateCloudDeploymentPlan(
        c.plan,
        c.authority,
        c.observed,
        prior.policyLedger,
        Date.now(),
      );
      if (JSON.stringify(approved) !== c.context.planJson)
        return fail("invalid-input");
      const parentFd = openDirectory(dirname(p), parent);
      let fd: number | undefined, state: State;
      try {
        mkdirSync(p, { mode: 0o700 });
        began = true;
        const workspace = directory(p);
        fd = openDirectory(p, workspace);
        check(p, parent, workspace, fd, parentFd, []);
        directory(c.ledgerDirectory, ledgerIdentity);
        fsyncSync(fd);
        fsyncSync(parentFd);
        check(p, parent, workspace, fd, parentFd, []);
        directory(c.ledgerDirectory, ledgerIdentity);
        // Only this successful actual call is an acknowledgement. No catch/read fallback.
        const reserved = ledger.reserve(
            c.plan,
            c.observed,
            c.expectedSnapshotSha256,
          ),
          run = reserved.runs.find((r) => r.runId === c.context.plan.runId);
        if (
          !run ||
          run.cleanup !== null ||
          run.planSha256 !== c.context.planSha256 ||
          reserved.runs.length !== prior.runs.length + 1
        )
          return fail("unrecognized");
        check(p, parent, workspace, fd, parentFd, []);
        directory(c.ledgerDirectory, ledgerIdentity);
        const manifestDirectory = join(p, "recipe"),
          contextDirectory = join(p, "context"),
          selection = {
            workspaceDirectory: p,
            ledgerDirectory: c.ledgerDirectory,
            authority: c.authority,
            runId: run.runId,
          };
        CloudRunManifestStore.create(manifestDirectory, c.original.manifest);
        check(p, parent, workspace, fd, parentFd, ["recipe"]);
        directory(c.ledgerDirectory, ledgerIdentity);
        CloudRunContextStore.create(contextDirectory, {
          json: c.original.contextJson,
          expected: {
            contextSha256: c.original.contextSha256,
            manifest: {
              directory: manifestDirectory,
              pin: c.original.manifest.pin,
            },
            ledger: { directory: c.ledgerDirectory, authority: c.authority },
          },
        });
        check(p, parent, workspace, fd, parentFd, ["recipe", "context"]);
        directory(c.ledgerDirectory, ledgerIdentity);
        const store = CloudSourceBoundJournalStore.bootstrap({
            selection,
            manifest: {
              directory: manifestDirectory,
              pin: c.original.manifest.pin,
            },
            context: {
              directory: contextDirectory,
              sha256: c.original.contextSha256,
            },
          }),
          genesis = store.read();
        if (
          genesis.genesis.manifest.json !== c.original.manifest.json ||
          genesis.genesis.context.json !== c.original.contextJson ||
          JSON.stringify(genesis.genesis.anchor.reservation) !==
            JSON.stringify({
              slot: run.slot,
              runId: run.runId,
              planSha256: run.planSha256,
              reservedAt: run.reservedAt,
            }) ||
          ledger.read().snapshotSha256 !== reserved.snapshotSha256
        )
          return fail("unrecognized");
        check(p, parent, workspace, fd, parentFd, names(c));
        directory(c.ledgerDirectory, ledgerIdentity);
        fsyncSync(fd);
        fsyncSync(parentFd);
        check(p, parent, workspace, fd, parentFd, names(c));
        state = {
          captured: c,
          parent,
          workspace,
          ledger: ledgerIdentity,
          ledgerSha256: reserved.snapshotSha256,
          store,
          genesisSha256: genesis.sha256,
        };
      } finally {
        try {
          if (fd !== undefined) closeSync(fd);
        } finally {
          closeSync(parentFd);
        }
      }
      validate(state);
      const session = new CloudPreparationSession(constructorKey);
      live.set(session, state);
      return session;
    } catch (e) {
      if (began) return fail("recovery-required");
      if (e instanceof CloudPreparationSessionError) throw e;
      return fail("unavailable");
    }
  }
  /** Safe current source/anchor validation, never a new sync or current execution gate. */
  read() {
    try {
      const state = live.get(this);
      if (!state) return fail("unavailable");
      return validate(state);
    } catch (e) {
      live.delete(this);
      if (e instanceof CloudPreparationSessionError) throw e;
      return fail("unavailable");
    }
  }
  /** Irreversibly drop this process's local lineage. No files or slots are removed. */
  discard() {
    live.delete(this);
  }
}
