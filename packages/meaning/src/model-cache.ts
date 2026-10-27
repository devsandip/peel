import { openDB, type IDBPDatabase } from "idb";

/** Public artifacts only. M0 adapter, deliberately excluded from app imports. */
export interface ModelArtifact {
  path: string;
  bytes: number;
  sha256: string;
}
export interface ModelManifest {
  identity: string;
  files: ModelArtifact[];
}
interface Installation {
  format: 1;
  generation: string;
  id: string;
  manifest: ModelManifest;
}
type Change =
  | {
      store: "meta" | "artifacts";
      kind: "put";
      key: IDBValidKey;
      value: unknown;
    }
  | { store: "meta" | "artifacts"; kind: "delete"; key: IDBValidKey }
  | { store: "meta" | "artifacts"; kind: "clear" };
export class ModelCacheError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ModelCacheError";
  }
}
const fail = (code: string): never => {
  throw new ModelCacheError(code);
};
export function validateModelManifest(input: ModelManifest): ModelManifest {
  const value = structuredClone(input);
  if (
    typeof value?.identity !== "string" ||
    !value.identity.length ||
    value.identity.length > 4096 ||
    !Array.isArray(value.files) ||
    value.files.length < 1 ||
    value.files.length > 16
  )
    return fail("invalid-manifest");
  const paths = new Set<string>();
  let total = 0;
  for (const file of value.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      file.path.length > 300 ||
      !/^\/(models|runtime)\/[a-zA-Z0-9_./-]+$/.test(file.path) ||
      file.path
        .split("/")
        .slice(1)
        .some((s) => !s || s === "." || s === "..") ||
      paths.has(file.path) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 1 ||
      file.bytes > 64 * 1024 * 1024 ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    )
      return fail("invalid-manifest");
    total += file.bytes;
    paths.add(file.path);
  }
  if (total > 128 * 1024 * 1024) return fail("invalid-manifest");
  return {
    identity: value.identity,
    files: value.files
      .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}
const digest = async (bytes: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
export const modelManifestId = async (manifest: ModelManifest) =>
  digest(
    new TextEncoder().encode(JSON.stringify(validateModelManifest(manifest)))
      .buffer,
  );
const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) fail("cancelled");
};
async function verify(file: ModelArtifact, bytes: unknown) {
  if (
    !(bytes instanceof ArrayBuffer) ||
    bytes.byteLength !== file.bytes ||
    (await digest(bytes)) !== file.sha256
  )
    fail("artifact-integrity");
  return bytes as ArrayBuffer;
}
async function boundedResponse(
  response: Response,
  file: ModelArtifact,
  signal: AbortSignal,
) {
  if (!response.ok || !response.body) return fail("artifact-unavailable");
  const reader = response.body.getReader();
  const abort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  const bytes = new Uint8Array(file.bytes);
  let loaded = 0;
  try {
    for (;;) {
      checkAbort(signal);
      const chunk = await reader.read();
      checkAbort(signal);
      if (chunk.done) break;
      if (loaded + chunk.value.byteLength > file.bytes)
        return fail("artifact-size");
      bytes.set(chunk.value, loaded);
      loaded += chunk.value.byteLength;
    }
    if (loaded !== file.bytes) return fail("artifact-size");
    return await verify(file, bytes.buffer);
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class PublicModelCache {
  private db: Promise<IDBPDatabase>;
  constructor(private readonly name: string) {
    if (!/^peel-m0-model-[a-zA-Z0-9_-]{1,80}$/.test(name))
      fail("isolated-database-required");
    this.db = openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore("meta");
        db.createObjectStore("artifacts");
      },
    }).then((db) => {
      if (
        db.objectStoreNames.length !== 2 ||
        !db.objectStoreNames.contains("meta") ||
        !db.objectStoreNames.contains("artifacts")
      ) {
        db.close();
        return fail("unrecognized-cache-schema");
      }
      return db;
    });
  }
  private async exclusive<T>(run: () => Promise<T>, signal?: AbortSignal) {
    if (!globalThis.navigator?.locks) return fail("locks-unavailable");
    checkAbort(signal);
    try {
      return await navigator.locks.request(
        `peel-public-model:${this.name}`,
        { mode: "exclusive", signal },
        run,
      );
    } catch (error) {
      checkAbort(signal);
      throw error;
    }
  }
  private async record(input: unknown): Promise<Installation> {
    const value = input as Installation;
    if (
      value?.format !== 1 ||
      typeof value.generation !== "string" ||
      !/^[0-9a-f-]{36}$/.test(value.generation) ||
      value.id !== (await modelManifestId(value.manifest))
    )
      return fail("unrecognized-cache-metadata");
    return { ...value, manifest: validateModelManifest(value.manifest) };
  }
  private async clearStage() {
    const db = await this.db;
    const raw = await db.get("meta", "staging");
    if (!raw) return;
    const stage = await this.record(raw);
    await this.mutate([
      ...stage.manifest.files.map((file) => ({
        store: "artifacts" as const,
        kind: "delete" as const,
        key: [stage.generation, file.path],
      })),
      { store: "meta", kind: "delete", key: "staging" },
    ]);
  }
  private async mutate(changes: Change[]) {
    const tx = (await this.db).transaction(["meta", "artifacts"], "readwrite", {
      durability: "strict",
    });
    const writes: Promise<unknown>[] = [];
    const done = tx.done;
    void done.catch(() => {});
    try {
      for (const change of changes) {
        const store = tx.objectStore(change.store);
        const request =
          change.kind === "put"
            ? store.put(change.value, change.key)
            : change.kind === "delete"
              ? store.delete(change.key)
              : store.clear();
        writes.push(request);
        void request.catch(() => {});
      }
      await Promise.all(writes);
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* Already aborted or completed. */
      }
      await Promise.allSettled(writes);
      await done.catch(() => {});
      throw error;
    }
  }
  private async verified(record: Installation) {
    const db = await this.db;
    for (const file of record.manifest.files)
      await verify(
        file,
        await db.get("artifacts", [record.generation, file.path]),
      );
  }
  async install(
    input: ModelManifest,
    load: (file: ModelArtifact, signal: AbortSignal) => Promise<Response>,
    options: {
      signal?: AbortSignal;
      progress?: (value: {
        completedFiles: number;
        totalFiles: number;
        verifiedBytes: number;
      }) => void;
    } = {},
  ): Promise<{ id: string; reused: boolean }> {
    const manifest = validateModelManifest(input);
    const id = await modelManifestId(manifest);
    const signal = options.signal ?? new AbortController().signal;
    return this.exclusive(async () => {
      const db = await this.db;
      await this.clearStage();
      const previousRaw = await db.get("meta", "ready");
      const previous = previousRaw ? await this.record(previousRaw) : null;
      if (previous?.id === id) {
        try {
          await this.verified(previous);
          checkAbort(signal);
          return { id, reused: true };
        } catch (error) {
          if (
            !(error instanceof ModelCacheError) ||
            error.code !== "artifact-integrity"
          )
            throw error;
          // Repair the same immutable set through a fresh staging generation.
        }
      }
      const stage: Installation = {
        format: 1,
        generation: crypto.randomUUID(),
        id,
        manifest,
      };
      await db.put("meta", stage, "staging");
      let completedFiles = 0,
        verifiedBytes = 0;
      try {
        for (const file of manifest.files) {
          checkAbort(signal);
          const bytes = await boundedResponse(
            await load(structuredClone(file), signal),
            file,
            signal,
          );
          checkAbort(signal);
          await db.put("artifacts", bytes, [stage.generation, file.path]);
          completedFiles++;
          verifiedBytes += file.bytes;
          options.progress?.({
            completedFiles,
            totalFiles: manifest.files.length,
            verifiedBytes,
          });
        }
        await this.verified(stage);
        checkAbort(signal);
        await this.mutate([
          ...(previous?.manifest.files.map((file) => ({
            store: "artifacts" as const,
            kind: "delete" as const,
            key: [previous.generation, file.path],
          })) ?? []),
          { store: "meta", kind: "put", key: "ready", value: stage },
          { store: "meta", kind: "delete", key: "staging" },
        ]);
        return { id, reused: false };
      } catch (error) {
        await this.clearStage();
        checkAbort(signal);
        throw error;
      }
    }, signal);
  }
  async openReady(input: ModelManifest) {
    const id = await modelManifestId(input);
    return this.exclusive(async () => {
      const raw = await (await this.db).get("meta", "ready");
      if (!raw) return fail("model-not-ready");
      const ready = await this.record(raw);
      if (ready.id !== id) return fail("model-version-mismatch");
      await this.verified(ready);
      return {
        id,
        read: async (path: string) => {
          const file = ready.manifest.files.find(
            (asset) => asset.path === path,
          );
          if (!file) return fail("artifact-not-allowed");
          const db = await this.db;
          const tx = db.transaction(["meta", "artifacts"], "readonly");
          const current = tx.objectStore("meta").get("ready");
          const asset = tx
            .objectStore("artifacts")
            .get([ready.generation, path]);
          const [record, bytes] = await Promise.all([current, asset, tx.done]);
          if (record?.generation !== ready.generation)
            return fail("model-handle-stale");
          const result = await verify(file, bytes);
          if ((await db.get("meta", "ready"))?.generation !== ready.generation)
            return fail("model-handle-stale");
          return result;
        },
      };
    });
  }
  async remove() {
    return this.exclusive(() =>
      this.mutate([
        { store: "meta", kind: "clear" },
        { store: "artifacts", kind: "clear" },
      ]),
    );
  }
  async close() {
    (await this.db).close();
  }
}
