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
import { join } from "node:path";
import {
  cloudJournalLocation,
  normalizeCloudJournalAnchor,
} from "./journal-genesis.ts";

const dbName = "journal.sqlite",
  markerName = "owner.json",
  databaseLimit = 2 * 1024 * 1024,
  rollbackLimit = 4 * 1024 * 1024;
type Code = "unavailable" | "unrecognized" | "exists";
export class CloudJournalFilesError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud journal files unavailable");
    this.code = code;
    Object.freeze(this);
  }
}
function fail(code: Code = "unrecognized"): never {
  throw new CloudJournalFilesError(code);
}
function privateCall<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof CloudJournalFilesError) throw error;
    return fail("unavailable");
  }
}
type Held = {
  path: string;
  fd: number;
  directory: boolean;
  identity: BigIntStats;
};
function owned(s: BigIntStats, directory: boolean) {
  const uid = process.getuid?.();
  if (
    uid === undefined ||
    s.uid !== BigInt(uid) ||
    (s.mode & 0o7777n) !== (directory ? 0o700n : 0o600n) ||
    (directory ? !s.isDirectory() : !s.isFile() || s.nlink !== 1n)
  )
    return fail();
}
function same(a: BigIntStats, b: BigIntStats) {
  if (a.dev !== b.dev || a.ino !== b.ino) return fail();
}
function current(h: Held) {
  const path = lstatSync(h.path, { bigint: true }),
    descriptor = fstatSync(h.fd, { bigint: true });
  owned(path, h.directory);
  owned(descriptor, h.directory);
  same(path, h.identity);
  same(descriptor, h.identity);
  return descriptor;
}
function bounded(h: Held, max: number) {
  const s = current(h);
  if (s.size > BigInt(max)) return fail();
  return Number(s.size);
}
function read(h: Held, max: number) {
  const size = bounded(h, max),
    bytes = Buffer.alloc(size + 1);
  let offset = 0;
  while (offset < bytes.length) {
    const n = readSync(h.fd, bytes, offset, bytes.length - offset, offset);
    if (!n) break;
    offset += n;
  }
  if (offset !== size || bounded(h, max) !== size) return fail();
  return bytes.subarray(0, offset);
}

/** Internal file facts only. No SQLite/schema/genesis or funding/source authentication. */
function files(value: unknown, create: boolean, inspection: boolean) {
  return privateCall(() => {
    const anchor = normalizeCloudJournalAnchor(value),
      location = cloudJournalLocation(anchor),
      held: Held[] = [];
    let closed = false;
    function release() {
      if (closed) return;
      closed = true;
      let failed = false;
      for (const h of [...held].reverse()) {
        try {
          closeSync(h.fd);
        } catch {
          failed = true;
        }
      }
      if (failed) fail("unavailable");
    }
    function capture(path: string, directory: boolean, exclusive = false) {
      const before = exclusive ? undefined : lstatSync(path, { bigint: true });
      if (before) owned(before, directory);
      const fd = openSync(
        path,
        constants.O_NOFOLLOW |
          constants.O_NONBLOCK |
          (directory ? constants.O_DIRECTORY : 0) |
          (exclusive
            ? constants.O_CREAT | constants.O_EXCL | constants.O_RDWR
            : constants.O_RDONLY),
        0o600,
      );
      // Track immediately so even a failed fstat/ownership check closes this descriptor.
      const h = {
        path,
        fd,
        directory,
        identity: undefined as unknown as BigIntStats,
      };
      held.push(h);
      try {
        h.identity = fstatSync(fd, { bigint: true });
        owned(h.identity, directory);
        if (before) same(before, h.identity);
        current(h);
        return h;
      } catch (error) {
        held.pop();
        closeSync(fd);
        throw error;
      }
    }
    try {
      const workspace = capture(anchor.workspaceDirectory, true);
      if (realpathSync(workspace.path) !== workspace.path) return fail();
      current(workspace);
      if (create) {
        try {
          mkdirSync(location.directory, { mode: 0o700 });
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
      }
      current(workspace);
      const directory = capture(location.directory, true),
        database = capture(join(directory.path, dbName), false, create),
        marker = capture(join(directory.path, markerName), false, create),
        markerBytes = Buffer.from(
          JSON.stringify({
            format: 1,
            kind: "synkies-cloud-journal-files",
            scopeSha256: location.scopeSha256,
            workspaceDevice: String(workspace.identity.dev),
            workspaceInode: String(workspace.identity.ino),
            directoryDevice: String(directory.identity.dev),
            directoryInode: String(directory.identity.ino),
            databaseDevice: String(database.identity.dev),
            databaseInode: String(database.identity.ino),
          }) + "\n",
        );
      function verify(strict: boolean) {
        if (closed) return fail("unavailable");
        for (const h of held) current(h);
        if (realpathSync(workspace.path) !== workspace.path) return fail();
        bounded(database, databaseLimit);
        if (!read(marker, 4096).equals(markerBytes)) return fail();
        const names = readdirSync(directory.path),
          rollbackName = dbName + "-journal";
        if (
          strict &&
          names.some((n) => ![dbName, markerName, rollbackName].includes(n))
        )
          return fail();
        if (names.includes(rollbackName)) {
          const rollback = capture(join(directory.path, rollbackName), false);
          try {
            const size = bounded(rollback, rollbackLimit),
              header = Buffer.alloc(8),
              length = readSync(rollback.fd, header, 0, 8, 0);
            if (
              size &&
              (size < 8 ||
                length !== 8 ||
                (!header.equals(Buffer.alloc(8)) &&
                  header.toString("hex") !== "d9d505f920a163d7"))
            )
              return fail();
            if (bounded(rollback, rollbackLimit) !== size) return fail();
          } finally {
            // Only the four persistent descriptors are retained between operations.
            held.pop();
            closeSync(rollback.fd);
          }
        }
        for (const h of held) current(h);
      }
      function sync() {
        verify(true);
        for (const h of [database, marker, directory, workspace]) {
          fsyncSync(h.fd);
          verify(true);
        }
      }
      if (create) {
        for (const h of held) current(h);
        writeFileSync(marker.fd, markerBytes);
        sync();
      } else verify(!inspection);
      return Object.freeze({
        directory: directory.path,
        databasePath: database.path,
        scopeSha256: location.scopeSha256,
        runAuthority: "unproven" as const,
        resourceWrites: 0 as const,
        verify: () => privateCall(() => verify(!inspection)),
        sync: () => privateCall(sync),
        close: () => privateCall(release),
      });
    } catch (error) {
      release();
      throw error;
    }
  });
}

/** Exclusive namespace files only; existing paths always refuse and partial state is retained. */
export function createCloudJournalFiles(anchor: unknown) {
  return files(anchor, true, false);
}
/** Open-only file inspection; never initializes or recognizes a complete SQLite journal. */
export function openCloudJournalFiles(anchor: unknown, inspection = false) {
  if (typeof inspection !== "boolean") return fail("unavailable");
  return files(anchor, false, inspection);
}
