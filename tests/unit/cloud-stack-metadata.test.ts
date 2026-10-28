import { afterEach, expect, it, vi } from "vitest";
import {
  cloudStackCommandArgs,
  collectCloudStackMetadata,
  type CloudStackCommand,
} from "../../infra/cloud/stack-metadata.ts";
import { cloudStackFixture } from "../fixtures/cloud-stack-pages.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const resultCode = async (
  f: ReturnType<typeof cloudStackFixture>,
  code: string,
) => {
  const result = await collectCloudStackMetadata(f.input, f);
  expect(result).toEqual({ kind: "unavailable", code, resourceWrites: 0 });
};
it("collects complete exact metadata across native pages, with configured identity and tag checks before resources", async () => {
  const f = cloudStackFixture(),
    result = await collectCloudStackMetadata(f.input, f);
  expect(result.kind).toBe("observed");
  if (result.kind !== "observed") throw Error("missing synthetic observation");
  expect(result.stacks.flatMap((s) => s.resources)).toHaveLength(17);
  expect(
    result.stacks.every(
      (s) => s.state === "listed" && s.missingLogicalIds.length === 0,
    ),
  ).toBe(true);
  expect(result.ownership).toBe("unproven");
  expect(result.targetAbsence).toBe("unproven");
  expect(result.inventorySha256).toBe(f.expected.inventorySha256);
  const calls = f.read.mock.calls.map(([c]) => c);
  expect(calls[0]).toEqual({ kind: "history-setting" });
  expect(calls.filter((c) => c.kind === "caller-identity")).toHaveLength(2);
  expect(calls.filter((c) => c.kind === "stacks")).toEqual([
    { kind: "stacks", nextToken: null },
    { kind: "stacks", nextToken: "next" },
    { kind: "stacks", nextToken: null },
    { kind: "stacks", nextToken: "next" },
  ]);
  for (const summary of f.summaries) {
    const tags = calls.findIndex(
        (c) => c.kind === "tags" && c.stackId === summary.StackId,
      ),
      resources = calls.findIndex(
        (c) => c.kind === "resources" && c.stackId === summary.StackId,
      );
    expect(tags).toBeGreaterThan(6);
    expect(resources).toBeGreaterThan(tags);
  }
  // Bucket/policy names are legitimately equal across different resource types.
  expect(result.stacks[0].resources[0].physicalId).toBe(
    result.stacks[0].resources[1].physicalId,
  );
  const frozen = (v: unknown) => {
    if (v && typeof v === "object") {
      expect(Object.isFrozen(v)).toBe(true);
      Object.values(v).forEach(frozen);
    }
  };
  frozen(result);
  expect(JSON.stringify(result)).not.toContain("private-session");
  expect(result.resourceWrites).toBe(0);
});

it("keeps not-listed, deleted-summary and partial-creation coverage explicit without claiming resource absence", async () => {
  const empty = cloudStackFixture();
  empty.stackPages.splice(0, 2, { NextToken: null, Count: 0, Stacks: [] });
  const absent = await collectCloudStackMetadata(empty.input, empty);
  if (absent.kind !== "observed") throw Error("missing summary");
  expect(
    absent.stacks.every(
      (s) =>
        s.state === "not-listed" &&
        s.stackId === null &&
        s.missingLogicalIds.length > 0,
    ),
  ).toBe(true);
  expect(
    empty.read.mock.calls.some(([c]) => ["tags", "resources"].includes(c.kind)),
  ).toBe(false);
  expect(absent.targetAbsence).toBe("unproven");
  const f = cloudStackFixture(),
    deleted = f.summaries[2],
    partial = f.summaries[3];
  deleted.Status = "DELETE_COMPLETE";
  partial.Status = "CREATE_IN_PROGRESS";
  f.resources[partial.StackId][1].Resources.pop();
  f.resources[partial.StackId][0].Resources[0].PhysicalId = null;
  f.resources[partial.StackId][0].Resources[0].Status = "CREATE_IN_PROGRESS";
  const result = await collectCloudStackMetadata(f.input, f);
  if (result.kind !== "observed") throw Error("missing partial summary");
  expect(result.stacks[2]).toMatchObject({
    state: "deleted-summary",
    status: "DELETE_COMPLETE",
    tags: null,
    resources: [],
  });
  expect(
    f.read.mock.calls.some(
      ([c]) =>
        (c.kind === "tags" || c.kind === "resources") &&
        c.stackId === deleted.StackId,
    ),
  ).toBe(false);
  expect(result.stacks[3].missingLogicalIds).toHaveLength(1);
  expect(result.stacks[3].resources.some((r) => r.physicalId === null)).toBe(
    true,
  );
  // Fixture lease expired many hours earlier; no new-run cutoff or credential export is used.
  expect(result.checkedAt).toBe("2026-10-28T01:00:00.000Z");
});

it("composes the current inspection gate and blocks metadata when it cannot authenticate", async () => {
  const f = cloudStackFixture();
  f.config["history-setting"] = "enabled";
  await resultCode(f, "identity-not-ready");
  expect(f.read.mock.calls.map(([c]) => c.kind)).toEqual(["history-setting"]);
  const mismatch = cloudStackFixture();
  mismatch.caller.Account = "222233334444";
  await resultCode(mismatch, "identity-not-ready");
  expect(mismatch.read.mock.calls.some(([c]) => c.kind === "stacks")).toBe(
    false,
  );
});

it("rejects account/region/partition/name/ID and duplicate summary drift before resource discovery", async () => {
  for (const edit of [
    (s: any) => {
      s.StackId = s.StackId.replace("111122223333", "222233334444");
    },
    (s: any) => {
      s.StackId = s.StackId.replace("us-east-1", "us-west-2");
    },
    (s: any) => {
      s.StackId = s.StackId.replace("arn:aws:", "arn:aws-us-gov:");
    },
    (s: any) => {
      s.StackName += "-foreign";
    },
    (s: any) => {
      s.StackId += "-foreign";
    },
  ]) {
    const f = cloudStackFixture();
    edit(f.summaries[0]);
    await resultCode(f, "scope-mismatch");
    expect(f.read.mock.calls.some(([c]) => c.kind === "tags")).toBe(false);
  }
  const duplicate = cloudStackFixture();
  duplicate.stackPages[1].Stacks[0] = duplicate.summaries[0];
  await resultCode(duplicate, "scope-mismatch");
  const unknown = cloudStackFixture();
  unknown.summaries[0].Status = "FUTURE_UNREVIEWED_STATUS";
  await resultCode(unknown, "malformed-response");
});

it("requires exact complete run-tag mappings without pagination or a generic missing-resource inference", async () => {
  for (const edit of [
    (d: any) => {
      d.Mappings = [];
    },
    (d: any) => {
      d.Mappings[0].Arn += "-foreign";
    },
    (d: any) => {
      d.Mappings[0].Tags.pop();
    },
    (d: any) => {
      d.Mappings[0].Tags[2].Value = "foreign";
    },
    (d: any) => {
      d.Mappings[0].Tags[1] = d.Mappings[0].Tags[0];
    },
  ]) {
    const f = cloudStackFixture();
    edit(f.tags[f.summaries[0].StackId]);
    await resultCode(f, "tag-scope-mismatch");
    expect(f.read.mock.calls.some(([c]) => c.kind === "resources")).toBe(false);
  }
  const paged = cloudStackFixture();
  paged.tags[paged.summaries[0].StackId].PaginationToken =
    "unsupported-continuation";
  await resultCode(paged, "page-incomplete");
});

it("rejects unknown/duplicate/truncated resources and foreign physical ARN scope while preserving typed shared names", async () => {
  for (const [edit, code] of [
    [
      (r: any) => {
        r.LogicalId = "UnknownResource";
      },
      "scope-mismatch",
    ],
    [
      (r: any) => {
        r.Type = "AWS::S3::BucketPolicy";
      },
      "scope-mismatch",
    ],
    [
      (r: any) => {
        r.Status = "FUTURE_UNREVIEWED_STATUS";
      },
      "malformed-response",
    ],
    [
      (r: any) => {
        r.PhysicalId = "arn:aws:s3:::";
      },
      "scope-mismatch",
    ],
    [
      (r: any) => {
        r.PhysicalId = "invalid\nprivate";
      },
      "malformed-response",
    ],
  ] as const) {
    const f = cloudStackFixture();
    edit(f.resources[f.summaries[0].StackId][0].Resources[0]);
    await resultCode(f, code);
  }
  for (const physicalId of [
    "arn:aws:dynamodb:us-west-2:111122223333:table/foreign",
    "arn:aws:dynamodb:us-east-1:222233334444:table/foreign",
    "arn:aws:lambda:us-east-1:111122223333:function/foreign",
  ]) {
    const f = cloudStackFixture();
    f.resources[f.summaries[2].StackId][0].Resources[0].PhysicalId = physicalId;
    await resultCode(f, "scope-mismatch");
  }
  const duplicate = cloudStackFixture(),
    rows = duplicate.resources[duplicate.summaries[0].StackId][0].Resources;
  rows[1] = rows[0];
  await resultCode(duplicate, "scope-mismatch");
  const sameType = cloudStackFixture();
  sameType.resources[sameType.summaries[3].StackId][0].Resources[0].PhysicalId =
    sameType.resources[
      sameType.summaries[2].StackId
    ][0].Resources[0].PhysicalId;
  await resultCode(sameType, "scope-mismatch");
  for (const edit of [
    (r: any[]) => {
      r.pop();
    },
    (r: any[]) => {
      r[0].PhysicalId = null;
    },
  ]) {
    const f = cloudStackFixture();
    edit(f.resources[f.summaries[0].StackId][0].Resources);
    await resultCode(f, "page-incomplete");
  }
});

it("rejects repeated/malformed or unbounded continuation instead of truncating coverage", async () => {
  const repeated = cloudStackFixture();
  repeated.stackPages[1] = { NextToken: "next", Count: 0, Stacks: [] };
  await resultCode(repeated, "page-incomplete");
  const huge = cloudStackFixture();
  huge.stackPages[0].Count = 10001;
  await resultCode(huge, "page-incomplete");
  const malformed = cloudStackFixture();
  malformed.stackPages[0].NextToken = "x".repeat(1025);
  await resultCode(malformed, "malformed-response");
  const resourceLoop = cloudStackFixture();
  resourceLoop.resources[resourceLoop.summaries[0].StackId] = [
    { NextToken: "next", Resources: [] },
    { NextToken: "next", Resources: [] },
  ];
  await resultCode(resourceLoop, "page-incomplete");
  const pages = cloudStackFixture(),
    read = pages.read.getMockImplementation()!;
  let n = 0;
  pages.read.mockImplementation(async (c, signal) =>
    c.kind === "stacks"
      ? JSON.stringify({ Count: 0, Stacks: [], NextToken: "t" + n++ })
      : read(c, signal),
  );
  await resultCode(pages, "page-incomplete");
  expect(n).toBe(100);
  const resources = cloudStackFixture(),
    baseRead = resources.read.getMockImplementation()!;
  let r = 0;
  resources.read.mockImplementation(async (c, signal) =>
    c.kind === "resources"
      ? JSON.stringify({ Resources: [], NextToken: "t" + r++ })
      : baseRead(c, signal),
  );
  await resultCode(resources, "page-incomplete");
  expect(r).toBe(8);
});

it("rechecks identity and stack stability and snapshots inputs before awaits", async () => {
  const drift = cloudStackFixture(),
    read = drift.read.getMockImplementation()!;
  let calls = 0;
  drift.read.mockImplementation(async (c, signal) => {
    if (c.kind === "caller-identity" && ++calls === 2)
      return JSON.stringify({ ...drift.caller, Account: "222233334444" });
    return read(c, signal);
  });
  await resultCode(drift, "identity-not-ready");
  const role = cloudStackFixture(),
    roleRead = role.read.getMockImplementation()!;
  let roleScans = 0;
  role.read.mockImplementation(async (c, signal) => {
    if (c.kind === "stacks" && c.nextToken === null && ++roleScans === 2) {
      role.config["configured-role"] = "Alternate";
      role.caller.Arn = role.caller.Arn.replace(
        "SSO_Synthetic_",
        "SSO_Alternate_",
      );
    }
    return roleRead(c, signal);
  });
  await resultCode(role, "identity-mismatch");
  const changed = cloudStackFixture(),
    baseRead = changed.read.getMockImplementation()!;
  let scans = 0;
  changed.read.mockImplementation(async (c, signal) => {
    if (c.kind === "stacks" && c.nextToken === null && ++scans === 2) {
      const page = structuredClone(changed.stackPages[0]);
      page.Stacks[0].Status = "DELETE_IN_PROGRESS";
      return JSON.stringify(page);
    }
    return baseRead(c, signal);
  });
  await resultCode(changed, "metadata-changed");
  const mutate = cloudStackFixture(),
    originalRead = mutate.read.getMockImplementation()!;
  mutate.read.mockImplementation(async (c, signal) => {
    mutate.input.profile = "foreign";
    mutate.input.inventory.accountId = "222233334444";
    mutate.input.inventory.runId = "changed";
    return originalRead(c, signal);
  });
  const result = await collectCloudStackMetadata(mutate.input, mutate);
  expect(result.kind).toBe("observed");
  if (result.kind === "observed")
    expect(result.expectedIdentity).toEqual({
      profile: "synthetic-dev",
      accountId: "111122223333",
      region: "us-east-1",
    });
});

it("returns fixed private failures for CLI errors, oversized/extra responses and invalid clocks", async () => {
  for (const invalid of [
    JSON.stringify({
      NextToken: null,
      Count: 0,
      Stacks: [],
      Outputs: ["private-value"],
    }),
    "x".repeat(65537),
  ]) {
    const f = cloudStackFixture(),
      read = f.read.getMockImplementation()!;
    f.read.mockImplementation(async (c, s) =>
      c.kind === "stacks" ? invalid : read(c, s),
    );
    await resultCode(f, "malformed-response");
  }
  const f = cloudStackFixture(),
    read = f.read.getMockImplementation()!;
  f.read.mockImplementation(async (c, s) => {
    if (c.kind === "stacks")
      throw Object.assign(Error("private-request"), {
        code: 254,
        stderr: '{"Code":"ValidationError","Message":"private-response"}',
        stdout: "",
      });
    return read(c, s);
  });
  await resultCode(f, "read-unavailable");
  for (const time of [-1, NaN, Number.MAX_SAFE_INTEGER]) {
    const clock = cloudStackFixture();
    clock.clock = () => time;
    await resultCode(clock, "clock-invalid");
  }
  for (const delta of [-1, 90001]) {
    const clock = cloudStackFixture();
    let n = 0;
    const start = clock.clock();
    clock.clock = () => (n++ === 0 ? start : start + delta);
    await resultCode(clock, "clock-invalid");
  }
});

it("aborts a stalled or late reader at the global deadline and never resumes metadata reads", async () => {
  vi.useFakeTimers();
  const f = cloudStackFixture(),
    read = f.read.getMockImplementation()!;
  let signal: AbortSignal | undefined,
    release: ((value: string) => void) | undefined;
  f.read.mockImplementation(async (c, s) => {
    if (c.kind === "stacks") {
      signal = s;
      return await new Promise<string>((resolve) => {
        release = resolve;
      });
    }
    return read(c, s);
  });
  const promise = collectCloudStackMetadata(f.input, f);
  await vi.advanceTimersByTimeAsync(90001);
  expect(await promise).toEqual({
    kind: "unavailable",
    code: "deadline",
    resourceWrites: 0,
  });
  expect(signal?.aborted).toBe(true);
  const before = f.read.mock.calls.length;
  release!(JSON.stringify({ NextToken: null, Count: 0, Stacks: [] }));
  await vi.advanceTimersByTimeAsync(1);
  expect(f.read.mock.calls.length).toBe(before);
});

it("rejects malformed inputs and environment overrides before spawning any real CLI command", async () => {
  const f = cloudStackFixture(),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...f.input, profile: "bad\nprofile" },
    { ...f.input, extra: true },
    Object.defineProperty({ ...f.input }, "profile", { get: getter }),
    { ...f.input, inventory: { ...f.input.inventory, region: "us-west-2" } },
  ])
    expect(await collectCloudStackMetadata(input as typeof f.input, f)).toEqual(
      { kind: "unavailable", code: "invalid-input", resourceWrites: 0 },
    );
  expect(f.read).not.toHaveBeenCalled();
  expect(getter).not.toHaveBeenCalled();
  vi.stubEnv("AWS_ACCESS_KEY_ID", "synthetic-environment-override");
  expect(await collectCloudStackMetadata(f.input)).toEqual({
    kind: "unavailable",
    code: "unsupported-environment",
    resourceWrites: 0,
  });
});

it("builds only exact projected metadata commands, using native token JSON with pagination disabled", () => {
  const f = cloudStackFixture(),
    args = (c: CloudStackCommand) =>
      cloudStackCommandArgs(
        f.input.profile,
        f.expected.accountId,
        f.expected.runId,
        c,
      ),
    list = args({ kind: "stacks", nextToken: "next" }),
    resources = args({
      kind: "resources",
      stackId: f.summaries[0].StackId,
      nextToken: "next",
    }),
    tags = args({ kind: "tags", stackId: f.summaries[0].StackId });
  for (const command of [list, resources, tags]) {
    expect(command).toContain("--no-paginate");
    expect(command).not.toContain("--starting-token");
    expect(command).not.toContain("--no-verify-ssl");
    expect(command).not.toContain("--debug");
    for (const forbidden of [
      "describe-stacks",
      "get-template",
      "describe-stack-events",
      "StackStatusReason",
      "ResourceStatusReason",
      "Parameters",
      "Outputs",
      "Environment.Variables",
    ])
      expect(command.join(" ")).not.toContain(forbidden);
  }
  expect(JSON.parse(list[list.indexOf("--cli-input-json") + 1])).toEqual({
    NextToken: "next",
  });
  expect(
    JSON.parse(resources[resources.indexOf("--cli-input-json") + 1]),
  ).toEqual({ StackName: f.summaries[0].StackId, NextToken: "next" });
  expect(tags).toContain("https://tagging.us-east-1.amazonaws.com");
  expect(tags).not.toContain("--pagination-token");
  expect(tags).not.toContain("--tag-filters");
  for (const stack of f.expected.stacks)
    expect(list[list.indexOf("--query") + 1]).toContain(stack.name);
  for (const command of [
    { kind: "session-expiration" },
    { kind: "stacks", nextToken: null, extra: "private" },
    {
      kind: "tags",
      stackId: f.summaries[0].StackId.replace("us-east-1", "us-west-2"),
    },
  ])
    expect(() => args(command as CloudStackCommand)).toThrow(
      "Cloud stack metadata unavailable",
    );
});
