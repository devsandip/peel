import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { immutableRecordStorage } from "./immutable-record-storage.ts";
import { normalizeCloudLedgerAuthority } from "./ledger-store.ts";
import { CloudRunManifestStore } from "./manifest-storage.ts";
import { normalizeCloudRunManifestPin } from "./run-manifest.ts";
import { readCloudRunPlanContext } from "./run-plan-context.ts";
import { inspectCloudRunReservationBinding } from "./run-reservation-binding.ts";

type Expected = {
  contextSha256: string;
  manifest: {
    directory: string;
    pin: ReturnType<typeof normalizeCloudRunManifestPin>;
  };
  ledger: {
    directory: string;
    authority: unknown;
  };
};
type Code = "invalid-input" | "unrecognized" | "exists" | "unavailable";
export class CloudContextStorageError extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Private Cloud context storage unavailable");
    this.code = code;
    Object.freeze(this);
  }
}
const fail = (code: Code): never => {
  throw new CloudContextStorageError(code);
};
function privateCall<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof CloudContextStorageError) throw error;
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
function pathString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    dirname(value) === value
  )
    return fail("invalid-input");
  return value;
}
function captured(value: unknown): Expected {
  try {
    const r = record(value, ["contextSha256", "manifest", "ledger"]),
      manifest = record(r.manifest, ["directory", "pin"]),
      ledger = record(r.ledger, ["directory", "authority"]);
    if (
      typeof r.contextSha256 !== "string" ||
      r.contextSha256.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(r.contextSha256)
    )
      return fail("invalid-input");
    const result = Object.freeze({
      contextSha256: r.contextSha256,
      manifest: Object.freeze({
        directory: pathString(manifest.directory),
        pin: normalizeCloudRunManifestPin(manifest.pin),
      }),
      ledger: Object.freeze({
        directory: pathString(ledger.directory),
        authority: normalizeCloudLedgerAuthority(ledger.authority),
      }),
    });
    // Leave bounded room for the fixed marker schema and inode identities.
    if (Buffer.byteLength(JSON.stringify(result)) > 12 * 1024)
      return fail("invalid-input");
    return result;
  } catch {
    return fail("invalid-input");
  }
}
function checkedJson(value: unknown, pin: Expected): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > 32 * 1024 ||
    createHash("sha256").update(value).digest("hex") !== pin.contextSha256
  )
    return fail("invalid-input");
  return value;
}
function bound(json: string, expected: Expected) {
  try {
    checkedJson(json, expected);
    const manifest = CloudRunManifestStore.inspect(
        expected.manifest.directory,
        expected.manifest.pin,
      ),
      original = { json: manifest.json, pin: manifest.pin },
      context = readCloudRunPlanContext(json, original),
      binding = inspectCloudRunReservationBinding({
        contextJson: json,
        manifest: original,
        ledger: expected.ledger,
      });
    return Object.freeze({ context, binding });
  } catch {
    return fail("unrecognized");
  }
}
const storage = immutableRecordStorage<Expected, ReturnType<typeof bound>>({
  recordName: "context.json",
  recordMaxBytes: 32 * 1024,
  marker: (expected, identities) =>
    JSON.stringify({
      format: 1,
      kind: "peel-cloud-run-context-store",
      expected,
      directory: identities.directory,
      context: identities.record,
      marker: identities.marker,
    }) + "\n",
  read: bound,
  fail,
});

/** Immutable local context acknowledgement only; never an execution or spending grant. */
export class CloudRunContextStore {
  readonly directory: string;
  private readonly expected: Expected;
  private constructor(directory: string, input: Expected) {
    // All caller-controlled strings and nested pins are copied before the first path resolution.
    const pin = captured(input),
      target = pathString(directory);
    this.expected = captured({
      contextSha256: pin.contextSha256,
      manifest: Object.freeze({
        ...pin.manifest,
        directory: storage.path(pin.manifest.directory),
      }),
      ledger: Object.freeze({
        ...pin.ledger,
        directory: storage.path(pin.ledger.directory),
      }),
    });
    this.directory = storage.path(target);
    Object.freeze(this);
  }
  static create(
    directory: string,
    value: { json: string; expected: Expected },
    hooks: { beforeCommit?: () => void; afterCommit?: () => void } = {},
  ) {
    return privateCall(() => {
      const r = record(value, ["json", "expected"]),
        pin = captured(r.expected),
        json = checkedJson(r.json, pin),
        store = new CloudRunContextStore(directory, pin);
      // Inspect existing sources before publication. Neither source is initialized or given a fresh store-sync acknowledgement here.
      bound(json, store.expected);
      storage.publish(
        store.directory,
        { json, pin: store.expected },
        hooks,
        () => store.read(),
      );
      return store;
    });
  }
  /** Re-sync the context descriptors only; source checks are not an atomic execution permit. */
  static open(directory: string, expected: Expected) {
    return privateCall(() => {
      const store = new CloudRunContextStore(directory, expected);
      store.inspect(true);
      return store;
    });
  }
  /** No new context/manifest synchronization claim; the ledger's SQLite recovery contract is unchanged. */
  static inspect(directory: string, expected: Expected) {
    return privateCall(() =>
      new CloudRunContextStore(directory, expected).read(),
    );
  }
  read() {
    return privateCall(() => this.inspect(false));
  }
  private inspect(synchronize: boolean) {
    const { json, value } = storage.inspect(
      this.directory,
      this.expected,
      synchronize,
    );
    return Object.freeze({
      json,
      context: value.context,
      binding: value.binding,
    });
  }
}
