import { afterEach, expect, it, vi } from "vitest";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as manifest from "../../infra/cloud/run-manifest.ts";
import {
  cloudCognitoPoolCommand,
  cloudRetainedCognitoPoolCommand,
  collectCloudCognitoPools,
  collectRetainedCloudCognitoPools,
} from "../../infra/cloud/cognito-pool-collisions.ts";
import recipe from "../fixtures/cloud-inventory-v1-recipe.json";
import { name, row, fixture } from "../fixtures/cloud-cognito-pool-pages.ts";

const retained = () => {
  const pin = manifest.normalizeCloudRunManifestPin(recipe.pin);
  return { json: recipe.json, pin: { ...pin, source: { ...pin.source } } };
};
const failure = (code: string) => ({
  kind: "unavailable",
  code,
  resourceWrites: 0,
});
const native = (args: readonly string[]) =>
  JSON.parse(args[args.indexOf("--cli-input-json") + 1]);
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

it("scans original native pages with current factories/writer unavailable and exactly compatible commands", async () => {
  const f = fixture([
      { NextToken: "private-next1", Count: 60, Matches: [row()] },
      { NextToken: "private-next2", Count: 0, Matches: [] },
      { NextToken: null, Count: 1, Matches: [row("us-east-1_Private2")] },
    ]),
    input = retained(),
    expected = [null, "private-next1", "private-next2"].map((t) =>
      cloudCognitoPoolCommand(f.input, t),
    ),
    unavailable = () => {
      throw Error("private current source unavailable");
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
    [null, "private-next1", "private-next2"].map((t) =>
      cloudRetainedCognitoPoolCommand(input, t),
    ),
  ).toEqual(expected);
  const result = await collectRetainedCloudCognitoPools(input, f);
  expect(result).toMatchObject({
    kind: "observed",
    retainedManifestSha256: input.pin.sha256,
    inventorySha256: input.pin.inventorySha256,
    pool: { name, matchingPools: 2, state: "collision" },
    ownership: "unproven",
    fullTargetAbsence: "unproven",
    resourceWrites: 0,
  });
  expect(f.run.mock.calls.map(([args]) => args)).toEqual(expected);
  expect(f.run.mock.calls.map(([args]) => native(args))).toEqual([
    { MaxResults: 60 },
    { MaxResults: 60, NextToken: "private-next1" },
    { MaxResults: 60, NextToken: "private-next2" },
  ]);
  expect(JSON.stringify(result)).not.toMatch(
    /private|Private|NextToken|Matches|LambdaConfig|"Id"/,
  );
  expect(
    f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
  ).toHaveLength(2);
  frozen(result);
  expected.forEach(frozen);
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});

it("keeps original expired scope/digests across mutation and returns only not-listed for an empty scan", async () => {
  const f = fixture(),
    input = retained(),
    original = structuredClone(input),
    identity = f.identity;
  f.identity = async (...args) => {
    input.json = "private replacement";
    input.pin.profile = "foreign";
    input.pin.accountId = "222233334444";
    input.pin.sha256 = "9".repeat(64);
    input.pin.source.commit = "9".repeat(40);
    return identity(...args);
  };
  const result = await collectRetainedCloudCognitoPools(input, f);
  expect(result).toMatchObject({
    kind: "observed",
    retainedManifestSha256: original.pin.sha256,
    inventorySha256: original.pin.inventorySha256,
    expectedIdentity: {
      profile: original.pin.profile,
      accountId: original.pin.accountId,
      region: original.pin.region,
    },
    pool: { name, matchingPools: 0, state: "not-listed" },
    ownership: "unproven",
    fullTargetAbsence: "unproven",
  });
  const prospective = fixture(),
    currentResult = await collectCloudCognitoPools(
      prospective.input,
      prospective,
    );
  expect(currentResult.kind).toBe("observed");
  expect(currentResult).not.toHaveProperty("retainedManifestSha256");
  frozen(result);
});

it("refuses malformed recipes/pins/getters and scope overrides before provider or identity work", async () => {
  const f = fixture(),
    identity = vi.fn(f.identity),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...retained(), profile: "foreign" },
    { ...retained(), name: "foreign" },
    { ...retained(), expected: f.expected },
    { ...retained(), endpoint: "https://foreign.example" },
    { ...retained(), json: recipe.json + " " },
    { ...retained(), pin: { ...retained().pin, sha256: "9".repeat(64) } },
    { ...retained(), pin: { ...retained().pin, accountId: "222233334444" } },
    { ...retained(), pin: { ...retained().pin, region: "us-west-2" } },
    {
      ...retained(),
      pin: {
        ...retained().pin,
        source: { ...retained().pin.source, commit: "9".repeat(40) },
      },
    },
    Object.defineProperty(retained(), "json", { get: getter }),
  ]) {
    const bad = input as ReturnType<typeof retained>;
    expect(
      await collectRetainedCloudCognitoPools(bad, { ...f, identity }),
    ).toEqual(failure("invalid-input"));
    try {
      cloudRetainedCognitoPoolCommand(bad);
      throw Error("invalid accepted");
    } catch (error) {
      expect(error).toMatchObject({
        message: "Cloud Cognito pool observation unavailable",
        code: "invalid-input",
      });
      frozen(error);
    }
  }
  expect(getter).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});

it("refuses malformed native tokens and retains the fixed endpoint/projection without configurable APIs", () => {
  for (const token of ["", "bad\nvalue", "x".repeat(8193), 1, {}])
    expect(() =>
      cloudRetainedCognitoPoolCommand(retained(), token as string),
    ).toThrow();
  const args = cloudRetainedCognitoPoolCommand(retained(), 'private"/+=token');
  expect(native(args)).toEqual({
    MaxResults: 60,
    NextToken: 'private"/+=token',
  });
  expect(args[args.indexOf("--endpoint-url") + 1]).toBe(
    "https://cognito-idp.us-east-1.amazonaws.com",
  );
  for (const forbidden of [
    "list-users",
    "describe-user-pool",
    "--starting-token",
    "--debug",
    "--no-verify-ssl",
  ])
    expect(args).not.toContain(forbidden);
  frozen(args);
});

it("refuses repeated/truncated pages, duplicates, foreign IDs/names and malformed metadata", async () => {
  for (const [pages, code] of [
    [
      [
        { NextToken: "repeat", Count: 0, Matches: [] },
        { NextToken: "repeat", Count: 0, Matches: [] },
      ],
      "pagination-invalid",
    ],
    [
      [
        { NextToken: "next", Count: 1, Matches: [row()] },
        { NextToken: null, Count: 1, Matches: [row()] },
      ],
      "pagination-invalid",
    ],
    [
      [{ NextToken: null, Count: 1, Matches: [row("us-west-2_Private")] }],
      "scope-mismatch",
    ],
    [
      [
        {
          NextToken: null,
          Count: 1,
          Matches: [row("us-east-1_Private", "foreign")],
        },
      ],
      "scope-mismatch",
    ],
    [[{ NextToken: null, Count: 0, Matches: [row()] }], "page-unavailable"],
    [[{ NextToken: null, Count: 61, Matches: [] }], "page-unavailable"],
    [
      [
        {
          NextToken: null,
          Count: 1,
          Matches: [{ ...row(), LambdaConfig: "private" }],
        },
      ],
      "page-unavailable",
    ],
    [
      Array.from({ length: 100 }, (_, i) => ({
        NextToken: "private-" + i,
        Count: 0,
        Matches: [],
      })),
      "pagination-invalid",
    ],
  ] as const) {
    const f = fixture(pages.map((p) => ({ ...p })));
    expect(await collectRetainedCloudCognitoPools(retained(), f)).toEqual(
      failure(code),
    );
  }
});

it("keeps process errors, malformed/private output and oversized responses unavailable", async () => {
  for (const response of [
    { stdout: "x".repeat(65537), stderr: "" },
    {
      stdout: '{"NextToken":null,"Count":0,"Matches":[],"private":"payload"}',
      stderr: "",
    },
    {
      stdout: '{"NextToken":null,"Count":0,"Matches":[]}',
      stderr: "private warning",
    },
  ]) {
    const f = fixture();
    f.run.mockResolvedValue(response);
    expect(await collectRetainedCloudCognitoPools(retained(), f)).toEqual(
      failure("page-unavailable"),
    );
  }
  const f = fixture();
  f.run.mockRejectedValue({
    code: 254,
    stdout: "",
    stderr: '{"Code":"ResourceNotFoundException","Message":"private"}',
  });
  expect(await collectRetainedCloudCognitoPools(retained(), f)).toEqual(
    failure("page-unavailable"),
  );
});

it("requires current configured identity before scanning and refuses final account/role drift", async () => {
  const denied = fixture();
  denied.config["configured-account"] = "222233334444\n";
  expect(await collectRetainedCloudCognitoPools(retained(), denied)).toEqual(
    failure("identity-not-ready"),
  );
  expect(denied.run).not.toHaveBeenCalled();
  for (const role of [false, true]) {
    const f = fixture(),
      base = f.identity;
    let n = 0;
    f.identity = async (...args) => {
      if (++n === 2) {
        if (role) {
          f.config["configured-role"] = "Alternate";
          f.caller.Arn = f.caller.Arn.replace(
            "SSO_Synthetic_",
            "SSO_Alternate_",
          );
        } else f.caller.Account = "222233334444";
      }
      return base(...args);
    };
    expect(await collectRetainedCloudCognitoPools(retained(), f)).toEqual(
      failure(role ? "identity-mismatch" : "identity-not-ready"),
    );
    expect(f.run).toHaveBeenCalledTimes(1);
  }
});

it("preserves pre-abort, current execution clock and default environment protections", async () => {
  const f = fixture(),
    controller = new AbortController();
  controller.abort();
  expect(
    await collectRetainedCloudCognitoPools(retained(), {
      ...f,
      signal: controller.signal,
    }),
  ).toEqual(failure("aborted"));
  expect(f.read).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
  for (const delta of [NaN, -1, 90001]) {
    const bad = fixture(),
      start = bad.clock();
    let n = 0;
    bad.clock = () => (n++ === 0 ? start : start + delta);
    expect(await collectRetainedCloudCognitoPools(retained(), bad)).toEqual(
      failure("clock-invalid"),
    );
  }
  vi.stubEnv("AWS_ENDPOINT_URL", "https://synthetic-override.example");
  expect(await collectRetainedCloudCognitoPools(retained(), f)).toEqual(
    failure("unsupported-environment"),
  );
  expect(f.read).not.toHaveBeenCalled();
});

it.each(["first-identity", "last-identity", "page"] as const)(
  "cancels an ignored %s signal with original-listener cleanup and no late reads",
  async (stage) => {
    vi.useFakeTimers();
    const f = fixture(),
      controller = new AbortController(),
      identity = f.identity,
      run = f.run.getMockImplementation()!;
    let release!: () => void,
      signal!: AbortSignal,
      identities = 0;
    const stall = async (s: AbortSignal) => {
      signal = s;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    f.identity = async (...args) => {
      identities++;
      if (
        (stage === "first-identity" && identities === 1) ||
        (stage === "last-identity" && identities === 2)
      )
        await stall(args[1]!.signal!);
      return identity(...args);
    };
    f.run.mockImplementation(async (args, s) => {
      if (stage === "page") await stall(s);
      return run(args, s);
    });
    const remove = vi.spyOn(controller.signal, "removeEventListener"),
      dependencies = { ...f, signal: controller.signal };
    const pending = collectRetainedCloudCognitoPools(retained(), dependencies);
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toBeTypeOf("function");
    dependencies.signal = new AbortController().signal;
    controller.abort("private reason");
    expect(await pending).toEqual(failure("aborted"));
    expect(signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    const before = {
      reads: f.read.mock.calls.length,
      pages: f.run.mock.calls.length,
    };
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect({
      reads: f.read.mock.calls.length,
      pages: f.run.mock.calls.length,
    }).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("enforces both read and whole-operation deadlines with no late page or identity publication", async () => {
  vi.useFakeTimers();
  for (const identityStall of [false, true]) {
    const f = fixture();
    let release!: () => void;
    const stall = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const identity = async (...args: Parameters<typeof f.identity>) => {
      if (identityStall) await stall();
      return f.identity(...args);
    };
    f.run.mockImplementation(async () => {
      await stall();
      return {
        stdout: '{"NextToken":null,"Count":0,"Matches":[]}',
        stderr: "",
      };
    });
    const pending = collectRetainedCloudCognitoPools(retained(), {
      ...f,
      identity,
    });
    await vi.advanceTimersByTimeAsync(identityStall ? 90001 : 15000);
    expect(await pending).toEqual(failure("deadline"));
    const before = {
      reads: f.read.mock.calls.length,
      pages: f.run.mock.calls.length,
    };
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect({
      reads: f.read.mock.calls.length,
      pages: f.run.mock.calls.length,
    }).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  }
});
