import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  cpSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudStackFixture } from "../fixtures/cloud-stack-pages.ts";
import { createCloudRunManifest } from "../../infra/cloud/run-manifest.ts";
import {
  CloudRunManifestStore,
  CloudManifestStorageError,
} from "../../infra/cloud/manifest-storage.ts";

const sync = vi.hoisted(() => ({ failAt: 0, calls: 0 }));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    fsyncSync: (fd: number) => {
      if (++sync.calls >= sync.failAt && sync.failAt > 0)
        throw Error("private sync failure");
      actual.fsyncSync(fd);
    },
  };
});
const parents: string[] = [],
  children: ChildProcess[] = [];
function fixture() {
  const f = cloudStackFixture(),
    parent = mkdtempSync(join(tmpdir(), "peel-cloud-manifest-"));
  parents.push(parent);
  const input = {
    ...f.input,
    source: {
      commit: "1".repeat(40),
      tree: "2".repeat(40),
      lockSha256: "3".repeat(64),
    },
    planSha256: "4".repeat(64),
  };
  return {
    parent,
    directory: join(parent, "manifest"),
    input,
    captured: createCloudRunManifest(input),
  };
}
const hash = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
function refused(work: () => unknown, code?: string) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(CloudManifestStorageError);
    expect((error as Error).message).toBe(
      "Private Cloud manifest storage unavailable",
    );
    expect((error as Error).cause).toBeUndefined();
    expect(Object.isFrozen(error)).toBe(true);
    if (code) expect((error as CloudManifestStorageError).code).toBe(code);
    return;
  }
  throw Error("Expected storage refusal");
}
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
async function exited(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null)
    await once(child, "exit");
}
function worker(
  f: ReturnType<typeof fixture>,
  captured = f.captured,
  mode = "normal",
  checkpoint?: string,
) {
  const script = fileURLToPath(
    new URL("../fixtures/cloud-manifest-worker.mjs", import.meta.url),
  );
  const child = spawn(process.execPath, [script], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  const line = new Promise<string>((resolve, reject) => {
    let output = "",
      settled = false;
    const fail = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(Error("Manifest worker unavailable"));
      }
    };
    const timer = setTimeout(fail, 10000);
    child.stdout!.on("data", (chunk) => {
      output += String(chunk);
      if (output.length > 8192) {
        fail();
        return;
      }
      const found = output
        .split("\n")
        .find((s) => (checkpoint ? s === checkpoint : s.startsWith("{")));
      if (found && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(found);
      }
    });
    child.on("error", fail);
    child.on("close", fail);
    child.stdin!.on("error", fail);
    child.stderr!.on("data", () => {});
  });
  child.stdin!.end(JSON.stringify({ directory: f.directory, captured, mode }));
  return { child, line };
}
afterEach(async () => {
  sync.failAt = 0;
  sync.calls = 0;
  vi.restoreAllMocks();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited(child);
  }
  for (const parent of parents.splice(0))
    rmSync(parent, { recursive: true, force: true });
});

it("exclusively persists exact private bytes and original identities, re-syncs on open and inspects without a new sync claim", () => {
  const f = fixture(),
    original = structuredClone(f.captured),
    store = CloudRunManifestStore.create(f.directory, f.captured);
  expect(Object.isFrozen(store)).toBe(true);
  expect(readdirSync(f.directory).sort()).toEqual([
    "manifest.json",
    "owner.json",
  ]);
  expect(statSync(f.directory).mode & 0o7777).toBe(0o700);
  for (const name of ["manifest.json", "owner.json"])
    expect(statSync(join(f.directory, name)).mode & 0o7777).toBe(0o600);
  expect(readFileSync(join(f.directory, "manifest.json"), "utf8")).toBe(
    original.json,
  );
  const snapshot = store.read();
  expect(snapshot.json).toBe(original.json);
  expect(snapshot.pin).toEqual(original.pin);
  frozen(snapshot);
  const calls = sync.calls;
  expect(CloudRunManifestStore.inspect(f.directory, original.pin)).toEqual(
    snapshot,
  );
  expect(sync.calls).toBe(calls);
  expect(CloudRunManifestStore.open(f.directory, original.pin).read()).toEqual(
    snapshot,
  );
  expect(sync.calls).toBe(calls + 4);
  refused(() => CloudRunManifestStore.create(f.directory, original), "exists");
  expect(store.directory.endsWith("/manifest")).toBe(true);
});

it("captures detached pins and rejects getters/private extras before creating any namespace", () => {
  const f = fixture(),
    getter = vi.fn(() => "private"),
    mutable = structuredClone(f.captured);
  const store = CloudRunManifestStore.create(f.directory, mutable);
  mutable.pin.source.commit = "9".repeat(40);
  expect(store.read().pin.source.commit).toBe("1".repeat(40));
  for (const value of [
    null,
    { ...f.captured, token: "private" },
    Object.defineProperty({ ...f.captured }, "json", { get: getter }),
    {
      ...f.captured,
      pin: Object.defineProperty({ ...f.captured.pin }, "sha256", {
        get: getter,
      }),
    },
    { ...f.captured, pin: { ...f.captured.pin, accountId: "222233334444" } },
    { ...f.captured, json: "private malformed" },
  ]) {
    const empty = fixture();
    refused(
      () =>
        CloudRunManifestStore.create(
          empty.directory,
          value as typeof f.captured,
        ),
      "invalid-input",
    );
    expect(readdirSync(empty.parent)).toEqual([]);
  }
  expect(getter).not.toHaveBeenCalled();
  const before = hash(join(f.directory, "manifest.json"));
  refused(() =>
    CloudRunManifestStore.open(f.directory, {
      ...f.captured.pin,
      source: { ...f.captured.pin.source, commit: "9".repeat(40) },
    }),
  );
  expect(hash(join(f.directory, "manifest.json"))).toBe(before);
});

it("preserves foreign/missing directories and invalid paths without fallback or repair", () => {
  const f = fixture();
  refused(() => CloudRunManifestStore.open(f.directory, f.captured.pin));
  expect(readdirSync(f.parent)).toEqual([]);
  for (const directory of [
    "relative/private",
    f.directory + "/../other",
    f.directory + "\n",
    "/",
  ])
    refused(
      () => CloudRunManifestStore.create(directory, f.captured),
      "invalid-input",
    );
  mkdirSync(f.directory, { mode: 0o700 });
  const foreign = join(f.directory, "notes.sqlite3");
  writeFileSync(foreign, "synthetic foreign", { mode: 0o600 });
  const before = hash(foreign);
  refused(
    () => CloudRunManifestStore.create(f.directory, f.captured),
    "exists",
  );
  refused(() => CloudRunManifestStore.open(f.directory, f.captured.pin));
  expect(hash(foreign)).toBe(before);
  expect(readdirSync(f.directory)).toEqual(["notes.sqlite3"]);
});

it("refuses mismatched ownership and permissive modes without changing stored state", () => {
  for (const name of [".", "manifest.json", "owner.json", "parent"]) {
    const f = fixture();
    CloudRunManifestStore.create(f.directory, f.captured);
    const target = name === "parent" ? f.parent : join(f.directory, name),
      mode = name === "parent" ? 0o777 : name === "." ? 0o755 : 0o644;
    chmodSync(target, mode);
    refused(() => CloudRunManifestStore.open(f.directory, f.captured.pin));
    expect(lstatSync(target).mode & 0o7777).toBe(mode);
  }
  const f = fixture();
  CloudRunManifestStore.create(f.directory, f.captured);
  const before = hash(join(f.directory, "manifest.json")),
    uid = process.getuid!(),
    caller = vi.spyOn(process, "getuid").mockReturnValue(uid + 1);
  try {
    refused(() => CloudRunManifestStore.open(f.directory, f.captured.pin));
  } finally {
    caller.mockRestore();
  }
  expect(hash(join(f.directory, "manifest.json"))).toBe(before);
  expect(
    CloudRunManifestStore.open(f.directory, f.captured.pin).read().json,
  ).toBe(f.captured.json);
});

it("rejects namespace/file links and preserves every referenced target", () => {
  const f = fixture(),
    outside = join(f.parent, "outside");
  mkdirSync(outside, { mode: 0o700 });
  const keep = join(outside, "keep");
  writeFileSync(keep, "synthetic keep", { mode: 0o600 });
  symlinkSync(outside, f.directory);
  refused(
    () => CloudRunManifestStore.create(f.directory, f.captured),
    "exists",
  );
  refused(() => CloudRunManifestStore.open(f.directory, f.captured.pin));
  expect(readFileSync(keep, "utf8")).toBe("synthetic keep");
  for (const name of ["manifest.json", "owner.json"])
    for (const hard of [false, true]) {
      const g = fixture();
      CloudRunManifestStore.create(g.directory, g.captured);
      const target = join(g.directory, name),
        saved = join(g.parent, "saved");
      if (hard) linkSync(target, saved);
      else {
        renameSync(target, saved);
        symlinkSync(saved, target);
      }
      const before = hash(saved);
      refused(() => CloudRunManifestStore.open(g.directory, g.captured.pin));
      expect(hash(saved)).toBe(before);
    }
});

it("refuses replaced file/directory identities even when their bytes and pins are copied", () => {
  for (const name of ["manifest.json", "owner.json", "directory"]) {
    const f = fixture();
    CloudRunManifestStore.create(f.directory, f.captured);
    if (name === "directory") {
      renameSync(f.directory, join(f.parent, "saved"));
      cpSync(join(f.parent, "saved"), f.directory, { recursive: true });
    } else {
      const target = join(f.directory, name),
        data = readFileSync(target);
      renameSync(target, join(f.parent, "saved"));
      writeFileSync(target, data, { mode: 0o600 });
    }
    const before = hash(join(f.directory, "manifest.json"));
    refused(() => CloudRunManifestStore.open(f.directory, f.captured.pin));
    expect(hash(join(f.directory, "manifest.json"))).toBe(before);
  }
});

it("preserves unknown/corrupt/oversize/invalid UTF-8 contents without interpreting or repairing them", () => {
  for (const change of ["extra", "marker", "recipe", "oversize", "utf8"]) {
    const f = fixture();
    CloudRunManifestStore.create(f.directory, f.captured);
    let target = join(
      f.directory,
      change === "marker" ? "owner.json" : "manifest.json",
    );
    if (change === "extra") {
      target = join(f.directory, "keep.txt");
      writeFileSync(target, "synthetic keep", { mode: 0o600 });
    } else if (change === "oversize")
      writeFileSync(target, "x".repeat(512 * 1024 + 1));
    else if (change === "utf8")
      writeFileSync(target, Buffer.from([0xff, 0xfe]));
    else writeFileSync(target, "synthetic private corrupt");
    const before = hash(target);
    refused(() => CloudRunManifestStore.open(f.directory, f.captured.pin));
    expect(hash(target)).toBe(before);
  }
});

it("checks path identities again before commit and never overwrites substituted data", () => {
  for (const replace of [
    "manifest.json",
    "owner.json",
    "directory",
    "manifest-in-place",
    "owner-in-place",
  ]) {
    const f = fixture();
    let foreign = "";
    refused(
      () =>
        CloudRunManifestStore.create(f.directory, f.captured, {
          beforeCommit: () => {
            if (replace === "directory") {
              renameSync(f.directory, join(f.parent, "original"));
              mkdirSync(f.directory, { mode: 0o700 });
              foreign = join(f.directory, "keep");
            } else if (replace.endsWith("-in-place")) {
              foreign = join(
                f.directory,
                replace === "owner-in-place" ? "owner.json" : "manifest.json",
              );
            } else {
              foreign = join(f.directory, replace);
              renameSync(foreign, join(f.parent, "original"));
            }
            writeFileSync(foreign, "synthetic foreign replacement", {
              mode: 0o600,
            });
          },
        }),
      "unrecognized",
    );
    expect(readFileSync(foreign, "utf8")).toBe("synthetic foreign replacement");
  }
});

it("never acknowledges sync failure and requires fresh successful sync for existing-store acknowledgement", () => {
  for (const phase of [1, 2, 3, 4]) {
    const f = fixture();
    sync.calls = 0;
    sync.failAt = phase;
    refused(
      () => CloudRunManifestStore.create(f.directory, f.captured),
      "unavailable",
    );
    const calls = sync.calls;
    if (phase === 1)
      refused(() => CloudRunManifestStore.inspect(f.directory, f.captured.pin));
    else {
      expect(
        CloudRunManifestStore.inspect(f.directory, f.captured.pin).json,
      ).toBe(f.captured.json);
      expect(sync.calls).toBe(calls);
      refused(
        () => CloudRunManifestStore.open(f.directory, f.captured.pin),
        "unavailable",
      );
    }
    sync.failAt = 0;
    if (phase > 1)
      expect(
        CloudRunManifestStore.open(f.directory, f.captured.pin).read().json,
      ).toBe(f.captured.json);
    refused(
      () => CloudRunManifestStore.create(f.directory, f.captured),
      "exists",
    );
  }
});

it("reads expired recipes without clock/new-run coupling and returns private errors for interrupted callbacks", () => {
  const f = fixture(),
    store = CloudRunManifestStore.create(f.directory, f.captured),
    clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw Error("private clock");
    });
  try {
    expect(
      CloudRunManifestStore.open(f.directory, f.captured.pin).read(),
    ).toEqual(store.read());
  } finally {
    clock.mockRestore();
  }
  for (const after of [false, true]) {
    const g = fixture(),
      hook = () => {
        throw Error("private hook cause");
      };
    refused(
      () =>
        CloudRunManifestStore.create(
          g.directory,
          g.captured,
          after ? { afterCommit: hook } : { beforeCommit: hook },
        ),
      "unavailable",
    );
    if (after)
      expect(
        CloudRunManifestStore.open(g.directory, g.captured.pin).read().json,
      ).toBe(g.captured.json);
    else
      refused(() => CloudRunManifestStore.inspect(g.directory, g.captured.pin));
  }
});

it("allows only one independent creator without mixing recipes", async () => {
  const f = fixture(),
    other = createCloudRunManifest({ ...f.input, planSha256: "5".repeat(64) }),
    workers = [worker(f), worker(f, other)];
  const outcomes = (await Promise.all(workers.map((w) => w.line))).map((s) =>
    JSON.parse(s),
  );
  await Promise.all(workers.map((w) => exited(w.child)));
  expect(outcomes.filter((x) => x.kind === "ok")).toHaveLength(1);
  expect(outcomes.filter((x) => x.code === "exists")).toHaveLength(1);
  const winner = outcomes[0].kind === "ok" ? f.captured : other;
  expect(CloudRunManifestStore.open(f.directory, winner.pin).read().json).toBe(
    winner.json,
  );
}, 20000);

it("preserves an incomplete namespace after actual pre-commit SIGKILL without automatic recreation", async () => {
  const f = fixture(),
    w = worker(f, f.captured, "before-commit", "prepared");
  await w.line;
  w.child.kill("SIGKILL");
  await exited(w.child);
  const before = hash(join(f.directory, "manifest.json"));
  refused(() => CloudRunManifestStore.open(f.directory, f.captured.pin));
  refused(
    () => CloudRunManifestStore.create(f.directory, f.captured),
    "exists",
  );
  expect(hash(join(f.directory, "manifest.json"))).toBe(before);
  expect(statSync(join(f.directory, "owner.json")).size).toBe(0);
}, 20000);

it("recovers exact committed bytes after SIGKILL before and after acknowledgement", async () => {
  for (const [mode, checkpoint] of [
    ["after-commit", "committed"],
    ["after-ack", "acknowledged"],
  ]) {
    const f = fixture(),
      w = worker(f, f.captured, mode, checkpoint);
    await w.line;
    w.child.kill("SIGKILL");
    await exited(w.child);
    const recovered = CloudRunManifestStore.open(
      f.directory,
      f.captured.pin,
    ).read();
    expect(recovered.json).toBe(f.captured.json);
    expect(recovered.pin).toEqual(f.captured.pin);
    frozen(recovered);
    refused(
      () => CloudRunManifestStore.create(f.directory, f.captured),
      "exists",
    );
  }
}, 20000);

it("does not discard a leading UTF-8 BOM before verifying exact stored bytes", () => {
  for (const name of ["manifest.json", "owner.json"]) {
    const f = fixture();
    CloudRunManifestStore.create(f.directory, f.captured);
    const file = join(f.directory, name);
    writeFileSync(
      file,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(file)]),
    );
    const before = hash(file);
    refused(() => CloudRunManifestStore.open(f.directory, f.captured.pin));
    expect(hash(file)).toBe(before);
  }
});
