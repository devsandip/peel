import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  cloudAuditCommercialRegions,
  collectCloudAuditRegions,
} from "./audit-regions.ts";
import {
  assertCloudIdentityEnvironment,
  cloudIdentityCommandArgs,
  collectCloudIdentityObservation,
} from "./identity-observations.ts";

const execute = promisify(execFile),
  limit = 64 * 1024,
  deadlineMs = 90000,
  commercialRegions = new Set<string>(cloudAuditCommercialRegions);
type Input = { profile: string; region: string; authorizedUntil: string };
export type CloudAuditCommand =
  | { kind: "organization" | "hooks" | "trails" | "caller-identity" }
  | { kind: "lake"; region: string };
export type CloudAuditFailureStage =
  | "registry"
  | "identity"
  | "organization"
  | "hooks"
  | "trails"
  | "lake"
  | "caller-identity";
type Reader = (
  command: CloudAuditCommand,
  signal: AbortSignal,
) => Promise<string>;
type Code =
  | "invalid-input"
  | "registry-not-ready"
  | "identity-not-ready"
  | "identity-mismatch"
  | "unsupported-environment"
  | "malformed-response"
  | "organization-unavailable"
  | "hooks-unavailable"
  | "trails-unavailable"
  | "lake-unavailable"
  | "lake-auth-unavailable"
  | "lake-access-denied"
  | "lake-unsupported"
  | "identity-recheck-unavailable"
  | "read-unavailable"
  | "deadline"
  | "clock-invalid";
type Reason =
  | "audit-absent"
  | "organization-coverage-unknown"
  | "hooks-require-review"
  | "hook-page-incomplete"
  | "trails-require-review"
  | "lake-requires-review"
  | "lake-page-incomplete";
type Visibility = "standalone" | "management" | "member";
const publicRegion = (value: unknown): string | null =>
  typeof value === "string" && commercialRegions.has(value) ? value : null;
function isAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === "AbortError" || candidate.code === "ABORT_ERR";
}
class AuditFailure extends Error {
  readonly code: Code;
  readonly stage: CloudAuditFailureStage | null;
  readonly region: string | null;
  constructor(
    code: Code,
    stage: CloudAuditFailureStage | null = null,
    region: string | null = null,
  ) {
    super("Cloud audit observation unavailable");
    this.code = code;
    this.stage = stage;
    this.region = publicRegion(region);
  }
  withContext(
    stage: CloudAuditFailureStage,
    region: string | null,
  ): AuditFailure {
    return this.stage === null
      ? new AuditFailure(this.code, stage, region)
      : this;
  }
}
function fail(
  code: Code,
  stage: CloudAuditFailureStage | null = null,
  region: string | null = null,
): never {
  throw new AuditFailure(code, stage, region);
}
const full = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.exec(value)?.[0] === value;
function snapshot(input: Input) {
  if (
    !input ||
    typeof input !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== 3
  )
    return fail("invalid-input");
  const d = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(d).sort().join() !== "authorizedUntil,profile,region" ||
    Object.values(d).some((v) => !v.enumerable || !("value" in v))
  )
    return fail("invalid-input");
  const profile: unknown = d.profile.value,
    region: unknown = d.region.value,
    cutoff: unknown = d.authorizedUntil.value;
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
function serviceError(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const e = error as {
    code?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    killed?: unknown;
    signal?: unknown;
  };
  if (
    e.code !== 254 ||
    e.stdout !== "" ||
    e.killed === true ||
    e.signal != null ||
    typeof e.stderr !== "string" ||
    Buffer.byteLength(e.stderr, "utf8") > limit
  )
    return null;
  // The fixed command pins JSON error formatting. Inspect only the structured code;
  // discard Message and any service-specific fields, which may contain private IDs.
  try {
    const data: unknown = JSON.parse(e.stderr);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const code = (data as Record<string, unknown>).Code;
    return full(code, /^[A-Za-z][A-Za-z0-9]{0,63}$/) ? code : null;
  } catch {
    return null;
  }
}
/** Only the precise service exception establishes standalone status. Never return raw CLI messages. */
export function cloudAuditStandaloneOrganization(error: unknown): boolean {
  return serviceError(error) === "AWSOrganizationsNotInUseException";
}
export function cloudAuditLakeFailure(error: unknown) {
  const code = serviceError(error);
  if (
    code === "UnrecognizedClientException" ||
    code === "InvalidClientTokenId" ||
    code === "ExpiredTokenException"
  )
    return "lake-auth-unavailable" as const;
  if (
    code === "AccessDeniedException" ||
    code === "InsufficientPermissionsException"
  )
    return "lake-access-denied" as const;
  if (code === "UnsupportedOperationException")
    return "lake-unsupported" as const;
  return "lake-unavailable" as const;
}
/** Fixed metadata-only commands, with small presence pages and explicit endpoints. */
export function cloudAuditCommandArgs(
  profile: string,
  command: CloudAuditCommand,
  regions: readonly string[],
): readonly string[] {
  if (!full(profile, /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/))
    return fail("invalid-input");
  if (command.kind === "caller-identity")
    return [
      ...cloudIdentityCommandArgs(profile, "caller-identity"),
      "--cli-error-format",
      "json",
    ];
  const region = command.kind === "lake" ? command.region : "us-east-1";
  if (
    !full(region, /^[a-z]{2}(?:-[a-z]+)+-\d+$/) ||
    region.length > 32 ||
    !regions.includes(region)
  )
    return fail("invalid-input");
  const common = [
    "--profile",
    profile,
    "--region",
    region,
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
  ];
  const countQuery = "{Count:length(TypeSummaries),NextToken:NextToken}";
  if (command.kind === "organization")
    return [
      ...common,
      "organizations",
      "describe-organization",
      "--endpoint-url",
      "https://organizations.us-east-1.amazonaws.com",
      "--query",
      "{ManagementAccountId:Organization.MasterAccountId}",
      "--output",
      "json",
    ];
  if (command.kind === "hooks")
    return [
      ...common,
      "cloudformation",
      "list-types",
      "--type",
      "HOOK",
      "--visibility",
      "PRIVATE",
      "--deprecated-status",
      "LIVE",
      "--max-results",
      "1",
      "--no-paginate",
      "--endpoint-url",
      "https://cloudformation.us-east-1.amazonaws.com",
      "--query",
      countQuery,
      "--output",
      "json",
    ];
  if (command.kind === "trails")
    return [
      ...common,
      "cloudtrail",
      "describe-trails",
      "--include-shadow-trails",
      "--endpoint-url",
      "https://cloudtrail.us-east-1.amazonaws.com",
      "--query",
      "{Count:length(trailList)}",
      "--output",
      "json",
    ];
  if (command.kind === "lake")
    return [
      ...common,
      "cloudtrail",
      "list-event-data-stores",
      "--max-results",
      "1",
      "--no-paginate",
      "--endpoint-url",
      `https://cloudtrail.${region}.amazonaws.com`,
      "--query",
      "{Count:length(EventDataStores),NextToken:NextToken}",
      "--output",
      "json",
    ];
  return fail("invalid-input");
}
function defaultReader(profile: string, regions: readonly string[]): Reader {
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
    signal.throwIfAborted();
    try {
      const { stdout } = await execute(
        "aws",
        [...cloudAuditCommandArgs(profile, command, regions)],
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
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw error;
      if (
        command.kind === "organization" &&
        cloudAuditStandaloneOrganization(error)
      )
        return '{"Standalone":true}';
      if (command.kind === "lake") return fail(cloudAuditLakeFailure(error));
      throw error;
    }
  };
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
function count(data: Record<string, unknown>, paginated: boolean) {
  if (
    Object.keys(data).sort().join() !==
      (paginated ? "Count,NextToken" : "Count") ||
    typeof data.Count !== "number" ||
    !Number.isSafeInteger(data.Count) ||
    data.Count < 0 ||
    (paginated && data.Count > 1) ||
    (paginated &&
      data.NextToken !== null &&
      (typeof data.NextToken !== "string" ||
        !data.NextToken.length ||
        data.NextToken.length > 1024))
  )
    return fail("malformed-response");
  return {
    present: data.Count > 0,
    complete: !paginated || data.NextToken === null,
  };
}
const paginatedCount = (data: Record<string, unknown>) => count(data, true);
const singleCount = (data: Record<string, unknown>) => count(data, false);

/** Configuration metadata only. Unknown coverage never establishes hook/data-event absence. */
export async function collectCloudAuditObservation(
  input: Input,
  dependencies: {
    identity?: typeof collectCloudIdentityObservation;
    regions?: typeof collectCloudAuditRegions;
    read?: Reader;
    clock?: () => number;
  } = {},
) {
  const clock = dependencies.clock ?? Date.now,
    controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined,
    timedOut = false,
    timedOutStage: CloudAuditFailureStage | null = null,
    activeStage: CloudAuditFailureStage | null = null,
    identityVerified = false;
  function abortCode(): Code {
    return timedOut ? "deadline" : "read-unavailable";
  }
  async function inStage<T>(
    stage: CloudAuditFailureStage,
    step: () => Promise<T>,
    region: string | null = null,
  ): Promise<T> {
    activeStage = stage;
    try {
      controller.signal.throwIfAborted();
      return await step();
    } catch (error) {
      if (error instanceof AuditFailure) {
        throw error.withContext(stage, region);
      }
      if (isAbort(error) || controller.signal.aborted) {
        return fail(abortCode(), stage, null);
      }
      return fail("read-unavailable", stage, region);
    } finally {
      activeStage = null;
    }
  }
  try {
    const captured = snapshot(input),
      started = clock();
    if (!Number.isSafeInteger(started) || started < 0)
      return fail("clock-invalid");
    const work = async () => {
      const matrix = await inStage("registry", async () => {
        const getRegions = dependencies.regions ?? collectCloudAuditRegions;
        const observed = await getRegions();
        if (observed.kind !== "observed") {
          return fail("registry-not-ready");
        }
        return observed;
      });
      const identity = await inStage(
        "identity",
        async () => {
          const getIdentity =
            dependencies.identity ?? collectCloudIdentityObservation;
          const observed = await getIdentity(captured);
          if (
            observed.kind !== "observed" ||
            !observed.summary.identityVerified ||
            !observed.summary.sessionActive
          ) {
            return fail("identity-not-ready");
          }
          return observed;
        },
        captured.region,
      );
      identityVerified = true;
      controller.signal.throwIfAborted();
      const reader =
        dependencies.read ??
        defaultReader(captured.profile, matrix.registry.regions);
      async function runCommand<T>(
        command: CloudAuditCommand,
        parse: (data: Record<string, unknown>) => T,
      ): Promise<T> {
        const stage: CloudAuditFailureStage = command.kind,
          region = publicRegion(
            command.kind === "lake" ? command.region : "us-east-1",
          );
        let raw: string;
        try {
          controller.signal.throwIfAborted();
          raw = await reader(command, controller.signal);
        } catch (error) {
          if (isAbort(error) || controller.signal.aborted) {
            return fail(abortCode(), stage, null);
          }
          if (error instanceof AuditFailure) {
            throw error.withContext(stage, region);
          }
          return fail(
            command.kind === "caller-identity"
              ? "identity-recheck-unavailable"
              : `${command.kind}-unavailable`,
            stage,
            region,
          );
        }
        try {
          return parse(json(raw));
        } catch (error) {
          if (error instanceof AuditFailure) {
            throw error.withContext(stage, region);
          }
          return fail("read-unavailable", stage, region);
        }
      }
      const visibility = await inStage<Visibility>(
        "organization",
        () =>
          runCommand({ kind: "organization" }, (organization) => {
            if (
              Object.keys(organization).join() === "Standalone" &&
              organization.Standalone === true
            ) {
              return "standalone";
            }
            if (
              Object.keys(organization).join() === "ManagementAccountId" &&
              full(organization.ManagementAccountId, /^\d{12}$/)
            ) {
              return organization.ManagementAccountId ===
                identity.expectedIdentity.accountId
                ? "management"
                : "member";
            }
            return fail("malformed-response");
          }),
        "us-east-1",
      );
      let hooks: "absent" | "unknown" = "unknown",
        targetDataEvents: "absent" | "unknown" = "unknown",
        code: Reason = "organization-coverage-unknown",
        hooksListed = false,
        trailsWithShadowsRead = false,
        lakeRegionsChecked = 0;
      if (visibility !== "member") {
        const hook = await inStage(
          "hooks",
          () => runCommand({ kind: "hooks" }, paginatedCount),
          "us-east-1",
        );
        hooksListed = true;
        if (hook.present) code = "hooks-require-review";
        else if (!hook.complete) code = "hook-page-incomplete";
        else {
          hooks = "absent";
          const trail = await inStage(
            "trails",
            () => runCommand({ kind: "trails" }, singleCount),
            "us-east-1",
          );
          trailsWithShadowsRead = true;
          if (trail.present) code = "trails-require-review";
          else {
            code = await inStage("lake", async (): Promise<Reason> => {
              for (
                let index = 0;
                index < matrix.registry.regions.length;
                index += 4
              ) {
                const batch = matrix.registry.regions.slice(index, index + 4);
                const results = await Promise.all(
                  batch.map((region) =>
                    runCommand({ kind: "lake", region }, paginatedCount),
                  ),
                );
                lakeRegionsChecked += results.length;
                if (results.some((r) => r.present)) {
                  return "lake-requires-review";
                }
                if (results.some((r) => !r.complete)) {
                  return "lake-page-incomplete";
                }
              }
              return "audit-absent";
            });
            if (code === "audit-absent") targetDataEvents = "absent";
          }
        }
      }
      await inStage(
        "caller-identity",
        () =>
          runCommand({ kind: "caller-identity" }, (caller) => {
            const prefix = `arn:aws:sts::${identity.expectedIdentity.accountId}:assumed-role/AWSReservedSSO_${identity.configuredRoleName}_`;
            if (
              Object.keys(caller).sort().join() !== "Account,Arn" ||
              caller.Account !== identity.expectedIdentity.accountId ||
              typeof caller.Arn !== "string" ||
              !caller.Arn.startsWith(prefix) ||
              !full(
                caller.Arn.slice(prefix.length),
                /^[a-f0-9]{16}\/[^/\r\n]{1,256}$/,
              )
            ) {
              return fail("identity-mismatch");
            }
          }),
        "us-east-1",
      );
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
          Date.parse(captured.authorizedUntil) >= cleanupBy;
      return Object.freeze({
        kind: "observed" as const,
        checkedAt: new Date(started).toISOString(),
        expectedIdentity: identity.expectedIdentity,
        identity: identity.identity,
        credentials: identity.credentials,
        registry: matrix.registry,
        safety: Object.freeze({ hooks, targetDataEvents }),
        coverage: Object.freeze({
          organization: visibility,
          hooksListed,
          trailsWithShadowsRead,
          lakeRegionsChecked,
          lakeComplete: targetDataEvents === "absent",
        }),
        summary: Object.freeze({
          identityVerified: true as const,
          hooksAbsent: hooks === "absent",
          dataEventsAbsent: targetDataEvents === "absent",
          auditReady: hooks === "absent" && targetDataEvents === "absent",
          cleanupRunwayReady,
          code,
        }),
        resourceWrites: 0 as const,
      });
    };
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        timedOutStage = activeStage;
        controller.abort();
        reject(new AuditFailure("deadline", timedOutStage, null));
      }, deadlineMs);
    });
    return await Promise.race([work(), timeout]);
  } catch (error) {
    controller.abort();
    const failure = timedOut
      ? new AuditFailure("deadline", timedOutStage, null)
      : error instanceof AuditFailure
        ? error
        : new AuditFailure("read-unavailable", activeStage, null);
    return Object.freeze({
      kind: "unavailable" as const,
      code: failure.code,
      stage: failure.stage,
      region: failure.region,
      identityVerified,
      resourceWrites: 0 as const,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
