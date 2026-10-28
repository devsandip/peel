import {
  S3Client,
  GetBucketTaggingCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { fromSSO } from "@aws-sdk/credential-provider-sso";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import {
  cloudExpectedInventory,
  type CloudInventoryInput,
} from "./expected-inventory.ts";
import { collectCloudInspectionIdentity } from "./inspection-identity.ts";
import { assertCloudIdentityEnvironment } from "./identity-observations.ts";

type Input = {
  profile: string;
  inventory: CloudInventoryInput;
  templates: string;
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
class BucketFailure extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud artifact-bucket metadata unavailable");
    this.code = code;
  }
}
const fail = (code: Code): never => {
  throw new BucketFailure(code);
};
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
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
function capture(input: Input) {
  const data = record(input, ["profile", "inventory", "templates"]),
    profile = text(
      data.profile,
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/,
      64,
      "invalid-input",
    );
  try {
    const expected = cloudExpectedInventory(
        data.inventory as CloudInventoryInput,
        data.templates as string,
      ),
      bucket = expected.stacks
        .find((s) => s.kind === "artifacts")
        ?.resources.find((r) => r.logicalId === "ArtifactBucket");
    if (
      bucket?.type !== "AWS::S3::Bucket" ||
      bucket.identity.name?.property !== "BucketName"
    )
      return fail("invalid-input");
    return { profile, expected, bucket: bucket.identity.name.value };
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
function serviceCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return e.$metadata?.httpStatusCode === 404 && typeof e.name === "string"
    ? e.name
    : null;
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

/** One owner-bound GetBucketTagging request, with redirects/retries and implicit HEAD blocked. */
export async function collectCloudArtifactBucket(
  input: Input,
  dependencies: {
    identity?: typeof collectCloudInspectionIdentity;
    transport?: Transport;
    credentials?: S3ClientConfig["credentials"];
    clock?: () => number;
    signal?: AbortSignal;
  } = {},
) {
  const controller = new AbortController(),
    clock = dependencies.clock ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined,
    listener: (() => void) | undefined,
    timedOut = false,
    aborted = false,
    closeTransport = () => {};
  try {
    const captured = capture(input),
      started = clock();
    if (!validClock(started)) return fail("clock-invalid");
    if (dependencies.signal?.aborted) return fail("aborted");
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
            accountId: captured.expected.accountId,
            region: captured.expected.region,
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
          result.expectedIdentity.accountId !== captured.expected.accountId ||
          result.expectedIdentity.region !== captured.expected.region
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
        state: "collision" | "not-found",
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
              owner !== captured.expected.accountId ||
              request.body != null ||
              !Object.hasOwn(request.query, "tagging") ||
              (request.query.tagging !== "" &&
                request.query.tagging !== null) ||
              Object.keys(request.query).length !== 1
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
            return {
              response: {
                ...result.response,
                body: await boundedBody(result.response.body, operation.signal),
              },
            };
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
                new BucketFailure(
                  controller.signal.aborted ? "aborted" : "deadline",
                ),
              );
            operation.signal.addEventListener("abort", rejectOperation, {
              once: true,
            });
            if (operation.signal.aborted) rejectOperation();
          });
          const result = await Promise.race([
            client.send(
              new GetBucketTaggingCommand({
                Bucket: captured.bucket,
                ExpectedBucketOwner: captured.expected.accountId,
              }),
              { abortSignal: operation.signal },
            ),
            cancelledOperation,
          ]);
          operation.signal.throwIfAborted();
          if (
            result.$metadata.httpStatusCode !== 200 ||
            !Array.isArray(result.TagSet) ||
            result.TagSet.length > 50 ||
            result.TagSet.some(
              (t) =>
                typeof t.Key !== "string" ||
                typeof t.Value !== "string" ||
                t.Key.length > 128 ||
                t.Value.length > 256,
            )
          )
            return fail("metadata-unavailable");
          state = "collision";
        } catch (error) {
          if (error instanceof BucketFailure) throw error;
          operation.signal.throwIfAborted();
          const code = serviceCode(error);
          if (code === "NoSuchBucket") state = "not-found";
          else if (code === "NoSuchTagSet") state = "collision";
          else return fail("metadata-unavailable");
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
          accountId: captured.expected.accountId,
          region: captured.expected.region,
        }),
        inventorySha256: captured.expected.inventorySha256,
        scope: "global-artifact-bucket" as const,
        bucket: Object.freeze({
          name: captured.bucket,
          expectedOwner: captured.expected.accountId,
          state,
        }),
        fullTargetAbsence: "unproven" as const,
        ownership: "unproven" as const,
        resourceWrites: 0 as const,
      });
    };
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => {
        aborted = true;
        controller.abort();
        reject(new BucketFailure("aborted"));
      };
      dependencies.signal?.addEventListener("abort", listener, { once: true });
      if (dependencies.signal?.aborted) listener();
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new BucketFailure("deadline"));
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
          : error instanceof BucketFailure
            ? error.code
            : "metadata-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (listener) dependencies.signal?.removeEventListener("abort", listener);
    closeTransport();
  }
}
