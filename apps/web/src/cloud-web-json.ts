import { CLOUD_PAGE_WIRE_BYTES } from "../../../packages/cloud-protocol/src/pull";
import { MAX_CLOUD_REQUEST_BYTES } from "../../../packages/cloud-protocol/src/server-http";

export const CLOUD_WEB_DEADLINE_MS = 10_000;
type EncodedRequest = { path: string; body?: string; method?: "GET" | "POST" };
function fields(value: object, keys: string[], unavailable: () => Error) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw unavailable();
}

/** Internal shared browser JSON transport. The parent owns authenticated context. */
export function createCloudWebJSONSender<T>(
  input: { origin: string; csrfToken: string },
  encode: (request: T) => EncodedRequest | Promise<EncodedRequest>,
  unavailable: () => Error,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): (
  request: T,
  signal: AbortSignal,
) => Promise<{ status: number; body: unknown }> {
  const config = structuredClone(input);
  fields(config, ["origin", "csrfToken"], unavailable);
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
    const timer = setTimeout(stop, CLOUD_WEB_DEADLINE_MS);
    signal.addEventListener("abort", stop, { once: true });
    try {
      if (signal.aborted) stop();
      controller.signal.throwIfAborted();
      const prepared = encode(structuredClone(inputRequest));
      // Keep synchronous download dispatch unchanged; mutations verify hashes asynchronously.
      const encoded =
        prepared instanceof Promise
          ? await Promise.race([prepared, aborted])
          : prepared;
      controller.signal.throwIfAborted();
      const target = new URL(encoded.path, origin),
        body = encoded.body,
        method = encoded.method ?? (body === undefined ? "GET" : "POST");
      if (
        (encoded.method !== undefined &&
          !["GET", "POST"].includes(encoded.method)) ||
        (method === "GET" && body !== undefined) ||
        !encoded.path.startsWith("/") ||
        encoded.path.startsWith("//") ||
        target.origin !== config.origin ||
        target.username ||
        target.password ||
        target.hash ||
        (body !== undefined &&
          (typeof body !== "string" ||
            new TextEncoder().encode(body).length > MAX_CLOUD_REQUEST_BYTES))
      )
        throw unavailable();
      const received = Promise.resolve(
        fetcher(target.href, {
          method,
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
