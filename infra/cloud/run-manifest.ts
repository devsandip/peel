import { createHash } from "node:crypto";
import {
  cloudExpectedInventory,
  type CloudInventoryInput,
} from "./expected-inventory.ts";

type Source = { commit: string; tree: string; lockSha256: string };
type Pin = {
  sha256: string;
  profile: string;
  accountId: string;
  region: "us-east-1";
  runId: string;
  source: Source;
  planSha256: string;
  templatesSha256: string;
  inventorySha256: string;
};
class ManifestFailure extends Error {
  constructor() {
    super("Reviewed Cloud run manifest unavailable");
    Object.freeze(this);
  }
}
const fail = (): never => {
  throw new ManifestFailure();
};
const hash = (data: string) => createHash("sha256").update(data).digest("hex");
function record(value: unknown, keys: string[]) {
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
function text(value: unknown, re: RegExp, max: number): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    re.exec(value)?.[0] !== value
  )
    return fail();
  return value;
}
const digest = (value: unknown) => text(value, /^[a-f0-9]{64}$/, 64);
const profile = (value: unknown) =>
  text(value, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, 64);
function source(value: unknown): Readonly<Source> {
  const r = record(value, ["commit", "tree", "lockSha256"]);
  return Object.freeze({
    commit: text(r.commit, /^[a-f0-9]{40}$/, 40),
    tree: text(r.tree, /^[a-f0-9]{40}$/, 40),
    lockSha256: digest(r.lockSha256),
  });
}
function bytes(value: unknown, max: number): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > max)
    return fail();
  return value;
}
function pin(value: unknown): Readonly<Pin> {
  const r = record(value, [
    "sha256",
    "profile",
    "accountId",
    "region",
    "runId",
    "source",
    "planSha256",
    "templatesSha256",
    "inventorySha256",
  ]);
  if (r.region !== "us-east-1") return fail();
  return Object.freeze({
    sha256: digest(r.sha256),
    profile: profile(r.profile),
    accountId: text(r.accountId, /^[0-9]{12}$/, 12),
    region: "us-east-1",
    runId: text(
      r.runId,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
      36,
    ),
    source: source(r.source),
    planSha256: digest(r.planSha256),
    templatesSha256: digest(r.templatesSha256),
    inventorySha256: digest(r.inventorySha256),
  });
}
function privateCall<T>(work: () => T): T {
  try {
    return work();
  } catch {
    return fail();
  }
}

/** Normalize an independently retained pin for private persistence; no provenance grant. */
export function normalizeCloudRunManifestPin(value: unknown) {
  return privateCall(() => pin(value));
}

/** Capture only; supplied source/plan metadata still requires independent provenance. */
export function createCloudRunManifest(input: {
  profile: string;
  source: Source;
  planSha256: string;
  inventory: CloudInventoryInput;
  templates: string;
}) {
  return privateCall(() => {
    const r = record(input, [
        "profile",
        "source",
        "planSha256",
        "inventory",
        "templates",
      ]),
      selectedProfile = profile(r.profile),
      originalSource = source(r.source),
      planSha256 = digest(r.planSha256),
      templates = bytes(r.templates, 128 * 1024),
      expected = cloudExpectedInventory(
        r.inventory as CloudInventoryInput,
        templates,
      ),
      inventoryJson = bytes(JSON.stringify(expected), 64 * 1024),
      json = bytes(
        JSON.stringify({
          format: 1,
          kind: "peel-cloud-run-manifest",
          profile: selectedProfile,
          source: originalSource,
          planSha256,
          inventoryJson,
          templates,
        }),
        512 * 1024,
      );
    return Object.freeze({
      json,
      pin: pin({
        sha256: hash(json),
        profile: selectedProfile,
        accountId: expected.accountId,
        region: expected.region,
        runId: expected.runId,
        source: originalSource,
        planSha256,
        templatesSha256: expected.templatesSha256,
        inventorySha256: expected.inventorySha256,
      }),
    });
  });
}

/** Integrity/retention only. Opaque recipe bytes are never physical ownership or action selectors. */
export function readCloudRunManifest(
  json: string,
  independentlyRetainedPin: Pin,
) {
  return privateCall(() => {
    const original = pin(independentlyRetainedPin),
      encoded = bytes(json, 512 * 1024);
    if (hash(encoded) !== original.sha256) return fail();
    const r = record(JSON.parse(encoded), [
      "format",
      "kind",
      "profile",
      "source",
      "planSha256",
      "inventoryJson",
      "templates",
    ]);
    if (r.format !== 1 || r.kind !== "peel-cloud-run-manifest") return fail();
    const selectedProfile = profile(r.profile),
      originalSource = source(r.source),
      planSha256 = digest(r.planSha256),
      inventoryJson = bytes(r.inventoryJson, 64 * 1024),
      templates = bytes(r.templates, 128 * 1024);
    if (
      selectedProfile !== original.profile ||
      JSON.stringify(originalSource) !== JSON.stringify(original.source) ||
      planSha256 !== original.planSha256 ||
      hash(templates) !== original.templatesSha256 ||
      JSON.stringify({
        format: 1,
        kind: "peel-cloud-run-manifest",
        profile: selectedProfile,
        source: originalSource,
        planSha256,
        inventoryJson,
        templates,
      }) !== encoded
    )
      return fail();
    // Validate only the retained snapshot header and content digest. Its resource
    // graph stays opaque until a separate historical interpreter/ownership gate.
    const snapshot = record(JSON.parse(inventoryJson), [
      "format",
      "kind",
      "accountId",
      "region",
      "runId",
      "lease",
      "artifact",
      "templatesSha256",
      "artifactObject",
      "functionRole",
      "stacks",
      "inventorySha256",
    ]);
    if (
      snapshot.format !== 1 ||
      snapshot.kind !== "expected" ||
      snapshot.accountId !== original.accountId ||
      snapshot.region !== original.region ||
      snapshot.runId !== original.runId ||
      snapshot.templatesSha256 !== original.templatesSha256 ||
      snapshot.inventorySha256 !== original.inventorySha256 ||
      JSON.stringify(snapshot) !== inventoryJson
    )
      return fail();
    const { inventorySha256, ...headerAndGraph } = snapshot;
    if (hash(JSON.stringify(headerAndGraph)) !== inventorySha256) return fail();
    return Object.freeze({
      format: 1 as const,
      profile: selectedProfile,
      source: originalSource,
      planSha256,
      inventoryJson,
      templates,
      inventorySha256: original.inventorySha256,
      manifestSha256: original.sha256,
      ownership: "unproven" as const,
      resourceWrites: 0 as const,
    });
  });
}
