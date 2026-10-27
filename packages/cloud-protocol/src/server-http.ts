import {
  CloudMutationService,
  CloudServerError,
  type CloudMutationRequest,
} from "./server";
import type { CloudPullService, PullScope } from "./pull";

export const MAX_CLOUD_REQUEST_BYTES = 2 * 1024 * 1024;
/** Production callers must verify Cognito/native credentials or the web session here. */
export type CloudCallerResolver = (request: Request) => Promise<string>;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
async function requestJSON(request: Request) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new CloudServerError("json-content-type-required", 415);
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > MAX_CLOUD_REQUEST_BYTES)
  )
    throw new CloudServerError("request-too-large", 413);
  if (!request.body) throw new CloudServerError("empty-request", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_CLOUD_REQUEST_BYTES) {
        await reader.cancel();
        throw new CloudServerError("request-too-large", 413);
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CloudServerError("malformed-json", 400);
  }
}
/** Fetch-standard adapter. No listener, auth shortcut, CORS policy or AWS resource is created. */
export function createCloudMutationHandler(
  service: CloudMutationService,
  resolveCaller: CloudCallerResolver,
  pull?: CloudPullService,
) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const pullPath =
        !!pull &&
        ["/v1/sync/bootstrap", "/v1/notes", "/v1/sync"].includes(url.pathname);
      if (url.search && !pullPath)
        return json({ error: "unsupported-query" }, 400);
      const noteMatch = /^\/v1\/notes\/([^/]+)$/.exec(url.pathname);
      if (url.pathname !== "/v1/mutations" && !noteMatch && !pullPath)
        return json({ error: "not-found" }, 404);
      if (
        (url.pathname === "/v1/mutations" && request.method !== "POST") ||
        (noteMatch && request.method !== "GET") ||
        (pullPath &&
          request.method !==
            (url.pathname === "/v1/sync/bootstrap" ? "POST" : "GET"))
      )
        return json({ error: "method-not-allowed" }, 405);
      // Resolve authority before consuming an untrusted payload. There is no paid request flag.
      const subject = await resolveCaller(request);
      if (pullPath) {
        if (url.pathname === "/v1/sync/bootstrap") {
          if (url.search) return json({ error: "unsupported-query" }, 400);
          return json(
            await pull!.bootstrap(
              subject,
              (await requestJSON(request)) as PullScope,
            ),
          );
        }
        const allowed =
          url.pathname === "/v1/notes"
            ? ["pageToken", "limit"]
            : ["after", "pageToken", "limit"];
        for (const key of url.searchParams.keys())
          if (
            !allowed.includes(key) ||
            url.searchParams.getAll(key).length !== 1
          )
            return json({ error: "unsupported-query" }, 400);
        const limitText = url.searchParams.get("limit"),
          limit =
            limitText === null
              ? undefined
              : /^[1-9]\d*$/.test(limitText)
                ? Number(limitText)
                : NaN;
        if (
          limit !== undefined &&
          (!Number.isSafeInteger(limit) || limit < 1 || limit > 32)
        )
          return json({ error: "invalid-page-limit" }, 400);
        const token = url.searchParams.get("pageToken"),
          after = url.searchParams.get("after");
        if (url.pathname === "/v1/sync" && after && !token)
          return json(await pull!.resume(subject, after));
        if (!token || after !== null)
          return json({ error: "page-token-required" }, 400);
        return json(
          await pull!.page(
            subject,
            { kind: url.pathname === "/v1/notes" ? "heads" : "changes", token },
            limit,
          ),
        );
      }
      if (noteMatch) {
        const generation = request.headers.get("x-peel-mode-generation") ?? "";
        if (
          !/^[1-9]\d*$/.test(generation) ||
          !Number.isSafeInteger(Number(generation))
        )
          throw new CloudServerError("invalid-mode-generation", 400);
        const collectionId = request.headers.get("x-peel-collection") ?? "";
        let noteId: string;
        try {
          noteId = decodeURIComponent(noteMatch[1]);
        } catch {
          throw new CloudServerError("invalid-note-id", 400);
        }
        return json({
          head: await service.get(
            subject,
            { version: 1, collectionId, modeGeneration: Number(generation) },
            noteId,
          ),
        });
      }
      const result = await service.mutate(
        subject,
        (await requestJSON(request)) as CloudMutationRequest,
      );
      return json(result, result.receipt.outcome === "conflict" ? 409 : 200);
    } catch (error) {
      if (error instanceof CloudServerError)
        return json({ error: error.code }, error.status);
      // Payloads, credentials and internal exception text never enter the response or a log.
      return json({ error: "service-unavailable" }, 503);
    }
  };
}
