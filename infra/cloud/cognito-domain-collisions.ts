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
  | "metadata-unavailable"
  | "scope-mismatch"
  | "clock-invalid"
  | "aborted"
  | "deadline";
class DomainFailure extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud Cognito domain observation unavailable");
    this.code = code;
  }
}
const fail = (code: Code): never => {
  throw new DomainFailure(code);
};
const execute = promisify(execFile),
  limit = 65536;
function record(value: unknown, keys: string[], code: Code) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail(code);
  const d = Object.getOwnPropertyDescriptors(value),
    result: Record<string, unknown> = {};
  if (Reflect.ownKeys(value).length !== keys.length) return fail(code);
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
function capture(input: Input) {
  const data = record(
      input,
      ["profile", "inventory", "templates"],
      "invalid-input",
    ),
    profile = text(
      data.profile,
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/,
      64,
      "invalid-input",
    );
  try {
    const expected = cloudExpectedInventory(
        data.inventory as CloudInventoryInput,
        data.templates as string,
      ),
      domain = expected.stacks
        .find((s) => s.kind === "data")
        ?.resources.find((r) => r.logicalId === "CloudDomain");
    if (
      domain?.type !== "AWS::Cognito::UserPoolDomain" ||
      domain.identity.kind !== "name" ||
      domain.identity.name?.property !== "Domain"
    )
      return fail("invalid-input");
    const name = text(
      domain.identity.name.value,
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
      63,
      "invalid-input",
    );
    return { profile, expected, name };
  } catch {
    return fail("invalid-input");
  }
}

const projection =
  "{Shape:type(DomainDescription),Domain:DomainDescription.Domain,AccountId:DomainDescription.AWSAccountId,PoolId:DomainDescription.UserPoolId,Status:DomainDescription.Status}";
function command(captured: ReturnType<typeof capture>) {
  return Object.freeze([
    "--profile",
    captured.profile,
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
    "cognito-idp",
    "describe-user-pool-domain",
    "--endpoint-url",
    "https://cognito-idp.us-east-1.amazonaws.com",
    "--cli-input-json",
    JSON.stringify({ Domain: captured.name }),
    "--query",
    projection,
  ]);
}
/** Pure canonical selector and metadata projection; no endpoint or domain override. */
export function cloudCognitoDomainCommand(input: Input) {
  return command(capture(input));
}
function defaultRunner(): Runner {
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
function validClock(time: number) {
  return (
    Number.isSafeInteger(time) &&
    time >= 0 &&
    Number.isFinite(new Date(time).getTime())
  );
}
async function readMetadata(
  run: Runner,
  args: readonly string[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const operation = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined,
    abort: (() => void) | undefined;
  try {
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => {
        operation.abort();
        reject(new DomainFailure(signal.aborted ? "aborted" : "deadline"));
      };
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, 15000);
      if (signal.aborted) abort();
    });
    const response = record(
      await Promise.race([run(args, operation.signal), cancelled]),
      ["stdout", "stderr"],
      "metadata-unavailable",
    );
    signal.throwIfAborted();
    operation.signal.throwIfAborted();
    if (
      typeof response?.stdout !== "string" ||
      response.stderr !== "" ||
      Buffer.byteLength(response.stdout) > limit
    )
      return fail("metadata-unavailable");
    return record(
      JSON.parse(response.stdout),
      ["Shape", "Domain", "AccountId", "PoolId", "Status"],
      "metadata-unavailable",
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}

function notFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const d = Object.getOwnPropertyDescriptors(error),
    value = (key: string) => d[key]?.value;
  if (
    ["code", "stdout", "stderr", "killed", "signal"].some(
      (key) => d[key] && !("value" in d[key]),
    ) ||
    value("code") !== 254 ||
    value("stdout") !== "" ||
    (d.killed !== undefined && value("killed") !== false) ||
    value("signal") != null ||
    typeof value("stderr") !== "string" ||
    Buffer.byteLength(value("stderr")) > limit
  )
    return false;
  try {
    const data: unknown = JSON.parse(value("stderr"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return false;
    const code = (data as Record<string, unknown>).Code;
    return typeof code === "string" && code === "ResourceNotFoundException";
  } catch {
    return false;
  }
}

/** Partial prospective domain metadata, never full absence or creation ownership. */
export async function collectCloudCognitoDomain(
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
      started = clock();
    if (!validClock(started)) return fail("clock-invalid");
    if (dependencies.signal?.aborted) return fail("aborted");
    try {
      assertCloudIdentityEnvironment(process.env);
    } catch {
      return fail("unsupported-environment");
    }
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

      const firstRole = await identity();
      let state: "collision" | "not-found" | "not-described",
        ownerMatchesExpected: boolean | null = null;
      try {
        const data = await readMetadata(
          run,
          command(captured),
          controller.signal,
        );
        if (data.Shape !== "object" && data.Shape !== "null")
          return fail("metadata-unavailable");
        const values = [data.Domain, data.AccountId, data.PoolId, data.Status];
        if (values.every((value) => value === null)) state = "not-described";
        else {
          if (data.Shape !== "object" || values.some((value) => value === null))
            return fail("metadata-unavailable");
          if (data.Domain !== captured.name) return fail("scope-mismatch");
          const owner = text(
            data.AccountId,
            /^[0-9]{12}$/,
            12,
            "scope-mismatch",
          );
          text(data.PoolId, /^us-east-1_[0-9A-Za-z]+$/, 55, "scope-mismatch");
          if (
            !["CREATING", "DELETING", "UPDATING", "ACTIVE", "FAILED"].includes(
              data.Status as string,
            )
          )
            return fail("metadata-unavailable");
          state = "collision";
          ownerMatchesExpected = owner === captured.expected.accountId;
        }
      } catch (error) {
        controller.signal.throwIfAborted();
        if (error instanceof DomainFailure) throw error;
        if (!notFound(error)) return fail("metadata-unavailable");
        state = "not-found";
      }
      if ((await identity()) !== firstRole) return fail("identity-mismatch");
      const ended = clock();
      if (!validClock(ended) || ended < started || ended - started > 90000)
        return fail("clock-invalid");
      controller.signal.throwIfAborted();
      return Object.freeze({
        kind: "observed" as const,
        checkedAt: new Date(started).toISOString(),
        completedAt: new Date(ended).toISOString(),
        expectedIdentity: Object.freeze({
          profile: captured.profile,
          accountId: captured.expected.accountId,
          region: captured.expected.region,
        }),
        inventorySha256: captured.expected.inventorySha256,
        scope: "cognito-domain-prefix" as const,
        domain: Object.freeze({
          name: captured.name,
          state,
          ownerMatchesExpected,
        }),
        fullTargetAbsence: "unproven" as const,
        ownership: "unproven" as const,
        resourceWrites: 0 as const,
      });
    };
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => {
        aborted = true;
        controller.abort();
        reject(new DomainFailure("aborted"));
      };
      dependencies.signal?.addEventListener("abort", listener, { once: true });
      if (dependencies.signal?.aborted) listener();
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new DomainFailure("deadline"));
      }, 90000);
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
          : error instanceof DomainFailure
            ? error.code
            : "metadata-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (listener) dependencies.signal?.removeEventListener("abort", listener);
  }
}
