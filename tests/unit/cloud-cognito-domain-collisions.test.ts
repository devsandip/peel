import { afterEach, expect, it, vi } from "vitest";
import {
  cloudCognitoDomainCommand,
  collectCloudCognitoDomain,
} from "../../infra/cloud/cognito-domain-collisions.ts";
import { cloudStackFixture } from "../fixtures/cloud-stack-pages.ts";

const name = "peel-cloud-dev-00000000-0000-4000-8000-000000000001-auth";
const metadata = () => ({
  Shape: "object",
  Domain: name,
  AccountId: "111122223333",
  PoolId: "us-east-1_Private1",
  Status: "ACTIVE",
});
const empty = (Shape = "null") => ({
  Shape,
  Domain: null,
  AccountId: null,
  PoolId: null,
  Status: null,
});
const response = (data: unknown) => ({
  stdout: JSON.stringify(data),
  stderr: "",
});
function fixture(data: unknown = metadata()) {
  return {
    ...cloudStackFixture(),
    run: vi.fn(async (_args: readonly string[], _signal: AbortSignal) =>
      response(data),
    ),
  };
}
const failure = (code: string) => ({
  kind: "unavailable",
  code,
  resourceWrites: 0,
});
const missing = () => ({
  code: 254,
  stdout: "",
  stderr: JSON.stringify({
    Code: "ResourceNotFoundException",
    Message: "private-message",
  }),
  killed: false,
  signal: null,
});
const nativeInput = (args: readonly string[]) =>
  JSON.parse(args[args.indexOf("--cli-input-json") + 1]);
const frozen = (value: unknown) => {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("derives one frozen canonical domain-prefix command with native service JSON and a shape-aware projection", () => {
  const f = fixture(),
    args = cloudCognitoDomainCommand(f.input);
  expect(nativeInput(args)).toEqual({ Domain: name });
  expect(args[args.indexOf("--profile") + 1]).toBe("synthetic-dev");
  expect(args[args.indexOf("--region") + 1]).toBe("us-east-1");
  expect(args[args.indexOf("--endpoint-url") + 1]).toBe(
    "https://cognito-idp.us-east-1.amazonaws.com",
  );
  expect(args[args.indexOf("--query") + 1]).toBe(
    "{Shape:type(DomainDescription),Domain:DomainDescription.Domain,AccountId:DomainDescription.AWSAccountId,PoolId:DomainDescription.UserPoolId,Status:DomainDescription.Status}",
  );
  expect(args).toContain("describe-user-pool-domain");
  expect(args).toContain("--no-paginate");
  expect(args).toContain("--no-cli-pager");
  expect(args).toContain("--no-cli-auto-prompt");
  for (const forbidden of [
    "--domain",
    "--debug",
    "--no-verify-ssl",
    "list-users",
    "describe-user-pool-client",
    "create-user-pool-domain",
    "delete-user-pool-domain",
    "list-tags-for-resource",
  ])
    expect(args).not.toContain(forbidden);
  frozen(args);
});

it("treats every documented lifecycle and foreign owner as a collision while discarding provider IDs", async () => {
  for (const Status of ["CREATING", "DELETING", "UPDATING", "ACTIVE", "FAILED"])
    for (const foreign of [false, true]) {
      const f = fixture({
        ...metadata(),
        Status,
        AccountId: foreign ? "222233334444" : "111122223333",
      });
      const result = await collectCloudCognitoDomain(f.input, f);
      if (result.kind !== "observed") throw Error(JSON.stringify(result));
      expect(result.domain).toEqual({
        name,
        state: "collision",
        ownerMatchesExpected: !foreign,
      });
      expect(result).toMatchObject({
        scope: "cognito-domain-prefix",
        inventorySha256: f.expected.inventorySha256,
        fullTargetAbsence: "unproven",
        ownership: "unproven",
        resourceWrites: 0,
      });
      expect(f.run).toHaveBeenCalledTimes(1);
      expect(
        f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
      ).toHaveLength(2);
      expect(JSON.stringify(result)).not.toMatch(
        /Private1|222233334444|PoolId|Status|private-message/,
      );
      frozen(result);
    }
});

it("leaves missing/null/empty descriptions unknown and never promotes them to complete absence", async () => {
  for (const Shape of ["object", "null"]) {
    const f = fixture(empty(Shape)),
      result = await collectCloudCognitoDomain(f.input, f);
    if (result.kind !== "observed") throw Error(JSON.stringify(result));
    expect(result.domain).toEqual({
      name,
      state: "not-described",
      ownerMatchesExpected: null,
    });
    expect(result.fullTargetAbsence).toBe("unproven");
    expect(result.ownership).toBe("unproven");
    frozen(result);
  }
});

it("records only a precise ordinary structured service not-found, ignoring message text", async () => {
  for (const error of [
    missing(),
    {
      code: 254,
      stdout: "",
      stderr: JSON.stringify({
        Code: "ResourceNotFoundException",
        Message: { private: "discard" },
      }),
    },
  ]) {
    const f = fixture();
    f.run.mockRejectedValue(error);
    const result = await collectCloudCognitoDomain(f.input, f);
    if (result.kind !== "observed") throw Error(JSON.stringify(result));
    expect(result.domain).toEqual({
      name,
      state: "not-found",
      ownerMatchesExpected: null,
    });
    expect(result.fullTargetAbsence).toBe("unproven");
    expect(result.ownership).toBe("unproven");
    expect(f.run).toHaveBeenCalledTimes(1);
    frozen(result);
  }
});

it("rejects ambiguous/permission/numeric/partial/oversized/accessor failures without reading their messages", async () => {
  const getter = vi.fn(() => "private"),
    base = missing();
  const errors: unknown[] = [
    ...[
      "NotAuthorizedException",
      "AccessDeniedException",
      "ValidationException",
      "InvalidParameterException",
      "OperationNotEnabledException",
      "TooManyRequestsException",
      "InternalErrorException",
      "ResourceNotFoundExceptionExtra",
    ].map((Code) => ({
      ...base,
      stderr: JSON.stringify({ Code, Message: "ResourceNotFoundException" }),
    })),
    { ...base, code: 400 },
    { ...base, code: "254" },
    { ...base, killed: true },
    { ...base, killed: null },
    { ...base, signal: "SIGTERM" },
    { ...base, stdout: "private" },
    { ...base, stderr: "ResourceNotFoundException" },
    { ...base, stderr: JSON.stringify({ status: 400 }) },
    {
      ...base,
      stderr: JSON.stringify({
        Code: "ResourceNotFoundException",
        Message: "x".repeat(65536),
      }),
    },
    {
      ...base,
      stderr: JSON.stringify([{ Code: "ResourceNotFoundException" }]),
    },
    { ...base, stderr: JSON.stringify({ Code: null }) },
    Object.defineProperty({ ...base }, "killed", { get: getter }),
    Object.defineProperty({ ...base }, "signal", { get: getter }),
    Object.defineProperty({ ...base }, "stderr", { get: getter }),
    null,
    "ResourceNotFoundException",
  ];
  for (const error of errors) {
    const f = fixture();
    f.run.mockRejectedValue(error);
    const result = await collectCloudCognitoDomain(f.input, f);
    expect(result).toEqual(failure("metadata-unavailable"));
    frozen(result);
    expect(f.run).toHaveBeenCalledTimes(1);
  }
  expect(getter).not.toHaveBeenCalled();
});

it("refuses malformed shapes, partial descriptions and unknown statuses rather than manufacturing absence", async () => {
  for (const data of [
    null,
    [],
    {},
    { ...metadata(), Private: "discard" },
    { ...empty(), Shape: "string" },
    { ...empty(), Shape: "array" },
    { ...empty(), Shape: null },
    { ...metadata(), Shape: "null" },
    { ...metadata(), Domain: null },
    { ...metadata(), AccountId: null },
    { ...metadata(), PoolId: null },
    { ...metadata(), Status: null },
    { ...metadata(), Status: "UNKNOWN" },
    { ...metadata(), Status: 1 },
    { ...metadata(), Status: {} },
  ]) {
    const f = fixture(data);
    expect(await collectCloudCognitoDomain(f.input, f)).toEqual(
      failure("metadata-unavailable"),
    );
    expect(f.run).toHaveBeenCalledTimes(1);
  }
  const getter = vi.fn(() => "private");
  for (const value of [
    { stdout: "private malformed", stderr: "" },
    { stdout: "x".repeat(65537), stderr: "" },
    { stdout: "é".repeat(32769), stderr: "" },
    { ...response(metadata()), stderr: "private warning" },
    { ...response(metadata()), Private: "discard" },
    Object.defineProperty(response(metadata()), "stdout", { get: getter }),
  ]) {
    const f = fixture();
    f.run.mockResolvedValue(value);
    expect(await collectCloudCognitoDomain(f.input, f)).toEqual(
      failure("metadata-unavailable"),
    );
  }
  expect(getter).not.toHaveBeenCalled();
});

it("validates exact returned prefix, twelve-digit owner and bounded regional pool ID", async () => {
  for (const change of [
    { Domain: "foreign-prefix" },
    { Domain: name + "\n" },
    { AccountId: "11112222333" },
    { AccountId: 111122223333 },
    { AccountId: "111122223333\n" },
    { PoolId: "us-west-2_Private" },
    { PoolId: "us-east-1_" },
    { PoolId: "us-east-1_" + "x".repeat(46) },
    { PoolId: "us-east-1_Private\n" },
  ]) {
    const f = fixture({ ...metadata(), ...change });
    expect(await collectCloudCognitoDomain(f.input, f)).toEqual(
      failure("scope-mismatch"),
    );
    expect(f.run).toHaveBeenCalledTimes(1);
  }
});

it("captures selectors before awaits and checks configured identity/role before and after every observation", async () => {
  const f = fixture(),
    original = cloudCognitoDomainCommand(f.input);
  f.run.mockImplementation(async (args) => {
    expect(args).toEqual(original);
    f.input.profile = "foreign";
    f.input.inventory.accountId = "222233334444";
    f.input.inventory.runId = "changed";
    f.input.templates = "changed";
    return response(metadata());
  });
  const result = await collectCloudCognitoDomain(f.input, f);
  if (result.kind !== "observed") throw Error(JSON.stringify(result));
  expect(result.expectedIdentity).toEqual({
    profile: "synthetic-dev",
    accountId: "111122223333",
    region: "us-east-1",
  });
  expect(result.domain.name).toBe(name);
  for (const state of ["collision", "not-described", "not-found"])
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
        if (state === "not-found") throw missing();
        return response(state === "collision" ? metadata() : empty());
      });
      expect(await collectCloudCognitoDomain(drift.input, drift)).toEqual(
        failure(role ? "identity-mismatch" : "identity-not-ready"),
      );
    }
  const denied = fixture();
  denied.config["history-setting"] = "enabled";
  expect(await collectCloudCognitoDomain(denied.input, denied)).toEqual(
    failure("identity-not-ready"),
  );
  expect(denied.run).not.toHaveBeenCalled();
});

it("rejects invalid input/getters/environment/clocks before reading and inspects old runs independently of new-run leases", async () => {
  const f = fixture(),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...f.input, name: "foreign" },
    { ...f.input, profile: "bad\nprofile" },
    { ...f.input, inventory: { ...f.input.inventory, region: "us-west-2" } },
    Object.defineProperty({ ...f.input }, "templates", { get: getter }),
  ])
    expect(await collectCloudCognitoDomain(input as typeof f.input, f)).toEqual(
      failure("invalid-input"),
    );
  expect(getter).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
  for (const time of [-1, NaN, Number.MAX_SAFE_INTEGER]) {
    const bad = fixture();
    bad.clock = () => time;
    expect(await collectCloudCognitoDomain(bad.input, bad)).toEqual(
      failure("clock-invalid"),
    );
    expect(bad.run).not.toHaveBeenCalled();
  }
  for (const delta of [-1, 90001]) {
    const bad = fixture(),
      start = bad.clock();
    let n = 0;
    bad.clock = () => (n++ === 0 ? start : start + delta);
    expect(await collectCloudCognitoDomain(bad.input, bad)).toEqual(
      failure("clock-invalid"),
    );
  }
  expect((await collectCloudCognitoDomain(f.input, f)).kind).toBe("observed");
  vi.stubEnv(
    "AWS_ENDPOINT_URL_COGNITO_IDP",
    "https://synthetic-override.example",
  );
  const override = fixture();
  expect(await collectCloudCognitoDomain(override.input, override)).toEqual(
    failure("unsupported-environment"),
  );
  expect(override.run).not.toHaveBeenCalled();
  expect(override.read).not.toHaveBeenCalled();
});

it("cancels stalled process reads and discards late results without an identity recheck", async () => {
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
    const pending = collectCloudCognitoDomain(f.input, {
      ...f,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.run).toHaveBeenCalledTimes(1);
    if (external) controller.abort();
    else await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual(failure(external ? "aborted" : "deadline"));
    expect(runnerSignal?.aborted).toBe(true);
    release!(response(metadata()));
    await vi.advanceTimersByTimeAsync(1);
    expect(f.run).toHaveBeenCalledTimes(1);
    expect(
      f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
    ).toHaveLength(1);
  }
});

it("pre-aborts and bounds initial/final identity stalls without allowing late observations", async () => {
  vi.useFakeTimers();
  const before = fixture(),
    controller = new AbortController();
  controller.abort();
  expect(
    await collectCloudCognitoDomain(before.input, {
      ...before,
      signal: controller.signal,
    }),
  ).toEqual(failure("aborted"));
  expect(before.run).not.toHaveBeenCalled();
  expect(before.read).not.toHaveBeenCalled();
  for (const initial of [false, true]) {
    const f = fixture();
    let calls = 0,
      release:
        ((v: Awaited<ReturnType<typeof f.identity>>) => void) | undefined;
    const identity: typeof f.identity = async (...args) =>
      ++calls === 1 && !initial
        ? await f.identity(...args)
        : await new Promise((resolve) => {
            release = resolve;
          });
    const pending = collectCloudCognitoDomain(f.input, { ...f, identity });
    await vi.advanceTimersByTimeAsync(90000);
    expect(await pending).toEqual(failure("deadline"));
    expect(f.run).toHaveBeenCalledTimes(initial ? 0 : 1);
    release!(
      await f.identity({
        profile: "synthetic-dev",
        accountId: "111122223333",
        region: "us-east-1",
      }),
    );
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(initial ? 1 : 2);
  }
});
