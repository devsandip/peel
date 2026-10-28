import { Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { collectCloudArtifactBucket } from "../../infra/cloud/artifact-bucket-metadata.ts";
import { cloudStackFixture } from "../fixtures/cloud-stack-pages.ts";

const name = "peel-cloud-dev-00000000-0000-4000-8000-000000000001";
const xml = (text: string) => new TextEncoder().encode(text);
const tags =
  '<Tagging xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><TagSet><Tag><Key>private-key</Key><Value>private-value</Value></Tag></TagSet></Tagging>';
function response(statusCode = 200, body: unknown = xml(tags), headers = {}) {
  return {
    response: {
      statusCode,
      headers: { "content-type": "application/xml", ...headers },
      body,
    },
  };
}
function fixture() {
  const handle = vi.fn(async (..._args: any[]) => response());
  return {
    ...cloudStackFixture(),
    credentials: {
      accessKeyId: "synthetic-access-key",
      secretAccessKey: "synthetic-secret",
    },
    transport: { handle, destroy: vi.fn() },
  };
}
const failure = (code: string) => ({
  kind: "unavailable",
  code,
  resourceWrites: 0,
});
const errorResponse = (code: string, status = 404, headers = {}) =>
  response(
    status,
    xml(
      `<Error><Code>${code}</Code><Message>private-provider-message</Message></Error>`,
    ),
    headers,
  );
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("uses the actual SDK to send one exact owner-bound GET without private output", async () => {
  const f = fixture(),
    result = await collectCloudArtifactBucket(f.input, f);
  expect(result.kind).toBe("observed");
  expect(f.transport.handle).toHaveBeenCalledTimes(1);
  const [request, options] = f.transport.handle.mock.calls[0];
  expect(request).toMatchObject({
    method: "GET",
    protocol: "https:",
    hostname: "s3.us-east-1.amazonaws.com",
    path: `/${name}/`,
    headers: { "x-amz-expected-bucket-owner": "111122223333" },
  });
  expect(request.query).toEqual({ tagging: "" });
  expect(request.body).toBeUndefined();
  expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  if (result.kind !== "observed") throw Error("missing fixture");
  expect(result.bucket).toEqual({
    name,
    expectedOwner: "111122223333",
    state: "collision",
  });
  expect(result).toMatchObject({
    scope: "global-artifact-bucket",
    fullTargetAbsence: "unproven",
    ownership: "unproven",
    inventorySha256: f.expected.inventorySha256,
  });
  expect(
    f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
  ).toHaveLength(2);
  expect(JSON.stringify(result)).not.toMatch(
    /private|TagSet|Message|authorization|synthetic-secret|LocationConstraint/,
  );
  const frozen = (value: unknown) => {
    if (value && typeof value === "object") {
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(frozen);
    }
  };
  frozen(result);
});

it("deserializes empty tags and NoSuchTagSet as collisions, exact NoSuchBucket as point-in-time not-found", async () => {
  for (const [wire, state] of [
    [response(200, xml("<Tagging><TagSet/></Tagging>")), "collision"],
    [errorResponse("NoSuchTagSet"), "collision"],
    [errorResponse("NoSuchBucket"), "not-found"],
  ] as const) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(wire);
    const result = await collectCloudArtifactBucket(f.input, f);
    if (result.kind !== "observed") throw Error(JSON.stringify(result));
    expect(result.bucket.state).toBe(state);
    expect(result.fullTargetAbsence).toBe("unproven");
    expect(result.ownership).toBe("unproven");
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
  }
});

it("does not follow regional redirects or send HEAD, including missing region information", async () => {
  for (const headers of [{}, { "x-amz-bucket-region": "us-west-2" }]) {
    for (const status of [301, 307, 400]) {
      const f = fixture();
      f.transport.handle.mockResolvedValue(
        errorResponse("PermanentRedirect", status, headers),
      );
      expect(await collectCloudArtifactBucket(f.input, f)).toEqual(
        failure("metadata-unavailable"),
      );
      expect(f.transport.handle).toHaveBeenCalledTimes(1);
      expect(f.transport.handle.mock.calls[0][0].method).toBe("GET");
    }
  }
});

it("keeps wrong status, numeric errors, permission failures and missing subresources unknown", async () => {
  for (const [code, status] of [
    ["404", 404],
    ["AccessDenied", 403],
    ["NoSuchBucket", 403],
    ["NoSuchTagSet", 400],
    ["NoSuchKey", 404],
    ["NoSuchBucketPolicy", 404],
    ["NoSuchBucketX", 404],
    ["ValidationError", 404],
  ] as const) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(errorResponse(code, status));
    expect(await collectCloudArtifactBucket(f.input, f)).toEqual(
      failure("metadata-unavailable"),
    );
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
  }
});

it("bounds and validates response metadata before deserialization without retaining payloads", async () => {
  for (const wire of [
    response(204),
    response(600),
    response(200, xml("private invalid XML")),
    response(200, xml("<Tagging/>")),
    response(
      200,
      xml("<Tagging><TagSet><Tag><Key>private</Key></Tag></TagSet></Tagging>"),
    ),
    response(200, xml(tags.replace("private-key", "x".repeat(129)))),
    response(200, xml("x".repeat(65537))),
    response(200, xml(tags), { "private-header": "x".repeat(16385) }),
    response(200, Readable.from([Buffer.alloc(40000), Buffer.alloc(30000)])),
    response(200, Readable.from(["private-string-chunk"])),
  ]) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(wire);
    expect(await collectCloudArtifactBucket(f.input, f)).toEqual(
      failure("metadata-unavailable"),
    );
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
  const f = fixture();
  f.transport.handle.mockResolvedValue(
    response(200, Readable.from([xml(tags)])),
  );
  expect((await collectCloudArtifactBucket(f.input, f)).kind).toBe("observed");
});

it("captures selectors before awaits and independently rechecks account and configured role", async () => {
  const f = fixture();
  f.transport.handle.mockImplementation(async () => {
    f.input.profile = "foreign";
    f.input.inventory.accountId = "222233334444";
    f.input.inventory.runId = "changed";
    f.input.templates = "changed";
    return response();
  });
  const result = await collectCloudArtifactBucket(f.input, f);
  if (result.kind !== "observed") throw Error("missing captured fixture");
  expect(result.expectedIdentity.profile).toBe("synthetic-dev");
  expect(result.bucket).toMatchObject({ name, expectedOwner: "111122223333" });
  for (const role of [false, true]) {
    const drift = fixture();
    drift.transport.handle.mockImplementation(async () => {
      if (role) {
        drift.config["configured-role"] = "Alternate";
        drift.caller.Arn = drift.caller.Arn.replace(
          "SSO_Synthetic_",
          "SSO_Alternate_",
        );
      } else drift.caller.Account = "222233334444";
      return response();
    });
    expect(await collectCloudArtifactBucket(drift.input, drift)).toEqual(
      failure(role ? "identity-mismatch" : "identity-not-ready"),
    );
  }
  const denied = fixture();
  denied.config["history-setting"] = "enabled";
  expect(await collectCloudArtifactBucket(denied.input, denied)).toEqual(
    failure("identity-not-ready"),
  );
  expect(denied.transport.handle).not.toHaveBeenCalled();
});

it("rejects invalid scope, getters, environment and clocks before using a transport", async () => {
  const f = fixture(),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...f.input, bucket: "foreign" },
    { ...f.input, expectedOwner: "222233334444" },
    { ...f.input, profile: "bad profile" },
    { ...f.input, inventory: { ...f.input.inventory, region: "us-west-2" } },
    Object.defineProperty({ ...f.input }, "templates", { get: getter }),
  ])
    expect(
      await collectCloudArtifactBucket(input as typeof f.input, f),
    ).toEqual(failure("invalid-input"));
  expect(getter).not.toHaveBeenCalled();
  expect(f.transport.handle).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
  for (const time of [-1, NaN, Number.MAX_SAFE_INTEGER]) {
    const bad = fixture();
    bad.clock = () => time;
    expect(await collectCloudArtifactBucket(bad.input, bad)).toEqual(
      failure("clock-invalid"),
    );
    expect(bad.transport.handle).not.toHaveBeenCalled();
  }
  for (const delta of [-1, 90001]) {
    const bad = fixture(),
      start = bad.clock();
    let n = 0;
    bad.clock = () => (n++ === 0 ? start : start + delta);
    expect(await collectCloudArtifactBucket(bad.input, bad)).toEqual(
      failure("clock-invalid"),
    );
  }
  vi.stubEnv("AWS_ENDPOINT_URL_S3", "https://synthetic-override.example");
  expect(await collectCloudArtifactBucket(f.input, f)).toEqual(
    failure("unsupported-environment"),
  );
  expect(f.transport.handle).not.toHaveBeenCalled();
});

it("bounds stalled transports at fifteen seconds and rejects late responses without identity recheck", async () => {
  vi.useFakeTimers();
  for (const external of [true, false]) {
    const f = fixture(),
      controller = new AbortController();
    let release: ((value: ReturnType<typeof response>) => void) | undefined,
      wireSignal: AbortSignal | undefined;
    f.transport.handle.mockImplementation(async (_request, options) => {
      wireSignal = options.abortSignal;
      return await new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = collectCloudArtifactBucket(f.input, {
      ...f,
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    if (external) controller.abort();
    else await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toEqual(failure(external ? "aborted" : "deadline"));
    expect(wireSignal?.aborted).toBe(true);
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
    release!(response());
    await vi.advanceTimersByTimeAsync(1);
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(
      f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
    ).toHaveLength(1);
  }
});

it("cancels bounded streaming bodies and prevents pre-aborted or overall-late identity work", async () => {
  vi.useFakeTimers();
  const f = fixture(),
    stream = new Readable({ read() {} });
  f.transport.handle.mockResolvedValue(response(200, stream));
  const pending = collectCloudArtifactBucket(f.input, f);
  await vi.advanceTimersByTimeAsync(15000);
  expect(await pending).toEqual(failure("deadline"));
  expect(stream.destroyed).toBe(true);
  const before = fixture(),
    controller = new AbortController();
  controller.abort();
  expect(
    await collectCloudArtifactBucket(before.input, {
      ...before,
      signal: controller.signal,
    }),
  ).toEqual(failure("aborted"));
  expect(before.transport.handle).not.toHaveBeenCalled();
  expect(before.read).not.toHaveBeenCalled();
  const late = fixture();
  let release:
    ((value: Awaited<ReturnType<typeof late.identity>>) => void) | undefined;
  const identity = vi.fn(
    async () =>
      await new Promise<Awaited<ReturnType<typeof late.identity>>>(
        (resolve) => {
          release = resolve;
        },
      ),
  );
  const overall = collectCloudArtifactBucket(late.input, { ...late, identity });
  await vi.advanceTimersByTimeAsync(90000);
  expect(await overall).toEqual(failure("deadline"));
  release!(
    await late.identity({
      profile: "synthetic-dev",
      accountId: "111122223333",
      region: "us-east-1",
    }),
  );
  await vi.advanceTimersByTimeAsync(1);
  expect(late.transport.handle).not.toHaveBeenCalled();
});

it("cannot send a request after a stalled credential provider exceeds the read deadline", async () => {
  vi.useFakeTimers();
  const f = fixture();
  let release: ((value: typeof f.credentials) => void) | undefined;
  const credentials = vi.fn(
    async () =>
      await new Promise<typeof f.credentials>((resolve) => {
        release = resolve;
      }),
  );
  const pending = collectCloudArtifactBucket(f.input, { ...f, credentials });
  await vi.advanceTimersByTimeAsync(15000);
  expect(await pending).toEqual(failure("deadline"));
  expect(credentials).toHaveBeenCalledTimes(1);
  release!(f.credentials);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.transport.handle).not.toHaveBeenCalled();
  expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  expect(
    f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
  ).toHaveLength(1);
});
