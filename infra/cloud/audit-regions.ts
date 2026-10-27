import { createHash } from "node:crypto";

export const cloudAuditRegistryUrl =
  "https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-lake-supported-regions.html";
const commercial = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "af-south-1",
  "ap-east-1",
  "ap-south-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-south-1",
  "ap-northeast-3",
  "ap-northeast-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ca-central-1",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-south-1",
  "eu-west-3",
  "eu-south-2",
  "eu-north-1",
  "eu-central-2",
  "il-central-1",
  "me-south-1",
  "me-central-1",
  "sa-east-1",
].sort();
const govCloud = ["us-gov-east-1", "us-gov-west-1"],
  complete = [...commercial, ...govCloud].sort(),
  limit = 256 * 1024,
  deadlineMs = 10000;
type Code =
  | "registry-format"
  | "registry-changed"
  | "registry-unavailable"
  | "deadline"
  | "clock-invalid";
class RegistryFailure extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud audit region registry unavailable");
    this.code = code;
  }
}
function fail(code: Code): never {
  throw new RegistryFailure(code);
}
function full(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.exec(value)?.[0] === value;
}

/** Match the entire reviewed AWS table; changed or partial coverage must be reviewed. */
export function parseCloudAuditRegions(html: string, checkedAt: string) {
  if (
    typeof html !== "string" ||
    Buffer.byteLength(html, "utf8") > limit ||
    !full(checkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) ||
    !Number.isSafeInteger(Date.parse(checkedAt)) ||
    new Date(checkedAt).toISOString() !== checkedAt
  )
    return fail("registry-format");
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const tables = [...markup.matchAll(/<table\b[^>]*>[\s\S]*?<\/table\s*>/gi)];
  if (
    tables.length !== 1 ||
    (markup.match(/<table\b/gi) ?? []).length !== 1 ||
    (markup.match(/<\/table\s*>/gi) ?? []).length !== 1
  )
    return fail("registry-format");
  const table = tables[0][0],
    rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    rows.length !== complete.length + 1 ||
    (table.match(/<tr\b/gi) ?? []).length !== rows.length ||
    (table.match(/<\/tr\s*>/gi) ?? []).length !== rows.length
  )
    return fail("registry-format");
  const headers = [...rows[0][1].matchAll(/<th\b[^>]*>([^<]*)<\/th\s*>/gi)].map(
    (m) => m[1].trim(),
  );
  if (
    headers.join() !== "Region Name,Region" ||
    /<td\b/i.test(rows[0][1]) ||
    (rows[0][1].match(/<th\b/gi) ?? []).length !== 2 ||
    (rows[0][1].match(/<\/th\s*>/gi) ?? []).length !== 2
  )
    return fail("registry-format");
  const found: string[] = [];
  for (const [, body] of rows.slice(1)) {
    const cells = [...body.matchAll(/<td\b[^>]*>([^<]*)<\/td\s*>/gi)];
    if (
      cells.length !== 2 ||
      (body.match(/<td\b/gi) ?? []).length !== 2 ||
      (body.match(/<\/td\s*>/gi) ?? []).length !== 2 ||
      /<th\b/i.test(body)
    )
      return fail("registry-format");
    const region = cells[1][1].trim();
    if (!full(region, /^[a-z]{2}(?:-[a-z]+)+-\d+$/))
      return fail("registry-format");
    found.push(region);
  }
  if (
    new Set(found).size !== found.length ||
    JSON.stringify(found.sort()) !== JSON.stringify(complete)
  )
    return fail("registry-changed");
  return Object.freeze({
    sourceUrl: cloudAuditRegistryUrl,
    checkedAt,
    sourceSha256: createHash("sha256").update(html, "utf8").digest("hex"),
    partition: "aws" as const,
    regions: Object.freeze([...commercial]),
    excludedRegions: Object.freeze([...govCloud]),
    publishedRegionCount: complete.length,
  });
}

/** Fixed public source only. This does not inspect account configuration or establish audit absence. */
export async function collectCloudAuditRegions(
  dependencies: {
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
    clock?: () => number;
  } = {},
) {
  const clock = dependencies.clock ?? Date.now,
    controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined,
    reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
    body: ReadableStream<Uint8Array> | undefined,
    timedOut = false;
  try {
    const started = clock();
    if (!Number.isSafeInteger(started) || started < 0)
      return fail("clock-invalid");
    const work = async () => {
      const response = await (dependencies.fetch ?? fetch)(
        cloudAuditRegistryUrl,
        {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          cache: "no-store",
          headers: { accept: "text/html", "accept-encoding": "identity" },
          signal: controller.signal,
        },
      );
      body = response.body ?? undefined;
      if (
        response.status !== 200 ||
        response.url !== cloudAuditRegistryUrl ||
        response.redirected ||
        !/^text\/html(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        ) ||
        !response.body
      )
        return fail("registry-unavailable");
      controller.signal.throwIfAborted();
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        controller.signal.throwIfAborted();
        const next = await reader.read();
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) return fail("registry-format");
        bytes += next.value.length;
        if (bytes > limit) return fail("registry-format");
        chunks.push(next.value);
      }
      const html = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(Buffer.concat(chunks));
      const ended = clock();
      if (
        !Number.isSafeInteger(ended) ||
        ended < started ||
        ended - started > deadlineMs
      )
        return fail("clock-invalid");
      return Object.freeze({
        kind: "observed" as const,
        registry: parseCloudAuditRegions(html, new Date(started).toISOString()),
        resourceWrites: 0 as const,
      });
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new RegistryFailure("deadline"));
      }, deadlineMs);
    });
    return await Promise.race([work(), timeout]);
  } catch (error) {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    else if (body) void body.cancel().catch(() => {});
    return Object.freeze({
      kind: "unavailable" as const,
      code: timedOut
        ? "deadline"
        : error instanceof RegistryFailure
          ? error.code
          : "registry-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (reader)
      try {
        reader.releaseLock();
      } catch {
        /* A timed-out stream can still have a pending read. */
      }
  }
}
