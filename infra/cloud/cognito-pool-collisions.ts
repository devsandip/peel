import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cloudExpectedInventory,
  type CloudInventoryInput,
} from "./expected-inventory.ts";
import { readHistoricalCloudInventory } from "./historical-inventory.ts";
import { collectCloudInspectionIdentity } from "./inspection-identity.ts";
import { assertCloudIdentityEnvironment } from "./identity-observations.ts";

type Input = {
  profile: string;
  inventory: CloudInventoryInput;
  templates: string;
};
type RetainedInput = {
  json: string;
  pin: Parameters<typeof readHistoricalCloudInventory>[1];
};
type Scope = {
  profile: string;
  expected: ReturnType<typeof cloudExpectedInventory>;
  name: string;
  retainedManifestSha256?: string;
};
type Dependencies = {
  run?: Runner;
  identity?: typeof collectCloudInspectionIdentity;
  clock?: () => number;
  signal?: AbortSignal;
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
  | "page-unavailable"
  | "pagination-invalid"
  | "scope-mismatch"
  | "clock-invalid"
  | "aborted"
  | "deadline";
class PoolFailure extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud Cognito pool observation unavailable");
    this.code = code;
    Object.freeze(this);
  }
}
const fail = (code: Code): never => {
  throw new PoolFailure(code);
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
function capture(input: Input): Scope {
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
    return scope(
      profile,
      cloudExpectedInventory(
        data.inventory as CloudInventoryInput,
        data.templates as string,
      ),
    );
  } catch {
    return fail("invalid-input");
  }
}
function scope(
  profile: string,
  expected: Scope["expected"],
  retainedManifestSha256?: string,
): Scope {
  const pool = expected.stacks
    .find((s) => s.kind === "data")
    ?.resources.find((r) => r.logicalId === "CloudUserPool");
  if (
    pool?.type !== "AWS::Cognito::UserPool" ||
    pool.identity.kind !== "provider" ||
    pool.identity.name?.property !== "UserPoolName"
  )
    return fail("invalid-input");
  const name = text(
    pool.identity.name.value,
    /^[a-z0-9-]+$/,
    128,
    "invalid-input",
  );
  return { profile, expected, name, retainedManifestSha256 };
}
function captureRetained(input: RetainedInput): Scope {
  const data = record(input, ["json", "pin"], "invalid-input");
  try {
    const retained = readHistoricalCloudInventory(
      data.json as string,
      data.pin as RetainedInput["pin"],
    );
    return scope(retained.profile, retained.inventory, retained.manifestSha256);
  } catch {
    return fail("invalid-input");
  }
}
function token(value: unknown): string | null {
  return value === null
    ? null
    : text(value, /^\S+$/, 8192, "pagination-invalid");
}
function command(
  captured: ReturnType<typeof capture>,
  nextToken: string | null,
) {
  const input = {
    MaxResults: 60,
    ...(nextToken === null ? {} : { NextToken: nextToken }),
  };
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
    "list-user-pools",
    "--endpoint-url",
    "https://cognito-idp.us-east-1.amazonaws.com",
    "--cli-input-json",
    JSON.stringify(input),
    "--query",
    "{NextToken:NextToken,Count:length(UserPools),Matches:UserPools[?Name=='" +
      captured.name +
      "'].{Id:Id,Name:Name}}",
  ]);
}
/** Pure first/next native page selector; the collector only follows returned service tokens. */
export function cloudCognitoPoolCommand(
  input: Input,
  nextToken: string | null = null,
) {
  return command(capture(input), token(nextToken));
}
/** Fixed native page command from original independently pinned selectors. */
export function cloudRetainedCognitoPoolCommand(
  input: RetainedInput,
  nextToken: string | null = null,
) {
  return command(captureRetained(input), token(nextToken));
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
async function readPage(
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
        reject(new PoolFailure(signal.aborted ? "aborted" : "deadline"));
      };
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(abort, 15000);
      if (signal.aborted) abort();
    });
    const response = await Promise.race([
      run(args, operation.signal),
      cancelled,
    ]);
    signal.throwIfAborted();
    operation.signal.throwIfAborted();
    if (
      typeof response?.stdout !== "string" ||
      response.stderr !== "" ||
      Buffer.byteLength(response.stdout) > limit
    )
      return fail("page-unavailable");
    return record(
      JSON.parse(response.stdout),
      ["NextToken", "Count", "Matches"],
      "page-unavailable",
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}

/** A bounded account/region scan is not full absence, an atomic snapshot or creation ownership. */
export function collectCloudCognitoPools(
  input: Input,
  dependencies: Dependencies = {},
) {
  return collect(() => capture(input), dependencies);
}
/** Original recipe expectations only; never creation ownership or atomic absence proof. */
export function collectRetainedCloudCognitoPools(
  input: RetainedInput,
  dependencies: Dependencies = {},
) {
  return collect(() => captureRetained(input), dependencies);
}
async function collect(captureScope: () => Scope, dependencies: Dependencies) {
  const controller = new AbortController(),
    clock = dependencies.clock ?? Date.now,
    signal = dependencies.signal;
  let timer: ReturnType<typeof setTimeout> | undefined,
    listener: (() => void) | undefined,
    timedOut = false,
    aborted = false;
  try {
    const captured = captureScope(),
      started = clock();
    if (!validClock(started)) return fail("clock-invalid");
    if (signal?.aborted) return fail("aborted");
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
      const firstRole = await identity(),
        seenTokens = new Set<string>(),
        matches = new Set<string>();
      let next: string | null = null,
        complete = false;
      for (let page = 0; page < 100; page++) {
        controller.signal.throwIfAborted();
        const data = await readPage(
          run,
          command(captured, next),
          controller.signal,
        );
        if (
          !Number.isInteger(data.Count) ||
          (data.Count as number) < 0 ||
          (data.Count as number) > 60 ||
          !Array.isArray(data.Matches) ||
          data.Matches.length > (data.Count as number)
        )
          return fail("page-unavailable");
        for (const raw of data.Matches) {
          const row = record(raw, ["Id", "Name"], "page-unavailable");
          if (row.Name !== captured.name) return fail("scope-mismatch");
          const id = text(
            row.Id,
            /^us-east-1_[0-9A-Za-z]+$/,
            55,
            "scope-mismatch",
          );
          if (matches.has(id)) return fail("pagination-invalid");
          matches.add(id);
        }
        next = token(data.NextToken);
        if (next === null) {
          complete = true;
          break;
        }
        if (seenTokens.has(next)) return fail("pagination-invalid");
        seenTokens.add(next);
      }
      if (!complete) return fail("pagination-invalid");
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
        scope: "cognito-pool-name-scan" as const,
        pool: Object.freeze({
          name: captured.name,
          matchingPools: matches.size,
          state: matches.size
            ? ("collision" as const)
            : ("not-listed" as const),
        }),
        fullTargetAbsence: "unproven" as const,
        ownership: "unproven" as const,
        resourceWrites: 0 as const,
        ...(captured.retainedManifestSha256 === undefined
          ? {}
          : { retainedManifestSha256: captured.retainedManifestSha256 }),
      });
    };
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => {
        aborted = true;
        controller.abort();
        reject(new PoolFailure("aborted"));
      };
      signal?.addEventListener("abort", listener, { once: true });
      if (signal?.aborted) listener();
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new PoolFailure("deadline"));
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
          : error instanceof PoolFailure
            ? error.code
            : "page-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (listener) signal?.removeEventListener("abort", listener);
  }
}
