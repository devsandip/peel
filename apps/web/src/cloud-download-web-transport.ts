import type {
  CloudDownloadRequest,
  CloudDownloadSender,
} from "./cloud-library-download";
import {
  CLOUD_PAGE_WIRE_BYTES,
  validatePullLocation,
} from "../../../packages/cloud-protocol/src/pull";

export const CLOUD_DOWNLOAD_DEADLINE_MS = 10_000;
const unavailable = () => Error("Cloud download transport unavailable");
function fields(value: object, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw unavailable();
}

/** Browser transport only. The parent supplies its trusted origin and issued CSRF. */
export function createCloudDownloadWebSender(
  input: { origin: string; csrfToken: string },
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): CloudDownloadSender {
  const config = structuredClone(input);
  fields(config, ["origin", "csrfToken"]);
  let origin: URL;
  try {
    origin = new URL(config.origin);
  } catch {
    throw unavailable();
  }
  if (
    origin.origin !== config.origin ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      )) ||
    typeof config.csrfToken !== "string" ||
    !/^[a-zA-Z0-9_-]{43}$/.test(config.csrfToken) ||
    typeof fetcher !== "function"
  )
    throw unavailable();
  return async (inputRequest, signal) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const controller = new AbortController();
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(unavailable());
    });
    void aborted.catch(() => {});
    const stop = () => {
      controller.abort();
      rejectAbort();
      void reader?.cancel().catch(() => {});
    };
    const timer = setTimeout(stop, CLOUD_DOWNLOAD_DEADLINE_MS);
    signal.addEventListener("abort", stop, { once: true });
    try {
      if (signal.aborted) stop();
      controller.signal.throwIfAborted();
      const request: CloudDownloadRequest = structuredClone(inputRequest);
      let path: string, body: string | undefined;
      if (request.kind === "bootstrap") {
        fields(request, ["kind", "scope"]);
        fields(request.scope, ["version", "collectionId", "modeGeneration"]);
        if (
          request.scope.version !== 1 ||
          typeof request.scope.collectionId !== "string" ||
          !/^[a-zA-Z0-9-]{1,128}$/.test(request.scope.collectionId) ||
          !Number.isSafeInteger(request.scope.modeGeneration) ||
          request.scope.modeGeneration < 1
        )
          throw unavailable();
        path = "/v1/sync/bootstrap";
        body = JSON.stringify(request.scope);
      } else if (request.kind === "resume") {
        fields(request, ["kind", "checkpoint"]);
        if (
          typeof request.checkpoint !== "string" ||
          !request.checkpoint.length ||
          request.checkpoint.length > 4096
        )
          throw unavailable();
        path = `/v1/sync?${new URLSearchParams({ after: request.checkpoint })}`;
      } else if (request.kind === "page") {
        fields(request, ["kind", "location"]);
        const location = validatePullLocation(request.location);
        path = `${location.kind === "heads" ? "/v1/notes" : "/v1/sync"}?${new URLSearchParams({ pageToken: location.token, limit: "32" })}`;
      } else throw unavailable();
      const received = Promise.resolve(
        fetcher(new URL(path, origin).href, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-peel-csrf": config.csrfToken,
          },
          ...(body === undefined ? {} : { body }),
          credentials: "same-origin",
          mode: "same-origin",
          redirect: "error",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          signal: controller.signal,
        }),
      );
      void received.then(
        (response) => {
          if (controller.signal.aborted)
            void response.body?.cancel().catch(() => {});
        },
        () => {},
      );
      const response = await Promise.race([received, aborted]);
      controller.signal.throwIfAborted();
      if (response.body) reader = response.body.getReader();
      const length = response.headers.get("content-length");
      if (
        response.redirected ||
        (response.url && new URL(response.url).origin !== config.origin) ||
        !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8")\s*)?$/i.test(
          response.headers.get("content-type") ?? "",
        ) ||
        (length !== null &&
          (!/^\d+$/.test(length) || Number(length) > CLOUD_PAGE_WIRE_BYTES)) ||
        !reader
      )
        throw unavailable();
      const bytes = new Uint8Array(CLOUD_PAGE_WIRE_BYTES);
      const bodyReader = reader;
      // Race one whole body operation, not each chunk: abort handlers stay bounded.
      const consume = async () => {
        let size = 0;
        for (;;) {
          const chunk = await bodyReader.read();
          controller.signal.throwIfAborted();
          if (chunk.done) break;
          if (size + chunk.value.byteLength > bytes.length) throw unavailable();
          bytes.set(chunk.value, size);
          size += chunk.value.byteLength;
        }
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            bytes.subarray(0, size),
          ),
        );
      };
      const responseBody = await Promise.race([consume(), aborted]);
      return { status: response.status, body: responseBody };
    } catch {
      stop();
      throw unavailable();
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      try {
        reader?.releaseLock();
      } catch {
        /* A canceled pending read may already have released the reader. */
      }
    }
  };
}
