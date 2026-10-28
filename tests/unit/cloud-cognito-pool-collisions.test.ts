import { afterEach, expect, it, vi } from "vitest";
import {
  cloudCognitoPoolCommand,
  collectCloudCognitoPools,
} from "../../infra/cloud/cognito-pool-collisions.ts";
import { cloudStackFixture } from "../fixtures/cloud-stack-pages.ts";

const name = "peel-cloud-dev-00000000-0000-4000-8000-000000000001";
const row = (id = "us-east-1_Private1", Name = name) => ({ Id: id, Name });
function fixture(
  pages: Record<string, unknown>[] = [
    { NextToken: null, Count: 0, Matches: [] },
  ],
) {
  let page = 0;
  return {
    ...cloudStackFixture(),
    pages,
    run: vi.fn(async (_args: readonly string[], _signal: AbortSignal) => ({
      stdout: JSON.stringify(pages[page++]),
      stderr: "",
    })),
  };
}
const failure = (code: string) => ({
  kind: "unavailable",
  code,
  resourceWrites: 0,
});
const nativeInput = (args: readonly string[]) =>
  JSON.parse(args[args.indexOf("--cli-input-json") + 1]);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("derives one fixed metadata command with native service JSON instead of CLI paginator tokens", () => {
  const f = fixture(),
    first = cloudCognitoPoolCommand(f.input),
    next = cloudCognitoPoolCommand(f.input, "private-token");
  expect(nativeInput(first)).toEqual({ MaxResults: 60 });
  expect(nativeInput(next)).toEqual({
    MaxResults: 60,
    NextToken: "private-token",
  });
  expect(first[first.indexOf("--profile") + 1]).toBe("synthetic-dev");
  expect(first[first.indexOf("--region") + 1]).toBe("us-east-1");
  expect(first[first.indexOf("--endpoint-url") + 1]).toBe(
    "https://cognito-idp.us-east-1.amazonaws.com",
  );
  expect(first).toContain("--no-paginate");
  expect(first).toContain("list-user-pools");
  expect(first[first.indexOf("--query") + 1]).toBe(
    "{NextToken:NextToken,Count:length(UserPools),Matches:UserPools[?Name=='" +
      name +
      "'].{Id:Id,Name:Name}}",
  );
  for (const forbidden of [
    "--starting-token",
    "--max-items",
    "--page-size",
    "--next-token",
    "--max-results",
    "--debug",
    "--no-verify-ssl",
    "list-users",
    "describe-user-pool-client",
  ])
    expect(first).not.toContain(forbidden);
  expect(Object.isFrozen(first)).toBe(true);
  for (const invalid of ["", "bad\nvalue", "x".repeat(8193), 1, {}])
    expect(() => cloudCognitoPoolCommand(f.input, invalid as string)).toThrow();
});

it("finishes all native pages including an empty intermediate page and counts multiple matching names privately", async () => {
  const f = fixture([
    { NextToken: "private-next1", Count: 60, Matches: [row()] },
    { NextToken: "private-next2", Count: 0, Matches: [] },
    { NextToken: null, Count: 1, Matches: [row("us-east-1_Private2")] },
  ]);
  const result = await collectCloudCognitoPools(f.input, f);
  if (result.kind !== "observed") throw Error(JSON.stringify(result));
  expect(result.pool).toEqual({ name, matchingPools: 2, state: "collision" });
  expect(result).toMatchObject({
    scope: "cognito-pool-name-scan",
    inventorySha256: f.expected.inventorySha256,
    fullTargetAbsence: "unproven",
    ownership: "unproven",
    resourceWrites: 0,
  });
  expect(f.run.mock.calls.map(([args]) => nativeInput(args))).toEqual([
    { MaxResults: 60 },
    { MaxResults: 60, NextToken: "private-next1" },
    { MaxResults: 60, NextToken: "private-next2" },
  ]);
  expect(f.run.mock.calls.every(([args]) => Object.isFrozen(args))).toBe(true);
  expect(
    f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
  ).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(
    /private|Private|NextToken|Matches|LambdaConfig|"Id"/,
  );
  const frozen = (v: unknown) => {
    if (v && typeof v === "object") {
      expect(Object.isFrozen(v)).toBe(true);
      Object.values(v).forEach(frozen);
    }
  };
  frozen(result);
});

it("reports a completed empty scan only as not-listed and never converts process errors to absence", async () => {
  const f = fixture([
    { NextToken: "next", Count: 60, Matches: [] },
    { NextToken: null, Count: 1, Matches: [] },
  ]);
  const result = await collectCloudCognitoPools(f.input, f);
  if (result.kind !== "observed") throw Error("missing fixture");
  expect(result.pool).toEqual({ name, matchingPools: 0, state: "not-listed" });
  expect(result.fullTargetAbsence).toBe("unproven");
  expect(result.ownership).toBe("unproven");
  for (const Code of [
    "ResourceNotFoundException",
    "NotAuthorizedException",
    "TooManyRequestsException",
    "ValidationException",
  ]) {
    const bad = fixture();
    bad.run.mockRejectedValue({
      code: 254,
      stdout: "",
      stderr: JSON.stringify({ Code, Message: "private-provider-message" }),
    });
    expect(await collectCloudCognitoPools(bad.input, bad)).toEqual(
      failure("page-unavailable"),
    );
    expect(bad.run).toHaveBeenCalledTimes(1);
  }
});

it("refuses repeated tokens/IDs and incomplete bounded scans instead of returning partial matches", async () => {
  for (const pages of [
    [
      { NextToken: "same", Count: 0, Matches: [] },
      { NextToken: "same", Count: 0, Matches: [] },
    ],
    [
      { NextToken: "next", Count: 1, Matches: [row()] },
      { NextToken: null, Count: 1, Matches: [row()] },
    ],
    [{ NextToken: null, Count: 2, Matches: [row(), row()] }],
  ]) {
    const f = fixture(pages);
    expect(await collectCloudCognitoPools(f.input, f)).toEqual(
      failure("pagination-invalid"),
    );
    expect(f.run.mock.calls.length).toBeLessThanOrEqual(2);
  }
  for (const terminal of [false, true]) {
    const f = fixture();
    let page = 0;
    f.run.mockImplementation(async () => ({
      stdout: JSON.stringify({
        NextToken: ++page === 100 && terminal ? null : "page-" + page,
        Count: 0,
        Matches: [],
      }),
      stderr: "",
    }));
    const result = await collectCloudCognitoPools(f.input, f);
    expect(terminal ? result.kind : result).toEqual(
      terminal ? "observed" : failure("pagination-invalid"),
    );
    expect(f.run).toHaveBeenCalledTimes(100);
  }
});

it("rejects malformed/extra/oversized output and count inconsistencies without retaining payloads", async () => {
  for (const data of [
    null,
    [],
    { NextToken: null, Matches: [] },
    { NextToken: null, Count: 0, Matches: [], Private: "private" },
    { NextToken: null, Count: -1, Matches: [] },
    { NextToken: null, Count: 61, Matches: [] },
    { NextToken: null, Count: 0.5, Matches: [] },
    { NextToken: null, Count: "1", Matches: [] },
    { NextToken: null, Count: 0, Matches: [row()] },
    { NextToken: null, Count: 1, Matches: null },
    { NextToken: null, Count: 1, Matches: [{ ...row(), Extra: "private" }] },
  ]) {
    const f = fixture([data as Record<string, unknown>]);
    expect(await collectCloudCognitoPools(f.input, f)).toEqual(
      failure("page-unavailable"),
    );
    expect(f.run).toHaveBeenCalledTimes(1);
  }
  for (const response of [
    { stdout: "private malformed", stderr: "" },
    { stdout: "x".repeat(65537), stderr: "" },
    {
      stdout: JSON.stringify({ NextToken: null, Count: 0, Matches: [] }),
      stderr: "private warning",
    },
  ]) {
    const f = fixture();
    f.run.mockResolvedValue(response);
    expect(await collectCloudCognitoPools(f.input, f)).toEqual(
      failure("page-unavailable"),
    );
  }
});

it("validates returned token/name/ID scope before making another read", async () => {
  for (const NextToken of ["", "bad\nvalue", "x".repeat(8193), 1, {}]) {
    const f = fixture([{ NextToken, Count: 0, Matches: [] }]);
    expect(await collectCloudCognitoPools(f.input, f)).toEqual(
      failure("pagination-invalid"),
    );
    expect(f.run).toHaveBeenCalledTimes(1);
  }
  for (const value of [
    row("us-west-2_Private"),
    row("us-east-1_"),
    row("us-east-1_" + "x".repeat(46)),
    row("us-east-1_Private\n"),
    row("us-east-1_Private", "foreign-name"),
  ]) {
    const f = fixture([
      { NextToken: "private-next", Count: 1, Matches: [value] },
    ]);
    expect(await collectCloudCognitoPools(f.input, f)).toEqual(
      failure("scope-mismatch"),
    );
    expect(f.run).toHaveBeenCalledTimes(1);
  }
});

it("captures selectors before awaits and checks independently configured identity and role before/after", async () => {
  const f = fixture(),
    original = cloudCognitoPoolCommand(f.input);
  f.run.mockImplementation(async (args) => {
    expect(args).toEqual(original);
    f.input.profile = "foreign";
    f.input.inventory.accountId = "222233334444";
    f.input.inventory.runId = "changed";
    f.input.templates = "changed";
    return {
      stdout: JSON.stringify({ NextToken: null, Count: 0, Matches: [] }),
      stderr: "",
    };
  });
  const result = await collectCloudCognitoPools(f.input, f);
  if (result.kind !== "observed") throw Error("missing captured fixture");
  expect(result.expectedIdentity).toEqual({
    profile: "synthetic-dev",
    accountId: "111122223333",
    region: "us-east-1",
  });
  expect(result.pool.name).toBe(name);
  for (const role of [false, true]) {
    const drift = fixture();
    drift.run.mockImplementation(async () => {
      if (role) {
        drift.config["configured-role"] = "Alternate";
        drift.caller.Arn = drift.caller.Arn.replace(
          "SSO_Synthetic_",
          "SSO_Alternate_",
        );
      } else drift.caller.Account = "222233334444";
      return {
        stdout: JSON.stringify({ NextToken: null, Count: 0, Matches: [] }),
        stderr: "",
      };
    });
    expect(await collectCloudCognitoPools(drift.input, drift)).toEqual(
      failure(role ? "identity-mismatch" : "identity-not-ready"),
    );
  }
  const denied = fixture();
  denied.config["history-setting"] = "enabled";
  expect(await collectCloudCognitoPools(denied.input, denied)).toEqual(
    failure("identity-not-ready"),
  );
  expect(denied.run).not.toHaveBeenCalled();
});

it("rejects scope/getter/environment/clock errors and inspects an old run without new-run cutoff coupling", async () => {
  const f = fixture(),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...f.input, name: "foreign" },
    { ...f.input, profile: "bad\nprofile" },
    { ...f.input, inventory: { ...f.input.inventory, region: "us-west-2" } },
    Object.defineProperty({ ...f.input }, "templates", { get: getter }),
  ])
    expect(await collectCloudCognitoPools(input as typeof f.input, f)).toEqual(
      failure("invalid-input"),
    );
  expect(getter).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
  for (const time of [-1, NaN, Number.MAX_SAFE_INTEGER]) {
    const bad = fixture();
    bad.clock = () => time;
    expect(await collectCloudCognitoPools(bad.input, bad)).toEqual(
      failure("clock-invalid"),
    );
    expect(bad.run).not.toHaveBeenCalled();
  }
  for (const delta of [-1, 90001]) {
    const bad = fixture(),
      start = bad.clock();
    let n = 0;
    bad.clock = () => (n++ === 0 ? start : start + delta);
    expect(await collectCloudCognitoPools(bad.input, bad)).toEqual(
      failure("clock-invalid"),
    );
  }
  expect((await collectCloudCognitoPools(f.input, f)).kind).toBe("observed");
  vi.stubEnv(
    "AWS_ENDPOINT_URL_COGNITO_IDP",
    "https://synthetic-override.example",
  );
  expect(await collectCloudCognitoPools(f.input, f)).toEqual(
    failure("unsupported-environment"),
  );
});

it("cancels stalled native pages at the read bound and rejects late pages without more reads or identity work", async () => {
  vi.useFakeTimers();
  for (const external of [true, false]) {
    const f = fixture(),
      controller = new AbortController();
    let release: ((v: { stdout: string; stderr: string }) => void) | undefined,
      runnerSignal: AbortSignal | undefined;
    f.run.mockImplementation(async (_args, signal) => {
      runnerSignal = signal;
      return await new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = collectCloudCognitoPools(f.input, {
      ...f,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.run).toHaveBeenCalledTimes(1);
    if (external) controller.abort();
    else await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual(failure(external ? "aborted" : "deadline"));
    expect(runnerSignal?.aborted).toBe(true);
    release!({
      stdout: JSON.stringify({ NextToken: "late", Count: 0, Matches: [] }),
      stderr: "",
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(
      f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
    ).toHaveLength(1);
  }
});

it("pre-aborts and bounds a stalled final identity recheck without returning already collected matches", async () => {
  vi.useFakeTimers();
  const before = fixture(),
    controller = new AbortController();
  controller.abort();
  expect(
    await collectCloudCognitoPools(before.input, {
      ...before,
      signal: controller.signal,
    }),
  ).toEqual(failure("aborted"));
  expect(before.run).not.toHaveBeenCalled();
  expect(before.read).not.toHaveBeenCalled();
  const f = fixture([{ NextToken: null, Count: 1, Matches: [row()] }]);
  let calls = 0,
    release: ((v: Awaited<ReturnType<typeof f.identity>>) => void) | undefined;
  const identity: typeof f.identity = async (...args) =>
    ++calls === 1
      ? await f.identity(...args)
      : await new Promise((resolve) => {
          release = resolve;
        });
  const pending = collectCloudCognitoPools(f.input, { ...f, identity });
  await vi.advanceTimersByTimeAsync(90000);
  expect(await pending).toEqual(failure("deadline"));
  expect(f.run).toHaveBeenCalledTimes(1);
  release!(
    await f.identity({
      profile: "synthetic-dev",
      accountId: "111122223333",
      region: "us-east-1",
    }),
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toBe(2);
});
