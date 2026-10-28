import { afterEach, expect, it, vi } from "vitest";
import {
  cloudInspectionCommandArgs,
  collectCloudInspectionIdentity,
  type CloudInspectionCommand,
} from "../../infra/cloud/inspection-identity.ts";

function fixture() {
  const input = {
      profile: "synthetic-dev",
      accountId: "111122223333",
      region: "us-east-1" as const,
    },
    values: Record<CloudInspectionCommand, string> = {
      "history-setting": "disabled\n",
      "configured-account": input.accountId + "\n",
      "configured-role": "Synthetic\n",
      "credential-process": "",
      "assume-role": "",
      "web-identity": "",
      "caller-identity": JSON.stringify({
        Account: input.accountId,
        Arn: `arn:aws:sts::${input.accountId}:assumed-role/AWSReservedSSO_Synthetic_0123456789abcdef/private-session`,
      }),
    },
    read = vi.fn(
      async (kind: CloudInspectionCommand, _signal: AbortSignal) =>
        values[kind],
    );
  return {
    input,
    values,
    read,
    clock: () => Date.parse("2026-10-28T08:00:00.000Z"),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const unavailable = (code: string) => ({
  kind: "unavailable",
  code,
  resourceWrites: 0,
});

it("authenticates only the independently pinned current identity, with no expired-run or new-run runway dependency", async () => {
  const f = fixture(),
    result = await collectCloudInspectionIdentity(f.input, f);
  expect(result).toEqual({
    kind: "observed",
    checkedAt: "2026-10-28T08:00:00.000Z",
    expectedIdentity: f.input,
    configuredRoleName: "Synthetic",
    summary: { identityVerified: true },
    resourceWrites: 0,
  });
  expect(f.read.mock.calls.map(([c]) => c)).toEqual([
    "history-setting",
    "configured-account",
    "configured-role",
    "credential-process",
    "assume-role",
    "web-identity",
    "caller-identity",
  ]);
  expect(JSON.stringify(result)).not.toMatch(
    /private-session|Arn|expiry|refresh|runway|cleanupReady|AccessKey|Token/,
  );
  expect(Object.isFrozen(result)).toBe(true);
  if (result.kind !== "observed") throw Error("missing fixture result");
  expect(Object.isFrozen(result.expectedIdentity)).toBe(true);
  expect(Object.isFrozen(result.summary)).toBe(true);
  f.input.accountId = "222233334444";
  expect(result.expectedIdentity.accountId).toBe("111122223333");
});

it("checks history/configuration before STS and refuses pin, role and unsupported-flow drift", async () => {
  for (const [setting, value, code] of [
    ["history-setting", "enabled", "history-not-disabled"],
    ["configured-account", "222233334444", "identity-mismatch"],
    ["configured-account", "", "identity-mismatch"],
    ["configured-role", "", "configuration-unavailable"],
    ["credential-process", "private-command", "unsupported-profile"],
    ["assume-role", "private-role", "unsupported-profile"],
    ["web-identity", "private-file", "unsupported-profile"],
  ]) {
    const f = fixture();
    f.values[setting as CloudInspectionCommand] = value;
    expect(await collectCloudInspectionIdentity(f.input, f)).toEqual(
      unavailable(code),
    );
    expect(f.read.mock.calls.some(([c]) => c === "caller-identity")).toBe(
      false,
    );
    if (setting === "history-setting") expect(f.read).toHaveBeenCalledTimes(1);
  }
});

it("accepts only exact absent optional configuration exits and preserves all other errors as unknown", async () => {
  const f = fixture(),
    baseRead = f.read.getMockImplementation()!;
  f.read.mockImplementation(async (c, signal) => {
    if (
      [
        "history-setting",
        "credential-process",
        "assume-role",
        "web-identity",
      ].includes(c)
    )
      throw { code: 1, stdout: "", stderr: "" };
    return baseRead(c, signal);
  });
  expect((await collectCloudInspectionIdentity(f.input, f)).kind).toBe(
    "observed",
  );
  for (const error of [
    { code: 1, stdout: "", stderr: "private-error" },
    { code: 1, stdout: "", stderr: "", killed: true },
    { code: 1, stdout: "", stderr: "", signal: "SIGTERM" },
    { code: 254, stdout: "", stderr: "" },
    { code: 1, stdout: "private", stderr: "" },
  ]) {
    const bad = fixture();
    bad.read.mockRejectedValue(error);
    expect(await collectCloudInspectionIdentity(bad.input, bad)).toEqual(
      unavailable("configuration-unavailable"),
    );
  }
  const required = fixture(),
    read = required.read.getMockImplementation()!;
  required.read.mockImplementation(async (c, signal) => {
    if (c === "configured-account") throw { code: 1, stdout: "", stderr: "" };
    return read(c, signal);
  });
  expect(
    await collectCloudInspectionIdentity(required.input, required),
  ).toEqual(unavailable("configuration-unavailable"));
});

it("rejects wrong account/partition/role or malformed caller metadata without exposing session data", async () => {
  for (const edit of [
    (c: any) => {
      c.Account = "222233334444";
    },
    (c: any) => {
      c.Arn = c.Arn.replace("Synthetic_", "Foreign_");
    },
    (c: any) => {
      c.Arn = c.Arn.replace("arn:aws:", "arn:aws-us-gov:");
    },
    (c: any) => {
      c.Arn += "\n";
    },
  ]) {
    const f = fixture(),
      caller = JSON.parse(f.values["caller-identity"]);
    edit(caller);
    f.values["caller-identity"] = JSON.stringify(caller);
    expect(await collectCloudInspectionIdentity(f.input, f)).toEqual(
      unavailable("identity-mismatch"),
    );
  }
  for (const raw of [
    "private-invalid-json",
    "null",
    JSON.stringify({
      Account: "111122223333",
      Arn: "private",
      UserId: "private",
    }),
    "x".repeat(65537),
  ]) {
    const f = fixture();
    f.values["caller-identity"] = raw;
    expect(await collectCloudInspectionIdentity(f.input, f)).toEqual(
      unavailable("identity-unavailable"),
    );
  }
  const f = fixture(),
    read = f.read.getMockImplementation()!;
  f.read.mockImplementation(async (c, s) => {
    if (c === "caller-identity")
      throw Object.assign(Error("private-error"), {
        stdout: "private-token",
        stderr: "private-response",
      });
    return read(c, s);
  });
  expect(await collectCloudInspectionIdentity(f.input, f)).toEqual(
    unavailable("identity-unavailable"),
  );
});

it("captures plain inputs before awaits and rejects accessors, coercion, extra fields and region drift", async () => {
  const f = fixture(),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...f.input, region: "us-west-2" },
    { ...f.input, accountId: 111122223333 },
    { ...f.input, profile: "private\nprofile" },
    { ...f.input, authorizedUntil: "expired" },
    Object.defineProperty({ ...f.input }, "profile", { get: getter }),
  ])
    expect(
      await collectCloudInspectionIdentity(input as typeof f.input, f),
    ).toEqual(unavailable("invalid-input"));
  expect(getter).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  const read = f.read.getMockImplementation()!;
  f.read.mockImplementation(async (c, s) => {
    f.input.accountId = "222233334444";
    f.input.profile = "foreign";
    return read(c, s);
  });
  const result = await collectCloudInspectionIdentity(f.input, f);
  if (result.kind !== "observed") throw Error("missing captured fixture");
  expect(result.expectedIdentity).toEqual({
    profile: "synthetic-dev",
    accountId: "111122223333",
    region: "us-east-1",
  });
});

it("rejects invalid/reversed/overrun clocks without requiring an authorization cutoff", async () => {
  for (const start of [-1, NaN, Number.MAX_SAFE_INTEGER]) {
    const f = fixture();
    f.clock = () => start;
    expect(await collectCloudInspectionIdentity(f.input, f)).toEqual(
      unavailable("clock-invalid"),
    );
    expect(f.read).not.toHaveBeenCalled();
  }
  for (const delta of [-1, 45001]) {
    const f = fixture(),
      start = f.clock();
    let calls = 0;
    f.clock = () => (calls++ === 0 ? start : start + delta);
    expect(await collectCloudInspectionIdentity(f.input, f)).toEqual(
      unavailable("clock-invalid"),
    );
  }
});

it("cancels stalled and late readers without resuming later credential or metadata operations", async () => {
  vi.useFakeTimers();
  for (const external of [true, false]) {
    const f = fixture(),
      controller = new AbortController();
    let release: ((raw: string) => void) | undefined,
      readerSignal: AbortSignal | undefined;
    f.read.mockImplementation(async (_c, signal) => {
      readerSignal = signal;
      return await new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const remove = vi.spyOn(controller.signal, "removeEventListener"),
      promise = collectCloudInspectionIdentity(f.input, {
        ...f,
        signal: controller.signal,
      });
    if (external) controller.abort();
    else await vi.advanceTimersByTimeAsync(45001);
    expect(await promise).toEqual(
      unavailable(external ? "aborted" : "deadline"),
    );
    expect(readerSignal?.aborted).toBe(true);
    expect(remove).toHaveBeenCalled();
    release!("disabled\n");
    await vi.advanceTimersByTimeAsync(1);
    expect(f.read).toHaveBeenCalledTimes(1);
  }
  const f = fixture(),
    cancelled = new AbortController();
  cancelled.abort();
  expect(
    await collectCloudInspectionIdentity(f.input, {
      ...f,
      signal: cancelled.signal,
    }),
  ).toEqual(unavailable("aborted"));
  expect(f.read).not.toHaveBeenCalled();
});

it("refuses credential/endpoint environment overrides before spawning the default CLI", async () => {
  const f = fixture();
  for (const key of [
    "AWS_ACCESS_KEY_ID",
    "AWS_CONFIG_FILE",
    "AWS_ENDPOINT_URL_STS",
    "AWS_CLI_HISTORY_FILE",
  ]) {
    vi.stubEnv(key, "synthetic-override");
    expect(await collectCloudInspectionIdentity(f.input)).toEqual(
      unavailable("unsupported-environment"),
    );
    vi.unstubAllEnvs();
  }
});

it("exposes fixed read-only settings/STS commands and rejects credential export even through runtime casts", () => {
  const f = fixture();
  for (const kind of Object.keys(f.values) as CloudInspectionCommand[]) {
    const args = cloudInspectionCommandArgs(f.input.profile, kind);
    for (const forbidden of [
      "export-credentials",
      "--debug",
      "--no-verify-ssl",
      "--no-sign-request",
    ])
      expect(args).not.toContain(forbidden);
    expect(args).toContain("--profile");
    expect(args).toContain("us-east-1");
    if (kind === "caller-identity") {
      expect(args).toContain("https://sts.us-east-1.amazonaws.com");
      expect(args).toContain("{Account:Account,Arn:Arn}");
    } else expect(args).toContain("get");
  }
  for (const kind of ["session-expiration", "unknown", "__proto__"])
    expect(() =>
      cloudInspectionCommandArgs(
        f.input.profile,
        kind as CloudInspectionCommand,
      ),
    ).toThrow("Cloud inspection identity unavailable");
});
