import { afterEach, expect, it, vi } from "vitest";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as manifest from "../../infra/cloud/run-manifest.ts";
import {
  cloudRetainedFixedTargetCommands,
  collectRetainedCloudFixedTargets,
  collectCloudFixedTargets,
} from "../../infra/cloud/fixed-target-metadata.ts";
import recipe from "../fixtures/cloud-inventory-v1-recipe.json";
import { cloudFixedTargetFixture as fixture } from "../fixtures/cloud-fixed-target-pages.ts";

const retained = () => {
  const pin = manifest.normalizeCloudRunManifestPin(recipe.pin);
  return { json: recipe.json, pin: { ...pin, source: { ...pin.source } } };
};
const unavailable = (code: string) => ({
  kind: "unavailable",
  code,
  resourceWrites: 0,
});
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

it("observes the original eight selectors with exact commands while current factories and writer are unavailable", async () => {
  const f = fixture(),
    input = retained(),
    unavailableFactory = () => {
      throw Error("private current source unavailable");
    },
    spies = [
      vi
        .spyOn(current, "cloudExpectedInventory")
        .mockImplementation(unavailableFactory),
      vi
        .spyOn(hosting, "cloudPrivateHostingTemplate")
        .mockImplementation(unavailableFactory),
      vi
        .spyOn(hosting, "cloudArtifactBootstrapTemplate")
        .mockImplementation(unavailableFactory),
      vi
        .spyOn(cleanup, "cloudCleanupGuardTemplate")
        .mockImplementation(unavailableFactory),
      vi
        .spyOn(cleanup, "cloudCleanupSentinelTemplate")
        .mockImplementation(unavailableFactory),
      vi
        .spyOn(cleanup, "cloudDevStackNames")
        .mockImplementation(unavailableFactory),
      vi
        .spyOn(data, "cloudDataIdentityTemplate")
        .mockImplementation(unavailableFactory),
      vi
        .spyOn(manifest, "createCloudRunManifest")
        .mockImplementation(unavailableFactory),
    ];
  const commands = cloudRetainedFixedTargetCommands(input);
  expect(commands).toEqual(f.commands);
  frozen(commands);
  const result = await collectRetainedCloudFixedTargets(input, f);
  expect(result).toMatchObject({
    kind: "observed",
    retainedManifestSha256: input.pin.sha256,
    inventorySha256: input.pin.inventorySha256,
    scope: "eight-fixed-non-bucket-targets",
    ownership: "unproven",
    fullTargetAbsence: "unproven",
    resourceWrites: 0,
  });
  if (result.kind !== "observed") throw Error("missing synthetic observation");
  expect(result.targets).toHaveLength(8);
  expect(result.targets.every((t) => t.state === "collision")).toBe(true);
  expect(f.run.mock.calls.map(([args]) => args)).toEqual(
    commands.map((c) => c.args),
  );
  expect(
    f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
  ).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(
    /private-session|Ab12Cd|Tags|Policy|Found|"Arn"/,
  );
  frozen(result);
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});

it.each(["all", "one"] as const)(
  "keeps %s documented not-found responses partial and does not retain provider payloads",
  async (selection) => {
    const f = fixture();
    f.commands.forEach((c) => {
      if (selection === "all" || c.logicalId === "CloudTable")
        f.missing.add(c.logicalId);
    });
    const result = await collectRetainedCloudFixedTargets(retained(), f);
    if (result.kind !== "observed")
      throw Error("missing synthetic not-found observation");
    expect(result.targets.filter((t) => t.state === "not-found")).toHaveLength(
      selection === "all" ? 8 : 1,
    );
    expect(result.targets.filter((t) => t.state === "collision")).toHaveLength(
      selection === "all" ? 0 : 7,
    );
    expect(result.fullTargetAbsence).toBe("unproven");
    expect(result.ownership).toBe("unproven");
    expect(result.retainedManifestSha256).toBe(recipe.pin.sha256);
    expect(JSON.stringify(result)).not.toMatch(
      /private-provider|private-value|Message|Extra/,
    );
    frozen(result);
  },
);

it("captures original expired scope and digests before identity awaits and preserves prospective output", async () => {
  const f = fixture(),
    input = retained(),
    original = structuredClone(input),
    base = f.identity;
  f.identity = async (...args) => {
    input.json = "private replacement";
    input.pin.profile = "foreign";
    input.pin.sha256 = "9".repeat(64);
    input.pin.source.commit = "9".repeat(40);
    return base(...args);
  };
  const result = await collectRetainedCloudFixedTargets(input, f);
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
  const prospective = await collectCloudFixedTargets(f.input, f);
  expect(prospective.kind).toBe("observed");
  expect(prospective).not.toHaveProperty("retainedManifestSha256");
});

it("refuses changed pins, malformed recipes, getters and caller scope overrides without identity/provider work", async () => {
  const f = fixture(),
    getter = vi.fn(() => "private"),
    identity = vi.fn(f.identity);
  for (const input of [
    null,
    { ...retained(), profile: "foreign" },
    { ...retained(), endpoint: "https://foreign.example" },
    { ...retained(), targets: f.commands },
    { ...retained(), expected: f.expected },
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
      await collectRetainedCloudFixedTargets(bad, { ...f, identity }),
    ).toEqual(unavailable("invalid-input"));
    try {
      cloudRetainedFixedTargetCommands(bad);
      throw Error("invalid input accepted");
    } catch (error) {
      expect(error).toMatchObject({
        message: "Cloud fixed-target metadata unavailable",
        code: "invalid-input",
      });
      frozen(error);
    }
  }
  expect(getter).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});

it("checks current configured identity and role again after the original-target reads", async () => {
  const denied = fixture();
  denied.config["configured-account"] = "222233334444\n";
  expect(await collectRetainedCloudFixedTargets(retained(), denied)).toEqual(
    unavailable("identity-not-ready"),
  );
  expect(denied.run).not.toHaveBeenCalled();
  for (const role of [false, true]) {
    const f = fixture(),
      base = f.identity;
    let calls = 0;
    f.identity = async (...args) => {
      if (++calls === 2) {
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
    expect(await collectRetainedCloudFixedTargets(retained(), f)).toEqual(
      unavailable(role ? "identity-mismatch" : "identity-not-ready"),
    );
    expect(f.run).toHaveBeenCalledTimes(8);
  }
});

it("refuses denied, wrong, partial or private malformed failures instead of treating them as not-found", async () => {
  for (const error of [
    {
      code: 254,
      stdout: "",
      stderr: '{"Code":"AccessDenied","Message":"private"}',
    },
    { code: 254, stdout: "", stderr: '{"Code":"ResourceNotFoundException"}' },
    { code: 254, stdout: "private partial", stderr: '{"Code":"NoSuchEntity"}' },
    { code: 254, stdout: "", stderr: '{"Code":"NoSuchEntity"}', killed: true },
    { code: 254, stdout: "", stderr: "private malformed" },
  ]) {
    const f = fixture();
    f.run.mockRejectedValue(error);
    const result = await collectRetainedCloudFixedTargets(retained(), f);
    expect(result).toEqual(unavailable("target-unavailable"));
    frozen(result);
    expect(f.run).toHaveBeenCalledTimes(1);
  }
  for (const response of [
    { stdout: '{"Found":false}', stderr: "" },
    { stdout: '{"Found":true,"SecretString":"private"}', stderr: "" },
    { stdout: '{"Found":true}', stderr: "private warning" },
    { stdout: "x".repeat(65537), stderr: "" },
  ]) {
    const f = fixture();
    f.run.mockResolvedValue(response);
    expect(await collectRetainedCloudFixedTargets(retained(), f)).toEqual(
      unavailable("target-unavailable"),
    );
  }
});

it("rejects returned foreign account, region, name and secret suffix scopes", async () => {
  for (const change of [
    (d: any) => {
      d.Name += "-foreign";
    },
    (d: any) => {
      d.Arn = d.Arn.replace("111122223333", "222233334444");
    },
    (d: any) => {
      d.Arn = d.Arn.replace("us-east-1", "us-west-2");
    },
    (d: any) => {
      d.Arn += "\n";
    },
  ]) {
    const f = fixture(),
      base = f.run.getMockImplementation()!;
    f.run.mockImplementation(async (args, signal) => {
      const response = await base(args, signal);
      if (args.includes("describe-secret")) {
        const d = JSON.parse(response.stdout);
        change(d);
        response.stdout = JSON.stringify(d);
      }
      return response;
    });
    expect(await collectRetainedCloudFixedTargets(retained(), f)).toEqual(
      unavailable("scope-mismatch"),
    );
  }
});

it("keeps current execution clock, pre-abort and default-runner environment gates", async () => {
  for (const delta of [NaN, -1, 90001]) {
    const f = fixture(),
      start = f.clock();
    let n = 0;
    f.clock = () => (n++ === 0 ? start : start + delta);
    expect(await collectRetainedCloudFixedTargets(retained(), f)).toEqual(
      unavailable("clock-invalid"),
    );
  }
  const f = fixture(),
    cancelled = new AbortController();
  cancelled.abort("private reason");
  expect(
    await collectRetainedCloudFixedTargets(retained(), {
      ...f,
      signal: cancelled.signal,
    }),
  ).toEqual(unavailable("aborted"));
  expect(f.run).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  vi.stubEnv("AWS_ENDPOINT_URL", "https://synthetic-override.example");
  expect(
    await collectRetainedCloudFixedTargets(retained(), {
      identity: f.identity,
    }),
  ).toEqual(unavailable("unsupported-environment"));
  expect(f.read).not.toHaveBeenCalled();
});

it.each(["runner", "first-identity", "last-identity"] as const)(
  "cancels an ignored %s signal and suppresses late work",
  async (stage) => {
    vi.useFakeTimers();
    const f = fixture(),
      controller = new AbortController(),
      run = f.run.getMockImplementation()!,
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
    f.run.mockImplementation(async (args, signal) => {
      if (stage === "runner") await stall(signal);
      return run(args, signal);
    });
    f.identity = async (...args) => {
      identities++;
      if (
        (stage === "first-identity" && identities === 1) ||
        (stage === "last-identity" && identities === 2)
      )
        await stall(args[1]!.signal!);
      return identity(...args);
    };
    const originalSignal = controller.signal,
      remove = vi.spyOn(originalSignal, "removeEventListener"),
      dependencies = { ...f, signal: originalSignal };
    const promise = collectRetainedCloudFixedTargets(retained(), dependencies);
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toBeTypeOf("function");
    dependencies.signal = new AbortController().signal;
    controller.abort("private reason");
    expect(await promise).toEqual(unavailable("aborted"));
    expect(internal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    const before = {
      reads: f.read.mock.calls.length,
      runs: f.run.mock.calls.length,
    };
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect({
      reads: f.read.mock.calls.length,
      runs: f.run.mock.calls.length,
    }).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("expires a stalled original-target read without accepting its late result", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let release!: () => void, internal!: AbortSignal;
  f.run.mockImplementation(async (_args, signal) => {
    internal = signal;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { stdout: '{"Found":true}', stderr: "" };
  });
  const promise = collectRetainedCloudFixedTargets(retained(), f);
  await vi.advanceTimersByTimeAsync(90001);
  expect(await promise).toEqual(unavailable("deadline"));
  expect(internal.aborted).toBe(true);
  const before = f.read.mock.calls.length;
  release();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.run).toHaveBeenCalledTimes(1);
  expect(f.read.mock.calls.length).toBe(before);
  expect(vi.getTimerCount()).toBe(0);
});
