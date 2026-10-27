import { openDB } from "idb";
import {
  PublicModelCache,
  ModelCacheError,
  type ModelManifest,
} from "../../packages/meaning/src/model-cache";
export { PublicModelCache };
const hash = async (bytes: Uint8Array) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
const assert = (value: unknown, code: string) => {
  if (!value) throw new Error(code);
};
const reject = async (run: () => Promise<unknown>, code: string) => {
  try {
    await run();
  } catch (error) {
    assert(
      error instanceof ModelCacheError && error.code === code,
      `wrong-error:${code}`,
    );
    return;
  }
  throw new Error(`expected-error:${code}`);
};
export async function smallSet(identity = "synthetic-v1", size = 4) {
  const bytes = new Uint8Array(size).fill(37);
  const manifest: ModelManifest = {
    identity,
    files: [
      {
        path: "/models/synthetic/a.bin",
        bytes: size,
        sha256: await hash(bytes),
      },
      {
        path: "/runtime/synthetic.wasm",
        bytes: size,
        sha256: await hash(bytes),
      },
    ],
  };
  return { manifest, load: async () => new Response(bytes.slice()) };
}
export async function runModelCacheContract(name: string) {
  const a = await smallSet(),
    b = await smallSet("synthetic-v2");
  let cache = new PublicModelCache(name);
  const checks: string[] = [];
  const record = (value: boolean, label: string) => {
    assert(value, label);
    checks.push(label);
  };
  try {
    await reject(() => cache.openReady(a.manifest), "model-not-ready");
    const first = await cache.install(a.manifest, a.load);
    await cache.close();
    cache = new PublicModelCache(name);
    const handle = await cache.openReady(a.manifest);
    record(
      new Uint8Array(await handle.read(a.manifest.files[0].path))[0] === 37 &&
        !first.reused,
      "complete-reopen-verified",
    );
    let calls = 0;
    record(
      (
        await cache.install(a.manifest, async () => {
          calls++;
          throw Error("must-not-download");
        })
      ).reused && calls === 0,
      "exact-set-reuse-no-download",
    );
    await reject(() => cache.openReady(b.manifest), "model-version-mismatch");
    await reject(() => handle.read("/models/unknown"), "artifact-not-allowed");
    checks.push("version-and-path-bound");
    await reject(
      () =>
        cache.install(b.manifest, async () => new Response(new Uint8Array(5))),
      "artifact-size",
    );
    await reject(
      () =>
        cache.install(b.manifest, async () => new Response(new Uint8Array(4))),
      "artifact-integrity",
    );
    await reject(
      () =>
        cache.install(
          b.manifest,
          async () => new Response(null, { status: 404 }),
        ),
      "artifact-unavailable",
    );
    await cache.openReady(a.manifest);
    checks.push("oversize-corrupt-missing-preserve-ready");
    const controller = new AbortController();
    await reject(
      () =>
        cache.install(b.manifest, b.load, {
          signal: controller.signal,
          progress: () => controller.abort(),
        }),
      "cancelled",
    );
    await cache.openReady(a.manifest);
    const duringStream = new AbortController();
    let pulls = 0;
    await reject(
      () =>
        cache.install(
          b.manifest,
          async () =>
            new Response(
              new ReadableStream({
                pull(controller) {
                  if (++pulls === 1) controller.enqueue(new Uint8Array([37]));
                  else duringStream.abort();
                },
              }),
            ),
          { signal: duringStream.signal },
        ),
      "cancelled",
    );
    await cache.openReady(a.manifest);
    checks.push("cancel-pending-stream-preserves-ready");
    const raw = await openDB(name, 1);
    record(
      !(await raw.get("meta", "staging")),
      "cancel-cleans-stage-preserves-ready",
    );
    let downloaded = 0;
    await reject(
      () =>
        cache.install(b.manifest, async () => {
          if (++downloaded === 2) {
            const staging = await raw.get("meta", "staging");
            await raw.put("artifacts", new Uint8Array(4).buffer, [
              staging.generation,
              b.manifest.files[0].path,
            ]);
          }
          return b.load();
        }),
      "artifact-integrity",
    );
    await cache.openReady(a.manifest);
    record(
      !(await raw.get("meta", "staging")),
      "stored-stage-reverified-before-promotion",
    );
    const original = await raw.get("meta", "ready");
    await raw.put("artifacts", new Uint8Array([0, 0, 0, 0]).buffer, [
      original.generation,
      a.manifest.files[0].path,
    ]);
    await reject(() => cache.openReady(a.manifest), "artifact-integrity");
    await reject(
      () => handle.read(a.manifest.files[0].path),
      "artifact-integrity",
    );
    record(
      !(await cache.install(a.manifest, a.load)).reused,
      "durable-corruption-rejected-and-repaired",
    );
    const repaired = await cache.openReady(a.manifest);
    await cache.install(b.manifest, b.load);
    await reject(
      () => repaired.read(a.manifest.files[0].path),
      "model-handle-stale",
    );
    record(
      (await raw.getAllKeys("artifacts")).length === 2,
      "atomic-replacement-reclaims-old-generation",
    );
    raw.close();
    const current = await cache.openReady(b.manifest);
    await cache.remove();
    await reject(
      () => current.read(b.manifest.files[0].path),
      "model-handle-stale",
    );
    await reject(() => cache.openReady(b.manifest), "model-not-ready");
    checks.push("remove-invalidates-handles");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const loaded = new Promise<void>((r) => (entered = r));
    const firstInstall = cache.install(a.manifest, async () => {
      entered();
      await gate;
      return a.load();
    });
    await loaded;
    const other = new PublicModelCache(name);
    const cancelQueued = new AbortController();
    const queued = other.install(b.manifest, b.load, {
      signal: cancelQueued.signal,
    });
    cancelQueued.abort();
    await reject(() => queued, "cancelled");
    let secondLoads = 0;
    const second = other.install(a.manifest, async () => {
      secondLoads++;
      return a.load();
    });
    release();
    await firstInstall;
    record(
      (await second).reused && secondLoads === 0,
      "concurrent-install-serialized-and-queued-cancel",
    );
    await other.close();
    return { checks, count: checks.length, realNotesUsed: false };
  } finally {
    await cache.close();
  }
}

export async function quotaSetup(name: string) {
  const a = await smallSet(),
    cache = new PublicModelCache(name);
  await cache.install(a.manifest, a.load);
  await cache.close();
}
export async function interruptedRecovery(name: string) {
  const a = await smallSet(),
    cache = new PublicModelCache(name);
  const raw = await openDB(name, 1);
  assert(await raw.get("meta", "staging"), "interrupted-stage-required");
  assert(
    (await raw.getAllKeys("artifacts")).length === 3,
    "one-staged-artifact-required",
  );
  await cache.openReady(a.manifest);
  const result = await cache.install(a.manifest, a.load);
  assert(
    result.reused &&
      !(await raw.get("meta", "staging")) &&
      (await raw.getAllKeys("artifacts")).length === 2,
    "interrupted-cleanup-required",
  );
  raw.close();
  await cache.close();
  return {
    abandonedStageObserved: true,
    priorReadyPreserved: true,
    stagedArtifactReclaimed: true,
  };
}
export async function abortedWrite(name: string) {
  const a = await smallSet(),
    b = await smallSet("aborted-update-v2");
  const cache = new PublicModelCache(name);
  const original = IDBObjectStore.prototype.put;
  const cases: {
    boundary: string;
    errorName: string;
    priorReadyPreserved: boolean;
  }[] = [];
  try {
    for (const boundary of ["artifact-write", "atomic-promotion"]) {
      let forced = false,
        errorName = "none";
      IDBObjectStore.prototype.put = function (...args) {
        const request = original.apply(this, args);
        if (
          (boundary === "artifact-write" && this.name === "artifacts") ||
          (boundary === "atomic-promotion" &&
            this.name === "meta" &&
            args[1] === "ready")
        ) {
          forced = true;
          this.transaction.abort();
        }
        return request;
      };
      try {
        await cache.install(b.manifest, b.load);
      } catch (error) {
        errorName = (error as Error).name;
      } finally {
        IDBObjectStore.prototype.put = original;
      }
      assert(
        forced &&
          [
            "AbortError",
            "TransactionInactiveError",
            "InvalidStateError",
          ].includes(errorName),
        `actual-transaction-abort-required:${boundary}:${forced}:${errorName}`,
      );
      await cache.openReady(a.manifest);
      cases.push({ boundary, errorName, priorReadyPreserved: true });
    }
  } finally {
    IDBObjectStore.prototype.put = original;
    await cache.close();
  }
  return {
    cases,
    boundary:
      "Actual write/promotion transactions forcibly aborted by synthetic fixture; not quota exhaustion",
  };
}
