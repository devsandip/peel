import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cloudAuditCommandArgs,
  cloudAuditLakeFailure,
  cloudAuditStandaloneOrganization,
  collectCloudAuditObservation,
  type CloudAuditCommand,
} from "../../infra/cloud/audit-observations.ts";
import {
  cloudAuditCommercialRegions,
  parseCloudAuditRegions,
} from "../../infra/cloud/audit-regions.ts";
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
function commandCount(
  read: ReturnType<typeof fixture>["read"],
  kind: CloudAuditCommand["kind"],
) {
  return read.mock.calls.filter(([c]) => c.kind === kind).length;
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
    expect(Object.keys(result).sort()).toEqual([
      "checkedAt",
      "coverage",
      "credentials",
      "expectedIdentity",
      "identity",
      "kind",
      "registry",
      "resourceWrites",
      "safety",
      "summary",
    ]);
    expect(cloudAuditCommercialRegions).toEqual(registry().regions);
    expect(Object.isFrozen(cloudAuditCommercialRegions)).toBe(true);
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
        stage: failKind,
        region: failKind === "lake" ? "af-south-1" : "us-east-1",
        identityVerified: true,
        resourceWrites: 0,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(JSON.stringify(result)).not.toContain("AccessDenied");
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
      stage: "registry",
      region: null,
      identityVerified: false,
      resourceWrites: 0,
    });
    expect(f.identity).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
    const g = fixture(now - 1);
    expect(await collectCloudAuditObservation(input(), g)).toEqual({
      kind: "unavailable",
      code: "identity-not-ready",
      stage: "identity",
      region: "us-east-1",
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
        stage: "hooks",
        region: "us-east-1",
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
        stage: "caller-identity",
        region: "us-east-1",
        identityVerified: true,
        resourceWrites: 0,
      });
    }
  });
  it("recognizes only the precise standalone service exception, not an arbitrary CLI failure", () => {
    const good = {
      code: 254,
      stdout: "",
      stderr: JSON.stringify({
        Code: "AWSOrganizationsNotInUseException",
        Message: "Synthetic standalone account.",
      }),
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
  it("classifies only safe Lake service facts without retaining messages or guessing regional causes", () => {
    const error = (code: string) => ({
      code: 254,
      stdout: "",
      stderr: JSON.stringify({
        Code: code,
        Message: "private identity/resource details",
        ResourceArn: arn,
      }),
    });
    expect(cloudAuditLakeFailure(error("UnrecognizedClientException"))).toBe(
      "lake-auth-unavailable",
    );
    expect(cloudAuditLakeFailure(error("AccessDeniedException"))).toBe(
      "lake-access-denied",
    );
    expect(cloudAuditLakeFailure(error("UnsupportedOperationException"))).toBe(
      "lake-unsupported",
    );
    expect(cloudAuditLakeFailure(error("OtherException"))).toBe(
      "lake-unavailable",
    );
    expect(
      cloudAuditLakeFailure({
        ...error("UnrecognizedClientException"),
        code: 253,
      }),
    ).toBe("lake-unavailable");
    expect(
      cloudAuditLakeFailure({
        code: 254,
        stdout: "",
        stderr: "private prefix UnrecognizedClientException",
      }),
    ).toBe("lake-unavailable");
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
        stage: null,
        region: null,
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
    ).toMatchObject({
      kind: "unavailable",
      code: "unsupported-environment",
      stage: null,
      region: null,
    });
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
      stage: "lake",
      region: null,
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
        stage: null,
        region: null,
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
    expect(hooks).toContain("--cli-error-format");
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
  it("attributes first-batch and later-batch concurrent Lake failures without out-of-order overwrites", async () => {
    type Deferred = {
      resolve: (value: string) => void;
      reject: (reason: unknown) => void;
    };
    const first = fixture(),
      firstPending = new Map<string, Deferred>();
    let markFirstReady = () => {};
    const firstReady = new Promise<void>((resolve) => {
      markFirstReady = resolve;
    });
    first.read.mockImplementation((c) => {
      if (c.kind !== "lake") return Promise.resolve(first.values[c.kind]);
      return new Promise<string>((resolve, reject) => {
        firstPending.set(c.region, { resolve, reject });
        if (firstPending.size === 4) markFirstReady();
      });
    });
    const firstRun = collectCloudAuditObservation(input(), first);
    await firstReady;
    const p0 = firstPending.get("af-south-1")!,
      p1 = firstPending.get("ap-east-1")!,
      p2 = firstPending.get("ap-northeast-1")!,
      p3 = firstPending.get("ap-northeast-2")!;
    p3.resolve(first.values.lake);
    p0.resolve(first.values.lake);
    await Promise.resolve();
    p1.reject(new Error("private OptInRequired " + arn));
    p2.reject(new Error("later concurrent failure " + account));
    const firstOutcome = await firstRun;
    expect(firstOutcome).toEqual({
      kind: "unavailable",
      code: "lake-unavailable",
      stage: "lake",
      region: "ap-east-1",
      identityVerified: true,
      resourceWrites: 0,
    });
    expect(Object.isFrozen(firstOutcome)).toBe(true);
    expect(commandCount(first.read, "lake")).toBe(4);
    const later = fixture(),
      laterRegions = registry().regions.slice(16, 20),
      laterBatch = new Set(laterRegions),
      laterTarget = laterRegions[2],
      laterPending = new Map<string, Deferred>();
    let markLaterReady = () => {};
    const laterReady = new Promise<void>((resolve) => {
      markLaterReady = resolve;
    });
    later.read.mockImplementation((c) => {
      if (c.kind !== "lake" || !laterBatch.has(c.region)) {
        return Promise.resolve(later.values[c.kind]);
      }
      return new Promise<string>((resolve, reject) => {
        laterPending.set(c.region, { resolve, reject });
        if (laterPending.size === 4) markLaterReady();
      });
    });
    const laterRun = collectCloudAuditObservation(input(), later);
    await laterReady;
    const l0 = laterPending.get(laterRegions[0])!,
      l1 = laterPending.get(laterRegions[1])!,
      l2 = laterPending.get(laterRegions[2])!,
      l3 = laterPending.get(laterRegions[3])!;
    l3.resolve(later.values.lake);
    l0.resolve(later.values.lake);
    await Promise.resolve();
    l2.reject(new Error("private AccessDeniedException " + role));
    l1.reject(new Error("trailing batch failure"));
    const laterOutcome = await laterRun;
    expect(laterOutcome).toEqual({
      kind: "unavailable",
      code: "lake-unavailable",
      stage: "lake",
      region: laterTarget,
      identityVerified: true,
      resourceWrites: 0,
    });
    expect(commandCount(later.read, "lake")).toBe(20);
    expect(commandCount(later.read, "caller-identity")).toBe(0);
    const serialized = JSON.stringify([firstOutcome, laterOutcome]);
    for (const secret of [
      account,
      role,
      arn,
      "OptInRequired",
      "AccessDenied",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
  it("attaches stage and region context to malformed responses, count failures and thrown prerequisites", async () => {
    for (const raw of ["{", JSON.stringify({ Extra: account })]) {
      const f = fixture();
      f.values.organization = raw;
      expect(await collectCloudAuditObservation(input(), f)).toEqual({
        kind: "unavailable",
        code: "malformed-response",
        stage: "organization",
        region: "us-east-1",
        identityVerified: true,
        resourceWrites: 0,
      });
    }
    const badTrails = fixture();
    badTrails.values.trails = JSON.stringify({ Count: 0, NextToken: null });
    expect(await collectCloudAuditObservation(input(), badTrails)).toEqual({
      kind: "unavailable",
      code: "malformed-response",
      stage: "trails",
      region: "us-east-1",
      identityVerified: true,
      resourceWrites: 0,
    });
    const badLake = fixture();
    badLake.read.mockImplementation(async (c) => {
      if (c.kind === "lake" && c.region === "il-central-1") {
        await Promise.resolve();
        return JSON.stringify({ Count: 2, NextToken: null });
      }
      return badLake.values[c.kind];
    });
    expect(await collectCloudAuditObservation(input(), badLake)).toEqual({
      kind: "unavailable",
      code: "malformed-response",
      stage: "lake",
      region: "il-central-1",
      identityVerified: true,
      resourceWrites: 0,
    });
    const badCaller = fixture();
    badCaller.values["caller-identity"] = "[]";
    expect(await collectCloudAuditObservation(input(), badCaller)).toEqual({
      kind: "unavailable",
      code: "malformed-response",
      stage: "caller-identity",
      region: "us-east-1",
      identityVerified: true,
      resourceWrites: 0,
    });
    const registryError = await collectCloudAuditObservation(input(), {
      ...fixture(),
      regions: async () => {
        throw new Error("private docs network error");
      },
    });
    expect(registryError).toEqual({
      kind: "unavailable",
      code: "read-unavailable",
      stage: "registry",
      region: null,
      identityVerified: false,
      resourceWrites: 0,
    });
    const identityError = await collectCloudAuditObservation(input(), {
      ...fixture(),
      identity: async () => {
        throw new Error("private SSO cache error " + arn);
      },
    });
    expect(identityError).toEqual({
      kind: "unavailable",
      code: "read-unavailable",
      stage: "identity",
      region: "us-east-1",
      identityVerified: false,
      resourceWrites: 0,
    });
    const badClock = fixture();
    badClock.clock = () => -1;
    expect(await collectCloudAuditObservation(input(), badClock)).toEqual({
      kind: "unavailable",
      code: "clock-invalid",
      stage: null,
      region: null,
      identityVerified: false,
      resourceWrites: 0,
    });
  });
  it("leaves region null on global deadlines and shared aborts across concurrent operations", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.read.mockImplementation((c, s) => {
      if (c.kind !== "lake") return Promise.resolve(f.values[c.kind]);
      return new Promise<string>((_, reject) => {
        s.addEventListener(
          "abort",
          () => reject(new Error("aborted " + c.region)),
          { once: true },
        );
      });
    });
    const timedOutLake = collectCloudAuditObservation(input(), f);
    await vi.advanceTimersByTimeAsync(90000);
    expect(await timedOutLake).toEqual({
      kind: "unavailable",
      code: "deadline",
      stage: "lake",
      region: null,
      identityVerified: true,
      resourceWrites: 0,
    });
    const stalledRegistry = collectCloudAuditObservation(input(), {
      ...fixture(),
      regions: () => new Promise(() => {}),
    });
    await vi.advanceTimersByTimeAsync(90000);
    expect(await stalledRegistry).toEqual({
      kind: "unavailable",
      code: "deadline",
      stage: "registry",
      region: null,
      identityVerified: false,
      resourceWrites: 0,
    });
    vi.useRealTimers();
    const shared = new AbortController(),
      aborted = fixture();
    let started = 0,
      markStarted = () => {};
    const allStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    aborted.read.mockImplementation((c) => {
      if (c.kind !== "lake") return Promise.resolve(aborted.values[c.kind]);
      return new Promise<string>((_, reject) => {
        shared.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted " + c.region, "AbortError")),
          { once: true },
        );
        started++;
        if (started === 4) markStarted();
      });
    });
    const abortedRun = collectCloudAuditObservation(input(), aborted);
    await allStarted;
    shared.abort();
    expect(await abortedRun).toEqual({
      kind: "unavailable",
      code: "read-unavailable",
      stage: "lake",
      region: null,
      identityVerified: true,
      resourceWrites: 0,
    });
  });
  it("whitelists diagnostic regions against reviewed commercial names and redacts spoofed inputs", async () => {
    for (const spoofed of [
      "us-gov-east-1",
      "cn-north-1",
      "private-region-" + account,
      arn,
      "__proto__",
    ]) {
      for (const mode of ["throw", "malformed"] as const) {
        const f = fixture(),
          base = registry();
        const customRegions = async () =>
          Object.freeze({
            kind: "observed" as const,
            registry: Object.freeze({
              ...base,
              regions: Object.freeze(["af-south-1", spoofed]),
            }),
            resourceWrites: 0 as const,
          });
        f.read.mockImplementation(async (c) => {
          if (c.kind === "lake" && c.region === spoofed) {
            if (mode === "throw") {
              throw new Error("private failure " + spoofed + " " + arn);
            }
            return "{}";
          }
          return f.values[c.kind];
        });
        const outcome = await collectCloudAuditObservation(input(), {
          ...f,
          regions: customRegions,
        });
        expect(outcome).toEqual({
          kind: "unavailable",
          code: mode === "throw" ? "lake-unavailable" : "malformed-response",
          stage: "lake",
          region: null,
          identityVerified: true,
          resourceWrites: 0,
        });
        expect(Object.isFrozen(outcome)).toBe(true);
        expect(Object.keys(outcome).sort()).toEqual([
          "code",
          "identityVerified",
          "kind",
          "region",
          "resourceWrites",
          "stage",
        ]);
        const text = JSON.stringify(outcome);
        expect(text).not.toContain(spoofed);
        expect(text).not.toContain(account);
        expect(text).not.toContain(arn);
      }
    }
  });
});
