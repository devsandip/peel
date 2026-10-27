import { expect, it, vi } from "vitest";
import {
  assertCloudIdentityEnvironment,
  cloudIdentityCommandArgs,
  collectCloudIdentityObservation,
  type CloudIdentityCommand,
} from "../../infra/cloud/identity-observations";

const now = Date.parse("2026-10-27T20:00:00.000Z"),
  minute = 60000;
const iso = (time: number) => new Date(time).toISOString();
const account = "111122223333",
  role = "FixtureAdmin",
  session = "synthetic-sensitive-session";
const caller = () => ({
  Account: account,
  Arn: `arn:aws:sts::${account}:assumed-role/AWSReservedSSO_${role}_0123456789abcdef/${session}`,
});
const exported = (expiration = iso(now + 120 * minute)) => ({
  Version: 1,
  AccessKeyId: "synthetic-sensitive-access",
  SecretAccessKey: "synthetic-sensitive-secret",
  SessionToken: "synthetic-sensitive-token",
  Expiration: expiration,
});
function fixture() {
  const input = {
    profile: "synthetic-dev",
    region: "us-east-1",
    authorizedUntil: iso(now + 180 * minute),
  };
  const values: Record<CloudIdentityCommand, string> = {
    "history-setting": "",
    "configured-account": account + "\n",
    "configured-role": role + "\n",
    "credential-process": "",
    "assume-role": "",
    "web-identity": "",
    "caller-identity": JSON.stringify(caller()),
    "session-expiration": JSON.stringify(exported()),
  };
  const read = vi.fn(
    async (command: CloudIdentityCommand, _signal: AbortSignal) =>
      values[command],
  );
  return { input, values, read };
}
const observe = (f: ReturnType<typeof fixture>, clock = () => now) =>
  collectCloudIdentityObservation(f.input, { read: f.read, clock });

it("restricts command arguments to explicit profile/region, local configuration, pinned STS and private process-format resolution", () => {
  for (const command of Object.keys(
    fixture().values,
  ) as CloudIdentityCommand[]) {
    const args = cloudIdentityCommandArgs("synthetic-dev", command);
    expect(args).toEqual(
      expect.arrayContaining([
        "--profile",
        "synthetic-dev",
        "--region",
        "us-east-1",
        "--no-cli-pager",
        "--no-cli-auto-prompt",
      ]),
    );
    expect(args).not.toEqual(expect.arrayContaining(["--debug"]));
    expect(args).not.toEqual(expect.arrayContaining(["--no-verify-ssl"]));
    if (command === "caller-identity")
      expect(args).toEqual(
        expect.arrayContaining([
          "sts",
          "get-caller-identity",
          "--endpoint-url",
          "https://sts.us-east-1.amazonaws.com",
          "--query",
          "{Account:Account,Arn:Arn}",
        ]),
      );
    else if (command === "session-expiration") {
      expect(args).toEqual(
        expect.arrayContaining([
          "configure",
          "export-credentials",
          "--format",
          "process",
        ]),
      );
      expect(args).not.toContain("--query");
      expect(args).not.toContain("--output");
    } else expect(args).toContain("get");
  }
  for (const profile of ["bad\n", "../admin", "admin;command", ""])
    expect(() => cloudIdentityCommandArgs(profile, "caller-identity")).toThrow(
      "Cloud identity observation unavailable",
    );
  expect(() =>
    cloudIdentityCommandArgs(
      "synthetic-dev",
      "create-stack" as CloudIdentityCommand,
    ),
  ).toThrow();
});

it("rejects credential/config/history/endpoint overrides without reflecting their values", () => {
  for (const name of [
    "AWS_ENDPOINT_URL",
    "AWS_ENDPOINT_URL_STS",
    "AWS_CONFIG_FILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_ROLE_ARN",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_CLI_HISTORY_FILE",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  ])
    expect(() =>
      assertCloudIdentityEnvironment({ [name]: "synthetic-sensitive-marker" }),
    ).toThrow(/^Cloud identity observation unavailable$/);
  expect(() =>
    assertCloudIdentityEnvironment({
      AWS_REGION: "us-west-2",
      AWS_PROFILE: "other-profile",
      AWS_ENDPOINT_URL: "",
    }),
  ).not.toThrow();
});

it("returns only frozen normalized identity/expiry, with no raw ARN/session or exported credential fields", async () => {
  const f = fixture(),
    result = await observe(f);
  expect(result.kind).toBe("observed");
  if (result.kind !== "observed") throw Error("Missing fixture observation");
  expect(result.expectedIdentity).toEqual({
    profile: "synthetic-dev",
    accountId: account,
    region: "us-east-1",
  });
  expect(result.identity).toEqual(result.expectedIdentity);
  expect(result.credentials).toEqual({
    sessionExpiresAt: iso(now + 120 * minute),
    refreshExpiresAt: null,
    refreshProven: false,
  });
  expect(result.summary).toEqual({
    identityVerified: true,
    sessionActive: true,
    cleanupRunwayReady: true,
    code: "direct-runway-ready",
  });
  expect(result.resourceWrites).toBe(0);
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    session,
    "synthetic-sensitive-access",
    "synthetic-sensitive-secret",
    "synthetic-sensitive-token",
    "AccessKeyId",
    "SecretAccessKey",
    "SessionToken",
    "Arn",
  ])
    expect(serialized).not.toContain(forbidden);
  for (const value of [
    result,
    result.identity,
    result.expectedIdentity,
    result.credentials,
    result.summary,
  ])
    expect(Object.isFrozen(value)).toBe(true);
  expect(f.read.mock.calls[0][0]).toBe("history-setting");
  expect(f.read.mock.calls.slice(-2).map(([command]) => command)).toEqual([
    "caller-identity",
    "session-expiration",
  ]);
  expect(f.read).toHaveBeenCalledTimes(8);
});

it("compares STS with the independent configured account and role before retrieving credentials", async () => {
  for (const changed of [
    { ...caller(), Account: "222233334444" },
    {
      Account: "222233334444",
      Arn: caller().Arn.replace(account, "222233334444"),
    },
    { ...caller(), Arn: caller().Arn.replace(role, "OtherAdmin") },
    { ...caller(), Arn: `arn:aws:iam::${account}:root` },
    { ...caller(), Arn: caller().Arn + "\n" },
    { ...caller(), UserId: "synthetic-sensitive-extra" },
  ]) {
    const f = fixture();
    f.values["caller-identity"] = JSON.stringify(changed);
    expect(await observe(f)).toMatchObject({
      kind: "unavailable",
      code: "identity-mismatch",
      identityVerified: false,
    });
    expect(f.read.mock.calls.map(([command]) => command)).not.toContain(
      "session-expiration",
    );
  }
  const f = fixture();
  f.values["configured-account"] = "222233334444\n";
  expect(await observe(f)).toMatchObject({
    kind: "unavailable",
    code: "identity-mismatch",
  });
});

it("blocks history and unsupported profile flows before authentication", async () => {
  for (const history of ["enabled\n", "unknown\n"]) {
    const f = fixture();
    f.values["history-setting"] = history;
    expect(await observe(f)).toMatchObject({
      kind: "unavailable",
      code: "history-not-disabled",
      identityVerified: false,
    });
    expect(f.read).toHaveBeenCalledTimes(1);
  }
  for (const key of [
    "credential-process",
    "assume-role",
    "web-identity",
  ] as const) {
    const f = fixture();
    f.values[key] = "synthetic-sensitive-unsupported\n";
    expect(await observe(f)).toMatchObject({
      kind: "unavailable",
      code: "unsupported-profile",
    });
    expect(f.read.mock.calls.map(([command]) => command)).not.toContain(
      "caller-identity",
    );
  }
  for (const value of ["", account + "\n\n", "not-an-account"]) {
    const f = fixture();
    f.values["configured-account"] = value;
    expect(await observe(f)).toMatchObject({
      kind: "unavailable",
      code: "configuration-unavailable",
    });
  }
});

it("reports direct lifetime boundaries honestly and never invents refresh proof", async () => {
  for (const [expiry, code, active, ready] of [
    [iso(now + 120 * minute), "direct-runway-ready", true, true],
    [iso(now + 120 * minute - 1), "insufficient-direct-runway", true, false],
    [iso(now + 30 * minute), "insufficient-direct-runway", true, false],
    [iso(now), "session-expired", false, false],
  ] as const) {
    const f = fixture();
    f.values["session-expiration"] = JSON.stringify(exported(expiry));
    const result = await observe(f);
    expect(result).toMatchObject({
      kind: "observed",
      summary: { code, sessionActive: active, cleanupRunwayReady: ready },
      credentials: { refreshProven: false, refreshExpiresAt: null },
    });
  }
  const f = fixture();
  f.values["session-expiration"] = JSON.stringify(
    exported("2026-10-27T22:00:00.000999+00:00"),
  );
  expect(await observe(f)).toMatchObject({
    kind: "observed",
    credentials: { sessionExpiresAt: "2026-10-27T22:00:00.000Z" },
  });
});

it("refuses malformed, missing and unbounded process output while discarding credential-bearing errors", async () => {
  const good = exported();
  for (const data of [
    { ...good, Version: 2 },
    { ...good, Expiration: undefined },
    { ...good, SessionToken: null },
    { ...good, Expiration: "2026-02-30T22:00:00Z" },
    { ...good, Expiration: "2026-10-27T22:00:00+05:30" },
    { ...good, extra: "synthetic-sensitive-extra" },
  ]) {
    const f = fixture();
    f.values["session-expiration"] = JSON.stringify(data);
    const result = await observe(f);
    expect(result).toMatchObject({
      kind: "unavailable",
      code: "malformed-credentials",
      identityVerified: true,
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-sensitive");
    expect(result).not.toHaveProperty("identity");
    expect(result).not.toHaveProperty("cause");
  }
  for (const raw of [
    '{"SecretAccessKey":"synthetic-sensitive',
    "synthetic-sensitive".repeat(5000),
  ]) {
    const f = fixture();
    f.values["session-expiration"] = raw;
    expect(await observe(f)).toMatchObject({
      kind: "unavailable",
      code: "malformed-credentials",
    });
  }
  const f = fixture();
  f.read.mockImplementation(async (command) => {
    if (command === "session-expiration")
      throw {
        stdout: JSON.stringify(good),
        stderr: "synthetic-sensitive-secret",
      };
    return f.values[command];
  });
  const result = await observe(f);
  expect(result).toMatchObject({
    kind: "unavailable",
    code: "read-unavailable",
    identityVerified: true,
  });
  expect(JSON.stringify(result)).not.toContain("synthetic-sensitive");
});

it("snapshots explicit input and rejects hidden fields/accessors before any read", async () => {
  const f = fixture();
  f.read.mockImplementation(async (command) => {
    if (command === "caller-identity") f.input.profile = "changed-profile";
    return f.values[command];
  });
  expect(await observe(f)).toMatchObject({
    kind: "observed",
    identity: { profile: "synthetic-dev" },
  });
  const getter = vi.fn(() => "synthetic-sensitive");
  const hidden = fixture();
  Object.defineProperty(hidden.input, "profile", {
    get: getter,
    enumerable: true,
  });
  expect(await observe(hidden)).toMatchObject({
    kind: "unavailable",
    code: "invalid-input",
  });
  expect(getter).not.toHaveBeenCalled();
  expect(hidden.read).not.toHaveBeenCalled();
  const extra = fixture();
  Object.defineProperty(extra.input, "token", {
    value: "synthetic-sensitive",
    enumerable: false,
  });
  expect(await observe(extra)).toMatchObject({
    kind: "unavailable",
    code: "invalid-input",
  });
});

it("bounds a stalled read and strips abort failures without leaving timers", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    f.read.mockImplementation((command, signal) =>
      command === "caller-identity"
        ? new Promise((_, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(Error("synthetic-sensitive-secret")),
              { once: true },
            ),
          )
        : Promise.resolve(f.values[command]),
    );
    const pending = observe(f);
    await vi.advanceTimersByTimeAsync(45000);
    expect(await pending).toEqual({
      kind: "unavailable",
      code: "deadline",
      identityVerified: false,
      resourceWrites: 0,
    });
    expect(f.read.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("rejects invalid clock/cutoff and insufficient authorization instead of shortening cleanup headroom", async () => {
  const short = fixture();
  short.input.authorizedUntil = iso(now + 120 * minute - 1);
  expect(await observe(short)).toMatchObject({
    kind: "unavailable",
    code: "authorization-window-too-short",
  });
  expect(short.read).not.toHaveBeenCalled();
  for (const ended of [now - 1, now + 45001, NaN]) {
    const f = fixture(),
      clock = vi.fn().mockReturnValueOnce(now).mockReturnValue(ended);
    expect(await observe(f, clock)).toMatchObject({
      kind: "unavailable",
      code: "clock-invalid",
    });
  }
  const late = fixture();
  late.input.authorizedUntil = iso(now + 120 * minute);
  expect(
    await observe(
      late,
      vi
        .fn()
        .mockReturnValueOnce(now)
        .mockReturnValue(now + 1),
    ),
  ).toMatchObject({
    kind: "unavailable",
    code: "authorization-window-too-short",
  });
});
