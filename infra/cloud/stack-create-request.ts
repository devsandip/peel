import { createHash } from "node:crypto";
import { readHistoricalCloudInventory } from "./historical-inventory.ts";
import { readCloudRunManifest } from "./run-manifest.ts";
import { readCloudRunPlanContext } from "./run-plan-context.ts";
import { readCloudStackCreateIntent } from "./stack-create-intent.ts";

type Original = Parameters<typeof readCloudStackCreateIntent>[1]["original"];
type Intent = {
  json: string;
  pin: Parameters<typeof readCloudStackCreateIntent>[1]["pin"];
};
type Input = { original: Original; intent: Intent; cursorKey: string | null };
type Pin = { sha256: string; unsignedSha256: string };
const templateKeys = {
  artifacts: "artifact-bootstrap",
  guard: "cleanup-guard",
  sentinel: "cleanup-sentinel",
  data: "private-hosting",
} as const;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
class RequestFailure extends Error {
  constructor() {
    super("Original Cloud stack request unavailable");
    Object.freeze(this);
  }
}
function fail(): never {
  throw new RequestFailure();
}
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
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > max ||
    Buffer.from(value).toString("utf8") !== value
  )
    return fail();
  return value;
}
function digest(value: unknown) {
  const s = bytes(value, 64);
  if (!/^[a-f0-9]{64}$/.test(s) || s.length !== 64) return fail();
  return s;
}
function frozen<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  return value as Record<string, any>;
}
function same(a: unknown, b: unknown) {
  if (JSON.stringify(a) !== JSON.stringify(b)) return fail();
}
function normalizedPin(value: unknown) {
  const p = record(value, ["sha256", "unsignedSha256"]);
  return Object.freeze({
    sha256: digest(p.sha256),
    unsignedSha256: digest(p.unsignedSha256),
  });
}
function definition(originalValue: unknown, intentValue: unknown) {
  const i = record(intentValue, ["json", "pin"]),
    intent = readCloudStackCreateIntent(bytes(i.json, 4096), {
      original: originalValue as Original,
      pin: i.pin as Intent["pin"],
    }),
    original = record(originalValue, [
      "contextJson",
      "contextSha256",
      "manifest",
    ]),
    m = record(original.manifest, ["json", "pin"]),
    manifest = {
      json: bytes(m.json, 512 * 1024),
      pin: m.pin as Original["manifest"]["pin"],
    },
    context = readCloudRunPlanContext(
      bytes(original.contextJson, 32 * 1024),
      manifest,
    ),
    retained = readCloudRunManifest(manifest.json, manifest.pin),
    history = readHistoricalCloudInventory(manifest.json, manifest.pin),
    kind = intent.intent.stack.kind,
    bundle = object(JSON.parse(retained.templates)),
    template = object(bundle[templateKeys[kind]]),
    templateBody = bytes(JSON.stringify(template), 51200);
  if (
    !templateBody.length ||
    hash(templateBody) !== intent.intent.stack.templateSha256
  )
    return fail();
  const expected = history.inventory.stacks.find((s) => s.kind === kind);
  if (
    !expected ||
    expected.name !== intent.intent.stack.name ||
    Object.hasOwn(template, "Transform")
  )
    return fail();
  const resources = object(template.Resources);
  same(
    Object.keys(resources).sort(),
    expected.resources.map((r) => r.logicalId).sort(),
  );
  let tagValues: Record<string, string> | undefined;
  for (const stack of history.inventory.stacks)
    for (const r of stack.resources)
      if (r.ownership.tags) {
        const tags = record(r.ownership.tags.values, [
          "PeelProject",
          "PeelEnvironment",
          "PeelRun",
        ]);
        if (Object.values(tags).some((v) => typeof v !== "string"))
          return fail();
        if (tagValues) same(tags, tagValues);
        else tagValues = tags as Record<string, string>;
      }
  if (!tagValues) return fail();
  for (const r of expected.resources) {
    const raw = object(resources[r.logicalId]),
      p = object(raw.Properties);
    if (
      raw.Type !== r.type ||
      [raw.DeletionPolicy, raw.UpdateReplacePolicy].some(
        (v) => v !== undefined && v !== "Delete",
      )
    )
      return fail();
    if (r.identity.name)
      same(p[r.identity.name.property], r.identity.name.value);
    if (r.ownership.tags)
      same(
        p[r.ownership.tags.property],
        r.ownership.tags.property === "UserPoolTags"
          ? r.ownership.tags.values
          : Object.entries(r.ownership.tags.values).map(([Key, Value]) => ({
              Key,
              Value,
            })),
      );
    for (const parent of r.ownership.parents)
      same(p[parent.property], { Ref: parent.logicalId });
    same(
      raw.DependsOn === undefined
        ? []
        : typeof raw.DependsOn === "string"
          ? [raw.DependsOn]
          : raw.DependsOn,
      r.dependsOn,
    );
  }
  if (kind === "data") {
    same(object(resources.CloudFunction).Properties.Code, {
      S3Bucket: history.inventory.artifactObject.bucketName,
      S3Key: history.inventory.artifactObject.key,
    });
    const parameters = record(template.Parameters, ["CursorKey"]),
      key = record(parameters.CursorKey, [
        "Type",
        "NoEcho",
        "MinLength",
        "MaxLength",
        "AllowedPattern",
        "ConstraintDescription",
      ]);
    if (
      key.Type !== "String" ||
      key.NoEcho !== true ||
      key.MinLength !== 44 ||
      key.MaxLength !== 44 ||
      key.AllowedPattern !== "^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$"
    )
      return fail();
    bytes(key.ConstraintDescription, 1024);
    same(object(resources.CursorSecret).Properties.SecretString, {
      Ref: "CursorKey",
    });
  } else if (Object.hasOwn(template, "Parameters")) return fail();
  let secretRefs = 0;
  function scan(v: unknown, path: string[] = []) {
    if (typeof v === "string" && v.includes("${CursorKey")) return fail();
    if (!v || typeof v !== "object") return;
    if (Object.hasOwn(v, "Fn::Transform")) return fail();
    if (Object.hasOwn(v, "Ref") && (v as any).Ref === "CursorKey") {
      if (
        kind !== "data" ||
        path.join("/") !== "Resources/CursorSecret/Properties/SecretString"
      )
        return fail();
      secretRefs++;
    }
    for (const [key, value] of Object.entries(v)) scan(value, [...path, key]);
  }
  scan(template);
  if (secretRefs !== (kind === "data" ? 1 : 0)) return fail();
  const binding = frozen({
    service: "cloudformation",
    operation: "CreateStack",
    apiVersion: "2010-05-15",
    method: "POST",
    destination: "https://cloudformation.us-east-1.amazonaws.com/",
    identity: context.plan.identity,
    lease: context.plan.lease,
    stopTestsAt: context.plan.stopTestsAt,
    cleanupBy: context.plan.cleanupBy,
    createBy:
      kind === "guard" || kind === "sentinel"
        ? new Date(
            Date.parse(context.plan.lease.startedAt) + 10 * 60000,
          ).toISOString()
        : context.plan.stopTestsAt,
  });
  const input = {
    Capabilities:
      kind === "guard" || kind === "data" ? ["CAPABILITY_NAMED_IAM"] : null,
    ClientRequestToken: intent.intent.clientRequestToken,
    DeploymentConfig: { DisableRollback: null, Mode: "STANDARD" },
    DisableRollback: null,
    EnableTerminationProtection: false,
    NotificationARNs: null,
    OnFailure: "ROLLBACK",
    Parameters:
      kind === "data"
        ? [
            {
              ParameterKey: "CursorKey",
              ParameterValue: {
                source: "ephemeral-noecho",
                bytes: 32,
                encoding: "base64",
              },
              UsePreviousValue: null,
              ResolvedValue: null,
            },
          ]
        : null,
    ResourceTypes: null,
    RetainExceptOnCreate: false,
    RoleARN: null,
    RollbackConfiguration: null,
    StackName: intent.intent.stack.name,
    StackPolicyBody: null,
    StackPolicyURL: null,
    Tags: Object.entries(tagValues).map(([Key, Value]) => ({ Key, Value })),
    TemplateBody: {
      sha256: hash(templateBody),
      utf8Bytes: Buffer.byteLength(templateBody),
    },
    TemplateURL: null,
    TimeoutInMinutes: 5,
  };
  const base = frozen({
    format: 1 as const,
    kind: "synkies-cloud-stack-create-request" as const,
    policyVersion: 1 as const,
    contextSha256: context.contextSha256,
    manifestSha256: context.manifestSha256,
    planSha256: context.planSha256,
    inventorySha256: context.inventorySha256,
    intentSha256: intent.pin.sha256,
    stackKind: kind,
    binding,
    input,
  });
  return { base, templateBody, kind };
}
type Definition = ReturnType<typeof definition>;
function frame(d: Definition, key: string | null) {
  const input: Record<string, unknown> = {
    ...structuredClone(d.base.input),
    TemplateBody: d.templateBody,
  };
  if (d.kind === "data") {
    const value = bytes(key, 44);
    if (
      value.length !== 44 ||
      Buffer.from(value, "base64").length !== 32 ||
      Buffer.from(value, "base64").toString("base64") !== value ||
      d.templateBody.includes(value)
    )
      return fail();
    input.Parameters = [
      {
        ParameterKey: "CursorKey",
        ParameterValue: value,
        UsePreviousValue: null,
        ResolvedValue: null,
      },
    ];
  } else if (key !== null) return fail();
  return frozen({
    format: 1,
    kind: "synkies-cloud-stack-create-unsigned",
    policyVersion: 1,
    contextSha256: d.base.contextSha256,
    manifestSha256: d.base.manifestSha256,
    planSha256: d.base.planSha256,
    inventorySha256: d.base.inventorySha256,
    intentSha256: d.base.intentSha256,
    stackKind: d.kind,
    binding: d.base.binding,
    input,
  });
}
function material(value: unknown): any {
  if (Array.isArray(value)) return value.map(material);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, material(v)]),
    );
  return value;
}
function snapshot(d: Definition, unsignedSha256: string) {
  const projection = frozen({
      ...d.base,
      unsignedSha256: digest(unsignedSha256),
    }),
    json = bytes(JSON.stringify(projection), 16 * 1024);
  return frozen({
    json,
    pin: Object.freeze({
      sha256: hash(json),
      unsignedSha256: projection.unsignedSha256,
    }),
    projection,
    ownership: "unproven" as const,
    runAuthority: "unproven" as const,
    resourceWrites: 0 as const,
  });
}
const active = new WeakMap<object, Record<string, unknown>>();

/** Pure original request binding. Secret-bearing material is process-local and never enumerable here. */
export function createCloudStackCreateRequest(value: Input) {
  return privateCall(() => {
    const r = record(value, ["original", "intent", "cursorKey"]),
      d = definition(r.original, r.intent),
      unsigned = frame(d, r.cursorKey as Input["cursorKey"]),
      encoded = bytes(JSON.stringify(unsigned), 128 * 1024),
      result = snapshot(d, hash(encoded));
    active.set(result, frozen(material(unsigned.input)));
    return result;
  });
}
/** Integrity/original projection only. Never restores material, current approval or a create capability. */
export function readCloudStackCreateRequestProjection(
  json: string,
  expected: { original: Original; intent: Intent; pin: Pin },
) {
  return privateCall(() => {
    const r = record(expected, ["original", "intent", "pin"]),
      pin = normalizedPin(r.pin),
      encoded = bytes(json, 16 * 1024),
      d = definition(r.original, r.intent),
      result = snapshot(d, pin.unsignedSha256);
    if (hash(encoded) !== pin.sha256 || result.json !== encoded) return fail();
    if (
      d.kind !== "data" &&
      hash(bytes(JSON.stringify(frame(d, null)), 128 * 1024)) !==
        pin.unsignedSha256
    )
      return fail();
    return result;
  });
}
/** Sensitive input for a trusted future wire adapter only. Never log, persist or treat it as permission. */
export function cloudStackCreateRequestInput(
  handle: unknown,
): Record<string, unknown> {
  return privateCall(() => {
    const input = active.get(handle as object);
    if (!input) return fail();
    return frozen(structuredClone(input));
  });
}
/** Drop the internal reference. Caller copies and physical memory erasure are not controlled here. */
export function discardCloudStackCreateRequest(handle: unknown) {
  active.delete(handle as object);
}
