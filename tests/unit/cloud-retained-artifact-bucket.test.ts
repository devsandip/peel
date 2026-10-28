import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as manifest from "../../infra/cloud/run-manifest.ts";
import {
  collectCloudArtifactBucket,
  collectRetainedCloudArtifactBucket,
} from "../../infra/cloud/artifact-bucket-metadata.ts";
import recipe from "../fixtures/cloud-inventory-v1-recipe.json";
import {
  name,
  xml,
  response,
  errorResponse,
  fixture,
} from "../fixtures/cloud-artifact-bucket-wire.ts";

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

it("sends exactly one original owner-bound SDK GET while current factories and writer are unavailable", async () => {
  const f = fixture(),
    input = retained(),
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
  const result = await collectRetainedCloudArtifactBucket(input, f);
  expect(result).toMatchObject({
    kind: "observed",
    retainedManifestSha256: input.pin.sha256,
    inventorySha256: input.pin.inventorySha256,
    ownership: "unproven",
    fullTargetAbsence: "unproven",
    resourceWrites: 0,
    bucket: { name, expectedOwner: input.pin.accountId, state: "collision" },
  });
  expect(f.transport.handle).toHaveBeenCalledTimes(1);
  const [request, options] = f.transport.handle.mock.calls[0];
  expect(request).toMatchObject({
    method: "GET",
    protocol: "https:",
    hostname: "s3.us-east-1.amazonaws.com",
    path: `/${name}/`,
    headers: { "x-amz-expected-bucket-owner": input.pin.accountId },
  });
  expect(request.query).toEqual({ tagging: "" });
  expect(request.body).toBeUndefined();
  expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  expect(
    f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
  ).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(
    /private|TagSet|Message|authorization|synthetic-secret/,
  );
  frozen(result);
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});

it("keeps original expired scope/digests captured before awaits and preserves prospective result shape", async () => {
  const f = fixture(),
    input = retained(),
    original = structuredClone(input),
    identity = f.identity;
  f.identity = async (...args) => {
    input.json = "private replacement";
    input.pin.accountId = "222233334444";
    input.pin.sha256 = "9".repeat(64);
    input.pin.profile = "foreign";
    input.pin.source.commit = "9".repeat(40);
    return identity(...args);
  };
  expect(await collectRetainedCloudArtifactBucket(input, f)).toMatchObject({
    kind: "observed",
    retainedManifestSha256: original.pin.sha256,
    inventorySha256: original.pin.inventorySha256,
    expectedIdentity: {
      profile: original.pin.profile,
      accountId: original.pin.accountId,
      region: original.pin.region,
    },
    bucket: { name, expectedOwner: original.pin.accountId },
  });
  const prospective = await collectCloudArtifactBucket(f.input, f);
  expect(prospective.kind).toBe("observed");
  expect(prospective).not.toHaveProperty("retainedManifestSha256");
});

it("rejects changed pins, getters and graph/bucket/owner/endpoint overrides before identity/transport work", async () => {
  const f = fixture(),
    identity = vi.fn(f.identity),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...retained(), profile: "foreign" },
    { ...retained(), expected: f.expected },
    { ...retained(), bucket: "foreign" },
    { ...retained(), expectedOwner: "222233334444" },
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
    const result = await collectRetainedCloudArtifactBucket(
      input as ReturnType<typeof retained>,
      { ...f, identity },
    );
    expect(result).toEqual(failure("invalid-input"));
    frozen(result);
  }
  expect(getter).not.toHaveBeenCalled();
  expect(identity).not.toHaveBeenCalled();
  expect(f.transport.handle).not.toHaveBeenCalled();
});

it("retains exact SDK collision/not-found classification without promoting missing metadata to absence", async () => {
  for (const [wire, state] of [
    [response(200, xml("<Tagging><TagSet/></Tagging>")), "collision"],
    [errorResponse("NoSuchTagSet"), "collision"],
    [errorResponse("NoSuchBucket"), "not-found"],
  ] as const) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(wire);
    const result = await collectRetainedCloudArtifactBucket(retained(), f);
    expect(result).toMatchObject({
      kind: "observed",
      bucket: { state },
      ownership: "unproven",
      fullTargetAbsence: "unproven",
      retainedManifestSha256: recipe.pin.sha256,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-provider|Message|TagSet/,
    );
    frozen(result);
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
});

it("does not send HEAD, retry or follow redirects, even without a region hint", async () => {
  for (const status of [301, 307, 400]) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(
      errorResponse("PermanentRedirect", status),
    );
    expect(await collectRetainedCloudArtifactBucket(retained(), f)).toEqual(
      failure("metadata-unavailable"),
    );
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(f.transport.handle.mock.calls[0][0].method).toBe("GET");
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
});

it("keeps denied/wrong errors and malformed/oversized/streamed payloads private and unavailable", async () => {
  for (const wire of [
    errorResponse("AccessDenied", 403),
    errorResponse("NoSuchBucket", 403),
    errorResponse("NoSuchKey"),
    errorResponse("404"),
    response(200, xml("private invalid XML")),
    response(200, xml("<Tagging/>")),
    response(200, xml("x".repeat(65537))),
    response(200, xml("<Tagging><TagSet/></Tagging>"), {
      "private-header": "x".repeat(16385),
    }),
    response(200, Readable.from([Buffer.alloc(40000), Buffer.alloc(30000)])),
  ]) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(wire);
    expect(await collectRetainedCloudArtifactBucket(retained(), f)).toEqual(
      failure("metadata-unavailable"),
    );
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
});

it("requires current configured identity and rejects final account/role drift", async () => {
  const denied = fixture();
  denied.config["configured-account"] = "222233334444\n";
  expect(await collectRetainedCloudArtifactBucket(retained(), denied)).toEqual(
    failure("identity-not-ready"),
  );
  expect(denied.transport.handle).not.toHaveBeenCalled();
  for (const role of [false, true]) {
    const f = fixture();
    f.transport.handle.mockImplementation(async () => {
      if (role) {
        f.config["configured-role"] = "Alternate";
        f.caller.Arn = f.caller.Arn.replace("SSO_Synthetic_", "SSO_Alternate_");
      } else f.caller.Account = "222233334444";
      return response();
    });
    expect(await collectRetainedCloudArtifactBucket(retained(), f)).toEqual(
      failure(role ? "identity-mismatch" : "identity-not-ready"),
    );
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
});

it("preserves pre-abort/current clock/default environment gates without a request", async () => {
  const f = fixture(),
    controller = new AbortController();
  controller.abort("private reason");
  expect(
    await collectRetainedCloudArtifactBucket(retained(), {
      ...f,
      signal: controller.signal,
    }),
  ).toEqual(failure("aborted"));
  expect(f.transport.handle).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  for (const delta of [NaN, -1, 90001]) {
    const bad = fixture(),
      start = bad.clock();
    let n = 0;
    bad.clock = () => (n++ === 0 ? start : start + delta);
    expect(await collectRetainedCloudArtifactBucket(retained(), bad)).toEqual(
      failure("clock-invalid"),
    );
  }
  vi.stubEnv("AWS_ENDPOINT_URL_S3", "https://synthetic-override.example");
  expect(await collectRetainedCloudArtifactBucket(retained(), f)).toEqual(
    failure("unsupported-environment"),
  );
  expect(f.transport.handle).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});

it.each(["first-identity", "last-identity", "transport"] as const)(
  "cancels an ignored %s signal, cleans up the original registration and suppresses late work",
  async (stage) => {
    vi.useFakeTimers();
    const f = fixture(),
      controller = new AbortController(),
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
    f.identity = async (...args) => {
      identities++;
      if (
        (stage === "first-identity" && identities === 1) ||
        (stage === "last-identity" && identities === 2)
      )
        await stall(args[1]!.signal!);
      return identity(...args);
    };
    f.transport.handle.mockImplementation(async (_request, options) => {
      if (stage === "transport") await stall(options.abortSignal);
      return response();
    });
    const remove = vi.spyOn(controller.signal, "removeEventListener"),
      dependencies = { ...f, signal: controller.signal };
    const pending = collectRetainedCloudArtifactBucket(
      retained(),
      dependencies,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(release).toBeTypeOf("function");
    dependencies.signal = new AbortController().signal;
    controller.abort("private reason");
    expect(await pending).toEqual(failure("aborted"));
    expect(internal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(f.transport.destroy).toHaveBeenCalledTimes(
      stage === "first-identity" ? 0 : 1,
    );
    const before = {
      reads: f.read.mock.calls.length,
      requests: f.transport.handle.mock.calls.length,
    };
    release();
    await vi.advanceTimersByTimeAsync(1);
    expect({
      reads: f.read.mock.calls.length,
      requests: f.transport.handle.mock.calls.length,
    }).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("bounds stalled transport/streams/credentials at fifteen seconds and rejects late requests/results", async () => {
  vi.useFakeTimers();
  for (const stage of ["transport", "credentials", "stream"] as const) {
    const f = fixture(),
      stream = new Readable({ read() {} });
    let release: (() => void) | undefined;
    const stall = async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const dependencies = {
      ...f,
      credentials:
        stage === "credentials"
          ? async () => {
              await stall();
              return f.credentials;
            }
          : f.credentials,
    };
    f.transport.handle.mockImplementation(async () => {
      if (stage === "transport") await stall();
      return stage === "stream" ? response(200, stream) : response();
    });
    const pending = collectRetainedCloudArtifactBucket(
      retained(),
      dependencies,
    );
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual(failure("deadline"));
    expect(f.transport.handle).toHaveBeenCalledTimes(
      stage === "credentials" ? 0 : 1,
    );
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
    if (stage === "stream") expect(stream.destroyed).toBe(true);
    const before = f.read.mock.calls.length;
    release?.();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.transport.handle).toHaveBeenCalledTimes(
      stage === "credentials" ? 0 : 1,
    );
    expect(f.read.mock.calls.length).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  }
});

it("applies the overall deadline to an ignored first identity without creating a transport request", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let release!: () => void;
  const identity = vi.fn(async (...args: Parameters<typeof f.identity>) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return f.identity(...args);
  });
  const pending = collectRetainedCloudArtifactBucket(retained(), {
    ...f,
    identity,
  });
  await vi.advanceTimersByTimeAsync(90001);
  expect(await pending).toEqual(failure("deadline"));
  release();
  await vi.advanceTimersByTimeAsync(1);
  expect(f.transport.handle).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
