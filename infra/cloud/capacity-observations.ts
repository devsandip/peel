import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  assertCloudIdentityEnvironment,
  cloudIdentityCommandArgs,
  collectCloudIdentityObservation,
} from "./identity-observations.ts";

const execute = promisify(execFile),
  limit = 64 * 1024,
  deadlineMs = 90000;
type Input = { profile: string; region: string; authorizedUntil: string };
type Command = "capacity" | "caller-identity";
type Reader = (command: Command, signal: AbortSignal) => Promise<string>;
type Code =
  | "invalid-input"
  | "identity-not-ready"
  | "identity-mismatch"
  | "malformed-response"
  | "read-unavailable"
  | "unsupported-environment"
  | "clock-invalid"
  | "deadline";
class CapacityFailure extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud capacity observation unavailable");
    this.code = code;
  }
}
function fail(code: Code): never {
  throw new CapacityFailure(code);
}
const full = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.exec(value)?.[0] === value;
export function cloudCapacityCommandArgs(
  profile: string,
  command: Command,
): readonly string[] {
  if (!full(profile, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/))
    return fail("invalid-input");
  if (command === "caller-identity")
    return cloudIdentityCommandArgs(profile, command);
  if (command !== "capacity") return fail("invalid-input");
  return [
    "--profile",
    profile,
    "--region",
    "us-east-1",
    "--no-cli-pager",
    "--no-cli-auto-prompt",
    "--color",
    "off",
    "--cli-connect-timeout",
    "5",
    "--cli-read-timeout",
    "10",
    "lambda",
    "get-account-settings",
    "--endpoint-url",
    "https://lambda.us-east-1.amazonaws.com",
    "--query",
    "{UnreservedConcurrentExecutions:AccountLimit.UnreservedConcurrentExecutions}",
    "--output",
    "json",
  ];
}
function defaultReader(profile: string): Reader {
  try {
    assertCloudIdentityEnvironment(process.env);
  } catch {
    return fail("unsupported-environment");
  }
  const environment = {
    ...process.env,
    AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: "true",
    AWS_EC2_METADATA_DISABLED: "true",
    AWS_MAX_ATTEMPTS: "1",
    AWS_RETRY_MODE: "standard",
    AWS_PAGER: "",
    AWS_CLI_AUTO_PROMPT: "off",
  };
  return async (command, signal) => {
    const { stdout } = await execute(
      "aws",
      [...cloudCapacityCommandArgs(profile, command)],
      {
        signal,
        timeout: 15000,
        maxBuffer: limit,
        encoding: "utf8",
        windowsHide: true,
        env: environment,
      },
    );
    return stdout;
  };
}
function inputSnapshot(input: Input) {
  if (
    !input ||
    typeof input !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== 3
  )
    return fail("invalid-input");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(descriptors).sort().join() !==
      "authorizedUntil,profile,region" ||
    Object.values(descriptors).some((d) => !d.enumerable || !("value" in d))
  )
    return fail("invalid-input");
  const profile: unknown = descriptors.profile.value,
    region: unknown = descriptors.region.value,
    cutoff: unknown = descriptors.authorizedUntil.value;
  if (
    !full(profile, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/) ||
    region !== "us-east-1" ||
    !full(cutoff, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) ||
    !Number.isSafeInteger(Date.parse(cutoff)) ||
    new Date(cutoff).toISOString() !== cutoff
  )
    return fail("invalid-input");
  return Object.freeze({ profile, region, authorizedUntil: cutoff });
}
function json(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > limit)
    return fail("malformed-response");
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data))
      return fail("malformed-response");
    return data as Record<string, unknown>;
  } catch {
    return fail("malformed-response");
  }
}

/** Read-only capacity; no quota adjustment, reservation or deployment permission. */
export async function collectCloudCapacityObservation(
  input: Input,
  dependencies: {
    identity?: typeof collectCloudIdentityObservation;
    read?: Reader;
    clock?: () => number;
  } = {},
) {
  const clock = dependencies.clock ?? Date.now,
    controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined,
    timedOut = false;
  try {
    const captured = inputSnapshot(input),
      started = clock();
    if (!Number.isSafeInteger(started) || started < 0)
      return fail("clock-invalid");
    const work = async () => {
      const identity = await (
        dependencies.identity ?? collectCloudIdentityObservation
      )(captured);
      if (
        identity.kind !== "observed" ||
        !identity.summary.identityVerified ||
        !identity.summary.sessionActive
      )
        return fail("identity-not-ready");
      controller.signal.throwIfAborted();
      const read = dependencies.read ?? defaultReader(captured.profile);
      const quota = json(await read("capacity", controller.signal)),
        unreserved = quota.UnreservedConcurrentExecutions;
      if (
        Object.keys(quota).join() !== "UnreservedConcurrentExecutions" ||
        typeof unreserved !== "number" ||
        !Number.isSafeInteger(unreserved) ||
        unreserved < 0
      )
        return fail("malformed-response");
      controller.signal.throwIfAborted();
      const caller = json(await read("caller-identity", controller.signal)),
        prefix = `arn:aws:sts::${identity.expectedIdentity.accountId}:assumed-role/AWSReservedSSO_${identity.configuredRoleName}_`;
      if (
        Object.keys(caller).sort().join() !== "Account,Arn" ||
        caller.Account !== identity.expectedIdentity.accountId ||
        typeof caller.Arn !== "string" ||
        !caller.Arn.startsWith(prefix) ||
        !full(
          caller.Arn.slice(prefix.length),
          /^[a-f0-9]{16}\/[^/\r\n]{1,256}$/,
        )
      )
        return fail("identity-mismatch");
      const ended = clock();
      if (
        !Number.isSafeInteger(ended) ||
        ended < started ||
        ended - started > deadlineMs
      )
        return fail("clock-invalid");
      const cleanupBy = ended + 120 * 60000,
        cleanupRunwayReady =
          Date.parse(identity.credentials.sessionExpiresAt) >= cleanupBy &&
          Date.parse(captured.authorizedUntil) >= cleanupBy,
        capacityReady = unreserved >= 101;
      return Object.freeze({
        kind: "observed" as const,
        checkedAt: new Date(started).toISOString(),
        expectedIdentity: identity.expectedIdentity,
        identity: identity.identity,
        credentials: identity.credentials,
        unreservedConcurrency: unreserved,
        summary: Object.freeze({
          identityVerified: true as const,
          capacityReady,
          cleanupRunwayReady,
          code: capacityReady ? "capacity-available" : "insufficient-capacity",
        }),
        resourceWrites: 0 as const,
      });
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new CapacityFailure("deadline"));
      }, deadlineMs);
    });
    return await Promise.race([work(), timeout]);
  } catch (error) {
    controller.abort();
    return Object.freeze({
      kind: "unavailable" as const,
      code: timedOut
        ? "deadline"
        : error instanceof CapacityFailure
          ? error.code
          : "read-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
