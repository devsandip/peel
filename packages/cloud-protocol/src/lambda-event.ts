import { MAX_CLOUD_REQUEST_BYTES } from "./server-http";

export interface CloudLambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
  body: string;
  isBase64Encoded: false;
}
class InvalidEvent extends Error {
  constructor(readonly status: 400 | 413 = 400) {
    super();
  }
}
const reject = (status: 400 | 413 = 400): never => {
  throw new InvalidEvent(status);
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : reject();
const string = (value: unknown): string =>
  typeof value === "string" ? value : reject();
const errorResponse = (status: number, code: string): CloudLambdaResponse => ({
  statusCode: status,
  headers: {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  },
  body: JSON.stringify({ error: code }),
  isBase64Encoded: false,
});
function requestFromEvent(input: unknown, origin: string): Request {
  const event = object(input);
  if (event.version !== "2.0" || typeof event.isBase64Encoded !== "boolean")
    reject();
  const path = string(event.rawPath),
    query = string(event.rawQueryString);
  if (
    path.length + query.length > 10240 ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    /[\x00-\x20\x7f-\uffff?#\\]/.test(path) ||
    /[\x00-\x20\x7f-\uffff#\\]/.test(query)
  )
    reject();
  const url = new URL(origin + path + (query ? "?" + query : ""));
  if (
    url.origin !== origin ||
    url.pathname !== path ||
    url.search.slice(1) !== query
  )
    reject();
  try {
    const decoded = decodeURIComponent(path);
    if (
      /[\x00-\x20\x7f?#\\]/.test(decoded) ||
      decoded.split("/").length !== path.split("/").length
    )
      reject();
    decodeURIComponent(query);
  } catch {
    return reject();
  }
  const method = string(object(object(event.requestContext).http).method);
  if (
    !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
      method,
    )
  )
    reject();
  const entries = Object.entries(object(event.headers));
  if (entries.length > 64) reject();
  const headers = new Headers(),
    seen = new Set<string>();
  let headerBytes = 0;
  for (const [key, entry] of entries) {
    const name = key.toLowerCase(),
      value = string(entry);
    headerBytes += Buffer.byteLength(key) + Buffer.byteLength(value) + 4;
    if (
      !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) ||
      seen.has(name) ||
      /[\x00-\x1f\x7f\u0100-\uffff]/.test(value) ||
      Buffer.byteLength(value) > 8192 ||
      headerBytes > 16384 ||
      name === "transfer-encoding"
    )
      reject();
    seen.add(name);
    headers.set(name, value);
  }
  if (event.cookies !== undefined) {
    const cookieInput = event.cookies;
    if (
      !Array.isArray(cookieInput) ||
      cookieInput.length > 32 ||
      headers.has("cookie")
    )
      return reject();
    const cookies = cookieInput
      .map((value: unknown) => {
        const text = string(value);
        if (!text || /[\x00-\x1f\x7f,\u0100-\uffff]/.test(text)) reject();
        return text;
      })
      .join("; ");
    if (
      Buffer.byteLength(cookies) > 8192 ||
      headerBytes + Buffer.byteLength(cookies) > 16384
    )
      reject();
    if (cookies) headers.set("cookie", cookies);
  }
  const body = event.body === undefined ? "" : string(event.body);
  if (
    body.length >
    (event.isBase64Encoded
      ? Math.ceil(MAX_CLOUD_REQUEST_BYTES / 3) * 4
      : MAX_CLOUD_REQUEST_BYTES)
  )
    reject(413);
  const bytes = Buffer.from(body, event.isBase64Encoded ? "base64" : "utf8");
  if (bytes.length > MAX_CLOUD_REQUEST_BYTES) reject(413);
  if (
    event.isBase64Encoded
      ? bytes.toString("base64") !== body
      : bytes.toString("utf8") !== body
  )
    reject();
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return reject();
  }
  const length = headers.get("content-length");
  if (
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) !== bytes.length)
  )
    reject();
  if (["GET", "HEAD"].includes(method) && bytes.length) reject();
  return new Request(url, {
    method,
    headers,
    body: bytes.length ? new Uint8Array(bytes) : undefined,
  });
}
async function responseToEvent(
  response: Response,
): Promise<CloudLambdaResponse> {
  const chunks: Uint8Array[] = [],
    reader = response.body?.getReader();
  let length = 0;
  try {
    if (reader)
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > MAX_CLOUD_REQUEST_BYTES) {
          await reader.cancel();
          throw Error();
        }
        chunks.push(next.value);
      }
  } finally {
    reader?.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  headers["cache-control"] = "no-store";
  headers["x-content-type-options"] = "nosniff";
  const cookies = response.headers.getSetCookie();
  return {
    statusCode: response.status,
    headers,
    ...(cookies.length ? { cookies } : {}),
    body: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    isBase64Encoded: false,
  };
}
/** Wrap a trusted Fetch service. This adapter configures no authentication or listener. */
export function createCloudLambdaAdapter(
  origin: string,
  service: (request: Request) => Promise<Response>,
) {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) throw Error();
  } catch {
    throw Error("Invalid Cloud Lambda origin");
  }
  return async (event: unknown): Promise<CloudLambdaResponse> => {
    try {
      return await responseToEvent(
        await service(requestFromEvent(event, origin)),
      );
    } catch (error) {
      if (error instanceof InvalidEvent)
        return errorResponse(
          error.status,
          error.status === 413 ? "request-too-large" : "invalid-http-event",
        );
      return errorResponse(503, "service-unavailable");
    }
  };
}
