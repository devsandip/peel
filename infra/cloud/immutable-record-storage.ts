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

/** @internal Fixed repository wrappers only; never accept configuration from callers. */
export function immutableRecordStorage<Pin, Value>(configuration: {
  recordName: string;
  recordMaxBytes: number;
  marker: (pin: Pin, identities: RecordIdentities) => string;
  read: (json: string, pin: Pin) => Value;
  fail: (
    code: "invalid-input" | "unrecognized" | "exists" | "unavailable",
  ) => never;
}) {
  const { recordName, recordMaxBytes, marker, read, fail } = configuration;
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
        (a.size !== b.size ||
          a.mtimeNs !== b.mtimeNs ||
          a.ctimeNs !== b.ctimeNs))
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
  function entries(directory: string) {
    if (
      JSON.stringify(readdirSync(directory).sort()) !==
      JSON.stringify([recordName, "owner.json"].sort())
    )
      return fail("unrecognized");
  }
  type Handles = {
    parent: number;
    root: number;
    recipe: number;
    owner: number;
  };
  function current(directory: string, h: Handles) {
    same(fdStat(h.parent, "parent"), namedStat(dirname(directory), "parent"));
    same(fdStat(h.root, "directory"), namedStat(directory, "directory"));
    same(
      fdStat(h.recipe, "file"),
      namedStat(join(directory, recordName), "file"),
    );
    same(
      fdStat(h.owner, "file"),
      namedStat(join(directory, "owner.json"), "file"),
    );
    entries(directory);
  }

  function publish(
    directory: string,
    input: { json: string; pin: Pin },
    hooks: { beforeCommit?: () => void; afterCommit?: () => void },
    readback: () => unknown,
  ) {
    const handles: number[] = [];
    try {
      const parent = openChecked(dirname(directory), "parent", handles);
      try {
        mkdirSync(directory, { mode: 0o700 });
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
      const root = openChecked(directory, "directory", handles),
        exclusive = (name: string) => {
          const fd = openSync(
            join(directory, name),
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
        recipe = exclusive(recordName),
        owner = exclusive("owner.json"),
        h = { parent, root, recipe, owner };
      current(directory, h);
      writeFileSync(recipe, input.json, "utf8");
      fsyncSync(recipe);
      hooks.beforeCommit?.();
      current(directory, h);
      if (
        fdStat(owner, "file").size !== 0n ||
        bounded(recipe, recordMaxBytes) !== input.json
      )
        return fail("unrecognized");
      writeFileSync(
        owner,
        marker(input.pin, {
          directory: identity(fdStat(root, "directory")),
          record: identity(fdStat(recipe, "file")),
          marker: identity(fdStat(owner, "file")),
        }),
        "utf8",
      );
      fsyncSync(owner);
      fsyncSync(root);
      fsyncSync(parent);
      current(directory, h);
      hooks.afterCommit?.();
      readback();
    } finally {
      closeAll(handles);
    }
  }
  function inspect(directory: string, pin: Pin, synchronize: boolean) {
    const handles: number[] = [];
    try {
      const parent = openChecked(dirname(directory), "parent", handles),
        root = openChecked(directory, "directory", handles);
      entries(directory);
      const recipe = openChecked(join(directory, recordName), "file", handles),
        owner = openChecked(join(directory, "owner.json"), "file", handles),
        h = { parent, root, recipe, owner },
        before = [
          fdStat(root, "directory"),
          fdStat(recipe, "file"),
          fdStat(owner, "file"),
        ];
      current(directory, h);
      if (
        bounded(owner, 16 * 1024) !==
        marker(pin, {
          directory: identity(before[0]),
          record: identity(before[1]),
          marker: identity(before[2]),
        })
      )
        return fail("unrecognized");
      const json = bounded(recipe, recordMaxBytes);
      let retained: Value;
      try {
        retained = read(json, pin);
      } catch {
        return fail("unrecognized");
      }
      if (synchronize)
        for (const fd of [recipe, owner, root, parent]) fsyncSync(fd);
      current(directory, h);
      [
        fdStat(root, "directory"),
        fdStat(recipe, "file"),
        fdStat(owner, "file"),
      ].forEach((s, i) => same(before[i], s, true));
      return Object.freeze({ json, value: retained });
    } finally {
      closeAll(handles);
    }
  }
  return Object.freeze({ path, publish, inspect });
}

type FileIdentity = { device: string; inode: string };
export type RecordIdentities = {
  directory: FileIdentity;
  record: FileIdentity;
  marker: FileIdentity;
};
