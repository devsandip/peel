import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile),
  deadlineMs = 45000,
  limit = 64 * 1024,
  minute = 60000;
type FailureCode =
  | "invalid-input"
  | "unsupported-environment"
  | "configuration-unavailable"
  | "unsupported-profile"
  | "history-not-disabled"
  | "identity-unavailable"
  | "identity-mismatch"
  | "credentials-unavailable"
  | "malformed-credentials"
  | "deadline"
  | "clock-invalid"
  | "authorization-window-too-short"
  | "read-unavailable";
class IdentityFailure extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode) {
    super("Cloud identity observation unavailable");
    this.code = code;
  }
}
const fail = (code: FailureCode): never => {
  throw new IdentityFailure(code);
};
const config = {
  "history-setting": "cli_history",
  "configured-account": "sso_account_id",
  "configured-role": "sso_role_name",
  "credential-process": "credential_process",
  "assume-role": "role_arn",
  "web-identity": "web_identity_token_file",
} as const;
export type CloudIdentityCommand =
  keyof typeof config | "caller-identity" | "session-expiration";
type Reader = (
  command: CloudIdentityCommand,
  signal: AbortSignal,
) => Promise<string>;
function full(value: unknown, regex: RegExp, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    regex.exec(value)?.[0] === value
  );
}
export function cloudIdentityCommandArgs(
  profile: string,
  command: CloudIdentityCommand,
): readonly string[] {
  if (!full(profile, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, 64))
    return fail("invalid-input");
  const common = [
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
  ];
  if (Object.hasOwn(config, command))
    return [
      ...common,
      "configure",
      "get",
      config[command as keyof typeof config],
    ];
  if (command === "caller-identity")
    return [
      ...common,
      "sts",
      "get-caller-identity",
      "--endpoint-url",
      "https://sts.us-east-1.amazonaws.com",
      "--output",
      "json",
      "--query",
      "{Account:Account,Arn:Arn}",
    ];
  if (command === "session-expiration")
    return [
      ...common,
      "configure",
      "export-credentials",
      "--format",
      "process",
    ];
  return fail("invalid-input");
}
export function assertCloudIdentityEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const forbidden = [
    "AWS_CONFIG_FILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
    "AWS_ROLE_ARN",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",
    "AWS_CLI_HISTORY_FILE",
  ];
  if (
    Object.keys(environment).some(
      (key) =>
        environment[key] &&
        (key === "AWS_ENDPOINT_URL" ||
          key.startsWith("AWS_ENDPOINT_URL_") ||
          forbidden.includes(key)),
    )
  )
    return fail("unsupported-environment");
}
function defaultReader(profile: string): Reader {
  assertCloudIdentityEnvironment(process.env);
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
    try {
      const { stdout } = await execute(
        "aws",
        [...cloudIdentityCommandArgs(profile, command)],
        {
          timeout: 15000,
          maxBuffer: limit,
          signal,
          encoding: "utf8",
          windowsHide: true,
          env: environment,
        },
      );
      return stdout;
    } catch (error) {
      // A missing optional local setting is the only accepted nonzero exit. Never retain errors.
      const e = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
      if (
        [
          "history-setting",
          "credential-process",
          "assume-role",
          "web-identity",
        ].includes(command) &&
        e.code === 1 &&
        e.stdout === "" &&
        e.stderr === ""
      )
        return "";
      return fail(
        command === "caller-identity"
          ? "identity-unavailable"
          : command === "session-expiration"
            ? "credentials-unavailable"
            : "configuration-unavailable",
      );
    }
  };
}
function bounded(value: unknown, code: FailureCode): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > limit)
    return fail(code);
  return value;
}
function line(value: string) {
  return value.replace(/\r?\n$/, "");
}
function json(value: string, code: FailureCode) {
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data))
      return fail(code);
    return data as Record<string, unknown>;
  } catch {
    return fail(code);
  }
}
function canonical(value: unknown): number {
  if (!full(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 24))
    return fail("invalid-input");
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== value)
    return fail("invalid-input");
  return time;
}
function sessionExpiry(data: Record<string, unknown>): string {
  const keys = [
    "Version",
    "AccessKeyId",
    "SecretAccessKey",
    "SessionToken",
    "Expiration",
    "AccountId",
  ];
  if (
    Object.keys(data).some((key) => !keys.includes(key)) ||
    data.Version !== 1 ||
    [data.AccessKeyId, data.SecretAccessKey, data.SessionToken].some(
      (value) => typeof value !== "string" || !value.length,
    )
  )
    return fail("malformed-credentials");
  const value = data.Expiration;
  if (
    !full(
      value,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/,
      40,
    )
  )
    return fail("malformed-credentials");
  const time = Date.parse(value),
    fraction = value.slice(19).match(/^\.(\d+)/)?.[1] ?? "";
  const expected =
    value.slice(0, 19) + "." + fraction.padEnd(3, "0").slice(0, 3) + "Z";
  if (!Number.isSafeInteger(time) || new Date(time).toISOString() !== expected)
    return fail("malformed-credentials");
  return expected;
}

/** Read-only SSO identity and direct lifetime. This does not prove refresh or authorize provisioning. */
export async function collectCloudIdentityObservation(
  input: { profile: string; region: string; authorizedUntil: string },
  dependencies: { read?: Reader; clock?: () => number } = {},
) {
  const clock = dependencies.clock ?? Date.now,
    controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined,
    identityVerified = false,
    deadlineReached = false;
  try {
    if (
      !input ||
      typeof input !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Reflect.ownKeys(input).some((key) => typeof key !== "string") ||
      Object.keys(input).sort().join() !== "authorizedUntil,profile,region" ||
      Reflect.ownKeys(input).length !== 3
    )
      return fail("invalid-input");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      Object.values(descriptors).some((d) => !d.enumerable || !("value" in d))
    )
      return fail("invalid-input");
    const profile: unknown = descriptors.profile.value,
      region: unknown = descriptors.region.value,
      authorizedUntil: unknown = descriptors.authorizedUntil.value;
    if (
      !full(profile, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, 64) ||
      region !== "us-east-1"
    )
      return fail("invalid-input");
    const cutoff = canonical(authorizedUntil),
      started = clock();
    if (!Number.isSafeInteger(started) || started < 0)
      return fail("clock-invalid");
    if (started + 120 * minute > cutoff)
      return fail("authorization-window-too-short");
    const read = dependencies.read ?? defaultReader(profile);
    const work = async () => {
      const history = line(
        bounded(
          await read("history-setting", controller.signal),
          "configuration-unavailable",
        ),
      );
      if (history !== "" && history !== "disabled")
        return fail("history-not-disabled");
      const settings = await Promise.all(
        (Object.keys(config) as (keyof typeof config)[])
          .filter((command) => command !== "history-setting")
          .map(
            async (command) =>
              [
                command,
                bounded(
                  await read(command, controller.signal),
                  "configuration-unavailable",
                ),
              ] as const,
          ),
      );
      const values = Object.fromEntries(settings),
        account = line(values["configured-account"]),
        role = line(values["configured-role"]);
      if (
        !full(account, /^\d{12}$/, 12) ||
        !full(role, /^[A-Za-z0-9_+=,.@-]{1,32}$/, 32)
      )
        return fail("configuration-unavailable");
      if (
        ["credential-process", "assume-role", "web-identity"].some(
          (key) => line(values[key]) !== "",
        )
      )
        return fail("unsupported-profile");
      const caller = json(
        bounded(
          await read("caller-identity", controller.signal),
          "identity-unavailable",
        ),
        "identity-unavailable",
      );
      if (
        Object.keys(caller).sort().join() !== "Account,Arn" ||
        caller.Account !== account ||
        typeof caller.Arn !== "string" ||
        caller.Arn.length > 2048
      )
        return fail("identity-mismatch");
      const prefix = `arn:aws:sts::${account}:assumed-role/AWSReservedSSO_${role}_`;
      if (
        !caller.Arn.startsWith(prefix) ||
        !full(
          caller.Arn.slice(prefix.length),
          /^[a-f0-9]{16}\/[^/\r\n]{1,256}$/,
          273,
        )
      )
        return fail("identity-mismatch");
      identityVerified = true;
      const credentials = json(
        bounded(
          await read("session-expiration", controller.signal),
          "malformed-credentials",
        ),
        "malformed-credentials",
      );
      if (
        credentials.AccountId !== undefined &&
        credentials.AccountId !== account
      )
        return fail("identity-mismatch");
      const sessionExpiresAt = sessionExpiry(credentials);
      delete credentials.AccessKeyId;
      delete credentials.SecretAccessKey;
      delete credentials.SessionToken;
      const ended = clock();
      if (
        !Number.isSafeInteger(ended) ||
        ended < started ||
        ended - started > deadlineMs
      )
        return fail("clock-invalid");
      const cleanupBy = ended + 120 * minute;
      if (cleanupBy > cutoff) return fail("authorization-window-too-short");
      const sessionActive = Date.parse(sessionExpiresAt) > ended,
        cleanupRunwayReady =
          sessionActive && Date.parse(sessionExpiresAt) >= cleanupBy;
      return Object.freeze({
        kind: "observed" as const,
        checkedAt: new Date(started).toISOString(),
        expectedIdentity: Object.freeze({
          profile,
          accountId: account,
          region: "us-east-1" as const,
        }),
        identity: Object.freeze({
          profile,
          accountId: caller.Account,
          region: "us-east-1" as const,
        }),
        configuredRoleName: role,
        credentials: Object.freeze({
          sessionExpiresAt,
          refreshExpiresAt: null,
          refreshProven: false as const,
        }),
        summary: Object.freeze({
          identityVerified: true as const,
          sessionActive,
          cleanupRunwayReady,
          code: !sessionActive
            ? "session-expired"
            : cleanupRunwayReady
              ? "direct-runway-ready"
              : "insufficient-direct-runway",
        }),
        projectedCleanupBy: new Date(cleanupBy).toISOString(),
        resourceWrites: 0 as const,
      });
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        deadlineReached = true;
        controller.abort();
        reject(new IdentityFailure("deadline"));
      }, deadlineMs);
    });
    return await Promise.race([work(), timeout]);
  } catch (error) {
    controller.abort();
    return Object.freeze({
      kind: "unavailable" as const,
      code: deadlineReached
        ? "deadline"
        : error instanceof IdentityFailure
          ? error.code
          : ("read-unavailable" as const),
      identityVerified,
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
