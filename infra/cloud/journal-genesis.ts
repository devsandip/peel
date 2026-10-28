import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { normalizeCloudLedgerAuthority } from "./ledger-store.ts";
import { normalizeCloudRunManifestPin } from "./run-manifest.ts";
import { readCloudRunPlanContext } from "./run-plan-context.ts";

type AnchorInput = {
  workspaceDirectory: string;
  ledgerDirectory: string;
  authority: unknown;
  reservation: {
    slot: 1 | 2;
    runId: string;
    planSha256: string;
    reservedAt: string;
  };
};
type Input = {
  anchor: AnchorInput;
  manifest: {
    directory: string;
    json: string;
    pin: ReturnType<typeof normalizeCloudRunManifestPin>;
  };
  context: { directory: string; json: string; sha256: string };
};
const envelopeLimit = 1536 * 1024,
  metadataLimit = 24 * 1024;
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
class GenesisFailure extends Error {
  constructor() {
    super("Original Cloud journal genesis unavailable");
    Object.freeze(this);
  }
}
const fail = (): never => {
  throw new GenesisFailure();
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
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > max ||
    Buffer.from(value).toString("utf8") !== value
  )
    return fail();
  return value;
}
function text(value: unknown, regex: RegExp, max: number) {
  const s = bytes(value, max);
  if (regex.exec(s)?.[0] !== s) return fail();
  return s;
}
const digest = (value: unknown) => text(value, /^[a-f0-9]{64}$/, 64);
function timestamp(value: unknown) {
  const s = text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 24);
  if (!Number.isSafeInteger(Date.parse(s)) || new Date(s).toISOString() !== s)
    return fail();
  return s;
}
function directory(value: unknown) {
  const s = bytes(value, 4096);
  if (
    /[\x00-\x1f\x7f]/.test(s) ||
    !isAbsolute(s) ||
    resolve(s) !== s ||
    dirname(s) === s
  )
    return fail();
  return s;
}
function frozen<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}
function inside(a: string, b: string) {
  const r = relative(a, b);
  return (
    r === "" || (r !== ".." && !r.startsWith(".." + sep) && !isAbsolute(r))
  );
}
function separate(paths: readonly string[]) {
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      if (inside(paths[i], paths[j]) || inside(paths[j], paths[i]))
        return fail();
    }
}
function journalDirectory(a: {
  workspaceDirectory: string;
  reservation: { runId: string };
}) {
  return directory(
    join(a.workspaceDirectory, "journal-" + a.reservation.runId),
  );
}
function anchor(value: unknown) {
  const a = record(value, [
      "workspaceDirectory",
      "ledgerDirectory",
      "authority",
      "reservation",
    ]),
    r = record(a.reservation, ["slot", "runId", "planSha256", "reservedAt"]);
  if (r.slot !== 1 && r.slot !== 2) return fail();
  const result = {
    workspaceDirectory: directory(a.workspaceDirectory),
    ledgerDirectory: directory(a.ledgerDirectory),
    authority: normalizeCloudLedgerAuthority(a.authority),
    reservation: {
      slot: r.slot as 1 | 2,
      runId: text(
        r.runId,
        /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
        36,
      ),
      planSha256: digest(r.planSha256),
      reservedAt: timestamp(r.reservedAt),
    },
  };
  separate([result.ledgerDirectory, journalDirectory(result)]);
  return frozen(result);
}
function location(a: ReturnType<typeof anchor>) {
  return Object.freeze({
    directory: journalDirectory(a),
    scopeSha256: hash(
      JSON.stringify({
        format: 1,
        kind: "synkies-cloud-journal-scope",
        anchor: a,
      }),
    ),
  });
}
/** Supplied data only; a later trusted adapter must observe this exact actual reservation. */
export function normalizeCloudJournalAnchor(value: unknown) {
  return privateCall(() => anchor(value));
}
/** Pure deterministic selection, not filesystem canonicalization, discovery or permission. */
export function cloudJournalLocation(value: unknown) {
  return privateCall(() => location(anchor(value)));
}
function genesis(value: unknown) {
  const r = record(value, ["anchor", "manifest", "context"]),
    a = anchor(r.anchor),
    m = record(r.manifest, ["directory", "json", "pin"]),
    c = record(r.context, ["directory", "json", "sha256"]),
    manifest = {
      directory: directory(m.directory),
      json: bytes(m.json, 512 * 1024),
      pin: normalizeCloudRunManifestPin(m.pin),
    },
    context = {
      directory: directory(c.directory),
      json: bytes(c.json, 32 * 1024),
      sha256: digest(c.sha256),
    };
  separate([
    a.ledgerDirectory,
    manifest.directory,
    context.directory,
    journalDirectory(a),
  ]);
  if (hash(context.json) !== context.sha256) return fail();
  const retained = readCloudRunPlanContext(context.json, {
      json: manifest.json,
      pin: manifest.pin,
    }),
    plan = retained.plan,
    reservation = a.reservation,
    reserved = Date.parse(reservation.reservedAt);
  if (
    retained.contextSha256 !== context.sha256 ||
    plan.runId !== reservation.runId ||
    retained.planSha256 !== reservation.planSha256 ||
    JSON.stringify(plan.identity) !== JSON.stringify(a.authority.identity) ||
    Date.parse(a.authority.authorizedUntil) < Date.parse(plan.cleanupBy) ||
    plan.reservedEnvelopeUSD !== reservation.slot * 2 + 1 ||
    reserved < Date.parse(plan.lease.startedAt) ||
    reserved - Date.parse(plan.lease.startedAt) > 30000 ||
    reserved < Date.parse(plan.createdAt) ||
    reserved - Date.parse(plan.createdAt) > 15 * 60000
  )
    return fail();
  const selected = location(a);
  bytes(
    JSON.stringify({
      anchor: a,
      journalDirectory: selected.directory,
      manifest: { directory: manifest.directory, pin: manifest.pin },
      context: { directory: context.directory, sha256: context.sha256 },
    }),
    metadataLimit,
  );
  return frozen({
    format: 1 as const,
    kind: "synkies-cloud-journal-genesis" as const,
    catalogVersion: 1 as const,
    revision: 0 as const,
    anchor: a,
    journalDirectory: selected.directory,
    manifest,
    context,
  });
}
function snapshot(value: ReturnType<typeof genesis>) {
  const json = bytes(JSON.stringify(value), envelopeLimit);
  return frozen({
    json,
    sha256: hash(json),
    scopeSha256: location(value.anchor).scopeSha256,
    journalDirectory: value.journalDirectory,
    genesis: value,
    ownership: "unproven" as const,
    runAuthority: "unproven" as const,
    resourceWrites: 0 as const,
  });
}
/** Pure original snapshot only; no actual source/ledger observation, durability or execution grant. */
export function createCloudJournalGenesis(input: Input) {
  return privateCall(() => snapshot(genesis(input)));
}
/** Expected anchor is independent; unknown-file checksums alone never authenticate a journal. */
export function readCloudJournalGenesis(
  json: string,
  expectedAnchor: AnchorInput,
) {
  return privateCall(() => {
    const a = anchor(expectedAnchor),
      encoded = bytes(json, envelopeLimit),
      r = record(JSON.parse(encoded), [
        "format",
        "kind",
        "catalogVersion",
        "revision",
        "anchor",
        "journalDirectory",
        "manifest",
        "context",
      ]);
    if (
      r.format !== 1 ||
      r.kind !== "synkies-cloud-journal-genesis" ||
      r.catalogVersion !== 1 ||
      r.revision !== 0 ||
      JSON.stringify(r.anchor) !== JSON.stringify(a)
    )
      return fail();
    const result = snapshot(
      genesis({ anchor: a, manifest: r.manifest, context: r.context }),
    );
    if (result.json !== encoded) return fail();
    return result;
  });
}
