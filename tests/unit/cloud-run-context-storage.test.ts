import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
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
import {
  CloudRunContextStore,
  CloudContextStorageError,
} from "../../infra/cloud/run-context-storage.ts";
import { CloudRunManifestStore } from "../../infra/cloud/manifest-storage.ts";
import { CloudRunLedger } from "../../infra/cloud/run-ledger.ts";
import { createCloudRunPlanContext } from "../../infra/cloud/run-plan-context.ts";
import { cloudNormalizedPlanFixture } from "../fixtures/cloud-normalized-plan.ts";
import {
  cloudLedgerPlan,
  ledgerRunIds,
} from "../fixtures/cloud-ledger-plan.ts";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as policy from "../../infra/cloud/deployment-plan.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as codec from "../../infra/cloud/run-manifest.ts";

const sync = vi.hoisted(() => ({ failAt: 0, calls: 0 }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    fsyncSync: (fd: number) => {
      if (++sync.calls >= sync.failAt && sync.failAt > 0)
        throw Error("private sync");
      actual.fsyncSync(fd);
    },
  };
});
const parents: string[] = [],
  children: ChildProcess[] = [],
  now = Date.parse("2026-10-27T12:00:00.000Z");
const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
function sample(second = false, id = ledgerRunIds[0], time = now) {
  const value = cloudNormalizedPlanFixture(second, id, time),
    context = createCloudRunPlanContext(value),
    f = cloudLedgerPlan(id, time);
  f.plan.source.templatesSha256 = context.plan.source.templatesSha256;
  f.observed.source.templatesSha256 = context.plan.source.templatesSha256;
  return { value, context, f };
}
function fixture(reserve = true) {
  const parent = mkdtempSync(join(tmpdir(), "peel-context-store-"));
  parents.push(parent);
  const s = sample(),
    ledgerDirectory = join(parent, "ledger"),
    manifestDirectory = join(parent, "manifest"),
    directory = join(parent, "context"),
    ledger = CloudRunLedger.create(ledgerDirectory, s.f.authorization);
  if (reserve)
    ledger.reserve(s.f.plan, s.f.observed, ledger.read().snapshotSha256, {
      clock: () => s.f.now,
    });
  CloudRunManifestStore.create(manifestDirectory, s.value.manifest);
  const expected = {
    contextSha256: s.context.contextSha256,
    manifest: { directory: manifestDirectory, pin: s.value.manifest.pin },
    ledger: { directory: ledgerDirectory, authority: s.f.authorization },
  };
  return {
    ...s,
    parent,
    directory,
    ledger,
    ledgerDirectory,
    manifestDirectory,
    expected,
    input: { json: s.context.json, expected },
  };
}
function refused(work: () => unknown, code?: string) {
  let caught: unknown;
  try {
    work();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CloudContextStorageError);
  expect((caught as Error).message).toBe(
    "Private Cloud context storage unavailable",
  );
  expect((caught as Error).cause).toBeUndefined();
  expect(Object.isFrozen(caught)).toBe(true);
  if (code) expect((caught as CloudContextStorageError).code).toBe(code);
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
  mode = "normal",
  checkpoint?: string,
) {
  const script = fileURLToPath(
      new URL("../fixtures/cloud-context-worker.mjs", import.meta.url),
    ),
    child = spawn(process.execPath, [script], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  children.push(child);
  const line = new Promise<string>((resolve, reject) => {
    let output = "",
      settled = false;
    const finish = (value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (value) resolve(value);
      else reject(Error("Context worker unavailable"));
    };
    const timer = setTimeout(() => finish(), 10000);
    child.stdout!.on("data", (chunk) => {
      output += String(chunk);
      if (output.length > 8192) return finish();
      const found = output
        .split("\n")
        .find((s) => (checkpoint ? s === checkpoint : s.startsWith("{")));
      if (found) finish(found);
    });
    child.on("error", () => finish());
    child.on("close", () => finish());
    child.stdin!.on("error", () => finish());
    child.stderr!.on("data", () => {});
  });
  child.stdin!.end(
    JSON.stringify({ directory: f.directory, value: f.input, mode }),
  );
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

it("persists exact bound context, independently checks actual sources and re-syncs only context on open", () => {
  const f = fixture(),
    before = f.ledger.read(),
    files = [
      join(f.ledgerDirectory, "runs.sqlite"),
      join(f.manifestDirectory, "manifest.json"),
      join(f.manifestDirectory, "owner.json"),
    ],
    bytes = files.map((file) => readFileSync(file));
  sync.calls = 0;
  const store = CloudRunContextStore.create(f.directory, f.input),
    snapshot = store.read();
  expect(sync.calls).toBe(4);
  expect(store).toBeInstanceOf(CloudRunContextStore);
  expect(Object.isFrozen(store)).toBe(true);
  expect(readdirSync(f.directory).sort()).toEqual([
    "context.json",
    "owner.json",
  ]);
  expect(statSync(f.directory).mode & 0o7777).toBe(0o700);
  for (const name of ["context.json", "owner.json"])
    expect(statSync(join(f.directory, name)).mode & 0o7777).toBe(0o600);
  expect(readFileSync(join(f.directory, "context.json"), "utf8")).toBe(
    f.context.json,
  );
  const marker = JSON.parse(
    readFileSync(join(f.directory, "owner.json"), "utf8"),
  );
  expect(marker).toMatchObject({
    format: 1,
    kind: "peel-cloud-run-context-store",
    expected: {
      contextSha256: f.context.contextSha256,
      manifest: { pin: f.value.manifest.pin },
      ledger: { authority: f.f.authorization },
    },
  });
  expect(snapshot.context).toEqual(f.context);
  expect(snapshot.binding).toMatchObject({
    contextSha256: f.context.contextSha256,
    reservation: { slot: 1 },
    runAuthority: "unproven",
    ownership: "unproven",
    resourceWrites: 0,
  });
  expect(CloudRunContextStore.inspect(f.directory, f.expected)).toEqual(
    snapshot,
  );
  expect(sync.calls).toBe(4);
  expect(CloudRunContextStore.open(f.directory, f.expected).read()).toEqual(
    snapshot,
  );
  expect(sync.calls).toBe(8);
  expect(f.ledger.read()).toEqual(before);
  files.forEach((file, i) => expect(readFileSync(file)).toEqual(bytes[i]));
  frozen(snapshot);
  refused(() => CloudRunContextStore.create(f.directory, f.input), "exists");
});

it("retains detached normalized source pins when caller objects change during publication", () => {
  const f = fixture(),
    input = structuredClone(f.input),
    original = structuredClone(f.expected),
    store = CloudRunContextStore.create(f.directory, input, {
      beforeCommit: () => {
        input.expected.ledger.directory = "relative";
        input.expected.ledger.authority.identity.profile = "foreign";
        input.expected.manifest.pin.source.commit = "9".repeat(40);
        input.expected.contextSha256 = "9".repeat(64);
      },
    });
  expect(store.read().context).toEqual(f.context);
  expect(CloudRunContextStore.open(f.directory, original).read()).toEqual(
    store.read(),
  );
});

it("keeps original context readable after actual cleanup and a second reservation", () => {
  const f = fixture(),
    first = CloudRunContextStore.create(f.directory, f.input),
    marker = readFileSync(join(f.directory, "owner.json"));
  f.ledger.recordCleanup(
    {
      runId: ledgerRunIds[0],
      planSha256: f.context.planSha256,
      inventorySha256: "9".repeat(64),
      checkedAt: new Date(now + 1000).toISOString(),
    },
    f.ledger.read().snapshotSha256,
    { clock: () => now + 1000 },
  );
  const second = sample(true, ledgerRunIds[1], now + 10000);
  f.ledger.reserve(
    second.f.plan,
    second.f.observed,
    f.ledger.read().snapshotSha256,
    { clock: () => second.f.now },
  );
  expect(first.read().binding.reservation).toMatchObject({
    slot: 1,
    cleanupReceiptRecorded: true,
  });
  expect(readFileSync(join(f.directory, "owner.json"))).toEqual(marker);
  const directory = join(f.parent, "second-context"),
    manifestDirectory = join(f.parent, "second-manifest");
  CloudRunManifestStore.create(manifestDirectory, second.value.manifest);
  const expected = {
      ...f.expected,
      contextSha256: second.context.contextSha256,
      manifest: {
        directory: manifestDirectory,
        pin: second.value.manifest.pin,
      },
    },
    store = CloudRunContextStore.create(directory, {
      json: second.context.json,
      expected,
    });
  expect(store.read().binding.reservation).toMatchObject({
    slot: 2,
    runId: ledgerRunIds[1],
    cleanupReceiptRecorded: false,
  });
  expect(
    CloudRunContextStore.open(f.directory, f.expected).read().binding
      .reservation.slot,
  ).toBe(1);
});

it("rejects strict malformed input/getters/overrides and wrong digests before accessing sources or mutating a target", () => {
  const f = fixture(),
    getter = vi.fn(() => "private"),
    inspect = vi.spyOn(CloudRunManifestStore, "inspect"),
    open = vi.spyOn(CloudRunLedger, "open");
  for (const input of [
    null,
    { ...f.input, owned: true },
    { ...f.input, json: f.input.json + " " },
    { ...f.input, json: "x".repeat(32769) },
    { ...f.input, expected: { ...f.expected, contextSha256: "F".repeat(64) } },
    { ...f.input, expected: { ...f.expected, kind: "private" } },
    {
      ...f.input,
      expected: {
        ...f.expected,
        ledger: { ...f.expected.ledger, directory: "relative" },
      },
    },
    {
      ...f.input,
      expected: {
        ...f.expected,
        manifest: {
          ...f.expected.manifest,
          directory: f.manifestDirectory + "\n",
        },
      },
    },
    Object.defineProperty({ ...f.input }, "json", { get: getter }),
    {
      ...f.input,
      expected: Object.defineProperty({ ...f.expected }, "ledger", {
        get: getter,
      }),
    },
    {
      ...f.input,
      expected: {
        ...f.expected,
        manifest: {
          ...f.expected.manifest,
          pin: Object.defineProperty({ ...f.expected.manifest.pin }, "sha256", {
            get: getter,
          }),
        },
      },
    },
    {
      ...f.input,
      expected: {
        ...f.expected,
        ledger: {
          ...f.expected.ledger,
          authority: Object.defineProperty(
            { ...f.expected.ledger.authority },
            "identity",
            { get: getter },
          ),
        },
      },
    },
  ])
    refused(
      () => CloudRunContextStore.create(f.directory, input as typeof f.input),
      "invalid-input",
    );
  for (const path of [
    "relative",
    f.directory + "/../other",
    "/",
    f.directory + "\n",
  ])
    refused(() => CloudRunContextStore.create(path, f.input), "invalid-input");
  expect(getter).not.toHaveBeenCalled();
  expect(inspect).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(existsSync(f.directory)).toBe(false);
});

it("requires the actual matching original manifest and ledger reservation before creating any namespace", () => {
  for (const change of [
    "missing-manifest",
    "wrong-pin",
    "missing-ledger",
    "wrong-authority",
    "empty-ledger",
    "invalid-context",
    "other-run",
  ]) {
    const f = fixture(change !== "empty-ledger"),
      input = structuredClone(f.input);
    if (change === "missing-manifest")
      input.expected.manifest.directory = join(f.parent, "absent-manifest");
    if (change === "wrong-pin")
      input.expected.manifest.pin = {
        ...input.expected.manifest.pin,
        sha256: "9".repeat(64),
      };
    if (change === "missing-ledger")
      input.expected.ledger.directory = join(f.parent, "absent-ledger");
    if (change === "wrong-authority")
      input.expected.ledger.authority.authorizedUntil =
        "2026-10-27T19:00:00.000Z";
    if (change === "invalid-context") {
      input.json = "{}";
      input.expected.contextSha256 = hash(input.json);
    }
    if (change === "other-run") {
      const other = sample(false, ledgerRunIds[1]),
        path = join(f.parent, "other-manifest");
      CloudRunManifestStore.create(path, other.value.manifest);
      input.json = other.context.json;
      input.expected.contextSha256 = other.context.contextSha256;
      input.expected.manifest = {
        directory: path,
        pin: other.value.manifest.pin,
      };
    }
    const before = f.ledger.read();
    refused(
      () => CloudRunContextStore.create(f.directory, input),
      "unrecognized",
    );
    expect(existsSync(f.directory)).toBe(false);
    expect(f.ledger.read()).toEqual(before);
    expect(existsSync(join(f.parent, "absent-manifest"))).toBe(false);
    expect(existsSync(join(f.parent, "absent-ledger"))).toBe(false);
  }
});

it("rechecks actual sources on existing read/open and post-commit readback without repairing damage", () => {
  for (const source of ["manifest", "ledger"])
    for (const during of [false, true]) {
      const f = fixture(),
        target =
          source === "manifest"
            ? join(f.manifestDirectory, "manifest.json")
            : join(f.ledgerDirectory, "owner.json"),
        damage = () =>
          writeFileSync(target, "synthetic preserved source change");
      if (during)
        refused(
          () =>
            CloudRunContextStore.create(f.directory, f.input, {
              afterCommit: damage,
            }),
          "unrecognized",
        );
      else {
        CloudRunContextStore.create(f.directory, f.input);
        damage();
      }
      refused(
        () => CloudRunContextStore.open(f.directory, f.expected),
        "unrecognized",
      );
      refused(
        () => CloudRunContextStore.inspect(f.directory, f.expected),
        "unrecognized",
      );
      expect(readFileSync(target, "utf8")).toBe(
        "synthetic preserved source change",
      );
      expect(readFileSync(join(f.directory, "context.json"), "utf8")).toBe(
        f.context.json,
      );
    }
});

it("preserves unknown/linked/permissive/corrupt or replaced context namespaces", () => {
  for (const change of [
    "extra",
    "utf8",
    "bom",
    "marker",
    "file-link",
    "hard-link",
    "mode",
    "copied",
  ]) {
    const f = fixture();
    CloudRunContextStore.create(f.directory, f.input);
    let target = join(f.directory, "context.json");
    if (change === "extra") {
      target = join(f.directory, "keep");
      writeFileSync(target, "synthetic unknown", { mode: 0o600 });
    }
    if (change === "utf8") writeFileSync(target, Buffer.from([0xff, 0xfe]));
    if (change === "bom")
      writeFileSync(
        target,
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), readFileSync(target)]),
      );
    if (change === "marker") {
      target = join(f.directory, "owner.json");
      writeFileSync(target, "synthetic corrupt");
    }
    if (change === "file-link") {
      renameSync(target, join(f.parent, "saved"));
      symlinkSync(join(f.parent, "saved"), target);
    }
    if (change === "hard-link") linkSync(target, join(f.parent, "saved"));
    if (change === "mode") chmodSync(target, 0o644);
    if (change === "copied") {
      renameSync(f.directory, join(f.parent, "saved"));
      cpSync(join(f.parent, "saved"), f.directory, { recursive: true });
    }
    const before = hash(readFileSync(target));
    refused(() => CloudRunContextStore.open(f.directory, f.expected));
    expect(hash(readFileSync(target))).toBe(before);
    refused(() => CloudRunContextStore.create(f.directory, f.input), "exists");
  }
  const f = fixture();
  refused(() => CloudRunContextStore.open(f.directory, f.expected));
  expect(existsSync(f.directory)).toBe(false);
});

it("preserves linked/unknown/corrupt source stores before publication", () => {
  for (const source of ["manifest", "ledger"])
    for (const change of ["link", "extra", "mode"]) {
      const f = fixture(),
        input = structuredClone(f.input),
        directory =
          source === "manifest" ? f.manifestDirectory : f.ledgerDirectory;
      let target = join(directory, "owner.json");
      if (change === "link") {
        const alias = join(f.parent, "alias");
        symlinkSync(directory, alias);
        if (source === "manifest") input.expected.manifest.directory = alias;
        else input.expected.ledger.directory = alias;
      } else if (change === "extra") {
        target = join(directory, "keep");
        writeFileSync(target, "synthetic unknown", { mode: 0o600 });
      } else chmodSync(target, 0o644);
      const before = readFileSync(target);
      refused(
        () => CloudRunContextStore.create(f.directory, input),
        "unrecognized",
      );
      expect(readFileSync(target)).toEqual(before);
      expect(existsSync(f.directory)).toBe(false);
    }
});

it("never acknowledges a failed context sync, leaves incomplete state and requires a fresh successful open sync", () => {
  for (const phase of [1, 2, 3, 4]) {
    const f = fixture();
    sync.calls = 0;
    sync.failAt = phase;
    refused(
      () => CloudRunContextStore.create(f.directory, f.input),
      "unavailable",
    );
    if (phase === 1)
      refused(() => CloudRunContextStore.inspect(f.directory, f.expected));
    else {
      const calls = sync.calls;
      expect(CloudRunContextStore.inspect(f.directory, f.expected).json).toBe(
        f.context.json,
      );
      expect(sync.calls).toBe(calls);
      refused(
        () => CloudRunContextStore.open(f.directory, f.expected),
        "unavailable",
      );
    }
    sync.failAt = 0;
    if (phase > 1)
      expect(
        CloudRunContextStore.open(f.directory, f.expected).read().json,
      ).toBe(f.context.json);
    refused(() => CloudRunContextStore.create(f.directory, f.input), "exists");
  }
});

it("allows only one actual independent creator", async () => {
  const f = fixture(),
    workers = [worker(f), worker(f)],
    outcomes = (await Promise.all(workers.map((w) => w.line))).map((s) =>
      JSON.parse(s),
    );
  await Promise.all(workers.map((w) => exited(w.child)));
  expect(outcomes.filter((x) => x.kind === "ok")).toHaveLength(1);
  expect(outcomes.filter((x) => x.code === "exists")).toHaveLength(1);
  expect(CloudRunContextStore.open(f.directory, f.expected).read().json).toBe(
    f.context.json,
  );
}, 20000);

it("preserves actual pre-commit SIGKILL state and recovers committed bytes after pre/post-ack SIGKILL", async () => {
  for (const [mode, checkpoint] of [
    ["before-commit", "prepared"],
    ["after-commit", "committed"],
    ["after-ack", "acknowledged"],
  ]) {
    const f = fixture(),
      w = worker(f, mode, checkpoint);
    await w.line;
    w.child.kill("SIGKILL");
    await exited(w.child);
    expect(readFileSync(join(f.directory, "context.json"), "utf8")).toBe(
      f.context.json,
    );
    if (mode === "before-commit") {
      refused(() => CloudRunContextStore.open(f.directory, f.expected));
      expect(statSync(join(f.directory, "owner.json")).size).toBe(0);
    } else {
      expect(
        CloudRunContextStore.open(f.directory, f.expected).read().context,
      ).toEqual(f.context);
    }
    refused(() => CloudRunContextStore.create(f.directory, f.input), "exists");
  }
}, 20000);

it("recovers expired original context with current factories/validators/cost/writer and live clock unavailable", () => {
  const f = fixture();
  CloudRunContextStore.create(f.directory, f.input);
  const unavailable = () => {
      throw Error("private current source unavailable");
    },
    spies = [
      vi
        .spyOn(current, "cloudExpectedInventory")
        .mockImplementation(unavailable),
      vi
        .spyOn(policy, "validateCloudDeploymentPlan")
        .mockImplementation(unavailable),
      vi.spyOn(policy, "cloudDevelopmentCost").mockImplementation(unavailable),
      vi
        .spyOn(hosting, "cloudPrivateHostingTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(hosting, "cloudArtifactBootstrapTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(cleanup, "cloudCleanupGuardTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(cleanup, "cloudCleanupSentinelTemplate")
        .mockImplementation(unavailable),
      vi.spyOn(cleanup, "cloudDevStackNames").mockImplementation(unavailable),
      vi
        .spyOn(data, "cloudDataIdentityTemplate")
        .mockImplementation(unavailable),
      vi.spyOn(codec, "createCloudRunManifest").mockImplementation(unavailable),
    ],
    clock = vi.spyOn(Date, "now").mockImplementation(unavailable);
  let result!: ReturnType<typeof CloudRunContextStore.inspect>;
  try {
    result = CloudRunContextStore.open(f.directory, f.expected).read();
  } finally {
    clock.mockRestore();
  }
  expect(result.context).toEqual(f.context);
  expect(result.binding.runAuthority).toBe("unproven");
  frozen(result);
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});

it("binds independently expected digest and canonical source selection on re-entry", () => {
  const f = fixture();
  CloudRunContextStore.create(f.directory, f.input);
  const manifestDirectory = join(f.parent, "another-manifest"),
    ledgerDirectory = join(f.parent, "another-ledger");
  CloudRunManifestStore.create(manifestDirectory, f.value.manifest);
  const ledger = CloudRunLedger.create(ledgerDirectory, f.f.authorization);
  ledger.reserve(f.f.plan, f.f.observed, ledger.read().snapshotSha256, {
    clock: () => f.f.now,
  });
  const bytes = readFileSync(join(f.directory, "owner.json"));
  for (const expected of [
    { ...f.expected, contextSha256: "9".repeat(64) },
    {
      ...f.expected,
      manifest: { ...f.expected.manifest, directory: manifestDirectory },
    },
    {
      ...f.expected,
      ledger: { ...f.expected.ledger, directory: ledgerDirectory },
    },
  ])
    refused(
      () => CloudRunContextStore.open(f.directory, expected),
      "unrecognized",
    );
  expect(readFileSync(join(f.directory, "owner.json"))).toEqual(bytes);
  expect(
    CloudRunContextStore.open(f.directory, f.expected).read().context,
  ).toEqual(f.context);
  const inspect = vi.spyOn(CloudRunManifestStore, "inspect");
  const huge = {
    ...f.expected,
    manifest: { ...f.expected.manifest, directory: "/" + "界".repeat(4094) },
    ledger: { ...f.expected.ledger, directory: "/" + "界".repeat(4094) },
  };
  refused(
    () =>
      CloudRunContextStore.create(join(f.parent, "other"), {
        json: f.input.json,
        expected: huge,
      }),
    "invalid-input",
  );
  expect(inspect).not.toHaveBeenCalled();
  expect(existsSync(join(f.parent, "other"))).toBe(false);
});
