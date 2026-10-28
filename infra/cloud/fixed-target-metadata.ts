import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cloudExpectedInventory,
  type CloudInventoryInput,
} from "./expected-inventory.ts";
import { collectCloudInspectionIdentity } from "./inspection-identity.ts";
import { assertCloudIdentityEnvironment } from "./identity-observations.ts";

type Input = {
  profile: string;
  inventory: CloudInventoryInput;
  templates: string;
};
type Runner = (
  args: readonly string[],
  signal: AbortSignal,
) => Promise<{ stdout: string; stderr: string }>;
type Code =
  | "invalid-input"
  | "unsupported-environment"
  | "identity-not-ready"
  | "identity-mismatch"
  | "target-unavailable"
  | "scope-mismatch"
  | "clock-invalid"
  | "aborted"
  | "deadline";
class TargetFailure extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud fixed-target metadata unavailable");
    this.code = code;
  }
}
const execute = promisify(execFile),
  limit = 64 * 1024,
  deadlineMs = 90000;
const fail = (code: Code): never => {
  throw new TargetFailure(code);
};
function record(value: unknown, keys: readonly string[], code: Code) {
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
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function capture(input: Input) {
  const value = record(
      input,
      ["profile", "inventory", "templates"],
      "invalid-input",
    ),
    profile = text(
      value.profile,
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/,
      64,
      "invalid-input",
    );
  try {
    return {
      profile,
      expected: cloudExpectedInventory(
        value.inventory as CloudInventoryInput,
        value.templates as string,
      ),
    };
  } catch {
    return fail("invalid-input");
  }
}
const selection = [
  ["guard", "CloudDeletionRole", "AWS::IAM::Role", "role"],
  ["guard", "CleanupScheduleRole", "AWS::IAM::Role", "role"],
  ["data", "CloudExecutionRole", "AWS::IAM::Role", "role"],
  ["sentinel", "SentinelTable", "AWS::DynamoDB::Table", "table"],
  ["data", "CloudTable", "AWS::DynamoDB::Table", "table"],
  ["data", "CloudFunction", "AWS::Lambda::Function", "function"],
  ["data", "CursorSecret", "AWS::SecretsManager::Secret", "secret"],
  ["guard", "CleanupGroup", "AWS::Scheduler::ScheduleGroup", "group"],
] as const;
function commands(
  profile: string,
  expected: ReturnType<typeof cloudExpectedInventory>,
) {
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
      "--cli-error-format",
      "json",
      "--no-paginate",
      "--output",
      "json",
    ],
    prefix = `arn:aws:`,
    regionAccount = `us-east-1:${expected.accountId}:`;
  return freeze(
    selection.map(([stack, logicalId, type, kind]) => {
      const resource = expected.stacks
        .find((s) => s.kind === stack)
        ?.resources.find((r) => r.logicalId === logicalId);
      if (!resource || resource.type !== type || !resource.identity.name)
        return fail("invalid-input");
      const name = resource.identity.name.value;
      const definitions = {
        role: {
          service: "iam",
          operation: "list-role-tags",
          endpoint: "https://iam.amazonaws.com",
          flag: "--role-name",
          selector: name,
          arn: null,
          query: "{Found:`true`}",
          notFound: "NoSuchEntity",
        },
        table: {
          service: "dynamodb",
          operation: "describe-table",
          endpoint: "https://dynamodb.us-east-1.amazonaws.com",
          flag: "--table-name",
          selector: prefix + "dynamodb:" + regionAccount + "table/" + name,
          arn: prefix + "dynamodb:" + regionAccount + "table/" + name,
          query: "{Arn:Table.TableArn,Name:Table.TableName}",
          notFound: "ResourceNotFoundException",
        },
        function: {
          service: "lambda",
          operation: "list-tags",
          endpoint: "https://lambda.us-east-1.amazonaws.com",
          flag: "--resource",
          selector: prefix + "lambda:" + regionAccount + "function:" + name,
          arn: null,
          query: "{Found:`true`}",
          notFound: "ResourceNotFoundException",
        },
        secret: {
          service: "secretsmanager",
          operation: "describe-secret",
          endpoint: "https://secretsmanager.us-east-1.amazonaws.com",
          flag: "--secret-id",
          selector: name,
          arn:
            prefix + "secretsmanager:" + regionAccount + "secret:" + name + "-",
          query: "{Arn:ARN,Name:Name}",
          notFound: "ResourceNotFoundException",
        },
        group: {
          service: "scheduler",
          operation: "get-schedule-group",
          endpoint: "https://scheduler.us-east-1.amazonaws.com",
          flag: "--name",
          selector: name,
          arn: prefix + "scheduler:" + regionAccount + "schedule-group/" + name,
          query: "{Arn:Arn,Name:Name}",
          notFound: "ResourceNotFoundException",
        },
      };
      const d = definitions[kind];
      return {
        stack,
        logicalId,
        type,
        name,
        kind,
        expectedArn: d.arn,
        notFound: d.notFound,
        args: [
          ...common,
          d.service,
          d.operation,
          "--endpoint-url",
          d.endpoint,
          d.flag,
          d.selector,
          "--query",
          d.query,
        ],
      };
    }),
  );
}
/** Pure fixed selectors/arguments. No target, endpoint or service can be supplied independently. */
export function cloudFixedTargetCommands(input: Input) {
  const captured = capture(input);
  return commands(captured.profile, captured.expected);
}
function defaultRunner(): Runner {
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
  return (args, signal) =>
    execute("aws", [...args], {
      signal,
      timeout: 15000,
      maxBuffer: limit,
      encoding: "utf8",
      windowsHide: true,
      env,
    });
}
function notFound(error: unknown, expected: string) {
  if (!error || typeof error !== "object") return false;
  const d = Object.getOwnPropertyDescriptors(error),
    value = (key: string) => d[key]?.value;
  if (
    value("code") !== 254 ||
    value("stdout") !== "" ||
    value("killed") === true ||
    value("signal") != null ||
    typeof value("stderr") !== "string" ||
    Buffer.byteLength(value("stderr")) > limit
  )
    return false;
  try {
    const data: unknown = JSON.parse(value("stderr"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const code = (data as Record<string, unknown>).Code;
    return typeof code === "string" && code === expected;
  } catch {
    return false;
  }
}
function validClock(time: number) {
  return (
    Number.isSafeInteger(time) &&
    time >= 0 &&
    Number.isFinite(new Date(time).getTime())
  );
}

/** Partial prospective collision evidence only; never all-target absence or old-run cleanup proof. */
export async function collectCloudFixedTargets(
  input: Input,
  dependencies: {
    run?: Runner;
    identity?: typeof collectCloudInspectionIdentity;
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
    const captured = capture(input),
      targets = commands(captured.profile, captured.expected),
      started = clock();
    if (!validClock(started)) return fail("clock-invalid");
    if (dependencies.signal?.aborted) return fail("aborted");
    const run = dependencies.run ?? defaultRunner();
    const work = async () => {
      const identity = async () => {
        controller.signal.throwIfAborted();
        const result = await (
          dependencies.identity ?? collectCloudInspectionIdentity
        )(
          {
            profile: captured.profile,
            accountId: captured.expected.accountId,
            region: captured.expected.region,
          },
          { signal: controller.signal },
        );
        controller.signal.throwIfAborted();
        if (
          result.kind !== "observed" ||
          result.summary.identityVerified !== true
        )
          return fail("identity-not-ready");
        if (
          result.expectedIdentity.profile !== captured.profile ||
          result.expectedIdentity.accountId !== captured.expected.accountId ||
          result.expectedIdentity.region !== captured.expected.region
        )
          return fail("identity-mismatch");
        return text(
          result.configuredRoleName,
          /^[A-Za-z0-9_+=,.@-]{1,32}$/,
          32,
          "identity-mismatch",
        );
      };
      const firstRole = await identity(),
        observations = [];
      for (const target of targets) {
        controller.signal.throwIfAborted();
        let state: "collision" | "not-found";
        try {
          const response = await run(target.args, controller.signal);
          controller.signal.throwIfAborted();
          if (
            typeof response?.stdout !== "string" ||
            response.stderr !== "" ||
            Buffer.byteLength(response.stdout) > limit
          )
            return fail("target-unavailable");
          let data: Record<string, unknown>;
          try {
            data = record(
              JSON.parse(response.stdout),
              target.expectedArn === null ? ["Found"] : ["Arn", "Name"],
              "target-unavailable",
            );
          } catch {
            return fail("target-unavailable");
          }
          if (target.expectedArn === null) {
            if (data.Found !== true) return fail("target-unavailable");
          } else {
            if (data.Name !== target.name || typeof data.Arn !== "string")
              return fail("scope-mismatch");
            if (target.kind === "secret") {
              if (!data.Arn.startsWith(target.expectedArn))
                return fail("scope-mismatch");
              text(
                data.Arn.slice(target.expectedArn.length),
                /^[A-Za-z0-9]{6}$/,
                6,
                "scope-mismatch",
              );
            } else if (data.Arn !== target.expectedArn)
              return fail("scope-mismatch");
          }
          state = "collision";
        } catch (error) {
          controller.signal.throwIfAborted();
          if (error instanceof TargetFailure) throw error;
          if (!notFound(error, target.notFound))
            return fail("target-unavailable");
          state = "not-found";
        }
        observations.push({
          stack: target.stack,
          logicalId: target.logicalId,
          type: target.type,
          name: target.name,
          state,
        });
      }
      if ((await identity()) !== firstRole) return fail("identity-mismatch");
      const ended = clock();
      if (!validClock(ended) || ended < started || ended - started > deadlineMs)
        return fail("clock-invalid");
      controller.signal.throwIfAborted();
      return freeze({
        kind: "observed" as const,
        checkedAt: new Date(started).toISOString(),
        completedAt: new Date(ended).toISOString(),
        expectedIdentity: {
          profile: captured.profile,
          accountId: captured.expected.accountId,
          region: captured.expected.region,
        },
        inventorySha256: captured.expected.inventorySha256,
        scope: "eight-fixed-non-bucket-targets" as const,
        targets: observations,
        fullTargetAbsence: "unproven" as const,
        ownership: "unproven" as const,
        resourceWrites: 0 as const,
      });
    };
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => {
        aborted = true;
        controller.abort();
        reject(new TargetFailure("aborted"));
      };
      dependencies.signal?.addEventListener("abort", listener, { once: true });
      if (dependencies.signal?.aborted) listener();
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new TargetFailure("deadline"));
      }, deadlineMs);
    });
    return await Promise.race([work(), cancelled, timeout]);
  } catch (error) {
    controller.abort();
    return Object.freeze({
      kind: "unavailable" as const,
      code: timedOut
        ? "deadline"
        : aborted
          ? "aborted"
          : error instanceof TargetFailure
            ? error.code
            : "target-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (listener) dependencies.signal?.removeEventListener("abort", listener);
  }
}
