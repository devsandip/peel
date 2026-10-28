import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  assertCloudIdentityEnvironment,
  cloudIdentityCommandArgs,
} from "./identity-observations.ts";

const execute = promisify(execFile),
  limit = 64 * 1024,
  deadlineMs = 45000;
const settings = [
  "configured-account",
  "configured-role",
  "credential-process",
  "assume-role",
  "web-identity",
] as const;
export type CloudInspectionCommand =
  "history-setting" | "caller-identity" | (typeof settings)[number];
type Reader = (
  command: CloudInspectionCommand,
  signal: AbortSignal,
) => Promise<string>;
type Input = { profile: string; accountId: string; region: "us-east-1" };
type Code =
  | "invalid-input"
  | "unsupported-environment"
  | "configuration-unavailable"
  | "history-not-disabled"
  | "unsupported-profile"
  | "identity-unavailable"
  | "identity-mismatch"
  | "clock-invalid"
  | "aborted"
  | "deadline";
class InspectionFailure extends Error {
  constructor(readonly code: Code) {
    super("Cloud inspection identity unavailable");
  }
}
function fail(code: Code): never {
  throw new InspectionFailure(code);
}
function object(value: unknown, keys: string[], code: Code) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail(code);
  const d = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length) return fail(code);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (!d[key]?.enumerable || !("value" in d[key])) return fail(code);
    result[key] = d[key].value;
  }
  return result;
}
function text(
  value: unknown,
  pattern: RegExp,
  max: number,
  code: Code,
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    pattern.exec(value)?.[0] !== value
  )
    return fail(code);
  return value;
}
function snapshot(value: Input): Readonly<Input> {
  const input = object(
    value,
    ["profile", "accountId", "region"],
    "invalid-input",
  );
  if (input.region !== "us-east-1") return fail("invalid-input");
  return Object.freeze({
    profile: text(
      input.profile,
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/,
      64,
      "invalid-input",
    ),
    accountId: text(input.accountId, /^\d{12}$/, 12, "invalid-input"),
    region: "us-east-1",
  });
}
/** This deliberately excludes export-credentials and all resource operations. */
export function cloudInspectionCommandArgs(
  profile: string,
  command: CloudInspectionCommand,
) {
  if (!["history-setting", "caller-identity", ...settings].includes(command))
    return fail("invalid-input");
  try {
    return cloudIdentityCommandArgs(profile, command);
  } catch {
    return fail("invalid-input");
  }
}
function defaultReader(profile: string): Reader {
  try {
    assertCloudIdentityEnvironment(process.env);
  } catch {
    return fail("unsupported-environment");
  }
  const env = {
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
      [...cloudInspectionCommandArgs(profile, command)],
      {
        signal,
        timeout: 15000,
        maxBuffer: limit,
        encoding: "utf8",
        windowsHide: true,
        env,
      },
    );
    return stdout;
  };
}
function optionalAbsent(command: CloudInspectionCommand, error: unknown) {
  if (
    ![
      "history-setting",
      "credential-process",
      "assume-role",
      "web-identity",
    ].includes(command) ||
    !error ||
    typeof error !== "object"
  )
    return false;
  const e = error as {
    code?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    killed?: unknown;
    signal?: unknown;
  };
  return (
    e.code === 1 &&
    e.stdout === "" &&
    e.stderr === "" &&
    e.killed !== true &&
    e.signal == null
  );
}
function validClock(time: number) {
  return (
    Number.isSafeInteger(time) &&
    time >= 0 &&
    Number.isFinite(new Date(time).getTime())
  );
}

/** Current identity for inspection, never a new-run runway or ownership decision. */
export async function collectCloudInspectionIdentity(
  input: Input,
  dependencies: {
    read?: Reader;
    clock?: () => number;
    signal?: AbortSignal;
  } = {},
) {
  const controller = new AbortController(),
    clock = dependencies.clock ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | undefined,
    listener: (() => void) | undefined,
    timedOut = false,
    aborted = false;
  try {
    const captured = snapshot(input),
      started = clock();
    if (!validClock(started)) return fail("clock-invalid");
    if (dependencies.signal?.aborted) return fail("aborted");
    const reader = dependencies.read ?? defaultReader(captured.profile);
    const read = async (command: CloudInspectionCommand) => {
      controller.signal.throwIfAborted();
      const code =
        command === "caller-identity"
          ? "identity-unavailable"
          : "configuration-unavailable";
      let raw: unknown;
      try {
        raw = await reader(command, controller.signal);
      } catch (error) {
        if (optionalAbsent(command, error)) raw = "";
        else return fail(code);
      }
      controller.signal.throwIfAborted();
      if (typeof raw !== "string" || Buffer.byteLength(raw) > limit)
        return fail(code);
      return raw;
    };
    const work = async () => {
      const line = (raw: string) => raw.replace(/\r?\n$/, "");
      const history = line(await read("history-setting"));
      if (history !== "" && history !== "disabled")
        return fail("history-not-disabled");
      const config = Object.fromEntries(
        await Promise.all(
          settings.map(async (kind) => [kind, line(await read(kind))]),
        ),
      );
      if (config["configured-account"] !== captured.accountId)
        return fail("identity-mismatch");
      const role = text(
        config["configured-role"],
        /^[A-Za-z0-9_+=,.@-]{1,32}$/,
        32,
        "configuration-unavailable",
      );
      if (
        ["credential-process", "assume-role", "web-identity"].some(
          (kind) => config[kind] !== "",
        )
      )
        return fail("unsupported-profile");
      let caller: Record<string, unknown>;
      try {
        caller = object(
          JSON.parse(await read("caller-identity")),
          ["Account", "Arn"],
          "identity-unavailable",
        );
      } catch (error) {
        if (error instanceof InspectionFailure) throw error;
        return fail("identity-unavailable");
      }
      const prefix = `arn:aws:sts::${captured.accountId}:assumed-role/AWSReservedSSO_${role}_`;
      if (
        caller.Account !== captured.accountId ||
        typeof caller.Arn !== "string" ||
        !caller.Arn.startsWith(prefix)
      )
        return fail("identity-mismatch");
      text(
        caller.Arn.slice(prefix.length),
        /^[a-f0-9]{16}\/[^/\r\n]{1,256}$/,
        273,
        "identity-mismatch",
      );
      const ended = clock();
      if (!validClock(ended) || ended < started || ended - started > deadlineMs)
        return fail("clock-invalid");
      controller.signal.throwIfAborted();
      return Object.freeze({
        kind: "observed" as const,
        checkedAt: new Date(started).toISOString(),
        expectedIdentity: captured,
        configuredRoleName: role,
        summary: Object.freeze({ identityVerified: true as const }),
        resourceWrites: 0 as const,
      });
    };
    const cancellation = new Promise<never>((_, reject) => {
      listener = () => {
        aborted = true;
        controller.abort();
        reject(new InspectionFailure("aborted"));
      };
      dependencies.signal?.addEventListener("abort", listener, { once: true });
      if (dependencies.signal?.aborted) listener();
    });
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new InspectionFailure("deadline"));
      }, deadlineMs);
    });
    return await Promise.race([work(), cancellation, deadline]);
  } catch (error) {
    controller.abort();
    return Object.freeze({
      kind: "unavailable" as const,
      code: timedOut
        ? "deadline"
        : aborted
          ? "aborted"
          : error instanceof InspectionFailure
            ? error.code
            : "identity-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (listener) dependencies.signal?.removeEventListener("abort", listener);
  }
}
