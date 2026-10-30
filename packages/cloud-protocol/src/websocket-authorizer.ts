import { validateCloudScope } from "./durable";
import type { CloudConnectionTickets } from "./connection-tickets";
import { CLOUD_SESSION_COOKIE } from "./web-session";
import {
  CLOUD_WEBSOCKET_PROTOCOL,
  cloudWebSocketTicket,
} from "./websocket-handshake";

export type CloudWebSocketDecision = Readonly<{
  principalId: string;
  policyDocument: Readonly<{
    Version: "2012-10-17";
    Statement: readonly Readonly<{
      Action: "execute-api:Invoke";
      Effect: "Allow" | "Deny";
      Resource: string;
    }>[];
  }>;
  context: Readonly<Record<string, string>>;
}>;
const bad = (): never => {
  throw Error("Cloud connection admission unavailable");
};
function object(raw: unknown, cap: number): Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
  )
    return bad();
  const keys = Reflect.ownKeys(raw);
  if (keys.length > cap || keys.some((key) => typeof key !== "string"))
    return bad();
  return raw as Record<string, unknown>;
}
function empty(raw: unknown) {
  if (
    raw !== null &&
    raw !== undefined &&
    Reflect.ownKeys(object(raw, 0)).length
  )
    bad();
}
function headers(single: unknown, multi: unknown) {
  const result = new Map<string, string>();
  let bytes = 0;
  for (const [raw, multiple] of [
    [single, false],
    [multi, true],
  ] as const) {
    if (raw === null || raw === undefined) continue;
    const seen = new Set<string>();
    for (const [name, original] of Object.entries(object(raw, 64))) {
      if (
        !name ||
        name.length > 128 ||
        !/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)
      )
        return bad();
      const key = name.toLowerCase();
      if (seen.has(key)) return bad();
      seen.add(key);
      const value = multiple
        ? Array.isArray(original) && original.length === 1
          ? original[0]
          : null
        : original;
      if (
        typeof value !== "string" ||
        value.length > 8192 ||
        !/^[\x09\x20-\x7e]*$/.test(value)
      )
        return bad();
      if (result.has(key)) {
        if (result.get(key) !== value) return bad();
      } else {
        bytes += key.length + value.length;
        if (bytes > 16384 || result.size >= 64) return bad();
        result.set(key, value);
      }
    }
  }
  return result;
}

/** Isolated REQUEST authorizer adapter; not an entrypoint, upgrade handler or provenance proof. */
export function createCloudWebSocketAuthorizer(
  input: { origin: string; connectArn: string; gatewayDomain: string },
  tickets: Pick<CloudConnectionTickets, "consume">,
): (
  event: unknown,
  originalSignal: AbortSignal,
) => Promise<CloudWebSocketDecision> {
  let origin: string, arn: string, domain: string, api: string, stage: string;
  let consume: CloudConnectionTickets["consume"];
  try {
    const config = structuredClone(input),
      keys = ["origin", "connectArn", "gatewayDomain"];
    if (
      Reflect.ownKeys(object(config, 3)).length !== 3 ||
      keys.some((key) => !Object.hasOwn(config, key))
    )
      return bad();
    const site = new URL(config.origin),
      gateway = new URL("https://" + config.gatewayDomain),
      match =
        /^arn:(aws|aws-cn|aws-us-gov):execute-api:([a-z0-9-]{1,64}):([0-9]{12}):([a-z0-9]{1,64})\/([A-Za-z0-9_$-]{1,128})\/\$connect$/.exec(
          config.connectArn,
        );
    if (
      site.protocol !== "https:" ||
      site.origin !== config.origin ||
      site.username ||
      site.password ||
      typeof config.connectArn !== "string" ||
      config.connectArn.length > 512 ||
      !match ||
      typeof config.gatewayDomain !== "string" ||
      config.gatewayDomain.length > 253 ||
      gateway.hostname !== config.gatewayDomain ||
      gateway.origin !== "https://" + config.gatewayDomain ||
      config.gatewayDomain
        .split(".")
        .some(
          (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
        ) ||
      typeof tickets?.consume !== "function"
    )
      return bad();
    origin = site.origin;
    arn = config.connectArn;
    domain = config.gatewayDomain;
    api = match[4];
    stage = match[5];
    consume = tickets.consume.bind(tickets);
  } catch {
    throw Error("Invalid Cloud connection authorizer configuration");
  }
  const decision = (
    principalId: string,
    effect: "Allow" | "Deny",
    context: Record<string, string>,
  ): CloudWebSocketDecision =>
    Object.freeze({
      principalId,
      policyDocument: Object.freeze({
        Version: "2012-10-17" as const,
        Statement: Object.freeze([
          Object.freeze({
            Action: "execute-api:Invoke" as const,
            Effect: effect,
            Resource: arn,
          }),
        ]),
      }),
      context: Object.freeze(context),
    });
  const denied = decision("unavailable", "Deny", {});
  return async (raw, signal) => {
    try {
      signal.throwIfAborted();
      const event = object(raw, 32),
        context = object(event.requestContext, 64);
      if (
        event.type !== "REQUEST" ||
        event.methodArn !== arn ||
        context.routeKey !== "$connect" ||
        context.eventType !== "CONNECT" ||
        context.apiId !== api ||
        context.stage !== stage ||
        context.domainName !== domain ||
        (event.httpMethod !== undefined && event.httpMethod !== "GET") ||
        (context.httpMethod !== undefined && context.httpMethod !== "GET") ||
        (event.body !== null && event.body !== undefined) ||
        event.isBase64Encoded === true ||
        (event.rawQueryString !== undefined && event.rawQueryString !== "")
      )
        return denied;
      empty(event.queryStringParameters);
      empty(event.multiValueQueryStringParameters);
      empty(event.pathParameters);
      for (const path of [event.path, event.rawPath, context.path])
        if (
          path !== undefined &&
          (typeof path !== "string" || path.length > 2048 || /[?#]/.test(path))
        )
          return denied;
      const connectionId = context.connectionId;
      if (
        typeof connectionId !== "string" ||
        !/^[A-Za-z0-9_+=/-]{1,128}$/.test(connectionId)
      )
        return denied;
      const values = headers(event.headers, event.multiValueHeaders),
        cookie = values.get("cookie"),
        source = values.get("origin");
      if (
        source !== origin ||
        !cookie ||
        (values.has("host") && values.get("host")!.toLowerCase() !== domain)
      )
        return denied;
      const ticket = cloudWebSocketTicket(values.get("sec-websocket-protocol"));
      const secrets = [
        ticket,
        values.get("x-peel-csrf"),
        ...cookie
          .split(";")
          .map((part) => part.trim())
          .filter((part) => part.startsWith(CLOUD_SESSION_COOKIE + "="))
          .map((part) => part.slice(CLOUD_SESSION_COOKIE.length + 1)),
      ].filter(
        (value): value is string =>
          typeof value === "string" && value.length >= 16,
      );
      // A malformed envelope cannot reflect selected credentials as a connection identifier.
      if (secrets.some((secret) => connectionId.includes(secret)))
        return denied;
      const selected = new Headers({ origin: source, cookie });
      for (const name of ["sec-fetch-site", "x-peel-csrf"])
        if (values.has(name)) selected.set(name, values.get(name)!);
      signal.throwIfAborted();
      const grant = await consume(
        new Request(origin + "/internal/cloud-connect", {
          headers: selected,
          signal,
        }),
        ticket,
      );
      signal.throwIfAborted();
      const scope = validateCloudScope(grant.scope);
      if (
        typeof grant.sessionHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(grant.sessionHash) ||
        !Number.isSafeInteger(grant.expiresAt) ||
        grant.expiresAt <= 0 ||
        !Number.isFinite(new Date(grant.expiresAt).getTime())
      )
        return denied;
      const allowed = decision(scope.ownerSubject, "Allow", {
        scopeVersion: "1",
        ownerSubject: scope.ownerSubject,
        collectionId: scope.collectionId,
        modeGeneration: String(scope.modeGeneration),
        sessionHash: grant.sessionHash,
        ticketExpiresAt: String(grant.expiresAt),
        connectionId,
        protocol: CLOUD_WEBSOCKET_PROTOCOL,
      });
      if (secrets.some((secret) => JSON.stringify(allowed).includes(secret)))
        return denied;
      signal.throwIfAborted();
      return allowed;
    } catch {
      return denied;
    }
  };
}
