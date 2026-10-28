import { afterEach, expect, it, vi } from "vitest";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as manifest from "../../infra/cloud/run-manifest.ts";
import {
  cloudCognitoDomainCommand,
  cloudRetainedCognitoDomainCommand,
  collectCloudCognitoDomain,
  collectRetainedCloudCognitoDomain,
} from "../../infra/cloud/cognito-domain-collisions.ts";
import recipe from "../fixtures/cloud-inventory-v1-recipe.json";
import {
  name,
  metadata,
  empty,
  response,
  fixture,
  missing,
} from "../fixtures/cloud-cognito-domain-response.ts";

const retained = () => {
  const pin = manifest.normalizeCloudRunManifestPin(recipe.pin);
  return { json: recipe.json, pin: { ...pin, source: { ...pin.source } } };
};
const failure = (code: string) => ({
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

it("observes the original prefix with exact compatible commands while current factories/writer are unavailable", async () => {
  const f = fixture(),
    input = retained(),
    expected = cloudCognitoDomainCommand(f.input),
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
  const command = cloudRetainedCognitoDomainCommand(input);
  expect(command).toEqual(expected);
  frozen(command);
  expect(JSON.parse(command[command.indexOf("--cli-input-json") + 1])).toEqual({
    Domain: name,
  });
  const result = await collectRetainedCloudCognitoDomain(input, f);
  expect(result).toMatchObject({
    kind: "observed",
    retainedManifestSha256: input.pin.sha256,
    inventorySha256: input.pin.inventorySha256,
    domain: { name, state: "collision", ownerMatchesExpected: true },
    ownership: "unproven",
    fullTargetAbsence: "unproven",
    resourceWrites: 0,
  });
  expect(f.run).toHaveBeenCalledTimes(1);
  expect(f.run.mock.calls[0][0]).toEqual(command);
  expect(
    f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
  ).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(
    /Private1|PoolId|Status|private-message/,
  );
  frozen(result);
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});

it("captures original expired selectors/digests before awaits while prospective output remains compatible", async () => {
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
  expect(await collectRetainedCloudCognitoDomain(input, f)).toMatchObject({
    kind: "observed",
    retainedManifestSha256: original.pin.sha256,
    inventorySha256: original.pin.inventorySha256,
    expectedIdentity: {
      profile: original.pin.profile,
      accountId: original.pin.accountId,
      region: original.pin.region,
    },
    domain: { name, ownerMatchesExpected: true },
  });
  const legacy = fixture(),
    result = await collectCloudCognitoDomain(legacy.input, legacy);
  expect(result.kind).toBe("observed");
  expect(result).not.toHaveProperty("retainedManifestSha256");
});

it("rejects malformed pins/recipes/getters and caller graph/domain/endpoint overrides before any identity/provider work", async () => {
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
      await collectRetainedCloudCognitoDomain(bad, { ...f, identity }),
    ).toEqual(failure("invalid-input"));
    try {
      cloudRetainedCognitoDomainCommand(bad);
      throw Error("invalid accepted");
    } catch (error) {
      expect(error).toMatchObject({
        message: "Cloud Cognito domain observation unavailable",
        code: "invalid-input",
      });
      frozen(error);
    }
  }
  expect(getter).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled();
  expect(f.run).not.toHaveBeenCalled();
});

it("keeps every valid lifecycle and foreign owner a collision without returning provider IDs/status", async () => {
  for (const Status of ["CREATING", "DELETING", "UPDATING", "ACTIVE", "FAILED"])
    for (const foreign of [false, true]) {
      const f = fixture({
        ...metadata(),
        Status,
        AccountId: foreign ? "222233334444" : "111122223333",
      });
      const result = await collectRetainedCloudCognitoDomain(retained(), f);
      expect(result).toMatchObject({
        kind: "observed",
        domain: { name, state: "collision", ownerMatchesExpected: !foreign },
        ownership: "unproven",
        fullTargetAbsence: "unproven",
      });
      expect(JSON.stringify(result)).not.toMatch(
        /Private1|222233334444|PoolId|Status/,
      );
      frozen(result);
    }
});

it("distinguishes empty optional descriptions from precise structured not-found without claiming absence", async () => {
  for (const Shape of ["object", "null"]) {
    const f = fixture(empty(Shape));
    expect(
      await collectRetainedCloudCognitoDomain(retained(), f),
    ).toMatchObject({
      kind: "observed",
      domain: { state: "not-described", ownerMatchesExpected: null },
      ownership: "unproven",
      fullTargetAbsence: "unproven",
    });
  }
  const f = fixture();
  f.run.mockRejectedValue(missing());
  const result = await collectRetainedCloudCognitoDomain(retained(), f);
  expect(result).toMatchObject({
    kind: "observed",
    retainedManifestSha256: recipe.pin.sha256,
    domain: { state: "not-found", ownerMatchesExpected: null },
    ownership: "unproven",
    fullTargetAbsence: "unproven",
  });
  expect(JSON.stringify(result)).not.toMatch(
    /private-message|ResourceNotFoundException/,
  );
  frozen(result);
});

it("keeps ambiguous, denied, partial, oversized and accessor errors private/unavailable", async () => {
  const getter = vi.fn(() => "private"),
    base = missing();
  for (const error of [
    {
      ...base,
      stderr:
        '{"Code":"AccessDeniedException","Message":"ResourceNotFoundException"}',
    },
    { ...base, stderr: '{"Code":"ResourceNotFoundExceptionExtra"}' },
    { ...base, code: "254" },
    { ...base, killed: true },
    { ...base, signal: "SIGTERM" },
    { ...base, stdout: "private partial" },
    { ...base, stderr: "private malformed" },
    {
      ...base,
      stderr: JSON.stringify({
        Code: "ResourceNotFoundException",
        Message: "x".repeat(65537),
      }),
    },
    Object.defineProperty({ ...base }, "stderr", { get: getter }),
    Object.defineProperty({ ...base }, "killed", { get: getter }),
  ]) {
    const f = fixture();
    f.run.mockRejectedValue(error);
    const result = await collectRetainedCloudCognitoDomain(retained(), f);
    expect(result).toEqual(failure("metadata-unavailable"));
    frozen(result);
    expect(f.run).toHaveBeenCalledTimes(1);
  }
  expect(getter).not.toHaveBeenCalled();
});

it("rejects wrong prefix/owner/pool scope and malformed optional metadata rather than manufacturing absence", async () => {
  for (const [value, code] of [
    [{ ...metadata(), Domain: "foreign" }, "scope-mismatch"],
    [{ ...metadata(), AccountId: "invalid" }, "scope-mismatch"],
    [{ ...metadata(), PoolId: "us-west-2_Private" }, "scope-mismatch"],
    [{ ...metadata(), Status: "UNKNOWN" }, "metadata-unavailable"],
    [{ ...metadata(), Shape: "null" }, "metadata-unavailable"],
    [{ ...metadata(), PoolId: null }, "metadata-unavailable"],
    [{ ...empty(), Shape: "array" }, "metadata-unavailable"],
  ] as const) {
    const f = fixture(value);
    expect(await collectRetainedCloudCognitoDomain(retained(), f)).toEqual(
      failure(code),
    );
  }
  for (const value of [
    { stdout: "x".repeat(65537), stderr: "" },
    { ...response(metadata()), stderr: "private warning" },
    response({ ...metadata(), Private: "payload" }),
  ]) {
    const f = fixture();
    f.run.mockResolvedValue(value);
    expect(await collectRetainedCloudCognitoDomain(retained(), f)).toEqual(
      failure("metadata-unavailable"),
    );
  }
});

it("requires current configured identity and refuses final account/role drift for every outcome", async () => {
  const denied = fixture();
  denied.config["configured-account"] = "222233334444\n";
  expect(await collectRetainedCloudCognitoDomain(retained(), denied)).toEqual(
    failure("identity-not-ready"),
  );
  expect(denied.run).not.toHaveBeenCalled();
  for (const outcome of ["collision", "not-found", "not-described"])
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
      if (outcome === "not-found") f.run.mockRejectedValue(missing());
      else if (outcome === "not-described")
        f.run.mockResolvedValue(response(empty()));
      expect(await collectRetainedCloudCognitoDomain(retained(), f)).toEqual(
        failure(role ? "identity-mismatch" : "identity-not-ready"),
      );
      expect(f.run).toHaveBeenCalledTimes(1);
    }
});

it("preserves pre-abort/current clock and environment gates before provider work", async () => {
  const f = fixture(),
    controller = new AbortController();
  controller.abort("private reason");
  expect(
    await collectRetainedCloudCognitoDomain(retained(), {
      ...f,
      signal: controller.signal,
    }),
  ).toEqual(failure("aborted"));
  expect(f.run).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  for (const delta of [NaN, -1, 90001]) {
    const bad = fixture(),
      start = bad.clock();
    let n = 0;
    bad.clock = () => (n++ === 0 ? start : start + delta);
    expect(await collectRetainedCloudCognitoDomain(retained(), bad)).toEqual(
      failure("clock-invalid"),
    );
  }
  vi.stubEnv(
    "AWS_ENDPOINT_URL_COGNITO_IDP",
    "https://synthetic-override.example",
  );
  expect(await collectRetainedCloudCognitoDomain(retained(), f)).toEqual(
    failure("unsupported-environment"),
  );
  expect(f.run).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});

it.each(["first-identity", "last-identity", "read"] as const)(
  "cancels an ignored %s signal, cleans the original listener and suppresses late work",
  async (stage) => {
    vi.useFakeTimers();
    const f = fixture(),
      controller = new AbortController(),
      identity = f.identity;
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
    f.run.mockImplementation(async (_args, s) => {
      if (stage === "read") await stall(s);
      return response(metadata());
    });
    const remove = vi.spyOn(controller.signal, "removeEventListener"),
      dependencies = { ...f, signal: controller.signal };
    const pending = collectRetainedCloudCognitoDomain(retained(), dependencies);
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toBeTypeOf("function");
    dependencies.signal = new AbortController().signal;
    controller.abort("private reason");
    expect(await pending).toEqual(failure("aborted"));
    expect(signal.aborted).toBe(true);
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

it("bounds read/global stalls and prevents late read or identity publication", async () => {
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
      return response(metadata());
    });
    const pending = collectRetainedCloudCognitoDomain(retained(), {
      ...f,
      identity,
    });
    await vi.advanceTimersByTimeAsync(identityStall ? 90001 : 15000);
    expect(await pending).toEqual(failure("deadline"));
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
  }
});
