import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudCapacityCommandArgs,
  collectCloudCapacityObservation,
} from "../../infra/cloud/capacity-observations.ts";
import { collectCloudIdentityObservation } from "../../infra/cloud/identity-observations.ts";

const now = Date.parse("2026-10-28T00:00:00.000Z"),
  account = "111122223333",
  role = "AdministratorAccess",
  arn = `arn:aws:sts::${account}:assumed-role/AWSReservedSSO_${role}_0123456789abcdef/synthetic-session`,
  input = () => ({
    profile: "synthetic",
    region: "us-east-1",
    authorizedUntil: "2026-10-28T04:00:00.000Z",
  });
function fixture(expiry = now + 3 * 60 * 60000) {
  const identity = vi.fn(async (captured: ReturnType<typeof input>) =>
    collectCloudIdentityObservation(captured, {
      clock: () => now,
      read: async (command) => {
        switch (command) {
          case "configured-account":
            return account + "\n";
          case "configured-role":
            return role + "\n";
          case "caller-identity":
            return JSON.stringify({ Account: account, Arn: arn });
          case "session-expiration":
            return JSON.stringify({
              Version: 1,
              AccessKeyId: "synthetic-key",
              SecretAccessKey: "synthetic-secret",
              SessionToken: "synthetic-token",
              Expiration: new Date(expiry).toISOString(),
            });
          default:
            return "";
        }
      },
    }),
  );
  const values = {
    capacity: JSON.stringify({ UnreservedConcurrentExecutions: 101 }),
    "caller-identity": JSON.stringify({ Account: account, Arn: arn }),
  };
  const read = vi.fn(
    async (command: "capacity" | "caller-identity", _signal: AbortSignal) =>
      values[command],
  );
  return { identity, values, read, clock: () => now };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("Cloud capacity observations", () => {
  it("reports quota boundaries honestly and privately, preserving the final 100 units", async () => {
    for (const quota of [0, 100, 101, 1000]) {
      const f = fixture();
      f.values.capacity = JSON.stringify({
        UnreservedConcurrentExecutions: quota,
      });
      const result = await collectCloudCapacityObservation(input(), f);
      expect(result.kind).toBe("observed");
      if (result.kind !== "observed") throw Error("missing observation");
      expect(result.unreservedConcurrency).toBe(quota);
      expect(result.summary).toEqual({
        identityVerified: true,
        capacityReady: quota >= 101,
        cleanupRunwayReady: true,
        code: quota >= 101 ? "capacity-available" : "insufficient-capacity",
      });
      expect(result.identity).toEqual(result.expectedIdentity);
      expect(result.resourceWrites).toBe(0);
      expect(
        Object.isFrozen(result.summary) && Object.isFrozen(result.identity),
      ).toBe(true);
      expect(f.read.mock.calls.map(([command]) => command)).toEqual([
        "capacity",
        "caller-identity",
      ]);
      expect(JSON.stringify(result)).not.toContain(arn);
      expect(JSON.stringify(result)).not.toContain("synthetic-token");
    }
  });
  it("does not confuse capacity with usable direct cleanup runway", async () => {
    const f = fixture(now + 90 * 60000),
      result = await collectCloudCapacityObservation(input(), f);
    expect(result.kind === "observed" && result.summary).toEqual({
      identityVerified: true,
      capacityReady: true,
      cleanupRunwayReady: false,
      code: "capacity-available",
    });
    const g = fixture(),
      times = [now, now + 1000];
    g.clock = () => times.shift()!;
    const boundary = input();
    boundary.authorizedUntil = new Date(now + 120 * 60000).toISOString();
    const later = await collectCloudCapacityObservation(boundary, g);
    expect(later.kind === "observed" && later.summary.cleanupRunwayReady).toBe(
      false,
    );
  });
  it("does not query quota without matched configured identity and an active session", async () => {
    const f = fixture(now - 1);
    expect(await collectCloudCapacityObservation(input(), f)).toEqual({
      kind: "unavailable",
      code: "identity-not-ready",
      resourceWrites: 0,
    });
    expect(f.read).not.toHaveBeenCalled();
    const g = fixture();
    g.identity.mockImplementation(async (captured) =>
      collectCloudIdentityObservation(captured, {
        clock: () => now,
        read: async () => {
          throw Error("private provider error");
        },
      }),
    );
    expect(await collectCloudCapacityObservation(input(), g)).toEqual({
      kind: "unavailable",
      code: "identity-not-ready",
      resourceWrites: 0,
    });
    expect(g.read).not.toHaveBeenCalled();
  });
  it("rejects account/role/session-shape drift after the quota read without reflecting it", async () => {
    for (const caller of [
      { Account: "999900001111", Arn: arn },
      { Account: account, Arn: arn.replace(role, "DifferentRole") },
      { Account: account, Arn: arn + "\n" },
      { Account: account, Arn: arn, UserId: "private-user" },
    ]) {
      const f = fixture();
      f.values["caller-identity"] = JSON.stringify(caller);
      expect(await collectCloudCapacityObservation(input(), f)).toEqual({
        kind: "unavailable",
        code: "identity-mismatch",
        resourceWrites: 0,
      });
    }
  });
  it("rejects malformed/oversized/noninteger quota and fixed private read failures", async () => {
    for (const value of [
      "bad",
      "[]",
      "x".repeat(64 * 1024 + 1),
      "{}",
      ...[-1, 100.5, "101", null, Number.MAX_SAFE_INTEGER + 1].map((n) =>
        JSON.stringify({ UnreservedConcurrentExecutions: n }),
      ),
      JSON.stringify({ UnreservedConcurrentExecutions: 101, extra: "private" }),
    ]) {
      const f = fixture();
      f.values.capacity = value;
      expect(await collectCloudCapacityObservation(input(), f)).toEqual({
        kind: "unavailable",
        code: "malformed-response",
        resourceWrites: 0,
      });
    }
    const f = fixture();
    f.read.mockRejectedValue(Error("private key and account"));
    expect(await collectCloudCapacityObservation(input(), f)).toEqual({
      kind: "unavailable",
      code: "read-unavailable",
      resourceWrites: 0,
    });
  });
  it("captures input before awaits and rejects extra/accessor/prototype values", async () => {
    const f = fixture(),
      mutable = input(),
      original = f.identity.getMockImplementation()!;
    f.identity.mockImplementation(async (captured) => {
      mutable.profile = "changed";
      expect(captured.profile).toBe("synthetic");
      return original(captured);
    });
    const result = await collectCloudCapacityObservation(mutable, f);
    expect(result.kind === "observed" && result.identity.profile).toBe(
      "synthetic",
    );
    let accessed = false;
    for (const bad of [
      { ...input(), extra: true },
      { ...input(), region: "us-west-2" },
      { ...input(), profile: "synthetic\n" },
      Object.create(input()),
      Object.defineProperty({ ...input() }, "profile", {
        get() {
          accessed = true;
          return "synthetic";
        },
      }),
    ]) {
      expect(await collectCloudCapacityObservation(bad, f)).toEqual({
        kind: "unavailable",
        code: "invalid-input",
        resourceWrites: 0,
      });
    }
    expect(accessed).toBe(false);
  });
  it("aborts the shared deadline and rejects invalid/reversed/overrun clocks", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let signal: AbortSignal | undefined;
    f.read.mockImplementation(async (_command, s) => {
      signal = s;
      return new Promise(() => {});
    });
    const pending = collectCloudCapacityObservation(input(), f);
    await vi.advanceTimersByTimeAsync(90000);
    expect(await pending).toEqual({
      kind: "unavailable",
      code: "deadline",
      resourceWrites: 0,
    });
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
    for (const end of [now - 1, now + 90001, NaN]) {
      const g = fixture(),
        times = [now, end];
      g.clock = () => times.shift()!;
      expect(await collectCloudCapacityObservation(input(), g)).toEqual({
        kind: "unavailable",
        code: "clock-invalid",
        resourceWrites: 0,
      });
    }
  });
  it("uses only pinned read commands and rejects unsafe environment overrides", async () => {
    const args = cloudCapacityCommandArgs("synthetic", "capacity");
    expect(args).toContain("https://lambda.us-east-1.amazonaws.com");
    expect(args).toContain("get-account-settings");
    expect(args.join(" ")).not.toMatch(
      /put-|update-|request-|list-functions|invoke|debug/,
    );
    expect(cloudCapacityCommandArgs("synthetic", "caller-identity")).toContain(
      "https://sts.us-east-1.amazonaws.com",
    );
    expect(() => cloudCapacityCommandArgs("--other", "capacity")).toThrow(
      "Cloud capacity observation unavailable",
    );
    vi.stubEnv("AWS_ENDPOINT_URL", "https://fixture.invalid");
    const f = fixture();
    expect(
      await collectCloudCapacityObservation(input(), {
        identity: f.identity,
        clock: f.clock,
      }),
    ).toEqual({
      kind: "unavailable",
      code: "unsupported-environment",
      resourceWrites: 0,
    });
  });
});
