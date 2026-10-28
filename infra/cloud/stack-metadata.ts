import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cloudDevStackNames } from "./cleanup.ts";
import {
  cloudExpectedInventory,
  type CloudInventoryInput,
} from "./expected-inventory.ts";
import { readHistoricalCloudInventory } from "./historical-inventory.ts";
import { assertCloudIdentityEnvironment } from "./identity-observations.ts";
import { collectCloudInspectionIdentity } from "./inspection-identity.ts";

const execute = promisify(execFile),
  limit = 64 * 1024,
  deadlineMs = 90000;
export type CloudStackCommand =
  | { kind: "stacks"; nextToken: string | null }
  | { kind: "tags"; stackId: string }
  | { kind: "resources"; stackId: string; nextToken: string | null };
type Reader = (
  command: CloudStackCommand,
  signal: AbortSignal,
) => Promise<string>;
type Input = {
  profile: string;
  inventory: CloudInventoryInput;
  templates: string;
};
type RetainedInput = {
  json: string;
  pin: Parameters<typeof readHistoricalCloudInventory>[1];
};
type Dependencies = {
  read?: Reader;
  clock?: () => number;
  identity?: typeof collectCloudInspectionIdentity;
  signal?: AbortSignal;
};
type Scope = {
  profile: string;
  expected: ReturnType<typeof cloudExpectedInventory>;
  names: readonly string[];
  retainedManifestSha256?: string;
};
type Code =
  | "invalid-input"
  | "unsupported-environment"
  | "identity-not-ready"
  | "identity-mismatch"
  | "scope-mismatch"
  | "tag-scope-mismatch"
  | "malformed-response"
  | "page-incomplete"
  | "metadata-changed"
  | "read-unavailable"
  | "clock-invalid"
  | "deadline"
  | "aborted";
class StackFailure extends Error {
  readonly code: Code;
  constructor(code: Code) {
    super("Cloud stack metadata unavailable");
    this.code = code;
    Object.freeze(this);
  }
}
function fail(code: Code): never {
  throw new StackFailure(code);
}
function record(
  value: unknown,
  keys: readonly string[],
  code: Code = "malformed-response",
) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length) return fail(code);
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const d = descriptors[key];
    if (!d?.enumerable || !("value" in d)) return fail(code);
    result[key] = d.value;
  }
  return result;
}
function text(
  value: unknown,
  pattern: RegExp,
  max: number,
  code: Code = "malformed-response",
): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    pattern.exec(value)?.[0] !== value
  )
    return fail(code);
  return value;
}
function token(value: unknown): string | null {
  return value === null ? null : text(value, /^[^\x00-\x1f\x7f]+$/, 1024);
}
function stackName(id: unknown, accountId: string, names: readonly string[]) {
  const value = text(id, /^[!-~]+$/, 256, "scope-mismatch"),
    prefix = `arn:aws:cloudformation:us-east-1:${accountId}:stack/`,
    parts = value.startsWith(prefix)
      ? value.slice(prefix.length).split("/")
      : [];
  if (
    parts.length !== 2 ||
    !names.includes(parts[0]) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      parts[1],
    )
  )
    return fail("scope-mismatch");
  return parts[0];
}
const tagKeys = ["PeelProject", "PeelEnvironment", "PeelRun"];
/** Exact metadata projections. Never DescribeStacks, stack events/templates, values or resource writes. */
export function cloudStackCommandArgs(
  profile: string,
  accountId: string,
  runId: string,
  command: CloudStackCommand,
): readonly string[] {
  try {
    return scopedCommandArgs(
      profile,
      accountId,
      Object.values(cloudDevStackNames(runId)),
      command,
    );
  } catch {
    return fail("invalid-input");
  }
}
/** Original pinned selectors only; no current factory or arbitrary scope override. */
export function cloudRetainedStackCommandArgs(
  input: RetainedInput,
  command: CloudStackCommand,
): readonly string[] {
  try {
    const { profile, expected, names } = retainedScope(input);
    return scopedCommandArgs(profile, expected.accountId, names, command);
  } catch {
    return fail("invalid-input");
  }
}
function scopedCommandArgs(
  profile: string,
  accountId: string,
  names: readonly string[],
  command: CloudStackCommand,
): readonly string[] {
  try {
    text(profile, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/, 64, "invalid-input");
    text(accountId, /^\d{12}$/, 12, "invalid-input");
    if (!command || typeof command !== "object") return fail("invalid-input");
    const kind = Object.getOwnPropertyDescriptor(command, "kind")?.value;
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
    ];
    if (kind === "stacks") {
      const c = record(command, ["kind", "nextToken"], "invalid-input"),
        next = token(c.nextToken);
      return [
        ...common,
        "cloudformation",
        "list-stacks",
        "--endpoint-url",
        "https://cloudformation.us-east-1.amazonaws.com",
        "--cli-input-json",
        JSON.stringify(next === null ? {} : { NextToken: next }),
        "--query",
        `{NextToken:NextToken,Count:length(StackSummaries),Stacks:StackSummaries[?contains(\`${JSON.stringify(names)}\`,StackName)].{StackId:StackId,StackName:StackName,Status:StackStatus}}`,
      ];
    }
    if (kind !== "tags" && kind !== "resources") return fail("invalid-input");
    const c = record(
      command,
      kind === "tags" ? ["kind", "stackId"] : ["kind", "stackId", "nextToken"],
      "invalid-input",
    );
    stackName(c.stackId, accountId, names);
    if (kind === "tags")
      return [
        ...common,
        "resourcegroupstaggingapi",
        "get-resources",
        "--endpoint-url",
        "https://tagging.us-east-1.amazonaws.com",
        "--resource-arn-list",
        c.stackId as string,
        "--query",
        `{PaginationToken:PaginationToken,Mappings:ResourceTagMappingList[].{Arn:ResourceARN,Tags:Tags[?contains(\`${JSON.stringify(tagKeys)}\`,Key)]}}`,
      ];
    const next = token(c.nextToken);
    return [
      ...common,
      "cloudformation",
      "list-stack-resources",
      "--endpoint-url",
      "https://cloudformation.us-east-1.amazonaws.com",
      "--cli-input-json",
      JSON.stringify({
        StackName: c.stackId,
        ...(next === null ? {} : { NextToken: next }),
      }),
      "--query",
      "{NextToken:NextToken,Resources:StackResourceSummaries[].{LogicalId:LogicalResourceId,Type:ResourceType,PhysicalId:PhysicalResourceId,Status:ResourceStatus}}",
    ];
  } catch {
    return fail("invalid-input");
  }
}
function defaultReader({ profile, expected, names }: Scope): Reader {
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
      [...scopedCommandArgs(profile, expected.accountId, names, command)],
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
function json(raw: string, keys: string[]) {
  try {
    return record(JSON.parse(raw), keys);
  } catch {
    return fail("malformed-response");
  }
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function validClock(time: number) {
  return (
    Number.isSafeInteger(time) &&
    time >= 0 &&
    Number.isFinite(new Date(time).getTime())
  );
}
const stackStatuses = new Set(
  "CREATE_IN_PROGRESS CREATE_FAILED CREATE_COMPLETE ROLLBACK_IN_PROGRESS ROLLBACK_FAILED ROLLBACK_COMPLETE DELETE_IN_PROGRESS DELETE_FAILED DELETE_COMPLETE UPDATE_IN_PROGRESS UPDATE_COMPLETE_CLEANUP_IN_PROGRESS UPDATE_COMPLETE UPDATE_FAILED UPDATE_ROLLBACK_IN_PROGRESS UPDATE_ROLLBACK_FAILED UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS UPDATE_ROLLBACK_COMPLETE REVIEW_IN_PROGRESS IMPORT_IN_PROGRESS IMPORT_COMPLETE IMPORT_ROLLBACK_IN_PROGRESS IMPORT_ROLLBACK_FAILED IMPORT_ROLLBACK_COMPLETE".split(
    " ",
  ),
);
const resourceStatuses = new Set(
  "CREATE_IN_PROGRESS CREATE_FAILED CREATE_COMPLETE DELETE_IN_PROGRESS DELETE_FAILED DELETE_COMPLETE DELETE_SKIPPED UPDATE_IN_PROGRESS UPDATE_FAILED UPDATE_COMPLETE IMPORT_FAILED IMPORT_COMPLETE IMPORT_IN_PROGRESS IMPORT_ROLLBACK_IN_PROGRESS IMPORT_ROLLBACK_FAILED IMPORT_ROLLBACK_COMPLETE EXPORT_FAILED EXPORT_COMPLETE EXPORT_IN_PROGRESS EXPORT_ROLLBACK_IN_PROGRESS EXPORT_ROLLBACK_FAILED EXPORT_ROLLBACK_COMPLETE UPDATE_ROLLBACK_IN_PROGRESS UPDATE_ROLLBACK_COMPLETE UPDATE_ROLLBACK_FAILED ROLLBACK_IN_PROGRESS ROLLBACK_COMPLETE ROLLBACK_FAILED".split(
    " ",
  ),
);
function status(value: unknown, values: Set<string>) {
  if (typeof value !== "string" || !values.has(value))
    return fail("malformed-response");
  return value;
}
type StackSummary = { stackId: string; name: string; status: string };
type Resource = {
  logicalId: string;
  type: string;
  physicalId: string | null;
  status: string;
};
type CollectedStack = {
  kind: string;
  name: string;
  state: "not-listed" | "deleted-summary" | "listed";
  stackId: string | null;
  status: string | null;
  tags: Record<string, string> | null;
  resources: Resource[];
  missingLogicalIds: string[];
};

function scope(
  profile: string,
  expected: Scope["expected"],
  retainedManifestSha256?: string,
): Scope {
  // Keep the existing CLI query's name order, independent of current factories.
  const names = ["guard", "artifacts", "sentinel", "data"].map((kind) => {
    const found = expected.stacks.find((stack) => stack.kind === kind);
    if (!found) return fail("invalid-input");
    return found.name;
  });
  return {
    profile,
    expected,
    names: Object.freeze(names),
    retainedManifestSha256,
  };
}
function currentScope(input: Input): Scope {
  const captured = record(
      input,
      ["profile", "inventory", "templates"],
      "invalid-input",
    ),
    profile = text(
      captured.profile,
      /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/,
      64,
      "invalid-input",
    );
  try {
    return scope(
      profile,
      cloudExpectedInventory(
        captured.inventory as CloudInventoryInput,
        captured.templates as string,
      ),
    );
  } catch {
    return fail("invalid-input");
  }
}
function retainedScope(input: RetainedInput): Scope {
  const captured = record(input, ["json", "pin"], "invalid-input");
  try {
    const retained = readHistoricalCloudInventory(
      captured.json as string,
      captured.pin as RetainedInput["pin"],
    );
    return scope(retained.profile, retained.inventory, retained.manifestSha256);
  } catch {
    return fail("invalid-input");
  }
}
/** Point-in-time metadata only, including for expired-run inspection. Never ownership/absence authority. */
export function collectCloudStackMetadata(
  input: Input,
  dependencies: Dependencies = {},
) {
  return collect(() => currentScope(input), dependencies);
}
/** Observe original pinned expectations even after the current factories change. */
export function collectRetainedCloudStackMetadata(
  input: RetainedInput,
  dependencies: Dependencies = {},
) {
  return collect(() => retainedScope(input), dependencies);
}
async function collect(capture: () => Scope, dependencies: Dependencies) {
  const controller = new AbortController(),
    clock = dependencies.clock ?? Date.now,
    signal = dependencies.signal;
  let timer: ReturnType<typeof setTimeout> | undefined,
    onAbort: (() => void) | undefined,
    aborted = false,
    timedOut = false;
  try {
    if (signal?.aborted) return fail("aborted");
    const captured = capture(),
      { profile, expected, names, retainedManifestSha256 } = captured;
    const started = clock();
    if (!validClock(started)) return fail("clock-invalid");
    const reader = dependencies.read ?? defaultReader(captured);
    const read = async (command: CloudStackCommand) => {
      controller.signal.throwIfAborted();
      const raw = await reader(command, controller.signal);
      controller.signal.throwIfAborted();
      if (typeof raw !== "string" || Buffer.byteLength(raw) > limit)
        return fail("malformed-response");
      return raw;
    };
    const work = async () => {
      const identity = async () => {
        controller.signal.throwIfAborted();
        const result = await (
          dependencies.identity ?? collectCloudInspectionIdentity
        )(
          { profile, accountId: expected.accountId, region: expected.region },
          { signal: controller.signal },
        );
        controller.signal.throwIfAborted();
        if (
          result.kind !== "observed" ||
          result.summary.identityVerified !== true
        )
          return fail("identity-not-ready");
        if (
          result.expectedIdentity.profile !== profile ||
          result.expectedIdentity.accountId !== expected.accountId ||
          result.expectedIdentity.region !== expected.region
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
      const summaries = async () => {
        const found: StackSummary[] = [],
          seen = new Set<string>();
        let next: string | null = null,
          count = 0;
        for (let page = 0; page < 100; page++) {
          const data = json(await read({ kind: "stacks", nextToken: next }), [
            "NextToken",
            "Count",
            "Stacks",
          ]);
          if (
            !Number.isSafeInteger(data.Count) ||
            (data.Count as number) < 0 ||
            !Array.isArray(data.Stacks) ||
            data.Stacks.length > (data.Count as number)
          )
            return fail("malformed-response");
          count += data.Count as number;
          if (count > 10000 || data.Stacks.length > 4)
            return fail("page-incomplete");
          for (const value of data.Stacks) {
            const row = record(value, ["StackId", "StackName", "Status"]),
              name = stackName(row.StackId, expected.accountId, names);
            if (
              row.StackName !== name ||
              found.some((s) => s.name === name || s.stackId === row.StackId)
            )
              return fail("scope-mismatch");
            found.push({
              stackId: row.StackId as string,
              name,
              status: status(row.Status, stackStatuses),
            });
          }
          next = token(data.NextToken);
          if (next === null)
            return found.sort((a, b) => a.name.localeCompare(b.name));
          if (seen.has(next)) return fail("page-incomplete");
          seen.add(next);
        }
        return fail("page-incomplete");
      };
      const first = await summaries(),
        stacks: CollectedStack[] = [],
        physical = new Set<string>(),
        requiredTags: Record<string, string> = {
          PeelProject: "peel",
          PeelEnvironment: "synthetic-cloud-dev",
          PeelRun: expected.runId,
        };
      for (const target of expected.stacks) {
        const found = first.find((s) => s.name === target.name),
          expectedRows = target.resources;
        const result: CollectedStack = {
          kind: target.kind,
          name: target.name,
          state: found
            ? found.status === "DELETE_COMPLETE"
              ? "deleted-summary"
              : "listed"
            : "not-listed",
          stackId: found?.stackId ?? null,
          status: found?.status ?? null,
          tags: null,
          resources: [],
          missingLogicalIds: expectedRows.map((r) => r.logicalId),
        };
        stacks.push(result);
        if (!found || found.status === "DELETE_COMPLETE") continue;
        const tagData = json(
          await read({ kind: "tags", stackId: found.stackId }),
          ["PaginationToken", "Mappings"],
        );
        if (tagData.PaginationToken !== null && tagData.PaginationToken !== "")
          return fail("page-incomplete");
        if (!Array.isArray(tagData.Mappings) || tagData.Mappings.length !== 1)
          return fail("tag-scope-mismatch");
        const mapping = record(tagData.Mappings[0], ["Arn", "Tags"]);
        if (
          mapping.Arn !== found.stackId ||
          !Array.isArray(mapping.Tags) ||
          mapping.Tags.length !== 3
        )
          return fail("tag-scope-mismatch");
        const tags: Record<string, string> = {};
        for (const rawTag of mapping.Tags) {
          const tag = record(rawTag, ["Key", "Value"]);
          if (
            typeof tag.Key !== "string" ||
            !Object.hasOwn(requiredTags, tag.Key) ||
            Object.hasOwn(tags, tag.Key) ||
            tag.Value !== requiredTags[tag.Key]
          )
            return fail("tag-scope-mismatch");
          tags[tag.Key] = tag.Value as string;
        }
        result.tags = { ...requiredTags };
        let next: string | null = null;
        const seen = new Set<string>();
        for (let page = 0; page < 8; page++) {
          const data = json(
            await read({
              kind: "resources",
              stackId: found.stackId,
              nextToken: next,
            }),
            ["NextToken", "Resources"],
          );
          if (
            !Array.isArray(data.Resources) ||
            data.Resources.length + result.resources.length >
              expectedRows.length
          )
            return fail("malformed-response");
          for (const raw of data.Resources) {
            const row = record(raw, [
                "LogicalId",
                "Type",
                "PhysicalId",
                "Status",
              ]),
              rule = expectedRows.find((r) => r.logicalId === row.LogicalId);
            if (
              !rule ||
              row.Type !== rule.type ||
              result.resources.some((r) => r.logicalId === rule.logicalId)
            )
              return fail("scope-mismatch");
            const physicalId =
              row.PhysicalId === null
                ? null
                : text(row.PhysicalId, /^[!-~]+$/, 2048);
            if (physicalId !== null) {
              if (physicalId.startsWith("arn:")) {
                const parts = physicalId.split(":"),
                  service = (
                    {
                      S3: "s3",
                      IAM: "iam",
                      Scheduler: "scheduler",
                      DynamoDB: "dynamodb",
                      Cognito: "cognito-idp",
                      Lambda: "lambda",
                      SecretsManager: "secretsmanager",
                    } as Record<string, string>
                  )[rule.type.split("::")[1]];
                if (
                  parts.length < 6 ||
                  parts[1] !== "aws" ||
                  parts[2] !== service ||
                  parts[3] !==
                    (["s3", "iam"].includes(service) ? "" : "us-east-1") ||
                  parts[4] !== (service === "s3" ? "" : expected.accountId) ||
                  !parts.slice(5).join(":")
                )
                  return fail("scope-mismatch");
              }
              const key = rule.type + "\0" + physicalId;
              if (physical.has(key)) return fail("scope-mismatch");
              physical.add(key);
            }
            result.resources.push({
              logicalId: rule.logicalId,
              type: rule.type,
              physicalId,
              status: status(row.Status, resourceStatuses),
            });
          }
          next = token(data.NextToken);
          if (next === null) break;
          if (seen.has(next) || page === 7) return fail("page-incomplete");
          seen.add(next);
        }
        result.resources.sort((a, b) => a.logicalId.localeCompare(b.logicalId));
        result.missingLogicalIds = expectedRows
          .filter(
            (r) =>
              !result.resources.some(
                (found) => found.logicalId === r.logicalId,
              ),
          )
          .map((r) => r.logicalId);
        if (
          ["CREATE_COMPLETE", "UPDATE_COMPLETE", "IMPORT_COMPLETE"].includes(
            found.status,
          ) &&
          (result.missingLogicalIds.length ||
            result.resources.some((r) => r.physicalId === null))
        )
          return fail("page-incomplete");
      }
      if (JSON.stringify(await summaries()) !== JSON.stringify(first))
        return fail("metadata-changed");
      if ((await identity()) !== firstRole) return fail("identity-mismatch");
      const ended = clock();
      if (!validClock(ended) || ended < started || ended - started > deadlineMs)
        return fail("clock-invalid");
      return freeze({
        kind: "observed" as const,
        checkedAt: new Date(started).toISOString(),
        completedAt: new Date(ended).toISOString(),
        expectedIdentity: {
          profile,
          accountId: expected.accountId,
          region: expected.region,
        },
        inventorySha256: expected.inventorySha256,
        stacks,
        ownership: "unproven" as const,
        targetAbsence: "unproven" as const,
        resourceWrites: 0 as const,
        ...(retainedManifestSha256 === undefined
          ? {}
          : { retainedManifestSha256 }),
      });
    };
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => {
        aborted = true;
        controller.abort();
        reject(new StackFailure("aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new StackFailure("deadline"));
      }, deadlineMs);
    });
    return await Promise.race([cancelled, timeout, work()]);
  } catch (error) {
    controller.abort();
    return Object.freeze({
      kind: "unavailable" as const,
      code: aborted
        ? "aborted"
        : timedOut
          ? "deadline"
          : error instanceof StackFailure
            ? error.code
            : "read-unavailable",
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
