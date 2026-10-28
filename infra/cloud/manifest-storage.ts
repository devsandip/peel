import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  type BigIntStats,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  normalizeCloudRunManifestPin,
  readCloudRunManifest,
} from "./run-manifest.ts";

type Pin = ReturnType<typeof normalizeCloudRunManifestPin>;
type Captured = { json: string; pin: Pin };
type Code = "invalid-input" | "unrecognized" | "exists" | "unavailable";
export class CloudManifestStorageError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Private Cloud manifest storage unavailable");
    this.code = code;
    Object.freeze(this);
  }
}
const fail = (code: Code): never => {
  throw new CloudManifestStorageError(code);
};
function privateCall<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof CloudManifestStorageError) throw error;
    return fail("unavailable");
  }
}
function record(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return fail("invalid-input");
  const d = Object.getOwnPropertyDescriptors(value);
  return Object.fromEntries(
    keys.map((key) => {
      if (!d[key]?.enumerable || !("value" in d[key]))
        return fail("invalid-input");
      return [key, d[key].value];
    }),
  );
}
function expectedPin(value: unknown) {
  try {
    return normalizeCloudRunManifestPin(value);
  } catch {
    return fail("invalid-input");
  }
}
function captured(value: Captured): Captured {
  try {
    const r = record(value, ["json", "pin"]),
      pin = expectedPin(r.pin);
    readCloudRunManifest(r.json, pin);
    return Object.freeze({ json: r.json as string, pin });
  } catch {
    return fail("invalid-input");
  }
}
function path(value: string) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    value === dirname(value) ||
    process.getuid === undefined
  )
    return fail("invalid-input");
  return join(realpathSync(dirname(value)), basename(value));
}
function owned(s: BigIntStats, kind: "parent" | "directory" | "file") {
  const uid = process.getuid?.();
  if (
    uid === undefined ||
    s.uid !== BigInt(uid) ||
    (kind === "file" ? !s.isFile() || s.nlink !== 1n : !s.isDirectory()) ||
    (kind === "parent"
      ? (s.mode & 0o022n) !== 0n
      : (s.mode & 0o7777n) !== (kind === "directory" ? 0o700n : 0o600n))
  )
    return fail("unrecognized");
  return s;
}
const fdStat = (fd: number, kind: "parent" | "directory" | "file") =>
  owned(fstatSync(fd, { bigint: true }), kind);
const namedStat = (name: string, kind: "parent" | "directory" | "file") =>
  owned(lstatSync(name, { bigint: true }), kind);
const identity = (s: BigIntStats) => ({
  device: String(s.dev),
  inode: String(s.ino),
});
function same(a: BigIntStats, b: BigIntStats, immutable = false) {
  if (
    a.dev !== b.dev ||
    a.ino !== b.ino ||
    (immutable &&
      (a.size !== b.size || a.mtimeNs !== b.mtimeNs || a.ctimeNs !== b.ctimeNs))
  )
    return fail("unrecognized");
}
function closeAll(handles: number[]) {
  let failed = false;
  for (const fd of handles.reverse()) {
    try {
      closeSync(fd);
    } catch {
      failed = true;
    }
  }
  if (failed) fail("unavailable");
}
function openChecked(
  name: string,
  kind: "parent" | "directory" | "file",
  handles: number[],
) {
  const before = namedStat(name, kind),
    fd = openSync(
      name,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        (kind === "file" ? 0 : constants.O_DIRECTORY),
    );
  handles.push(fd);
  same(before, fdStat(fd, kind));
  return fd;
}
function bounded(fd: number, max: number) {
  const before = fdStat(fd, "file");
  if (before.size > BigInt(max)) return fail("unrecognized");
  const buffer = Buffer.alloc(max + 1);
  let length = 0;
  while (length < buffer.length) {
    const n = readSync(fd, buffer, length, buffer.length - length, length);
    if (n === 0) break;
    length += n;
  }
  if (length > max || BigInt(length) !== before.size)
    return fail("unrecognized");
  same(before, fdStat(fd, "file"), true);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer.subarray(0, length),
    );
  } catch {
    return fail("unrecognized");
  }
}
function marker(
  pin: Pin,
  root: BigIntStats,
  recipe: BigIntStats,
  owner: BigIntStats,
) {
  return (
    JSON.stringify({
      format: 1,
      kind: "peel-cloud-run-manifest-store",
      pin,
      directory: identity(root),
      manifest: identity(recipe),
      marker: identity(owner),
    }) + "\n"
  );
}
function entries(directory: string) {
  if (
    JSON.stringify(readdirSync(directory).sort()) !==
    '["manifest.json","owner.json"]'
  )
    return fail("unrecognized");
}
type Handles = { parent: number; root: number; recipe: number; owner: number };
function current(directory: string, h: Handles) {
  same(fdStat(h.parent, "parent"), namedStat(dirname(directory), "parent"));
  same(fdStat(h.root, "directory"), namedStat(directory, "directory"));
  same(
    fdStat(h.recipe, "file"),
    namedStat(join(directory, "manifest.json"), "file"),
  );
  same(
    fdStat(h.owner, "file"),
    namedStat(join(directory, "owner.json"), "file"),
  );
  entries(directory);
}

/** Private immutable recipe storage only; no ledger, AWS, creation ID or cleanup authority. */
export class CloudRunManifestStore {
  readonly directory: string;
  private readonly pin: Pin;
  private constructor(directory: string, value: unknown) {
    this.pin = expectedPin(value);
    this.directory = path(directory);
    Object.freeze(this);
  }
  static create(
    directory: string,
    value: Captured,
    hooks: { beforeCommit?: () => void; afterCommit?: () => void } = {},
  ) {
    return privateCall(() => {
      const input = captured(value),
        store = new CloudRunManifestStore(directory, input.pin),
        handles: number[] = [];
      try {
        const parent = openChecked(dirname(store.directory), "parent", handles);
        try {
          mkdirSync(store.directory, { mode: 0o700 });
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "EEXIST"
          )
            return fail("exists");
          throw error;
        }
        const root = openChecked(store.directory, "directory", handles),
          exclusive = (name: string) => {
            const fd = openSync(
              join(store.directory, name),
              constants.O_CREAT |
                constants.O_EXCL |
                constants.O_RDWR |
                constants.O_NOFOLLOW,
              0o600,
            );
            handles.push(fd);
            fdStat(fd, "file");
            return fd;
          },
          recipe = exclusive("manifest.json"),
          owner = exclusive("owner.json"),
          h = { parent, root, recipe, owner };
        current(store.directory, h);
        writeFileSync(recipe, input.json, "utf8");
        fsyncSync(recipe);
        hooks.beforeCommit?.();
        current(store.directory, h);
        if (
          fdStat(owner, "file").size !== 0n ||
          bounded(recipe, 512 * 1024) !== input.json
        )
          return fail("unrecognized");
        writeFileSync(
          owner,
          marker(
            input.pin,
            fdStat(root, "directory"),
            fdStat(recipe, "file"),
            fdStat(owner, "file"),
          ),
          "utf8",
        );
        fsyncSync(owner);
        fsyncSync(root);
        fsyncSync(parent);
        current(store.directory, h);
        hooks.afterCommit?.();
        store.read();
        return store;
      } finally {
        closeAll(handles);
      }
    });
  }
  /** Existing-store acknowledgement re-syncs verified descriptors; never creates or repairs. */
  static open(directory: string, pin: Pin) {
    return privateCall(() => {
      const store = new CloudRunManifestStore(directory, pin);
      store.inspect(true);
      return store;
    });
  }
  /** Read-only recovery inspection is not a new synchronization acknowledgement. */
  static inspect(directory: string, pin: Pin) {
    return privateCall(() => new CloudRunManifestStore(directory, pin).read());
  }
  read() {
    return privateCall(() => this.inspect(false));
  }
  private inspect(synchronize: boolean) {
    const handles: number[] = [];
    try {
      const parent = openChecked(dirname(this.directory), "parent", handles),
        root = openChecked(this.directory, "directory", handles);
      entries(this.directory);
      const recipe = openChecked(
          join(this.directory, "manifest.json"),
          "file",
          handles,
        ),
        owner = openChecked(
          join(this.directory, "owner.json"),
          "file",
          handles,
        ),
        h = { parent, root, recipe, owner },
        before = [
          fdStat(root, "directory"),
          fdStat(recipe, "file"),
          fdStat(owner, "file"),
        ];
      current(this.directory, h);
      if (
        bounded(owner, 16 * 1024) !==
        marker(this.pin, before[0], before[1], before[2])
      )
        return fail("unrecognized");
      const json = bounded(recipe, 512 * 1024);
      let retained: ReturnType<typeof readCloudRunManifest>;
      try {
        retained = readCloudRunManifest(json, this.pin);
      } catch {
        return fail("unrecognized");
      }
      if (synchronize)
        for (const fd of [recipe, owner, root, parent]) fsyncSync(fd);
      current(this.directory, h);
      [
        fdStat(root, "directory"),
        fdStat(recipe, "file"),
        fdStat(owner, "file"),
      ].forEach((s, i) => same(before[i], s, true));
      return Object.freeze({ json, pin: this.pin, recipe: retained });
    } finally {
      closeAll(handles);
    }
  }
}
