import { randomBytes } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import {
  assertCloudScope,
  validateCloudScope,
  type CloudScope,
} from "./durable";
import { CloudServerError } from "./server";
import {
  validateCloudWebSession,
  type CloudWebSessionStore,
} from "./web-session";
import { CLOUD_WEBSOCKET_PROTOCOL } from "./websocket-handshake";

export const MAX_CONNECTION_LEASE_MS = 15 * 60_000;
export const registryTime = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 0 &&
  Number.isFinite(new Date(value).getTime());
export const registryHash = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}(?![\s\S])/.test(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_+=/-]{1,128}(?![\s\S])/.test(value);
const fail = (status = 503): never => {
  throw new CloudServerError("connection-registry-unavailable", status);
};
function exact(
  input: unknown,
  keys: string[],
): asserts input is Record<string, unknown> {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(input, key))
  )
    fail();
}
export function registryTarget(arn: unknown, domain: unknown) {
  if (
    typeof arn !== "string" ||
    arn.length > 512 ||
    !/^arn:(aws|aws-cn|aws-us-gov):execute-api:[a-z0-9-]{1,64}:[0-9]{12}:[a-z0-9]{1,64}\/[A-Za-z0-9_$-]{1,128}\/\$connect(?![\s\S])/.test(
      arn,
    ) ||
    typeof domain !== "string" ||
    domain.length > 253 ||
    !domain ||
    domain
      .split(".")
      .some(
        (label) =>
          !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?![\s\S])/.test(label),
      )
  )
    fail();
}
export interface CloudConnectionRecord {
  version: 1;
  registrationId: string;
  connectArn: string;
  gatewayDomain: string;
  connectionId: string;
  sessionHash: string;
  sessionIssuedAt: number;
  sessionExpiresAt: number;
  scope: CloudScope;
  registeredAt: number;
  expiresAt: number;
}
export function validateCloudConnectionRecord(
  input: CloudConnectionRecord,
): CloudConnectionRecord {
  try {
    exact(input, [
      "version",
      "registrationId",
      "connectArn",
      "gatewayDomain",
      "connectionId",
      "sessionHash",
      "sessionIssuedAt",
      "sessionExpiresAt",
      "scope",
      "registeredAt",
      "expiresAt",
    ]);
    exact(input.scope, [
      "version",
      "ownerSubject",
      "collectionId",
      "modeGeneration",
    ]);
    const value = structuredClone(input);
    registryTarget(value.connectArn, value.gatewayDomain);
    if (
      value.version !== 1 ||
      !registryHash(value.registrationId) ||
      !registryHash(value.sessionHash) ||
      !id(value.connectionId) ||
      !registryTime(value.sessionIssuedAt) ||
      !registryTime(value.sessionExpiresAt) ||
      !registryTime(value.registeredAt) ||
      !registryTime(value.expiresAt) ||
      value.registeredAt < value.sessionIssuedAt ||
      value.expiresAt <= value.registeredAt ||
      value.expiresAt > value.sessionExpiresAt ||
      value.expiresAt - value.registeredAt > MAX_CONNECTION_LEASE_MS
    )
      fail();
    value.scope = validateCloudScope(value.scope);
    // Canonical field order supports exact conditional persistence independent of input key order.
    return {
      version: 1,
      registrationId: value.registrationId,
      connectArn: value.connectArn,
      gatewayDomain: value.gatewayDomain,
      connectionId: value.connectionId,
      sessionHash: value.sessionHash,
      sessionIssuedAt: value.sessionIssuedAt,
      sessionExpiresAt: value.sessionExpiresAt,
      scope: {
        version: 1,
        ownerSubject: value.scope.ownerSubject,
        collectionId: value.scope.collectionId,
        modeGeneration: value.scope.modeGeneration,
      },
      registeredAt: value.registeredAt,
      expiresAt: value.expiresAt,
    };
  } catch {
    return fail();
  }
}
export interface CloudConnectionRegistryStore {
  insert(record: CloudConnectionRecord, now: number): Promise<boolean>;
  read(
    connectArn: string,
    gatewayDomain: string,
    connectionId: string,
    now: number,
  ): Promise<CloudConnectionRecord | null>;
  remove(record: CloudConnectionRecord, now: number): Promise<boolean>;
  close(): Promise<void>;
}
export function registryPath(path: string) {
  if (
    typeof path !== "string" ||
    !path ||
    !isAbsolute(path) ||
    resolve(path) !== path
  )
    fail();
}
const freeze = (
  record: CloudConnectionRecord,
): Readonly<CloudConnectionRecord> => {
  Object.freeze(record.scope);
  return Object.freeze(record);
};

/** Trusted server metadata boundary; not an invocation or continuing publication authority. */
export class CloudConnectionRegistry {
  private config: {
    connectArn: string;
    gatewayDomain: string;
    leaseMs: number;
  };
  private readSession: CloudWebSessionStore["read"];
  private libraryContext: (subject: string) => Promise<CloudScope>;
  private insert: CloudConnectionRegistryStore["insert"];
  private read: CloudConnectionRegistryStore["read"];
  private drop: CloudConnectionRegistryStore["remove"];
  private wall = 0;
  constructor(
    config: { connectArn: string; gatewayDomain: string; leaseMs: number },
    sessions: Pick<CloudWebSessionStore, "read">,
    library: { libraryContext(subject: string): Promise<CloudScope> },
    store: CloudConnectionRegistryStore,
    private clock = () => Date.now(),
  ) {
    try {
      exact(config, ["connectArn", "gatewayDomain", "leaseMs"]);
      this.config = structuredClone(config);
      registryTarget(this.config.connectArn, this.config.gatewayDomain);
      if (
        !Number.isSafeInteger(this.config.leaseMs) ||
        this.config.leaseMs < 1000 ||
        this.config.leaseMs > MAX_CONNECTION_LEASE_MS
      )
        fail();
      this.readSession = sessions.read.bind(sessions);
      this.libraryContext = library.libraryContext.bind(library);
      this.insert = store.insert.bind(store);
      this.read = store.read.bind(store);
      this.drop = store.remove.bind(store);
    } catch {
      throw Error("Invalid Cloud connection registry configuration");
    }
  }
  private now() {
    const at = this.clock();
    if (!registryTime(at) || at < this.wall) fail();
    this.wall = at;
    return at;
  }
  private target(record: CloudConnectionRecord) {
    if (
      record.connectArn !== this.config.connectArn ||
      record.gatewayDomain !== this.config.gatewayDomain
    )
      fail(403);
  }
  private active(
    record: CloudConnectionRecord,
    signal: AbortSignal,
    deadline = record.expiresAt,
  ) {
    signal.throwIfAborted();
    const at = this.now();
    if (at < record.registeredAt || at >= record.expiresAt || at >= deadline)
      fail(401);
  }
  private async policy(record: CloudConnectionRecord, signal: AbortSignal) {
    this.active(record, signal);
    const raw = await this.readSession(record.sessionHash);
    signal.throwIfAborted();
    if (!raw) fail(401);
    const session = validateCloudWebSession(raw!);
    if (
      session.idHash !== record.sessionHash ||
      session.subject !== record.scope.ownerSubject ||
      session.revoked ||
      session.issuedAt !== record.sessionIssuedAt ||
      session.expiresAt !== record.sessionExpiresAt
    )
      fail(401);
    const scope = await this.libraryContext(session.subject);
    signal.throwIfAborted();
    assertCloudScope(validateCloudScope(scope), record.scope);
    const current = await this.readSession(record.sessionHash);
    signal.throwIfAborted();
    if (!current) fail(401);
    const checked = validateCloudWebSession(current!);
    if (
      (Object.keys(session) as (keyof typeof session)[]).some(
        (key) => session[key] !== checked[key],
      )
    )
      fail(401);
    this.active(record, signal);
  }
  private async retained(record: CloudConnectionRecord, signal: AbortSignal) {
    const raw = await this.read(
      record.connectArn,
      record.gatewayDomain,
      record.connectionId,
      this.now(),
    );
    signal.throwIfAborted();
    if (
      !raw ||
      JSON.stringify(validateCloudConnectionRecord(raw)) !==
        JSON.stringify(record)
    )
      fail(401);
    this.active(record, signal);
  }
  private failure(signal: AbortSignal, error: unknown): never {
    return fail(
      signal.aborted
        ? 409
        : error instanceof CloudServerError &&
            [400, 401, 403, 409, 410, 429, 503].includes(error.status)
          ? error.status
          : 503,
    );
  }
  async register(
    input: Readonly<Record<string, string>>,
    originalConnectionId: string,
    signal: AbortSignal,
  ): Promise<Readonly<CloudConnectionRecord>> {
    let attempted: CloudConnectionRecord | undefined;
    try {
      signal.throwIfAborted();
      exact(input, [
        "scopeVersion",
        "ownerSubject",
        "collectionId",
        "modeGeneration",
        "sessionHash",
        "ticketExpiresAt",
        "connectionId",
        "protocol",
      ]);
      const admission = structuredClone(input);
      if (
        Object.values(admission).some((value) => typeof value !== "string") ||
        admission.scopeVersion !== "1" ||
        admission.protocol !== CLOUD_WEBSOCKET_PROTOCOL ||
        !id(originalConnectionId) ||
        admission.connectionId !== originalConnectionId ||
        !registryHash(admission.sessionHash) ||
        !/^(0|[1-9][0-9]{0,15})(?![\s\S])/.test(admission.modeGeneration) ||
        !/^(0|[1-9][0-9]{0,15})(?![\s\S])/.test(admission.ticketExpiresAt)
      )
        fail(400);
      const scope = validateCloudScope({
        version: 1,
        ownerSubject: admission.ownerSubject,
        collectionId: admission.collectionId,
        modeGeneration: Number(admission.modeGeneration),
      });
      const deadline = Number(admission.ticketExpiresAt),
        at = this.now();
      if (!registryTime(deadline) || deadline <= at || deadline - at > 60_000)
        fail(401);
      const raw = await this.readSession(admission.sessionHash);
      signal.throwIfAborted();
      if (!raw) fail(401);
      const session = validateCloudWebSession(raw!),
        registeredAt = this.now();
      if (
        session.revoked ||
        session.idHash !== admission.sessionHash ||
        session.subject !== scope.ownerSubject ||
        registeredAt < session.issuedAt ||
        registeredAt >= session.expiresAt ||
        deadline > session.expiresAt
      )
        fail(401);
      const record = validateCloudConnectionRecord({
        version: 1,
        registrationId: randomBytes(32).toString("hex"),
        connectArn: this.config.connectArn,
        gatewayDomain: this.config.gatewayDomain,
        connectionId: originalConnectionId,
        sessionHash: session.idHash,
        sessionIssuedAt: session.issuedAt,
        sessionExpiresAt: session.expiresAt,
        scope,
        registeredAt,
        expiresAt: Math.min(
          registeredAt + this.config.leaseMs,
          session.expiresAt,
        ),
      });
      await this.policy(record, signal);
      this.active(record, signal, deadline);
      attempted = record;
      if (!(await this.insert(structuredClone(record), this.now()))) fail(429);
      await this.policy(record, signal);
      await this.retained(record, signal);
      this.active(record, signal, deadline);
      return freeze(record);
    } catch (error) {
      if (attempted) {
        try {
          await this.drop(structuredClone(attempted), this.now());
        } catch {
          /* Best effort exact cleanup; never return success. */
        }
      }
      return this.failure(signal, error);
    }
  }
  async resolve(
    originalConnectionId: string,
    expectedPublicationScope: CloudScope,
    signal: AbortSignal,
  ): Promise<Readonly<CloudConnectionRecord>> {
    try {
      signal.throwIfAborted();
      if (!id(originalConnectionId)) fail(400);
      exact(expectedPublicationScope, [
        "version",
        "ownerSubject",
        "collectionId",
        "modeGeneration",
      ]);
      const expected = validateCloudScope(
        structuredClone(expectedPublicationScope),
      );
      const raw = await this.read(
        this.config.connectArn,
        this.config.gatewayDomain,
        originalConnectionId,
        this.now(),
      );
      signal.throwIfAborted();
      if (!raw) fail(401);
      const record = validateCloudConnectionRecord(raw!);
      this.target(record);
      if (record.connectionId !== originalConnectionId) fail(401);
      assertCloudScope(expected, record.scope);
      await this.policy(record, signal);
      await this.retained(record, signal);
      this.active(record, signal);
      return freeze(record);
    } catch (error) {
      return this.failure(signal, error);
    }
  }
  async remove(
    input: CloudConnectionRecord,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      signal.throwIfAborted();
      const record = validateCloudConnectionRecord(input);
      this.target(record);
      const removed = await this.drop(record, this.now());
      signal.throwIfAborted();
      return removed;
    } catch (error) {
      return this.failure(signal, error);
    }
  }
}
