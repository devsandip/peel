import { immutableRecordStorage } from "./immutable-record-storage.ts";
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
const storage = immutableRecordStorage<
  Pin,
  ReturnType<typeof readCloudRunManifest>
>({
  recordName: "manifest.json",
  recordMaxBytes: 512 * 1024,
  marker: (pin, identities) =>
    JSON.stringify({
      format: 1,
      kind: "peel-cloud-run-manifest-store",
      pin,
      directory: identities.directory,
      manifest: identities.record,
      marker: identities.marker,
    }) + "\n",
  read: readCloudRunManifest,
  fail,
});

/** Private immutable recipe storage only; no ledger, AWS, creation ID or cleanup authority. */
export class CloudRunManifestStore {
  readonly directory: string;
  private readonly pin: Pin;
  private constructor(directory: string, value: unknown) {
    this.pin = expectedPin(value);
    this.directory = storage.path(directory);
    Object.freeze(this);
  }
  static create(
    directory: string,
    value: Captured,
    hooks: { beforeCommit?: () => void; afterCommit?: () => void } = {},
  ) {
    return privateCall(() => {
      const input = captured(value),
        store = new CloudRunManifestStore(directory, input.pin);
      storage.publish(store.directory, input, hooks, () => store.read());
      return store;
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
    const { json, value } = storage.inspect(
      this.directory,
      this.pin,
      synchronize,
    );
    return Object.freeze({ json, pin: this.pin, recipe: value });
  }
}
