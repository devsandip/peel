import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CloudServerError, validateServerSubject } from "./server";
import type { CloudCallerResolver } from "./server-http";

export const CLOUD_SESSION_COOKIE = "__Host-peel-session";
export const MAX_WEB_SESSION_MS = 24 * 60 * 60 * 1000;
export interface CloudWebSession {
  version: 1;
  idHash: string;
  subject: string;
  csrfHash: string;
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
}
export interface CloudWebSessionStore {
  /** Return current committed state so completed revocation defeats later reads. */
  read(idHash: string): Promise<CloudWebSession | null>;
  /** Must insert atomically without overwriting another session. */
  insert(session: CloudWebSession): Promise<boolean>;
  /** Must durably revoke an existing ID; a missing ID is already unusable. */
  revoke(idHash: string): Promise<void>;
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{43}$/.test(value);
const hash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const time = (value: number) =>
  Number.isSafeInteger(value) &&
  value >= 0 &&
  Number.isFinite(new Date(value).getTime());
const fail = (code: string, status: number): never => {
  throw new CloudServerError(code, status);
};
export function validateCloudWebSession(
  input: CloudWebSession,
): CloudWebSession {
  const value = structuredClone(input);
  const fields = [
    "version",
    "idHash",
    "subject",
    "csrfHash",
    "issuedAt",
    "expiresAt",
    "revoked",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key)) ||
    value.version !== 1 ||
    !hash(value.idHash) ||
    !hash(value.csrfHash) ||
    typeof value.revoked !== "boolean" ||
    !time(value.issuedAt) ||
    !time(value.expiresAt) ||
    value.expiresAt - value.issuedAt < 60000 ||
    value.expiresAt - value.issuedAt > MAX_WEB_SESSION_MS
  )
    throw Error("Invalid stored web session");
  validateServerSubject(value.subject);
  return value;
}
function cookie(request: Request, optional = false) {
  const header = request.headers.get("cookie");
  if (header === null) return optional ? null : fail("unauthorized", 401);
  if (header.length > 8192) return fail("unauthorized", 401);
  const values = header
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${CLOUD_SESSION_COOKIE}=`))
    .map((value) => value.slice(CLOUD_SESSION_COOKIE.length + 1));
  if (!values.length && optional) return null;
  if (values.length !== 1 || !token(values[0]))
    return fail("unauthorized", 401);
  return values[0];
}
const cookieHeader = (value: string, seconds: number) =>
  `${CLOUD_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;

/** Server-only request boundary. No routes, default store or browser token persistence. */
export function createCloudWebSessionBoundary(
  config: { origin: string; lifetimeMs: number },
  store: CloudWebSessionStore,
  authenticateForIssue: CloudCallerResolver,
  clock = () => Date.now(),
) {
  const origin = new URL(config.origin),
    lifetime = config.lifetimeMs;
  if (
    origin.protocol !== "https:" ||
    origin.origin !== config.origin ||
    origin.username ||
    origin.password ||
    !Number.isSafeInteger(lifetime) ||
    lifetime < 60000 ||
    lifetime > MAX_WEB_SESSION_MS ||
    lifetime % 1000
  )
    throw Error("Invalid web session configuration");
  const now = () => {
    const value = clock();
    if (!time(value)) return fail("session-clock-unavailable", 503);
    return value;
  };
  function checkOrigin(request: Request, unsafe: boolean) {
    if (new URL(request.url).origin !== origin.origin)
      return fail("origin-rejected", 403);
    const source = request.headers.get("origin"),
      site = request.headers.get("sec-fetch-site");
    if (
      (source !== null && source !== origin.origin) ||
      (unsafe && source !== origin.origin) ||
      (site !== null && !["same-origin", "none"].includes(site))
    )
      return fail("origin-rejected", 403);
  }
  const persistence = async <T>(operation: () => Promise<T>): Promise<T> => {
    try {
      return await operation();
    } catch {
      return fail("session-unavailable", 503);
    }
  };
  async function session(request: Request) {
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    checkOrigin(request, unsafe);
    const idHash = digest(cookie(request)!);
    const stored = await persistence(() => store.read(idHash));
    if (!stored) return fail("unauthorized", 401);
    let record: CloudWebSession;
    try {
      record = validateCloudWebSession(stored);
    } catch {
      return fail("session-unavailable", 503);
    }
    if (record.idHash !== idHash) return fail("session-unavailable", 503);
    const current = now();
    if (current < record.issuedAt)
      return fail("session-clock-unavailable", 503);
    if (record.revoked || current >= record.expiresAt)
      return fail("unauthorized", 401);
    // A supplied token also binds captured safe reads to this exact session.
    if (unsafe || request.headers.has("x-peel-csrf")) {
      const csrf = request.headers.get("x-peel-csrf");
      if (
        !token(csrf) ||
        !timingSafeEqual(
          Buffer.from(digest(csrf), "hex"),
          Buffer.from(record.csrfHash, "hex"),
        )
      )
        return fail("csrf-rejected", 403);
    }
    return record;
  }
  const resolveCaller: CloudCallerResolver = async (request) =>
    (await session(request)).subject;
  return {
    resolveCaller,
    /** Server-only current session metadata; never serialize this to a client. */
    async resolveSession(request: Request): Promise<Readonly<CloudWebSession>> {
      return Object.freeze(structuredClone(await session(request)));
    },
    async issue(request: Request): Promise<Response> {
      if (request.method !== "POST") return fail("method-not-allowed", 405);
      checkOrigin(request, true);
      const previous = cookie(request, true);
      let subject: string;
      try {
        subject = await authenticateForIssue(request);
        validateServerSubject(subject);
      } catch (error) {
        return fail(
          error instanceof CloudServerError && error.status === 401
            ? "unauthorized"
            : "authentication-unavailable",
          error instanceof CloudServerError && error.status === 401 ? 401 : 503,
        );
      }
      const issuedAt = now(),
        expiresAt = issuedAt + lifetime;
      if (!time(expiresAt)) return fail("session-clock-unavailable", 503);
      const id = randomBytes(32).toString("base64url"),
        csrf = randomBytes(32).toString("base64url");
      const record = validateCloudWebSession({
        version: 1,
        idHash: digest(id),
        subject,
        csrfHash: digest(csrf),
        issuedAt,
        expiresAt,
        revoked: false,
      });
      if (!(await persistence(() => store.insert(record))))
        return fail("session-unavailable", 503);
      if (now() < issuedAt || now() >= expiresAt)
        return fail("session-clock-unavailable", 503);
      if (previous) await persistence(() => store.revoke(digest(previous)));
      return Response.json(
        { csrfToken: csrf, expiresAt },
        {
          headers: {
            "Set-Cookie": cookieHeader(id, lifetime / 1000),
            "Cache-Control": "no-store",
          },
        },
      );
    },
    async logout(request: Request): Promise<Response> {
      if (request.method !== "POST") return fail("method-not-allowed", 405);
      const record = await session(request);
      await persistence(() => store.revoke(record.idHash));
      return new Response(null, {
        status: 204,
        headers: {
          "Set-Cookie": cookieHeader("", 0),
          "Cache-Control": "no-store",
        },
      });
    },
  };
}
