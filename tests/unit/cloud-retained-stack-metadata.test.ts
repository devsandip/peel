import { afterEach, expect, it, vi } from "vitest";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as manifest from "../../infra/cloud/run-manifest.ts";
import {
  cloudRetainedStackCommandArgs,
  cloudStackCommandArgs,
  collectCloudStackMetadata,
  collectRetainedCloudStackMetadata,
  type CloudStackCommand,
} from "../../infra/cloud/stack-metadata.ts";
import recipe from "../fixtures/cloud-inventory-v1-recipe.json";
import { cloudStackFixture } from "../fixtures/cloud-stack-pages.ts";

const retained = () => {
  const pin = manifest.normalizeCloudRunManifestPin(recipe.pin);
  return { json: recipe.json, pin: { ...pin, source: { ...pin.source } } };
};
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function refused(f: ReturnType<typeof cloudStackFixture>, code: string) {
  const result = await collectRetainedCloudStackMetadata(retained(), f);
  expect(result).toEqual({ kind: "unavailable", code, resourceWrites: 0 });
  frozen(result);
}

it("uses the original expired recipe while current factories, name helper and writer are unavailable", async () => {
  const f = cloudStackFixture(),
    input = retained(),
    commands: CloudStackCommand[] = [
      { kind: "stacks", nextToken: null },
      { kind: "stacks", nextToken: 'opaque"/+= token' },
      { kind: "tags", stackId: f.summaries[0].StackId },
      { kind: "resources", stackId: f.summaries[3].StackId, nextToken: "next" },
    ],
    args = commands.map((command) =>
      cloudStackCommandArgs(
        f.input.profile,
        f.expected.accountId,
        f.expected.runId,
        command,
      ),
    ),
    unavailable = () => {
      throw Error("private current factory unavailable");
    },
    spies = [
      vi
        .spyOn(current, "cloudExpectedInventory")
        .mockImplementation(unavailable),
      vi
        .spyOn(hosting, "cloudPrivateHostingTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(hosting, "cloudArtifactBootstrapTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(cleanup, "cloudCleanupGuardTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(cleanup, "cloudCleanupSentinelTemplate")
        .mockImplementation(unavailable),
      vi.spyOn(cleanup, "cloudDevStackNames").mockImplementation(unavailable),
      vi
        .spyOn(data, "cloudDataIdentityTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(manifest, "createCloudRunManifest")
        .mockImplementation(unavailable),
    ];
  expect(
    commands.map((command) => cloudRetainedStackCommandArgs(input, command)),
  ).toEqual(args);
  const result = await collectRetainedCloudStackMetadata(input, f);
  expect(result.kind).toBe("observed");
  if (result.kind !== "observed") throw Error("missing synthetic observation");
  expect(result.retainedManifestSha256).toBe(input.pin.sha256);
  expect(result.inventorySha256).toBe(input.pin.inventorySha256);
  expect(result.stacks.flatMap((s) => s.resources)).toHaveLength(17);
  expect(result).toMatchObject({
    ownership: "unproven",
    targetAbsence: "unproven",
    resourceWrites: 0,
  });
  expect(result.stacks.every((s) => s.missingLogicalIds.length === 0)).toBe(
    true,
  );
  frozen(result);
  expect(JSON.stringify(result)).not.toMatch(/private-session|private current/);
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  const calls = f.read.mock.calls.map(([c]) => c);
  expect(calls.filter((c) => c.kind === "caller-identity")).toHaveLength(2);
  for (const s of f.summaries) {
    expect(
      calls.findIndex((c) => c.kind === "resources" && c.stackId === s.StackId),
    ).toBeGreaterThan(
      calls.findIndex((c) => c.kind === "tags" && c.stackId === s.StackId),
    );
  }
});

it("captures exact selectors and digests before the first await and preserves prospective output", async () => {
  const f = cloudStackFixture(),
    input = retained(),
    original = structuredClone(input),
    identity = vi.fn(async (...args: Parameters<typeof f.identity>) => {
      input.json = "private replacement";
      input.pin.source.commit = "9".repeat(40);
      input.pin.sha256 = "9".repeat(64);
      input.pin.profile = "foreign";
      return f.identity(...args);
    });
  const result = await collectRetainedCloudStackMetadata(input, {
    ...f,
    identity,
  });
  expect(result).toMatchObject({
    kind: "observed",
    retainedManifestSha256: original.pin.sha256,
    inventorySha256: original.pin.inventorySha256,
    expectedIdentity: {
      profile: original.pin.profile,
      accountId: original.pin.accountId,
      region: original.pin.region,
    },
  });
  const prospective = await collectCloudStackMetadata(f.input, f);
  expect(prospective.kind).toBe("observed");
  expect(prospective).not.toHaveProperty("retainedManifestSha256");
});

it("rejects malformed or unpinned inputs and caller scope overrides before identity/provider work", async () => {
  const f = cloudStackFixture(),
    identity = vi.fn(f.identity),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    "private",
    { ...retained(), profile: "foreign" },
    { ...retained(), expected: f.expected },
    { ...retained(), json: recipe.json + " " },
    { ...retained(), pin: { ...retained().pin, sha256: "9".repeat(64) } },
    {
      ...retained(),
      pin: {
        ...retained().pin,
        source: { ...retained().pin.source, commit: "9".repeat(40) },
      },
    },
    { ...retained(), pin: { ...retained().pin, accountId: "222233334444" } },
    { ...retained(), pin: { ...retained().pin, region: "us-west-2" } },
    Object.defineProperty(retained(), "json", { get: getter }),
  ]) {
    expect(
      await collectRetainedCloudStackMetadata(
        input as ReturnType<typeof retained>,
        { ...f, identity },
      ),
    ).toEqual({
      kind: "unavailable",
      code: "invalid-input",
      resourceWrites: 0,
    });
    try {
      cloudRetainedStackCommandArgs(input as ReturnType<typeof retained>, {
        kind: "stacks",
        nextToken: null,
      });
      throw Error("accepted invalid input");
    } catch (error) {
      expect(error).toMatchObject({
        message: "Cloud stack metadata unavailable",
        code: "invalid-input",
      });
      frozen(error);
    }
  }
  expect(getter).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});

it("keeps current configured identity and role checks independent of the retained recipe", async () => {
  const mismatch = cloudStackFixture();
  mismatch.config["configured-account"] = "222233334444\n";
  await refused(mismatch, "identity-not-ready");
  expect(mismatch.read.mock.calls.some(([c]) => c.kind === "stacks")).toBe(
    false,
  );
  const f = cloudStackFixture(),
    base = f.identity;
  let calls = 0;
  f.identity = async (...args) => {
    if (++calls === 2) {
      f.config["configured-role"] = "Alternate";
      f.caller.Arn = f.caller.Arn.replace("SSO_Synthetic_", "SSO_Alternate_");
    }
    return base(...args);
  };
  await refused(f, "identity-mismatch");
  expect(calls).toBe(2);
});

it("retains ARN scope, exact tags, resource catalog and stable-summary checks", async () => {
  for (const [code, edit] of [
    [
      "scope-mismatch",
      (f: ReturnType<typeof cloudStackFixture>) => {
        f.summaries[0].StackId = f.summaries[0].StackId.replace(
          "us-east-1",
          "us-west-2",
        );
      },
    ],
    [
      "tag-scope-mismatch",
      (f: ReturnType<typeof cloudStackFixture>) => {
        f.tags[f.summaries[0].StackId].Mappings[0].Tags[2].Value = "foreign";
      },
    ],
    [
      "scope-mismatch",
      (f: ReturnType<typeof cloudStackFixture>) => {
        f.resources[f.summaries[0].StackId][0].Resources[0].LogicalId =
          "Foreign";
      },
    ],
  ] as const) {
    const f = cloudStackFixture();
    edit(f);
    await refused(f, code);
  }
  const changed = cloudStackFixture(),
    read = changed.read.getMockImplementation()!;
  let scans = 0;
  changed.read.mockImplementation(async (c, s) => {
    if (c.kind === "stacks" && c.nextToken === null && ++scans === 2) {
      const page = structuredClone(changed.stackPages[0]);
      page.Stacks[0].Status = "DELETE_IN_PROGRESS";
      return JSON.stringify(page);
    }
    return read(c, s);
  });
  await refused(changed, "metadata-changed");
});

it("reports empty/deleted/partial coverage without upgrading it to target absence", async () => {
  const f = cloudStackFixture();
  f.summaries[0].Status = "DELETE_COMPLETE";
  f.summaries[3].Status = "CREATE_IN_PROGRESS";
  f.resources[f.summaries[3].StackId][1].Resources.pop();
  const result = await collectRetainedCloudStackMetadata(retained(), f);
  if (result.kind !== "observed") throw Error("missing partial observation");
  expect(result.stacks[0]).toMatchObject({
    state: "deleted-summary",
    tags: null,
    resources: [],
  });
  expect(result.stacks[3].missingLogicalIds).toHaveLength(1);
  expect(result.targetAbsence).toBe("unproven");
  const empty = cloudStackFixture();
  empty.stackPages.splice(0, 2, { NextToken: null, Count: 0, Stacks: [] });
  const absent = await collectRetainedCloudStackMetadata(retained(), empty);
  expect(absent).toMatchObject({ kind: "observed", targetAbsence: "unproven" });
  if (absent.kind === "observed")
    expect(absent.stacks.every((s) => s.state === "not-listed")).toBe(true);
});

it("refuses repeated pages, oversized/private failures and invalid current execution clocks", async () => {
  const repeated = cloudStackFixture();
  repeated.stackPages[1].NextToken = "next";
  await refused(repeated, "page-incomplete");
  for (const response of ["x".repeat(65537), '{"private":"payload"}']) {
    const f = cloudStackFixture();
    f.read.mockResolvedValue(response);
    const good = cloudStackFixture();
    const result = await collectRetainedCloudStackMetadata(retained(), {
      ...f,
      identity: good.identity,
    });
    expect(result).toEqual({
      kind: "unavailable",
      code: "malformed-response",
      resourceWrites: 0,
    });
  }
  const bad = cloudStackFixture();
  const read = bad.read.getMockImplementation()!;
  bad.read.mockImplementation(async (c, s) => {
    if (c.kind === "stacks") throw Error("private provider payload");
    return read(c, s);
  });
  await refused(bad, "read-unavailable");
  for (const delta of [NaN, -1, 90001]) {
    const f = cloudStackFixture(),
      start = f.clock();
    let n = 0;
    f.clock = () => (n++ === 0 ? start : start + delta);
    await refused(f, "clock-invalid");
  }
});

it("cancels before any input or identity work and removes the listener after success", async () => {
  vi.useFakeTimers();
  const f = cloudStackFixture(),
    controller = new AbortController(),
    identity = vi.fn(f.identity);
  controller.abort("private abort reason");
  expect(
    await collectRetainedCloudStackMetadata(
      null as unknown as ReturnType<typeof retained>,
      { ...f, identity, signal: controller.signal },
    ),
  ).toEqual({ kind: "unavailable", code: "aborted", resourceWrites: 0 });
  expect(identity).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  const active = new AbortController(),
    remove = vi.spyOn(active.signal, "removeEventListener");
  expect(
    (
      await collectRetainedCloudStackMetadata(retained(), {
        ...f,
        signal: active.signal,
      })
    ).kind,
  ).toBe("observed");
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["metadata", "first-identity", "last-identity"] as const)(
  "cancels an ignored %s signal promptly and suppresses late work",
  async (stage) => {
    vi.useFakeTimers();
    const f = cloudStackFixture(),
      controller = new AbortController(),
      read = f.read.getMockImplementation()!,
      identity = f.identity;
    let release!: () => void,
      internal!: AbortSignal,
      identities = 0;
    const stall = async (signal: AbortSignal) => {
      internal = signal;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    f.read.mockImplementation(async (c, s) => {
      if (stage === "metadata" && c.kind === "stacks") await stall(s);
      return read(c, s);
    });
    f.identity = async (...args) => {
      if (
        (stage === "first-identity" && ++identities === 1) ||
        (stage === "last-identity" && ++identities === 2)
      )
        await stall(args[1]!.signal!);
      return identity(...args);
    };
    const promise = collectRetainedCloudStackMetadata(retained(), {
      ...f,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toBeTypeOf("function");
    controller.abort("private reason");
    expect(await promise).toEqual({
      kind: "unavailable",
      code: "aborted",
      resourceWrites: 0,
    });
    expect(internal.aborted).toBe(true);
    const before = f.read.mock.calls.length;
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.read.mock.calls.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("expires a stalled retained observation without accepting its late response", async () => {
  vi.useFakeTimers();
  const f = cloudStackFixture();
  let release!: (value: string) => void, signal!: AbortSignal;
  f.read.mockImplementation(async (_c, s) => {
    signal = s;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  });
  const good = cloudStackFixture();
  const promise = collectRetainedCloudStackMetadata(retained(), {
    ...f,
    identity: good.identity,
  });
  await vi.advanceTimersByTimeAsync(90001);
  expect(await promise).toEqual({
    kind: "unavailable",
    code: "deadline",
    resourceWrites: 0,
  });
  expect(signal.aborted).toBe(true);
  const before = f.read.mock.calls.length;
  release(JSON.stringify(f.stackPages[0]));
  await vi.advanceTimersByTimeAsync(1);
  expect(f.read.mock.calls.length).toBe(before);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps retained command selectors closed and rejects forbidden commands and foreign ARNs", () => {
  const f = cloudStackFixture();
  for (const command of [
    { kind: "describe-stacks" },
    { kind: "stacks", nextToken: null, profile: "foreign" },
    {
      kind: "resources",
      stackId: f.summaries[0].StackId.replace("111122223333", "222233334444"),
      nextToken: null,
    },
    { kind: "tags", stackId: f.summaries[0].StackId + "/foreign" },
    { kind: "stacks", nextToken: "--endpoint-url\nprivate" },
  ])
    expect(() =>
      cloudRetainedStackCommandArgs(retained(), command as CloudStackCommand),
    ).toThrow("Cloud stack metadata unavailable");
});
