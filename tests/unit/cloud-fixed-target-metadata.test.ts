import { afterEach, expect, it, vi } from "vitest";
import {
  cloudFixedTargetCommands,
  collectCloudFixedTargets,
} from "../../infra/cloud/fixed-target-metadata.ts";
import { cloudFixedTargetFixture as fixture } from "../fixtures/cloud-fixed-target-pages.ts";

const unavailable = (code: string) => ({
  kind: "unavailable",
  code,
  resourceWrites: 0,
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("derives exactly eight scoped metadata commands without customer data, policies, values or configurable targets", () => {
  const f = fixture();
  expect(f.commands.map((c) => [c.stack, c.logicalId, c.kind])).toEqual([
    ["guard", "CloudDeletionRole", "role"],
    ["guard", "CleanupScheduleRole", "role"],
    ["data", "CloudExecutionRole", "role"],
    ["sentinel", "SentinelTable", "table"],
    ["data", "CloudTable", "table"],
    ["data", "CloudFunction", "function"],
    ["data", "CursorSecret", "secret"],
    ["guard", "CleanupGroup", "group"],
  ]);
  for (const c of f.commands) {
    expect(Object.isFrozen(c.args)).toBe(true);
    const args = c.args.join(" ");
    for (const forbidden of [
      "get-item",
      "get-secret-value",
      "get-function",
      "get-role",
      "get-schedule ",
      "AssumeRolePolicyDocument",
      "Environment.Variables",
      "Target.Input",
      "--debug",
      "--no-verify-ssl",
    ])
      expect(args).not.toContain(forbidden);
    expect(c.args).toContain("--no-paginate");
    expect(c.args).toContain("--cli-error-format");
    expect(c.args[c.args.indexOf("--cli-error-format") + 1]).toBe("json");
    expect(c.args[c.args.indexOf("--profile") + 1]).toBe("synthetic-dev");
    expect(c.args[c.args.indexOf("--endpoint-url") + 1]).toBe(
      c.kind === "role"
        ? "https://iam.amazonaws.com"
        : `https://${({ table: "dynamodb", function: "lambda", secret: "secretsmanager", group: "scheduler" } as Record<string, string>)[c.kind]}.us-east-1.amazonaws.com`,
    );
    if (c.kind === "table")
      expect(c.args[c.args.indexOf("--table-name") + 1]).toBe(
        `arn:aws:dynamodb:us-east-1:111122223333:table/${c.name}`,
      );
  }
  expect(Object.isFrozen(f.commands)).toBe(true);
});

it("records collisions for successful scope-valid metadata, including untagged successes, with no provider payload retained", async () => {
  const f = fixture(),
    result = await collectCloudFixedTargets(f.input, f);
  expect(result.kind).toBe("observed");
  if (result.kind !== "observed") throw Error("missing fixture result");
  expect(result.targets).toHaveLength(8);
  expect(result.targets.every((t) => t.state === "collision")).toBe(true);
  expect(result.fullTargetAbsence).toBe("unproven");
  expect(result.ownership).toBe("unproven");
  expect(result.inventorySha256).toBe(f.expected.inventorySha256);
  expect(f.run).toHaveBeenCalledTimes(8);
  expect(
    f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
  ).toHaveLength(2);
  for (const forbidden of [
    "private-session",
    "Ab12Cd",
    "Tags",
    "Policy",
    "Found",
    '"Arn"',
  ])
    expect(JSON.stringify(result)).not.toContain(forbidden);
  const frozen = (v: unknown) => {
    if (v && typeof v === "object") {
      expect(Object.isFrozen(v)).toBe(true);
      Object.values(v).forEach(frozen);
    }
  };
  frozen(result);
});

it("classifies exact structured process exceptions for all eight targets as not-found, never full absence or cleanup proof", async () => {
  const f = fixture();
  f.commands.forEach((c) => f.missing.add(c.logicalId));
  const result = await collectCloudFixedTargets(f.input, f);
  if (result.kind !== "observed") throw Error("missing not-found fixture");
  expect(result.targets.every((t) => t.state === "not-found")).toBe(true);
  expect(result.fullTargetAbsence).toBe("unproven");
  expect(result.scope).toBe("eight-fixed-non-bucket-targets");
  expect(JSON.stringify(result)).not.toMatch(
    /private-provider-message|private-value|Message|Extra/,
  );
  const mixed = fixture();
  mixed.missing.add("CloudTable");
  const both = await collectCloudFixedTargets(mixed.input, mixed);
  if (both.kind !== "observed") throw Error("missing mixed fixture");
  expect(
    both.targets.filter((t) => t.state === "not-found").map((t) => t.logicalId),
  ).toEqual(["CloudTable"]);
  expect(both.targets.filter((t) => t.state === "collision")).toHaveLength(7);
});

it("keeps wrong, denied, validation and malformed service errors unknown at the actual runner boundary", async () => {
  for (const targetId of [
    "CloudDeletionRole",
    "CloudTable",
    "CloudFunction",
    "CursorSecret",
    "CleanupGroup",
  ]) {
    const f = fixture(),
      base = f.run.getMockImplementation()!,
      target = f.commands.find((c) => c.logicalId === targetId)!;
    f.run.mockImplementation(async (args, signal) => {
      if (JSON.stringify(args) === JSON.stringify(target.args))
        throw {
          code: 254,
          stdout: "",
          stderr: JSON.stringify({
            Code:
              target.notFound === "NoSuchEntity"
                ? "ResourceNotFoundException"
                : "NoSuchEntity",
            Message: "private",
          }),
        };
      return base(args, signal);
    });
    expect(await collectCloudFixedTargets(f.input, f)).toEqual(
      unavailable("target-unavailable"),
    );
  }
  const normal = {
    code: 254,
    stdout: "",
    stderr: '{"Code":"NoSuchEntity","Message":"private"}',
  };
  for (const error of [
    { ...normal, code: "254" },
    { ...normal, code: 1 },
    { ...normal, stdout: "partial-private" },
    { ...normal, killed: true },
    { ...normal, signal: "SIGTERM" },
    { ...normal, stderr: '{"Code":"AccessDenied"}' },
    { ...normal, stderr: '{"Code":"ValidationError"}' },
    { ...normal, stderr: '{"Code":"NoSuchEntityException"}' },
    { ...normal, stderr: '{"Code":"NoSuchEntity\\n"}' },
    { ...normal, stderr: '[{"Code":"NoSuchEntity"}]' },
    { ...normal, stderr: "null" },
    { ...normal, stderr: 'prefix {"Code":"NoSuchEntity"}' },
    { ...normal, stderr: '{"Code":"NoSuchEntity"' },
    {
      ...normal,
      stderr: '{"Code":"NoSuchEntity","Message":"' + "x".repeat(65537) + '"}',
    },
  ]) {
    const f = fixture();
    f.run.mockRejectedValue(error);
    expect(await collectCloudFixedTargets(f.input, f)).toEqual(
      unavailable("target-unavailable"),
    );
    expect(f.run).toHaveBeenCalledTimes(1);
  }
});

it("rejects malformed success markers, partial output, stderr and private extra fields rather than accepting fabricated readiness", async () => {
  for (const response of [
    { stdout: "null", stderr: "" },
    { stdout: "true", stderr: "" },
    { stdout: '{"Found":false}', stderr: "" },
    { stdout: '{"Found":"true"}', stderr: "" },
    { stdout: '{"Found":true,"SecretString":"private"}', stderr: "" },
    { stdout: '{"Found":true}', stderr: "private-warning" },
    { stdout: "x".repeat(65537), stderr: "" },
  ]) {
    const f = fixture();
    f.run.mockResolvedValue(response);
    expect(await collectCloudFixedTargets(f.input, f)).toEqual(
      unavailable("target-unavailable"),
    );
  }
});

it("checks returned name and ARN account/region/type/suffix scope without publishing mismatched provider data", async () => {
  for (const targetId of [
    "CloudTable",
    "SentinelTable",
    "CursorSecret",
    "CleanupGroup",
  ]) {
    for (const change of [
      (data: any) => {
        data.Name += "-foreign";
      },
      (data: any) => {
        data.Arn = data.Arn.replace("111122223333", "222233334444");
      },
      (data: any) => {
        data.Arn = data.Arn.replace("us-east-1", "us-west-2");
      },
      (data: any) => {
        data.Arn += "\n";
      },
    ]) {
      const f = fixture(),
        base = f.run.getMockImplementation()!,
        target = f.commands.find((c) => c.logicalId === targetId)!;
      f.run.mockImplementation(async (args, signal) => {
        const response = await base(args, signal);
        if (JSON.stringify(args) === JSON.stringify(target.args)) {
          const data = JSON.parse(response.stdout);
          change(data);
          response.stdout = JSON.stringify(data);
        }
        return response;
      });
      expect(await collectCloudFixedTargets(f.input, f)).toEqual(
        unavailable("scope-mismatch"),
      );
    }
  }
});

it("uses current identity before and after metadata and rejects account/profile/role drift", async () => {
  const denied = fixture();
  denied.config["history-setting"] = "enabled";
  expect(await collectCloudFixedTargets(denied.input, denied)).toEqual(
    unavailable("identity-not-ready"),
  );
  expect(denied.run).not.toHaveBeenCalled();
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.caller.Account = "222233334444";
    },
    (f: ReturnType<typeof fixture>) => {
      f.config["configured-role"] = "Alternate";
      f.caller.Arn = f.caller.Arn.replace("SSO_Synthetic_", "SSO_Alternate_");
    },
  ]) {
    const f = fixture(),
      base = f.run.getMockImplementation()!;
    let count = 0;
    f.run.mockImplementation(async (args, signal) => {
      const response = await base(args, signal);
      if (++count === 8) change(f);
      return response;
    });
    expect(await collectCloudFixedTargets(f.input, f)).toEqual(
      unavailable(
        f.caller.Account === "111122223333"
          ? "identity-mismatch"
          : "identity-not-ready",
      ),
    );
  }
});

it("captures inputs before awaits and stamps the oldest observation while allowing expired-run metadata inspection", async () => {
  const f = fixture(),
    base = f.run.getMockImplementation()!,
    start = f.clock();
  let clocks = 0;
  f.clock = () => (clocks++ === 0 ? start : start + 60000);
  f.run.mockImplementation(async (args, signal) => {
    f.input.profile = "foreign";
    f.input.inventory.accountId = "222233334444";
    f.input.templates = "changed";
    return base(args, signal);
  });
  const result = await collectCloudFixedTargets(f.input, f);
  if (result.kind !== "observed") throw Error("missing captured result");
  expect(result.expectedIdentity).toEqual({
    profile: "synthetic-dev",
    accountId: "111122223333",
    region: "us-east-1",
  });
  expect(result.checkedAt).toBe(new Date(start).toISOString());
  expect(result.completedAt).toBe(new Date(start + 60000).toISOString());
  expect(result.targets).toHaveLength(8);
});

it("rejects invalid inputs, selectors and clocks before spawning the runner", async () => {
  const f = fixture(),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...f.input, profile: "invalid\nprofile" },
    { ...f.input, endpoint: "https://foreign.example" },
    { ...f.input, inventory: { ...f.input.inventory, region: "us-west-2" } },
    Object.defineProperty({ ...f.input }, "profile", { get: getter }),
  ])
    expect(await collectCloudFixedTargets(input as typeof f.input, f)).toEqual(
      unavailable("invalid-input"),
    );
  expect(getter).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  expect(() =>
    cloudFixedTargetCommands({ ...f.input, templates: "private-invalid" }),
  ).toThrow("Cloud fixed-target metadata unavailable");
  for (const start of [-1, NaN, Number.MAX_SAFE_INTEGER]) {
    const bad = fixture();
    bad.clock = () => start;
    expect(await collectCloudFixedTargets(bad.input, bad)).toEqual(
      unavailable("clock-invalid"),
    );
    expect(bad.run).not.toHaveBeenCalled();
  }
  for (const delta of [-1, 90001]) {
    const bad = fixture(),
      start = bad.clock();
    let n = 0;
    bad.clock = () => (n++ === 0 ? start : start + delta);
    expect(await collectCloudFixedTargets(bad.input, bad)).toEqual(
      unavailable("clock-invalid"),
    );
  }
});

it("aborts a stalled or late runner without continuing any target reads or identity rechecks", async () => {
  vi.useFakeTimers();
  for (const external of [true, false]) {
    const f = fixture(),
      controller = new AbortController();
    let release:
        ((value: { stdout: string; stderr: string }) => void) | undefined,
      runnerSignal: AbortSignal | undefined;
    f.run.mockImplementation(async (_args, signal) => {
      runnerSignal = signal;
      return await new Promise((resolve) => {
        release = resolve;
      });
    });
    const remove = vi.spyOn(controller.signal, "removeEventListener"),
      result = collectCloudFixedTargets(f.input, {
        ...f,
        signal: controller.signal,
      });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.run).toHaveBeenCalledTimes(1);
    if (external) controller.abort();
    else await vi.advanceTimersByTimeAsync(90001);
    expect(await result).toEqual(
      unavailable(external ? "aborted" : "deadline"),
    );
    expect(runnerSignal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalled();
    release!({ stdout: '{"Found":true}', stderr: "" });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(
      f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
    ).toHaveLength(1);
  }
  const f = fixture(),
    cancelled = new AbortController();
  cancelled.abort();
  expect(
    await collectCloudFixedTargets(f.input, { ...f, signal: cancelled.signal }),
  ).toEqual(unavailable("aborted"));
  expect(f.run).not.toHaveBeenCalled();
});

it("refuses default-runner environment overrides before any real CLI command", async () => {
  const f = fixture();
  vi.stubEnv("AWS_ENDPOINT_URL", "https://synthetic-override.example");
  expect(
    await collectCloudFixedTargets(f.input, { identity: f.identity }),
  ).toEqual(unavailable("unsupported-environment"));
  expect(f.read).not.toHaveBeenCalled();
});
