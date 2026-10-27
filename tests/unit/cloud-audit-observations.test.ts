import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudAuditCommandArgs,
  cloudAuditStandaloneOrganization,
  collectCloudAuditObservation,
  type CloudAuditCommand,
} from "../../infra/cloud/audit-observations.ts";
import { parseCloudAuditRegions } from "../../infra/cloud/audit-regions.ts";
import { collectCloudIdentityObservation } from "../../infra/cloud/identity-observations.ts";

const now = Date.parse("2026-10-28T00:00:00.000Z"),
  account = "111122223333",
  role = "AdministratorAccess",
  arn = `arn:aws:sts::${account}:assumed-role/AWSReservedSSO_${role}_0123456789abcdef/synthetic`,
  input = () => ({
    profile: "synthetic",
    region: "us-east-1",
    authorizedUntil: "2026-10-28T04:00:00.000Z",
  }),
  allRegions =
    "us-east-1 us-east-2 us-west-1 us-west-2 af-south-1 ap-east-1 ap-south-2 ap-southeast-3 ap-southeast-4 ap-south-1 ap-northeast-3 ap-northeast-2 ap-southeast-1 ap-southeast-2 ap-northeast-1 ca-central-1 eu-central-1 eu-west-1 eu-west-2 eu-south-1 eu-west-3 eu-south-2 eu-north-1 eu-central-2 il-central-1 me-south-1 me-central-1 sa-east-1 us-gov-east-1 us-gov-west-1".split(
      " ",
    );
function registry() {
  return parseCloudAuditRegions(
    "<table><tr><th>Region Name</th><th>Region</th></tr>" +
      allRegions
        .map((r) => `<tr><td>Synthetic</td><td>${r}</td></tr>`)
        .join("") +
      "</table>",
    new Date(now).toISOString(),
  );
}
function fixture(expiry = now + 3 * 60 * 60000) {
  const regions = vi.fn(async () =>
    Object.freeze({
      kind: "observed" as const,
      registry: registry(),
      resourceWrites: 0 as const,
    }),
  );
  const identity = vi.fn(async (captured: ReturnType<typeof input>) =>
    collectCloudIdentityObservation(captured, {
      clock: () => now,
      read: async (c) =>
        c === "configured-account"
          ? account + "\n"
          : c === "configured-role"
            ? role + "\n"
            : c === "caller-identity"
              ? JSON.stringify({ Account: account, Arn: arn })
              : c === "session-expiration"
                ? JSON.stringify({
                    Version: 1,
                    AccessKeyId: "synthetic-key",
                    SecretAccessKey: "synthetic-secret",
                    SessionToken: "synthetic-token",
                    Expiration: new Date(expiry).toISOString(),
                  })
                : "",
    }),
  );
  const values: Record<string, string> = {
    organization: JSON.stringify({ ManagementAccountId: account }),
    hooks: JSON.stringify({ Count: 0, NextToken: null }),
    trails: JSON.stringify({ Count: 0 }),
    lake: JSON.stringify({ Count: 0, NextToken: null }),
    "caller-identity": JSON.stringify({ Account: account, Arn: arn }),
  };
  const read = vi.fn(
    async (c: CloudAuditCommand, _signal: AbortSignal) => values[c.kind],
  );
  return { regions, identity, values, read, clock: () => now };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("Cloud hook/audit observations", () => {
  it("requires complete absence in every verified home region, with at most four concurrent reads", async () => {
    const f = fixture();
    let active = 0,
      maximum = 0;
    f.read.mockImplementation(async (c) => {
      if (c.kind === "lake") {
        active++;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active--;
      }
      return f.values[c.kind];
    });
    const result = await collectCloudAuditObservation(input(), f);
    expect(result.kind).toBe("observed");
    if (result.kind !== "observed") throw Error("missing observation");
    expect(result.safety).toEqual({
      hooks: "absent",
      targetDataEvents: "absent",
    });
    expect(result.summary).toEqual({
      identityVerified: true,
      hooksAbsent: true,
      dataEventsAbsent: true,
      auditReady: true,
      cleanupRunwayReady: true,
      code: "audit-absent",
    });
    expect(result.coverage).toEqual({
      organization: "management",
      hooksListed: true,
      trailsWithShadowsRead: true,
      lakeRegionsChecked: 28,
      lakeComplete: true,
    });
    const reads = f.read.mock.calls
      .map(([c]) => c)
      .filter((c) => c.kind === "lake");
    expect(reads.map((c) => c.region).sort()).toEqual(registry().regions);
    expect(maximum).toBe(4);
    expect(result.expectedIdentity).toEqual(result.identity);
    expect(
      Object.isFrozen(result.safety) && Object.isFrozen(result.coverage),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain(arn);
    expect(JSON.stringify(result)).not.toContain("synthetic-token");
    expect(JSON.stringify(result)).not.toContain("configuredRoleName");
    expect(result.resourceWrites).toBe(0);
    expect(result.safety).not.toHaveProperty("targetNames");
  });
  it("accepts only proven standalone or management coverage, never a member's empty local lists", async () => {
    const f = fixture();
    f.values.organization = '{"Standalone":true}';
    const standalone = await collectCloudAuditObservation(input(), f);
    expect(
      standalone.kind === "observed" && standalone.summary.auditReady,
    ).toBe(true);
    const g = fixture();
    g.values.organization = JSON.stringify({
      ManagementAccountId: "999900001111",
    });
    const member = await collectCloudAuditObservation(input(), g);
    expect(member.kind === "observed" && member.safety).toEqual({
      hooks: "unknown",
      targetDataEvents: "unknown",
    });
    expect(member.kind === "observed" && member.summary.code).toBe(
      "organization-coverage-unknown",
    );
    expect(g.read.mock.calls.map(([c]) => c.kind)).toEqual([
      "organization",
      "caller-identity",
    ]);
    expect(JSON.stringify(member)).not.toContain("999900001111");
  });
  it("keeps present/partial hooks unknown without executing them or reading further audit configuration", async () => {
    for (const page of [
      { Count: 1, NextToken: null },
      { Count: 0, NextToken: "private-continuation" },
    ]) {
      const f = fixture();
      f.values.hooks = JSON.stringify(page);
      const result = await collectCloudAuditObservation(input(), f);
      expect(result.kind === "observed" && result.summary.auditReady).toBe(
        false,
      );
      expect(result.kind === "observed" && result.safety.hooks).toBe("unknown");
      expect(f.read.mock.calls.map(([c]) => c.kind)).toEqual([
        "organization",
        "hooks",
        "caller-identity",
      ]);
      expect(JSON.stringify(result)).not.toContain("private-continuation");
    }
  });
  it("does not equate trails with absence or read their event payloads/selectors", async () => {
    const f = fixture();
    f.values.trails = '{"Count":2}';
    const result = await collectCloudAuditObservation(input(), f);
    expect(result.kind === "observed" && result.safety).toEqual({
      hooks: "absent",
      targetDataEvents: "unknown",
    });
    expect(result.kind === "observed" && result.summary.code).toBe(
      "trails-require-review",
    );
    expect(f.read.mock.calls.some(([c]) => c.kind === "lake")).toBe(false);
  });
  it("refuses nonempty/partial Lake coverage and stops later batches without fallback pagination", async () => {
    for (const page of [
      { Count: 1, NextToken: null },
      { Count: 0, NextToken: "private-continuation" },
    ]) {
      const f = fixture();
      f.values.lake = JSON.stringify(page);
      const result = await collectCloudAuditObservation(input(), f);
      expect(result.kind === "observed" && result.safety.targetDataEvents).toBe(
        "unknown",
      );
      expect(result.kind === "observed" && result.coverage.lakeComplete).toBe(
        false,
      );
      expect(f.read.mock.calls.filter(([c]) => c.kind === "lake")).toHaveLength(
        4,
      );
      expect(JSON.stringify(result)).not.toContain("private-continuation");
    }
  });
  it("fails closed on denied/disabled/unsupported regional or organization access and cancels outstanding work", async () => {
    for (const failKind of [
      "organization",
      "hooks",
      "trails",
      "lake",
      "caller-identity",
    ]) {
      const f = fixture();
      let observedSignal: AbortSignal | undefined;
      f.read.mockImplementation(async (c, s) => {
        observedSignal = s;
        if (c.kind === failKind)
          throw Error("private ARN and AccessDenied/OptInRequired details");
        return f.values[c.kind];
      });
      const result = await collectCloudAuditObservation(input(), f);
      expect(result).toEqual({
        kind: "unavailable",
        code:
          failKind === "caller-identity"
            ? "identity-recheck-unavailable"
            : `${failKind}-unavailable`,
        identityVerified: true,
        resourceWrites: 0,
      });
      expect(observedSignal?.aborted).toBe(true);
      const lakeReads = f.read.mock.calls.filter(
        ([c]) => c.kind === "lake",
      ).length;
      if (failKind === "caller-identity") expect(lakeReads).toBe(28);
      else expect(lakeReads).toBeLessThanOrEqual(4);
    }
  });
  it("does not resolve credentials when public coverage fails, or query configuration without active identity", async () => {
    const f = fixture();
    const unavailable = await collectCloudAuditObservation(input(), {
      ...f,
      regions: async () => ({
        kind: "unavailable",
        code: "registry-changed",
        resourceWrites: 0,
      }),
    });
    expect(unavailable).toEqual({
      kind: "unavailable",
      code: "registry-not-ready",
      identityVerified: false,
      resourceWrites: 0,
    });
    expect(f.identity).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    const g = fixture(now - 1);
    expect(await collectCloudAuditObservation(input(), g)).toEqual({
      kind: "unavailable",
      code: "identity-not-ready",
      identityVerified: false,
      resourceWrites: 0,
    });
    expect(g.read).not.toHaveBeenCalled();
  });
  it("rejects malformed/count/token responses and a changed rechecked account/role", async () => {
    for (const value of [
      "bad",
      "[]",
      "x".repeat(64 * 1024 + 1),
      "{}",
      '{"Count":"0","NextToken":null}',
      '{"Count":-1,"NextToken":null}',
      '{"Count":2,"NextToken":null}',
      '{"Count":0,"NextToken":""}',
      '{"Count":0,"NextToken":null,"extra":"private"}',
    ]) {
      const f = fixture();
      f.values.hooks = value;
      expect(await collectCloudAuditObservation(input(), f)).toEqual({
        kind: "unavailable",
        code: "malformed-response",
        identityVerified: true,
        resourceWrites: 0,
      });
    }
    for (const caller of [
      { Account: "999900001111", Arn: arn },
      { Account: account, Arn: arn.replace(role, "Different") },
      { Account: account, Arn: arn + "\n" },
    ]) {
      const f = fixture();
      f.values["caller-identity"] = JSON.stringify(caller);
      expect(await collectCloudAuditObservation(input(), f)).toEqual({
        kind: "unavailable",
        code: "identity-mismatch",
        identityVerified: true,
        resourceWrites: 0,
      });
    }
  });
  it("recognizes only the precise standalone service exception, not an arbitrary CLI failure", () => {
    const good = {
      code: 254,
      stdout: "",
      stderr:
        "\nAn error occurred (AWSOrganizationsNotInUseException) when calling the DescribeOrganization operation: Synthetic standalone account.\n",
    };
    expect(cloudAuditStandaloneOrganization(good)).toBe(true);
    for (const patch of [
      { code: 253 },
      { stdout: "private" },
      { killed: true },
      { signal: "SIGTERM" },
      {
        stderr: good.stderr.replace(
          "AWSOrganizationsNotInUseException",
          "AccessDeniedException",
        ),
      },
      { stderr: "private prefix" + good.stderr },
      { stderr: good.stderr + "another line\n" },
    ])
      expect(cloudAuditStandaloneOrganization({ ...good, ...patch })).toBe(
        false,
      );
  });
  it("captures input before awaits, rejects unsafe values/overrides and separates direct runway", async () => {
    const f = fixture(now + 90 * 60000),
      mutable = input(),
      original = f.identity.getMockImplementation()!;
    f.identity.mockImplementation(async (captured) => {
      mutable.profile = "changed";
      expect(captured.profile).toBe("synthetic");
      return original(captured);
    });
    const result = await collectCloudAuditObservation(mutable, f);
    expect(result.kind === "observed" && result.identity.profile).toBe(
      "synthetic",
    );
    expect(
      result.kind === "observed" && result.summary.cleanupRunwayReady,
    ).toBe(false);
    let accessed = false;
    for (const bad of [
      { ...input(), extra: true },
      Object.create(input()),
      { ...input(), region: "us-west-2" },
      Object.defineProperty(input(), "profile", {
        get() {
          accessed = true;
          return "synthetic";
        },
      }),
    ])
      expect(await collectCloudAuditObservation(bad, f)).toMatchObject({
        kind: "unavailable",
        code: "invalid-input",
      });
    expect(accessed).toBe(false);
    vi.stubEnv("AWS_ENDPOINT_URL", "https://fixture.invalid");
    const g = fixture();
    expect(
      await collectCloudAuditObservation(input(), {
        regions: g.regions,
        identity: g.identity,
        clock: g.clock,
      }),
    ).toMatchObject({ kind: "unavailable", code: "unsupported-environment" });
  });
  it("aborts the shared deadline and rejects reversed/overrun clocks", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let signal: AbortSignal | undefined;
    f.read.mockImplementation(async (c, s) => {
      signal = s;
      return c.kind === "lake" ? new Promise(() => {}) : f.values[c.kind];
    });
    const pending = collectCloudAuditObservation(input(), f);
    await vi.advanceTimersByTimeAsync(90000);
    expect(await pending).toMatchObject({
      kind: "unavailable",
      code: "deadline",
    });
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();
    for (const end of [now - 1, now + 90001, NaN]) {
      const g = fixture(),
        times = [now, end];
      g.clock = () => times.shift()!;
      expect(await collectCloudAuditObservation(input(), g)).toMatchObject({
        kind: "unavailable",
        code: "clock-invalid",
      });
    }
  });
  it("issues only scoped read commands, includes shadows/activated hooks and never silently paginates", () => {
    const regions = registry().regions;
    const hooks = cloudAuditCommandArgs(
      "synthetic",
      { kind: "hooks" },
      regions,
    );
    for (const argument of ["HOOK", "PRIVATE", "LIVE", "--no-paginate"])
      expect(hooks).toContain(argument);
    expect(
      cloudAuditCommandArgs("synthetic", { kind: "trails" }, regions),
    ).toContain("--include-shadow-trails");
    for (const region of regions) {
      const args = cloudAuditCommandArgs(
        "synthetic",
        { kind: "lake", region },
        regions,
      );
      expect(args).toContain(`https://cloudtrail.${region}.amazonaws.com`);
      expect(args).toContain("--no-paginate");
      expect(args.join(" ")).not.toMatch(
        /lookup-events|get-query|start-query|invoke|update-|create-|delete-|next-token|debug/,
      );
    }
    expect(() =>
      cloudAuditCommandArgs(
        "synthetic",
        { kind: "lake", region: "us-gov-east-1" },
        regions,
      ),
    ).toThrow("Cloud audit observation unavailable");
    expect(() =>
      cloudAuditCommandArgs("--other", { kind: "hooks" }, regions),
    ).toThrow("Cloud audit observation unavailable");
  });
});
