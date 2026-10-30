import { createHash, randomBytes } from "node:crypto";
import {
  assertCloudScope,
  validateCloudScope,
  type CloudScope,
} from "./durable";
import { CloudServerError } from "./server";
import { validateCloudWebSession, type CloudWebSession } from "./web-session";

export const MAX_CONNECTION_TICKET_MS = 60_000;
export interface CloudConnectionTicket {
  version: 1;
  idHash: string;
  sessionHash: string;
  scope: CloudScope;
  issuedAt: number;
  expiresAt: number;
}
export interface CloudConnectionTicketStore {
  /** Atomic insert, bounded admission and persisted monotonic time; never overwrite. */
  insert(record: CloudConnectionTicket, now: number): Promise<boolean>;
  /** Atomic single use only for the original session and an unexpired ticket. */
  take(
    idHash: string,
    sessionHash: string,
    now: number,
  ): Promise<CloudConnectionTicket | null>;
  close(): Promise<void>;
}
export const connectionTicketTime = (value: number) =>
  Number.isSafeInteger(value) &&
  value >= 0 &&
  Number.isFinite(new Date(value).getTime());
export const connectionTicketHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const unavailable = (status = 503): never => {
  throw new CloudServerError("connection-ticket-unavailable", status);
};
export function validateCloudConnectionTicket(
  input: CloudConnectionTicket,
): CloudConnectionTicket {
  try {
    const keys = [
      "version",
      "idHash",
      "sessionHash",
      "scope",
      "issuedAt",
      "expiresAt",
    ];
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Reflect.ownKeys(input).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(input, key))
    )
      return unavailable();
    const scopeKeys = [
      "version",
      "ownerSubject",
      "collectionId",
      "modeGeneration",
    ];
    if (
      !input.scope ||
      typeof input.scope !== "object" ||
      Array.isArray(input.scope) ||
      Reflect.ownKeys(input.scope).length !== scopeKeys.length ||
      scopeKeys.some((key) => !Object.hasOwn(input.scope, key))
    )
      return unavailable();
    const record = structuredClone(input);
    if (
      record.version !== 1 ||
      !connectionTicketHash(record.idHash) ||
      !connectionTicketHash(record.sessionHash) ||
      !connectionTicketTime(record.issuedAt) ||
      !connectionTicketTime(record.expiresAt) ||
      record.expiresAt <= record.issuedAt ||
      record.expiresAt - record.issuedAt > MAX_CONNECTION_TICKET_MS
    )
      return unavailable();
    record.scope = validateCloudScope(record.scope);
    return record;
  } catch {
    return unavailable();
  }
}
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
type SessionResolver = (request: Request) => Promise<Readonly<CloudWebSession>>;
type LibraryAuthority = {
  libraryContext(subject: string): Promise<CloudScope>;
};

/** Server-only connection prerequisite. No route, socket or continuing fan-out grant. */
export class CloudConnectionTickets {
  private origin: string;
  private lifetime: number;
  private wall = 0;
  constructor(
    config: { origin: string; lifetimeMs: number },
    private resolve: SessionResolver,
    private library: LibraryAuthority,
    private store: CloudConnectionTicketStore,
    private clock = () => Date.now(),
  ) {
    const origin = new URL(config.origin);
    if (
      origin.protocol !== "https:" ||
      origin.origin !== config.origin ||
      origin.username ||
      origin.password ||
      !Number.isSafeInteger(config.lifetimeMs) ||
      config.lifetimeMs < 1000 ||
      config.lifetimeMs > MAX_CONNECTION_TICKET_MS ||
      config.lifetimeMs % 1000
    )
      throw Error("Invalid connection ticket configuration");
    this.origin = origin.origin;
    this.lifetime = config.lifetimeMs;
  }
  private now() {
    const value = this.clock();
    if (!connectionTicketTime(value) || value < this.wall) return unavailable();
    this.wall = value;
    return value;
  }
  private capture(input: Request, method: string) {
    input.signal.throwIfAborted();
    const url = new URL(input.url),
      length = input.headers.get("content-length");
    if (input.method !== method) return unavailable(405);
    if (
      url.origin !== this.origin ||
      url.username ||
      url.password ||
      input.headers.get("origin") !== this.origin
    )
      return unavailable(403);
    if (
      url.search ||
      url.hash ||
      input.body !== null ||
      input.headers.has("transfer-encoding") ||
      (length !== null && length !== "0")
    )
      return unavailable(400);
    return new Request(input.url, {
      method,
      headers: new Headers(input.headers),
      signal: input.signal,
    });
  }
  private async session(
    request: Request,
    expected?: Readonly<CloudWebSession>,
  ) {
    request.signal.throwIfAborted();
    const session = validateCloudWebSession(await this.resolve(request));
    request.signal.throwIfAborted();
    const at = this.now();
    if (
      session.revoked ||
      at < session.issuedAt ||
      at >= session.expiresAt ||
      (expected &&
        (Object.keys(expected) as (keyof CloudWebSession)[]).some(
          (key) => session[key] !== expected[key],
        ))
    )
      return unavailable(401);
    return Object.freeze(session);
  }
  private async scope(request: Request, session: Readonly<CloudWebSession>) {
    request.signal.throwIfAborted();
    const scope = validateCloudScope(
      await this.library.libraryContext(session.subject),
    );
    request.signal.throwIfAborted();
    if (scope.ownerSubject !== session.subject) return unavailable(401);
    return scope;
  }
  private validAt(record: CloudConnectionTicket) {
    const now = this.now();
    if (now < record.issuedAt || now >= record.expiresAt)
      return unavailable(401);
  }
  private failure(input: Request, error: unknown): never {
    return unavailable(
      input.signal.aborted
        ? 409
        : error instanceof CloudServerError &&
            [400, 401, 403, 405, 410, 429, 503].includes(error.status)
          ? error.status
          : 503,
    );
  }
  async issue(
    input: Request,
  ): Promise<Readonly<{ ticket: string; expiresAt: number }>> {
    try {
      const request = this.capture(input, "POST"),
        session = await this.session(request),
        scope = await this.scope(request, session),
        issuedAt = this.now(),
        ticket = randomBytes(32).toString("base64url"),
        record = validateCloudConnectionTicket({
          version: 1,
          idHash: digest(ticket),
          sessionHash: session.idHash,
          scope,
          issuedAt,
          expiresAt: Math.min(issuedAt + this.lifetime, session.expiresAt),
        });
      await this.session(request, session);
      if (!(await this.store.insert(structuredClone(record), this.now())))
        return unavailable(429);
      request.signal.throwIfAborted();
      assertCloudScope(await this.scope(request, session), record.scope);
      await this.session(request, session);
      this.validAt(record);
      request.signal.throwIfAborted();
      return Object.freeze({ ticket, expiresAt: record.expiresAt });
    } catch (error) {
      return this.failure(input, error);
    }
  }
  async consume(
    input: Request,
    raw: unknown,
  ): Promise<
    Readonly<{
      scope: Readonly<CloudScope>;
      sessionHash: string;
      expiresAt: number;
    }>
  > {
    try {
      const request = this.capture(input, "GET");
      if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(raw))
        return unavailable(400);
      const session = await this.session(request),
        idHash = digest(raw),
        claimed = await this.store.take(idHash, session.idHash, this.now());
      request.signal.throwIfAborted();
      if (!claimed) return unavailable(401);
      const record = validateCloudConnectionTicket(claimed);
      if (
        record.idHash !== idHash ||
        record.sessionHash !== session.idHash ||
        record.issuedAt < session.issuedAt ||
        record.expiresAt > session.expiresAt
      )
        return unavailable();
      this.validAt(record);
      assertCloudScope(await this.scope(request, session), record.scope);
      await this.session(request, session);
      this.validAt(record);
      request.signal.throwIfAborted();
      return Object.freeze({
        scope: Object.freeze(record.scope),
        sessionHash: record.sessionHash,
        expiresAt: record.expiresAt,
      });
    } catch (error) {
      return this.failure(input, error);
    }
  }
}
