import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { normalizeCloudLedgerAuthority } from "./ledger-store.ts";
import { CloudRunLedger } from "./run-ledger.ts";
import { CloudRunManifestStore } from "./manifest-storage.ts";
import { CloudRunContextStore } from "./run-context-storage.ts";
import { normalizeCloudRunManifestPin } from "./run-manifest.ts";
import {
  cloudJournalLocation,
  createCloudJournalGenesis,
  normalizeCloudJournalAnchor,
} from "./journal-genesis.ts";
import {
  CloudJournalGenesisStore,
  CloudJournalStorageError,
} from "./journal-storage.ts";

type Selection = {
  workspaceDirectory: string;
  ledgerDirectory: string;
  authority: unknown;
  runId: string;
};
type Sources = {
  selection: Selection;
  manifest: {
    directory: string;
    pin: ReturnType<typeof normalizeCloudRunManifestPin>;
  };
  context: { directory: string; sha256: string };
};
type Code =
  "invalid-input" | "unrecognized" | "exists" | "unavailable" | "uncertain";
export class CloudJournalSourceError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Original Cloud journal sources unavailable");
    this.code = code;
    Object.freeze(this);
  }
}
function fail(code: Code): never {
  throw new CloudJournalSourceError(code);
}
function privateCall<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof CloudJournalSourceError) throw error;
    if (
      error instanceof CloudJournalStorageError &&
      ["exists", "uncertain"].includes(error.code)
    )
      return fail(error.code as "exists" | "uncertain");
    return fail("unavailable");
  }
}
function input<T>(work: () => T): T {
  try {
    return work();
  } catch {
    return fail("invalid-input");
  }
}
function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return fail("invalid-input");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Object.fromEntries(
    keys.map((key) => {
      if (!descriptors[key]?.enumerable || !("value" in descriptors[key]))
        return fail("invalid-input");
      return [key, descriptors[key].value];
    }),
  );
}
function text(value: unknown, max: number) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > max ||
    Buffer.from(value).toString("utf8") !== value
  )
    return fail("invalid-input");
  return value;
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
function selection(value: unknown) {
  const r = record(value, [
      "workspaceDirectory",
      "ledgerDirectory",
      "authority",
      "runId",
    ]),
    runId = text(r.runId, 36);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      runId,
    ) ||
    runId.length !== 36
  )
    return fail("invalid-input");
  return Object.freeze({
    workspaceDirectory: path(r.workspaceDirectory),
    ledgerDirectory: path(r.ledgerDirectory),
    authority: normalizeCloudLedgerAuthority(r.authority),
    runId,
  });
}
function sources(value: unknown) {
  const r = record(value, ["selection", "manifest", "context"]),
    m = record(r.manifest, ["directory", "pin"]),
    c = record(r.context, ["directory", "sha256"]),
    sha256 = text(c.sha256, 64);
  if (!/^[a-f0-9]{64}$/.test(sha256) || sha256.length !== 64)
    return fail("invalid-input");
  const result = Object.freeze({
    selection: selection(r.selection),
    manifest: Object.freeze({
      directory: path(m.directory),
      pin: normalizeCloudRunManifestPin(m.pin),
    }),
    context: Object.freeze({ directory: path(c.directory), sha256 }),
  });
  text(JSON.stringify(result), 24 * 1024);
  return result;
}
function canonical(directory: string) {
  const s = lstatSync(directory, { bigint: true }),
    uid = process.getuid?.();
  if (
    uid === undefined ||
    !s.isDirectory() ||
    s.uid !== BigInt(uid) ||
    (s.mode & 0o7777n) !== 0o700n ||
    realpathSync(directory) !== directory
  )
    return fail("unrecognized");
}
type Captured = ReturnType<typeof selection>;
type Anchor = ReturnType<typeof normalizeCloudJournalAnchor>;
function actualAnchor(s: Captured, recovery: boolean) {
  canonical(s.workspaceDirectory);
  canonical(s.ledgerDirectory);
  const ledger = CloudRunLedger.open(s.ledgerDirectory, s.authority);
  if (ledger.directory !== s.ledgerDirectory) return fail("unrecognized");
  const run = recovery
    ? ledger.readReservation(s.runId)
    : ledger.read().runs.find((r) => r.runId === s.runId);
  if (!run) return fail("unrecognized");
  canonical(s.workspaceDirectory);
  canonical(s.ledgerDirectory);
  return normalizeCloudJournalAnchor({
    workspaceDirectory: s.workspaceDirectory,
    ledgerDirectory: s.ledgerDirectory,
    authority: s.authority,
    reservation: {
      slot: run.slot,
      runId: run.runId,
      planSha256: run.planSha256,
      reservedAt: run.reservedAt,
    },
  });
}
function separate(paths: readonly string[]) {
  for (const a of paths)
    for (const b of paths)
      if (a !== b) {
        const r = relative(a, b);
        if (!r || (r !== ".." && !r.startsWith(".." + sep) && !isAbsolute(r)))
          return fail("unrecognized");
      }
  if (new Set(paths).size !== paths.length) return fail("unrecognized");
}
function original(
  s: Captured,
  a: Anchor,
  m: Sources["manifest"],
  c: Sources["context"],
  synchronize: boolean,
) {
  separate([
    a.ledgerDirectory,
    m.directory,
    c.directory,
    cloudJournalLocation(a).directory,
  ]);
  canonical(m.directory);
  canonical(c.directory);
  const manifest = synchronize
      ? CloudRunManifestStore.open(m.directory, m.pin).read()
      : CloudRunManifestStore.inspect(m.directory, m.pin),
    expected = {
      contextSha256: c.sha256,
      manifest: { directory: m.directory, pin: m.pin },
      ledger: { directory: a.ledgerDirectory, authority: a.authority },
    },
    context = synchronize
      ? CloudRunContextStore.open(c.directory, expected).read()
      : CloudRunContextStore.inspect(c.directory, expected),
    r = context.binding.reservation;
  if (
    JSON.stringify({
      slot: r.slot,
      runId: r.runId,
      planSha256: r.planSha256,
      reservedAt: r.reservedAt,
    }) !== JSON.stringify(a.reservation)
  )
    return fail("unrecognized");
  canonical(m.directory);
  canonical(c.directory);
  if (JSON.stringify(actualAnchor(s, false)) !== JSON.stringify(a))
    return fail("unrecognized");
  return createCloudJournalGenesis({
    anchor: a,
    manifest: {
      directory: m.directory,
      json: manifest.json,
      pin: manifest.pin,
    },
    context: { directory: c.directory, json: context.json, sha256: c.sha256 },
  });
}
function bound(s: Captured, synchronize: boolean) {
  const a = actualAnchor(s, false),
    stored = CloudJournalGenesisStore.open(a).read(),
    g = stored.genesis,
    checked = original(s, a, g.manifest, g.context, synchronize);
  if (checked.json !== stored.json) return fail("unrecognized");
  return stored;
}

/** Actual local funding/source observations only; never a spending or provider execution capability. */
export class CloudSourceBoundJournalStore {
  private readonly selection: Captured;
  private constructor(s: Captured) {
    this.selection = s;
    Object.freeze(this);
  }
  static bootstrap(
    value: Sources,
    hooks: { beforeCommit?: () => void; afterCommit?: () => void } = {},
  ) {
    return privateCall(() => {
      const captured = input(() => sources(value)),
        s = captured.selection,
        a = actualAnchor(s, false),
        capturedOriginal = original(
          s,
          a,
          captured.manifest,
          captured.context,
          true,
        );
      let committed = false;
      try {
        CloudJournalGenesisStore.bootstrap(
          {
            anchor: a,
            manifest: capturedOriginal.genesis.manifest,
            context: capturedOriginal.genesis.context,
          },
          {
            beforeCommit: () => {
              hooks.beforeCommit?.();
              if (
                original(s, a, captured.manifest, captured.context, true)
                  .json !== capturedOriginal.json
              )
                return fail("unrecognized");
            },
            afterCommit: () => {
              committed = true;
              hooks.afterCommit?.();
            },
          },
        );
        if (
          original(s, a, captured.manifest, captured.context, true).json !==
          capturedOriginal.json
        )
          return fail("unrecognized");
        return new CloudSourceBoundJournalStore(s);
      } catch (error) {
        if (
          committed ||
          (error instanceof CloudJournalStorageError &&
            error.code === "uncertain")
        )
          return fail("uncertain");
        throw error;
      }
    });
  }
  /** Open-only separate source acknowledgements; retained pins replace lost caller memory, never current gates. */
  static open(value: Selection) {
    return privateCall(() => {
      const s = input(() => selection(value));
      bound(s, true);
      return new CloudSourceBoundJournalStore(s);
    });
  }
  /** Exact historical journal under the actual independent funding tuple; sources need not still exist. */
  static inspect(value: Selection) {
    return privateCall(() => {
      const s = input(() => selection(value));
      return CloudJournalGenesisStore.inspect(actualAnchor(s, true));
    });
  }
  /** Validate actual sources without claiming a fresh synchronization acknowledgement. */
  read() {
    return privateCall(() => bound(this.selection, false));
  }
}
