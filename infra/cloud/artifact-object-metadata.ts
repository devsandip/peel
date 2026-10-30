import {
  S3Client,
  ListObjectVersionsCommand,
  type ListObjectVersionsCommandOutput,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { fromSSO } from "@aws-sdk/credential-provider-sso";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { readHistoricalCloudInventory } from "./historical-inventory.ts";
import { collectCloudInspectionIdentity } from "./inspection-identity.ts";
import { assertCloudIdentityEnvironment } from "./identity-observations.ts";

type RetainedInput = {
  json: string;
  pin: Parameters<typeof readHistoricalCloudInventory>[1];
};
type Scope = {
  profile: string;
  accountId: string;
  region: "us-east-1";
  bucket: string;
  key: string;
  bytes: number;
  inventorySha256: string;
  retainedManifestSha256: string;
};
type Dependencies = {
  identity?: typeof collectCloudInspectionIdentity;
  transport?: Transport;
  credentials?: S3ClientConfig["credentials"];
  clock?: () => number;
  signal?: AbortSignal;
};
type Transport = Pick<NodeHttpHandler, "handle" | "destroy">;
type Code =
  | "invalid-input"
  | "unsupported-environment"
  | "identity-not-ready"
  | "identity-mismatch"
  | "transport-scope"
  | "metadata-unavailable"
  | "clock-invalid"
  | "aborted"
  | "deadline";
type Review =
  | "delete-marker"
  | "other-key"
  | "non-null-version"
  | "not-latest"
  | "size-mismatch"
  | "multiple-entries";
class ObjectFailure extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud artifact-object metadata unavailable");
    this.code = code;
    Object.freeze(this);
  }
}
const fail = (code: Code): never => {
  throw new ObjectFailure(code);
};
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const MAX_KEYS = 2;
function record(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail("invalid-input");
  const d = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length)
    return fail("invalid-input");
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (!d[key]?.enumerable || !("value" in d[key]))
      return fail("invalid-input");
    result[key] = d[key].value;
  }
  return result;
}
function text(
  value: unknown,
  pattern: RegExp,
  max: number,
  code: Code,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    pattern.exec(value)?.[0] !== value
  )
    return fail(code);
  return value;
}
/** Original retained bucket/key/bytes only; never regenerated from current factories. */
function captureRetained(input: RetainedInput): Scope {
  const data = record(input, ["json", "pin"]);
  try {
    const retained = readHistoricalCloudInventory(
        data.json as string,
        data.pin as RetainedInput["pin"],
      ),
      inventory = retained.inventory,
      object = inventory.artifactObject,
      bucket = inventory.stacks
        .find((s) => s.kind === "artifacts")
        ?.resources.find((r) => r.logicalId === "ArtifactBucket");
    if (
      bucket?.type !== "AWS::S3::Bucket" ||
      bucket.identity.name?.property !== "BucketName" ||
      bucket.identity.name.value !== object.bucketName ||
      inventory.region !== "us-east-1" ||
      !Number.isSafeInteger(object.bytes) ||
      object.bytes <= 0
    )
      return fail("invalid-input");
    return {
      profile: retained.profile,
      accountId: inventory.accountId,
      region: "us-east-1",
      bucket: text(
        object.bucketName,
        /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/,
        63,
        "invalid-input",
      ),
      key: text(
        object.key,
        /^cloud-lambda\/[0-9a-f]{64}\.zip$/,
        96,
        "invalid-input",
      ),
      bytes: object.bytes,
      inventorySha256: inventory.inventorySha256,
      retainedManifestSha256: retained.manifestSha256,
    };
  } catch {
    return fail("invalid-input");
  }
}
function validClock(time: number) {
  return (
    Number.isSafeInteger(time) &&
    time >= 0 &&
    Number.isFinite(new Date(time).getTime())
  );
}
async function boundedBody(
  body: unknown,
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  if (body instanceof Uint8Array) {
    if (body.byteLength > 65536) return fail("metadata-unavailable");
    return body;
  }
  if (
    !body ||
    typeof (body as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function"
  )
    return fail("metadata-unavailable");
  const stream = body as AsyncIterable<unknown> & { destroy?: () => void },
    chunks: Uint8Array[] = [];
  let bytes = 0;
  const abort = () => stream.destroy?.();
  signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const raw of stream) {
      signal.throwIfAborted();
      if (!(raw instanceof Uint8Array)) return fail("metadata-unavailable");
      bytes += raw.byteLength;
      if (bytes > 65536) return fail("metadata-unavailable");
      chunks.push(raw);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks, bytes);
  } finally {
    signal.removeEventListener("abort", abort);
    stream.destroy?.();
  }
}
/**
 * Bounded root-element check on an already size-limited body, not an XML
 * parser: an optional XML declaration, one ListVersionsResult root in
 * the documented S3 namespace (or with no attributes), and nothing after its
 * closing tag. The SDK still deserializes the full document.
 */
const ENVELOPE =
  /^(?:<\?xml\s[^<>?]{0,200}\?>)?\s*<ListVersionsResult(?:\s+xmlns\s*=\s*(["'])http:\/\/s3\.amazonaws\.com\/doc\/2006-03-01\/?\1)?\s*>([\s\S]*)<\/ListVersionsResult>\s*$/;
function listVersionsEnvelope(body: Uint8Array) {
  let text: string;
  try {
    // The decoder removes a leading BOM while rejecting invalid UTF-8.
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return false;
  }
  const match = ENVELOPE.exec(text);
  if (!match) return false;
  // Do not let the greedy interior absorb a second/nested root, declarations
  // or comments that could disguise a closing root. This is not schema proof.
  return !/<\/?ListVersionsResult(?=[\s>])|<!|<\?/.test(match[2]);
}
const echo = (value: unknown) => value === undefined || value === "";
const entryText = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= 1024;
/**
 * One complete page only. Truncation, continuation, grouping, contradictory
 * echoes or malformed entries are unknown, never empty or expected.
 */
function classify(scope: Scope, page: ListObjectVersionsCommandOutput) {
  const versions = page.Versions ?? [],
    markers = page.DeleteMarkers ?? [];
  if (
    page.$metadata.httpStatusCode !== 200 ||
    page.IsTruncated !== false ||
    page.NextKeyMarker !== undefined ||
    page.NextVersionIdMarker !== undefined ||
    page.Name !== scope.bucket ||
    page.MaxKeys !== MAX_KEYS ||
    !echo(page.Prefix) ||
    !echo(page.KeyMarker) ||
    !echo(page.VersionIdMarker) ||
    !echo(page.Delimiter) ||
    page.EncodingType !== undefined ||
    (page.CommonPrefixes !== undefined && page.CommonPrefixes.length !== 0) ||
    !Array.isArray(versions) ||
    !Array.isArray(markers) ||
    versions.length + markers.length > MAX_KEYS ||
    versions.some(
      (v) =>
        !entryText(v.Key) ||
        !entryText(v.VersionId) ||
        typeof v.IsLatest !== "boolean" ||
        !Number.isSafeInteger(v.Size) ||
        v.Size! < 0,
    ) ||
    markers.some(
      (m) =>
        !entryText(m.Key) ||
        !entryText(m.VersionId) ||
        typeof m.IsLatest !== "boolean",
    )
  )
    return fail("metadata-unavailable");
  const expectedKey = (key: unknown) => key === scope.key,
    review = new Set<Review>();
  if (markers.length) review.add("delete-marker");
  if (versions.length + markers.length > 1) review.add("multiple-entries");
  if (![...versions, ...markers].every((e) => expectedKey(e.Key)))
    review.add("other-key");
  for (const v of versions.filter((v) => expectedKey(v.Key))) {
    if (v.VersionId !== "null") review.add("non-null-version");
    if (v.IsLatest !== true) review.add("not-latest");
    if (v.Size !== scope.bytes) review.add("size-mismatch");
  }
  const total = versions.length + markers.length;
  return Object.freeze({
    shape:
      total === 0
        ? ("empty" as const)
        : review.size === 0
          ? ("expected-null-version-object" as const)
          : ("requires-review" as const),
    counts: Object.freeze({
      versions: versions.length,
      deleteMarkers: markers.length,
      expectedKeyEntries: [...versions, ...markers].filter((e) =>
        expectedKey(e.Key),
      ).length,
      otherKeyEntries: [...versions, ...markers].filter(
        (e) => !expectedKey(e.Key),
      ).length,
    }),
    review: Object.freeze([...review].sort()),
  });
}

/**
 * One owner-bound ListObjectVersions page for the original retained artifact
 * object. Metadata only: never ownership, body hash, versioning mode, absence
 * or deletion authority.
 */
export function collectRetainedCloudArtifactObject(
  input: RetainedInput,
  dependencies: Dependencies = {},
) {
  return collect(() => captureRetained(input), dependencies);
}
async function collect(captureScope: () => Scope, dependencies: Dependencies) {
  const controller = new AbortController(),
    clock = dependencies.clock ?? Date.now,
    signal = dependencies.signal;
  let timer: ReturnType<typeof setTimeout> | undefined,
    listener: (() => void) | undefined,
    timedOut = false,
    aborted = false,
    closeTransport = () => {};
  try {
    const captured = captureScope(),
      started = clock();
    if (!validClock(started)) return fail("clock-invalid");
    if (signal?.aborted) return fail("aborted");
    try {
      assertCloudIdentityEnvironment(process.env);
    } catch {
      return fail("unsupported-environment");
    }
    const work = async () => {
      const identity = async () => {
        controller.signal.throwIfAborted();
        const result = await (
          dependencies.identity ?? collectCloudInspectionIdentity
        )(
          {
            profile: captured.profile,
            accountId: captured.accountId,
            region: captured.region,
          },
          { signal: controller.signal },
        );
        controller.signal.throwIfAborted();
        if (
          result.kind !== "observed" ||
          result.summary.identityVerified !== true
        )
          return fail("identity-not-ready");
        if (
          result.expectedIdentity.profile !== captured.profile ||
          result.expectedIdentity.accountId !== captured.accountId ||
          result.expectedIdentity.region !== captured.region
        )
          return fail("identity-mismatch");
        return text(
          result.configuredRoleName,
          /^[A-Za-z0-9_+=,.@-]{1,32}$/,
          32,
          "identity-mismatch",
        );
      };
      const firstRole = await identity(),
        operation = new AbortController(),
        abort = () => operation.abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      const operationTimer = setTimeout(abort, 15000),
        transport =
          dependencies.transport ??
          new NodeHttpHandler({
            connectionTimeout: 5000,
            requestTimeout: 10000,
            socketTimeout: 10000,
          });
      let requests = 0,
        envelope = false,
        observed: ReturnType<typeof classify>,
        client: S3Client | undefined,
        closed = false,
        rejectOperation: (() => void) | undefined;
      closeTransport = () => {
        if (closed) return;
        closed = true;
        if (client) client.destroy();
        else transport.destroy();
      };
      try {
        const guarded: Transport = {
          async handle(request, options) {
            operation.signal.throwIfAborted();
            const owner = Object.entries(request.headers).find(
              ([key]) => key.toLowerCase() === "x-amz-expected-bucket-owner",
            )?.[1];
            if (
              ++requests !== 1 ||
              request.method !== "GET" ||
              request.protocol !== "https:" ||
              request.hostname !== "s3.us-east-1.amazonaws.com" ||
              (request.port !== undefined && request.port !== 443) ||
              ![`/${captured.bucket}`, `/${captured.bucket}/`].includes(
                request.path,
              ) ||
              owner !== captured.accountId ||
              request.body != null ||
              !Object.hasOwn(request.query, "versions") ||
              (request.query.versions !== "" &&
                request.query.versions !== null) ||
              request.query["max-keys"] !== String(MAX_KEYS) ||
              Object.keys(request.query).length !== 2
            )
              return fail("transport-scope");
            const result = await transport.handle(request, {
              ...options,
              abortSignal: operation.signal,
            });
            operation.signal.throwIfAborted();
            if (
              !Number.isInteger(result.response.statusCode) ||
              result.response.statusCode < 100 ||
              result.response.statusCode > 599 ||
              Buffer.byteLength(JSON.stringify(result.response.headers)) > 16384
            )
              return fail("metadata-unavailable");
            let body = await boundedBody(
              result.response.body,
              operation.signal,
            );
            // Only a documented ListVersionsResult document may become a page.
            if (result.response.statusCode === 200) {
              if (!listVersionsEnvelope(body))
                return fail("metadata-unavailable");
              // The pinned SDK parser does not consume a UTF-8 BOM itself.
              if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf)
                body = body.subarray(3);
              envelope = true;
            }
            return { response: { ...result.response, body } };
          },
          destroy() {
            transport.destroy();
          },
        };
        client = new S3Client({
          region: "us-east-1",
          endpoint: "https://s3.us-east-1.amazonaws.com",
          forcePathStyle: true,
          followRegionRedirects: false,
          useArnRegion: false,
          disableS3ExpressSessionAuth: true,
          maxAttempts: 1,
          ignoreConfiguredEndpointUrls: true,
          logger: quiet,
          credentials:
            dependencies.credentials ??
            fromSSO({
              profile: captured.profile,
              clientConfig: {
                maxAttempts: 1,
                ignoreConfiguredEndpointUrls: true,
                logger: quiet,
              },
            }),
          requestHandler: guarded,
        });
        try {
          const cancelledOperation = new Promise<never>((_, reject) => {
            rejectOperation = () =>
              reject(
                new ObjectFailure(
                  controller.signal.aborted ? "aborted" : "deadline",
                ),
              );
            operation.signal.addEventListener("abort", rejectOperation, {
              once: true,
            });
            if (operation.signal.aborted) rejectOperation();
          });
          const page = await Promise.race([
            client.send(
              new ListObjectVersionsCommand({
                Bucket: captured.bucket,
                ExpectedBucketOwner: captured.accountId,
                MaxKeys: MAX_KEYS,
              }),
              { abortSignal: operation.signal },
            ),
            cancelledOperation,
          ]);
          operation.signal.throwIfAborted();
          if (!envelope) return fail("metadata-unavailable");
          observed = classify(captured, page);
        } catch (error) {
          if (error instanceof ObjectFailure) throw error;
          operation.signal.throwIfAborted();
          // Not-found, denied and every other service error remain unknown.
          return fail("metadata-unavailable");
        }
      } finally {
        clearTimeout(operationTimer);
        controller.signal.removeEventListener("abort", abort);
        if (rejectOperation)
          operation.signal.removeEventListener("abort", rejectOperation);
        closeTransport();
      }
      if ((await identity()) !== firstRole) return fail("identity-mismatch");
      const ended = clock();
      if (!validClock(ended) || ended < started || ended - started > 90000)
        return fail("clock-invalid");
      controller.signal.throwIfAborted();
      return Object.freeze({
        kind: "observed" as const,
        checkedAt: new Date(started).toISOString(),
        completedAt: new Date(ended).toISOString(),
        expectedIdentity: Object.freeze({
          profile: captured.profile,
          accountId: captured.accountId,
          region: captured.region,
        }),
        retainedManifestSha256: captured.retainedManifestSha256,
        inventorySha256: captured.inventorySha256,
        scope: "retained-artifact-object-versions" as const,
        object: Object.freeze({
          bucket: captured.bucket,
          key: captured.key,
          expectedBytes: captured.bytes,
          expectedOwner: captured.accountId,
        }),
        page: Object.freeze({ complete: true as const, maxKeys: MAX_KEYS }),
        shape: observed.shape,
        counts: observed.counts,
        review: observed.review,
        bucketVersioning: "unproven" as const,
        bodyVerification: "unproven" as const,
        fullTargetAbsence: "unproven" as const,
        ownership: "unproven" as const,
        resourceWrites: 0 as const,
      });
    };
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => {
        aborted = true;
        controller.abort();
        reject(new ObjectFailure("aborted"));
      };
      signal?.addEventListener("abort", listener, { once: true });
      if (signal?.aborted) listener();
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new ObjectFailure("deadline"));
      }, 90000);
    });
    return await Promise.race([work(), cancelled, timeout]);
  } catch (error) {
    controller.abort();
    return Object.freeze({
      kind: "unavailable" as const,
      code: timedOut
        ? "deadline"
        : aborted
          ? "aborted"
          : error instanceof ObjectFailure
            ? error.code
            : "metadata-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (listener) signal?.removeEventListener("abort", listener);
    closeTransport();
  }
}
