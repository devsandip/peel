import { createHash } from "node:crypto";
import { readCloudStackCreateRequestProjection } from "./stack-create-request.ts";

type Request = {
  json: string;
  expected: Parameters<typeof readCloudStackCreateRequestProjection>[1];
};
type Input = { request: Request; observedAt: string; response: unknown };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
class ObservationFailure extends Error {
  constructor() {
    super("Original Cloud stack response observation unavailable");
    Object.freeze(this);
  }
}
function fail(): never {
  throw new ObservationFailure();
}
function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length > required.length + optional.length
  )
    return fail();
  const descriptors = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(value);
  if (
    required.some((k) => !Object.hasOwn(descriptors, k)) ||
    keys.some(
      (k) => typeof k !== "string" || ![...required, ...optional].includes(k),
    )
  )
    return fail();
  return Object.fromEntries(
    keys.map((k) => {
      const d = descriptors[k as string];
      if (!d?.enumerable || !("value" in d)) return fail();
      return [k, d.value];
    }),
  ) as Record<string, unknown>;
}
function bytes(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    Buffer.byteLength(value) > max ||
    Buffer.from(value).toString("utf8") !== value
  )
    return fail();
  return value;
}
function digest(value: unknown) {
  const s = bytes(value, 64);
  if (s.length !== 64 || !/^[a-f0-9]{64}$/.test(s)) return fail();
  return s;
}
function identifier(value: unknown) {
  const s = bytes(value, 128);
  if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.exec(s)?.[0] !== s) return fail();
  return s;
}
function timestamp(value: unknown) {
  const s = bytes(value, 24);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) ||
    !Number.isSafeInteger(Date.parse(s)) ||
    new Date(s).toISOString() !== s
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
function original(value: unknown) {
  const r = record(value, ["json", "expected"]);
  return readCloudStackCreateRequestProjection(
    bytes(r.json, 16 * 1024),
    r.expected as Request["expected"],
  );
}
type Original = ReturnType<typeof original>;
function observation(
  request: Original,
  value: {
    observedAt: unknown;
    stackId: unknown;
    operationId: unknown;
    requestId: unknown;
  },
) {
  const p = request.projection,
    observedAt = timestamp(value.observedAt),
    stackId = bytes(value.stackId, 256),
    prefix = `arn:aws:cloudformation:${p.binding.identity.region}:${p.binding.identity.accountId}:stack/${p.input.StackName}/`,
    uuid = stackId.slice(prefix.length);
  if (
    !stackId.startsWith(prefix) ||
    uuid.length !== 36 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      uuid,
    ) ||
    Date.parse(observedAt) < Date.parse(p.binding.lease.startedAt)
  )
    return fail();
  return frozen({
    format: 1 as const,
    kind: "synkies-cloud-stack-create-response" as const,
    runId: p.input.Tags.find((tag) => tag.Key === "PeelRun")!.Value,
    stackKind: p.stackKind,
    requestSha256: request.pin.sha256,
    unsignedSha256: request.pin.unsignedSha256,
    observedAt,
    stackId,
    operationId:
      value.operationId === null ? null : identifier(value.operationId),
    requestId: identifier(value.requestId),
    httpStatusCode: 200 as const,
    attempts: 1 as const,
    totalRetryDelay: 0 as const,
    providerObservation: "unproven" as const,
    ownership: "unproven" as const,
    operationSettlement: "unproven" as const,
    runAuthority: "unproven" as const,
    resourceWrites: 0 as const,
  });
}
function snapshot(value: ReturnType<typeof observation>) {
  const json = bytes(JSON.stringify(value), 2048);
  return frozen({ json, sha256: hash(json), observation: value });
}
/** Supplied response integrity only. Never an acknowledged send, actual provider result or ownership/settlement proof. */
export function createCloudStackCreateResponseObservation(value: Input) {
  try {
    const r = record(value, ["request", "observedAt", "response"]),
      request = original(r.request),
      response = record(r.response, ["StackId", "$metadata"], ["OperationId"]),
      meta = record(
        response.$metadata,
        ["httpStatusCode", "requestId", "attempts", "totalRetryDelay"],
        ["extendedRequestId", "cfId"],
      );
    if (
      meta.httpStatusCode !== 200 ||
      meta.attempts !== 1 ||
      meta.totalRetryDelay !== 0 ||
      meta.extendedRequestId !== undefined ||
      meta.cfId !== undefined ||
      response.OperationId === null
    )
      return fail();
    return snapshot(
      observation(request, {
        observedAt: r.observedAt,
        stackId: response.StackId,
        operationId:
          response.OperationId === undefined ? null : response.OperationId,
        requestId: meta.requestId,
      }),
    );
  } catch {
    return fail();
  }
}
/** Canonical historical integrity under independent original pins; never restores any execution capability. */
export function readCloudStackCreateResponseObservation(
  json: string,
  expected: { request: Request; sha256: string },
) {
  try {
    const e = record(expected, ["request", "sha256"]),
      encoded = bytes(json, 2048);
    if (hash(encoded) !== digest(e.sha256)) return fail();
    const request = original(e.request),
      raw = record(JSON.parse(encoded), [
        "format",
        "kind",
        "runId",
        "stackKind",
        "requestSha256",
        "unsignedSha256",
        "observedAt",
        "stackId",
        "operationId",
        "requestId",
        "httpStatusCode",
        "attempts",
        "totalRetryDelay",
        "providerObservation",
        "ownership",
        "operationSettlement",
        "runAuthority",
        "resourceWrites",
      ]),
      result = snapshot(
        observation(request, {
          observedAt: raw.observedAt,
          stackId: raw.stackId,
          operationId: raw.operationId,
          requestId: raw.requestId,
        }),
      );
    if (encoded !== result.json) return fail();
    return result;
  } catch {
    return fail();
  }
}
