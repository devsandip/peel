import { createHash } from "node:crypto";
import {
  normalizeCloudRunManifestPin,
  readCloudRunManifest,
} from "./run-manifest.ts";
import { readCloudRunPlanContext } from "./run-plan-context.ts";

type StackKind = "artifacts" | "guard" | "sentinel" | "data";
type Original = {
  contextJson: string;
  contextSha256: string;
  manifest: {
    json: string;
    pin: ReturnType<typeof normalizeCloudRunManifestPin>;
  };
};
type Pin = {
  sha256: string;
  contextSha256: string;
  manifestSha256: string;
  planSha256: string;
  inventorySha256: string;
  stackKind: StackKind;
};
const templateKeys = Object.freeze({
  artifacts: "artifact-bootstrap",
  guard: "cleanup-guard",
  sentinel: "cleanup-sentinel",
  data: "private-hosting",
});
const limit = 4 * 1024;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
class IntentFailure extends Error {
  constructor() {
    super("Original Cloud stack creation intent unavailable");
    Object.freeze(this);
  }
}
const fail = (): never => {
  throw new IntentFailure();
};
function privateCall<T>(work: () => T): T {
  try {
    return work();
  } catch {
    return fail();
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
    return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  return Object.fromEntries(
    keys.map((key) => {
      if (!d[key]?.enumerable || !("value" in d[key])) return fail();
      return [key, d[key].value];
    }),
  );
}
function bytes(value: unknown, max: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > max)
    return fail();
  return value;
}
function digest(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(value)
  )
    return fail();
  return value;
}
function stackKind(value: unknown): StackKind {
  if (typeof value !== "string" || !Object.hasOwn(templateKeys, value))
    return fail();
  return value as StackKind;
}
function pin(value: unknown): Pin {
  const r = record(value, [
    "sha256",
    "contextSha256",
    "manifestSha256",
    "planSha256",
    "inventorySha256",
    "stackKind",
  ]);
  return Object.freeze({
    sha256: digest(r.sha256),
    contextSha256: digest(r.contextSha256),
    manifestSha256: digest(r.manifestSha256),
    planSha256: digest(r.planSha256),
    inventorySha256: digest(r.inventorySha256),
    stackKind: stackKind(r.stackKind),
  });
}
function original(value: unknown) {
  const r = record(value, ["contextJson", "contextSha256", "manifest"]),
    m = record(r.manifest, ["json", "pin"]),
    contextJson = bytes(r.contextJson, 32 * 1024);
  if (hash(contextJson) !== digest(r.contextSha256)) return fail();
  const manifest = {
      json: bytes(m.json, 512 * 1024),
      pin: normalizeCloudRunManifestPin(m.pin),
    },
    context = readCloudRunPlanContext(contextJson, manifest),
    retained = readCloudRunManifest(manifest.json, manifest.pin),
    bundle = record(JSON.parse(retained.templates), [
      "data-identity",
      "artifact-bootstrap",
      "cleanup-guard",
      "cleanup-sentinel",
      "private-hosting",
    ]);
  if (
    JSON.stringify(bundle) !== retained.templates ||
    Object.values(bundle).some(
      (v) => !v || typeof v !== "object" || Array.isArray(v),
    )
  )
    return fail();
  return { context, bundle };
}
function token(value: unknown, runId: string, kind: StackKind): string {
  if (typeof value !== "string" || value.length > 128) return fail();
  const prefix = `peel-${runId}-${kind}-`,
    nonce = value.slice(prefix.length);
  if (
    !value.startsWith(prefix) ||
    nonce.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      nonce,
    ) ||
    !/^[a-zA-Z0-9][-a-zA-Z0-9]*$/.test(value)
  )
    return fail();
  return value;
}
function identity(
  retained: ReturnType<typeof original>,
  kind: StackKind,
  clientRequestToken: unknown,
) {
  const { context, bundle } = retained;
  return Object.freeze({
    format: 1 as const,
    kind: "peel-cloud-stack-create-intent" as const,
    contextSha256: context.contextSha256,
    manifestSha256: context.manifestSha256,
    planSha256: context.planSha256,
    inventorySha256: context.inventorySha256,
    identity: context.plan.identity,
    runId: context.plan.runId,
    stack: Object.freeze({
      kind,
      name: context.plan.stacks[kind],
      templateSha256: hash(JSON.stringify(bundle[templateKeys[kind]])),
    }),
    clientRequestToken: token(clientRequestToken, context.plan.runId, kind),
  });
}
function snapshot(json: string, intent: ReturnType<typeof identity>) {
  return Object.freeze({
    json,
    pin: pin({
      sha256: hash(json),
      contextSha256: intent.contextSha256,
      manifestSha256: intent.manifestSha256,
      planSha256: intent.planSha256,
      inventorySha256: intent.inventorySha256,
      stackKind: intent.stack.kind,
    }),
    intent,
    ownership: "unproven" as const,
    runAuthority: "unproven" as const,
    resourceWrites: 0 as const,
  });
}
/** Pure expected identity only. No token generation, durability, complete request or execution authority. */
export function createCloudStackCreateIntent(input: {
  original: Original;
  stackKind: StackKind;
  clientRequestToken: string;
}) {
  return privateCall(() => {
    const r = record(input, ["original", "stackKind", "clientRequestToken"]),
      retained = original(r.original),
      intent = identity(retained, stackKind(r.stackKind), r.clientRequestToken),
      json = bytes(JSON.stringify(intent), limit);
    return snapshot(json, intent);
  });
}
/** Capture independent integrity expectations only; never provider provenance or a grant. */
export function normalizeCloudStackCreateIntentPin(value: unknown) {
  return privateCall(() => pin(value));
}
/** Recover exact original stack/token identity without current policy, filesystem or provider access. */
export function readCloudStackCreateIntent(
  json: string,
  expected: { original: Original; pin: Pin },
) {
  return privateCall(() => {
    const selected = record(expected, ["original", "pin"]),
      pinned = pin(selected.pin),
      encoded = bytes(json, limit);
    if (hash(encoded) !== pinned.sha256) return fail();
    const r = record(JSON.parse(encoded), [
        "format",
        "kind",
        "contextSha256",
        "manifestSha256",
        "planSha256",
        "inventorySha256",
        "identity",
        "runId",
        "stack",
        "clientRequestToken",
      ]),
      stack = record(r.stack, ["kind", "name", "templateSha256"]),
      retained = original(selected.original),
      intent = identity(retained, stackKind(stack.kind), r.clientRequestToken),
      result = snapshot(encoded, intent);
    record(r.identity, ["profile", "accountId", "region"]);
    if (
      JSON.stringify(intent) !== encoded ||
      JSON.stringify(result.pin) !== JSON.stringify(pinned)
    )
      return fail();
    return result;
  });
}
