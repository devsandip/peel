import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import tls from "node:tls";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as manifest from "../../infra/cloud/run-manifest.ts";
import { collectRetainedCloudArtifactObject } from "../../infra/cloud/artifact-object-metadata.ts";
import recipe from "../fixtures/cloud-inventory-v1-recipe.json";
import {
  name,
  xml,
  response,
  errorResponse,
  fixture,
} from "../fixtures/cloud-artifact-bucket-wire.ts";

// Synthetic XML, fake credentials, an empty HOME and denied sockets: no provider request.
const key = `cloud-lambda/${"a".repeat(64)}.zip`;
const retained = () => {
  const pin = manifest.normalizeCloudRunManifestPin(recipe.pin);
  return { json: recipe.json, pin: { ...pin, source: { ...pin.source } } };
};
const failure = (code: string) => ({
  kind: "unavailable",
  code,
  resourceWrites: 0,
});
type Entry = {
  key?: string;
  version?: string;
  latest?: boolean;
  size?: number;
  marker?: boolean;
};
function page(
  entries: Entry[] = [],
  {
    bucket = name,
    maxKeys = "2",
    truncated = "false" as string | null,
    extra = "",
  } = {},
) {
  const body = entries
    .map((e) =>
      e.marker
        ? `<DeleteMarker><Owner><ID>private-owner-id</ID></Owner><Key>${e.key ?? key}</Key><VersionId>${e.version ?? "private-version-id"}</VersionId><IsLatest>${e.latest ?? true}</IsLatest><LastModified>2026-10-27T12:00:00.000Z</LastModified></DeleteMarker>`
        : `<Version><ETag>"private-etag"</ETag><Size>${e.size ?? 1024}</Size><Owner><ID>private-owner-id</ID></Owner><StorageClass>STANDARD</StorageClass><Key>${e.key ?? key}</Key><VersionId>${e.version ?? "null"}</VersionId><IsLatest>${e.latest ?? true}</IsLatest><LastModified>2026-10-27T12:00:00.000Z</LastModified></Version>`,
    )
    .join("");
  return response(
    200,
    xml(
      `<ListVersionsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix></Prefix><KeyMarker></KeyMarker><VersionIdMarker></VersionIdMarker><MaxKeys>${maxKeys}</MaxKeys>${truncated === null ? "" : `<IsTruncated>${truncated}</IsTruncated>`}${extra}${body}</ListVersionsResult>`,
    ),
  );
}
const PRIVATE =
  /private|ETag|owner-id|foreign-object|Message|synthetic-secret|StorageClass/;
// Fake only timers the collector uses, so the SDK's real async file reads of the
// isolated HOME can finish; then wait on a barrier for the stall itself.
const fakeTimers = () =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
/** Resolves when a stall is actually entered, however long real file reads take. */
function barrier() {
  let reached!: () => void;
  const arrived = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return { reached, arrived };
}
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
let home: string, sockets: ReturnType<typeof vi.fn>;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "synkies-artifact-object-home-"));
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  vi.stubEnv("AWS_PROFILE", "");
  sockets = vi.fn(() => {
    throw Error("network denied in synthetic tests");
  });
  vi.spyOn(net, "connect").mockImplementation(sockets as never);
  vi.spyOn(net, "createConnection").mockImplementation(sockets as never);
  vi.spyOn(tls, "connect").mockImplementation(sockets as never);
  vi.spyOn(http, "request").mockImplementation(sockets as never);
  vi.spyOn(https, "request").mockImplementation(sockets as never);
  vi.spyOn(globalThis, "fetch").mockImplementation(sockets as never);
});
afterEach(() => {
  try {
    expect(sockets).not.toHaveBeenCalled();
    // The SDK found nothing to read or write in the isolated empty HOME.
    expect(readdirSync(home)).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  }
});

it("sends exactly one original owner-bound ListObjectVersions page while current factories are unavailable", async () => {
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
  f.transport.handle.mockResolvedValue(page());
  const result = await collectRetainedCloudArtifactObject(input, f);
  expect(result).toEqual({
    kind: "observed",
    checkedAt: expect.any(String),
    completedAt: expect.any(String),
    expectedIdentity: {
      profile: input.pin.profile,
      accountId: input.pin.accountId,
      region: "us-east-1",
    },
    retainedManifestSha256: input.pin.sha256,
    inventorySha256: input.pin.inventorySha256,
    scope: "retained-artifact-object-versions",
    object: {
      bucket: name,
      key,
      expectedBytes: 1024,
      expectedOwner: input.pin.accountId,
    },
    page: { complete: true, maxKeys: 2 },
    shape: "empty",
    counts: {
      versions: 0,
      deleteMarkers: 0,
      expectedKeyEntries: 0,
      otherKeyEntries: 0,
    },
    review: [],
    bucketVersioning: "unproven",
    bodyVerification: "unproven",
    fullTargetAbsence: "unproven",
    ownership: "unproven",
    resourceWrites: 0,
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
  expect(request.query).toEqual({ versions: "", "max-keys": "2" });
  expect(request.body).toBeUndefined();
  expect(options.abortSignal).toBeInstanceOf(AbortSignal);
  expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  expect(
    f.read.mock.calls.filter(([c]) => c.kind === "caller-identity"),
  ).toHaveLength(2);
  frozen(result);
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
});

it("classifies only the sole expected latest null-version size match as the expected shape", async () => {
  const f = fixture();
  f.transport.handle.mockResolvedValue(page([{}]));
  const result = await collectRetainedCloudArtifactObject(retained(), f);
  expect(result).toMatchObject({
    kind: "observed",
    shape: "expected-null-version-object",
    counts: {
      versions: 1,
      deleteMarkers: 0,
      expectedKeyEntries: 1,
      otherKeyEntries: 0,
    },
    review: [],
    bucketVersioning: "unproven",
    bodyVerification: "unproven",
    ownership: "unproven",
    resourceWrites: 0,
  });
  expect(JSON.stringify(result)).not.toMatch(PRIVATE);
  frozen(result);
});

it.each([
  ["foreign key", [{ key: "foreign-object.zip" }], ["other-key"]],
  [
    "versioned object",
    [{ version: "private-version-id" }],
    ["non-null-version"],
  ],
  ["size mismatch", [{ size: 1023 }], ["size-mismatch"]],
  ["noncurrent null version", [{ latest: false }], ["not-latest"]],
  ["sole delete marker", [{ marker: true }], ["delete-marker"]],
  [
    "object and marker",
    [{ latest: false }, { marker: true }],
    ["delete-marker", "multiple-entries", "not-latest"],
  ],
  [
    "expected and foreign",
    [{}, { key: "foreign-object.zip" }],
    ["multiple-entries", "other-key"],
  ],
] as const)(
  "requires review for a complete %s page without leaking foreign identifiers",
  async (_label, entries, review) => {
    const f = fixture();
    f.transport.handle.mockResolvedValue(page([...entries]));
    const result = await collectRetainedCloudArtifactObject(retained(), f);
    expect(result).toMatchObject({
      kind: "observed",
      shape: "requires-review",
      review,
      ownership: "unproven",
      bodyVerification: "unproven",
      resourceWrites: 0,
    });
    expect(JSON.stringify(result)).not.toMatch(PRIVATE);
    frozen(result);
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  },
);

it("never reports an incomplete, grouped or contradictory page as empty", async () => {
  for (const wire of [
    page([], {
      truncated: "true",
      extra: "<NextKeyMarker>private</NextKeyMarker>",
    }),
    page([], { truncated: "true" }),
    page([], { truncated: null }),
    page([], { extra: "<NextKeyMarker>private</NextKeyMarker>" }),
    page([], { extra: "<NextVersionIdMarker>private</NextVersionIdMarker>" }),
    page([], { bucket: "foreign-bucket-name" }),
    page([], { maxKeys: "1000" }),
    page([], { extra: "<Delimiter>/</Delimiter>" }),
    page([], { extra: "<EncodingType>url</EncodingType>" }),
    page([], {
      extra: "<CommonPrefixes><Prefix>private/</Prefix></CommonPrefixes>",
    }),
    page([{}, {}, {}]),
    page([{ size: -1 }]),
    response(
      200,
      xml(
        `<ListVersionsResult><Name>${name}</Name><Prefix>private</Prefix><MaxKeys>2</MaxKeys><IsTruncated>false</IsTruncated></ListVersionsResult>`,
      ),
    ),
  ]) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(wire);
    const result = await collectRetainedCloudArtifactObject(retained(), f);
    expect(result).toEqual(failure("metadata-unavailable"));
    frozen(result);
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
});

it("rejects an HTTP 200 body that is not exactly one documented ListVersionsResult document", async () => {
  const fields = `<Name>${name}</Name><MaxKeys>2</MaxKeys><IsTruncated>false</IsTruncated>`,
    ns = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';
  for (const body of [
    // Root's countercase: SDK-readable fields under an unrelated root.
    `<UnrelatedResult>${fields}</UnrelatedResult>`,
    `<ListBucketResult ${ns}>${fields}</ListBucketResult>`,
    `<ListVersionsResult xmlns="https://private.example/">${fields}</ListVersionsResult>`,
    `<ListVersionsResult ${ns} private="x">${fields}</ListVersionsResult>`,
    `<!DOCTYPE ListVersionsResult><ListVersionsResult>${fields}</ListVersionsResult>`,
    `<Other><ListVersionsResult>${fields}</ListVersionsResult></Other>`,
    `<ListVersionsResult>${fields}</ListVersionsResult><Other/>`,
    `<ListVersionsResult>${fields}`,
    `<ListVersionsResult>${fields}</ListVersionsResult><ListVersionsResult>${fields}</ListVersionsResult>`,
    `<ListVersionsResult><ListVersionsResult>${fields}</ListVersionsResult></ListVersionsResult>`,
    `<ListVersionsResult><!-- </ListVersionsResult> -->${fields}</ListVersionsResult>`,
    `<ListVersionsResult><!DOCTYPE Other>${fields}</ListVersionsResult>`,
  ]) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(response(200, xml(body)));
    const result = await collectRetainedCloudArtifactObject(retained(), f);
    expect(result).toEqual(failure("metadata-unavailable"));
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
  const invalid = fixture();
  invalid.transport.handle.mockResolvedValue(
    response(200, new Uint8Array([0x3c, 0xff, 0xfe, 0x3e])),
  );
  expect(await collectRetainedCloudArtifactObject(retained(), invalid)).toEqual(
    failure("metadata-unavailable"),
  );
});

it("keeps documented namespaces, quotes, declaration, BOM and whitespace readable", async () => {
  const documented = new TextDecoder().decode(
    page([{}]).response.body as Uint8Array,
  );
  for (const body of [
    documented,
    documented.replace('/2006-03-01/"', '/2006-03-01"'),
    documented.replace(
      'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"',
      "xmlns='http://s3.amazonaws.com/doc/2006-03-01/'",
    ),
    documented.replace(' xmlns="http://s3.amazonaws.com/doc/2006-03-01/"', ""),
    "\uFEFF" + documented,
    '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n' +
      documented.replace("><", ">\n  <") +
      "\n",
  ]) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(response(200, xml(body)));
    expect(
      await collectRetainedCloudArtifactObject(retained(), f),
      body.slice(0, 100),
    ).toMatchObject({
      kind: "observed",
      shape: "expected-null-version-object",
      page: { complete: true },
    });
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
});

it("keeps not-found, denied, redirect, malformed and oversized responses unknown and private", async () => {
  for (const wire of [
    errorResponse("NoSuchBucket"),
    errorResponse("AccessDenied", 403),
    errorResponse("PermanentRedirect", 301),
    errorResponse("TemporaryRedirect", 307),
    errorResponse("InternalError", 500),
    response(200, xml("private invalid XML")),
    response(200, xml("x".repeat(65537))),
    {
      response: {
        ...page().response,
        headers: {
          "content-type": "application/xml",
          "private-header": "x".repeat(16385),
        },
      },
    },
    response(200, Readable.from([Buffer.alloc(40000), Buffer.alloc(30000)])),
  ]) {
    const f = fixture();
    f.transport.handle.mockResolvedValue(wire);
    const result = await collectRetainedCloudArtifactObject(retained(), f);
    expect(result).toEqual(failure("metadata-unavailable"));
    expect(JSON.stringify(result)).not.toMatch(PRIVATE);
    expect(f.transport.handle).toHaveBeenCalledTimes(1);
    expect(f.transport.handle.mock.calls[0][0].method).toBe("GET");
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
});

it("keeps the original retained scope captured before awaits when caller inputs mutate", async () => {
  const f = fixture(),
    input = retained(),
    original = structuredClone(input),
    identity = f.identity;
  f.transport.handle.mockResolvedValue(page([{}]));
  f.identity = async (...args) => {
    input.json = "private replacement";
    input.pin.accountId = "222233334444";
    input.pin.sha256 = "9".repeat(64);
    input.pin.profile = "foreign";
    input.pin.source.commit = "9".repeat(40);
    return identity(...args);
  };
  expect(await collectRetainedCloudArtifactObject(input, f)).toMatchObject({
    kind: "observed",
    shape: "expected-null-version-object",
    retainedManifestSha256: original.pin.sha256,
    inventorySha256: original.pin.inventorySha256,
    expectedIdentity: {
      profile: original.pin.profile,
      accountId: original.pin.accountId,
    },
    object: { bucket: name, key, expectedOwner: original.pin.accountId },
  });
  expect(f.transport.handle.mock.calls[0][0].headers).toMatchObject({
    "x-amz-expected-bucket-owner": original.pin.accountId,
  });
});

it("rejects changed pins, getters and caller bucket/key/owner/endpoint overrides before identity or transport", async () => {
  const f = fixture(),
    identity = vi.fn(f.identity),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...retained(), profile: "foreign" },
    { ...retained(), bucket: "foreign" },
    { ...retained(), key: "foreign.zip" },
    { ...retained(), expectedOwner: "222233334444" },
    { ...retained(), endpoint: "https://foreign.example" },
    { ...retained(), json: recipe.json + " " },
    { ...retained(), pin: { ...retained().pin, sha256: "9".repeat(64) } },
    { ...retained(), pin: { ...retained().pin, accountId: "222233334444" } },
    { ...retained(), pin: { ...retained().pin, region: "us-west-2" } },
    Object.defineProperty(retained(), "json", { get: getter }),
  ]) {
    const result = await collectRetainedCloudArtifactObject(
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

it("requires current configured identity before the request and rejects final account or role drift", async () => {
  const denied = fixture();
  denied.config["configured-account"] = "222233334444\n";
  expect(await collectRetainedCloudArtifactObject(retained(), denied)).toEqual(
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
      return page();
    });
    expect(await collectRetainedCloudArtifactObject(retained(), f)).toEqual(
      failure(role ? "identity-mismatch" : "identity-not-ready"),
    );
    expect(f.transport.destroy).toHaveBeenCalledTimes(1);
  }
});

it("preserves pre-abort, clock and endpoint-environment gates without a request", async () => {
  const f = fixture(),
    controller = new AbortController();
  controller.abort("private reason");
  expect(
    await collectRetainedCloudArtifactObject(retained(), {
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
    bad.transport.handle.mockResolvedValue(page());
    bad.clock = () => (n++ === 0 ? start : start + delta);
    expect(await collectRetainedCloudArtifactObject(retained(), bad)).toEqual(
      failure("clock-invalid"),
    );
  }
  vi.stubEnv("AWS_ENDPOINT_URL_S3", "https://synthetic-override.example");
  expect(await collectRetainedCloudArtifactObject(retained(), f)).toEqual(
    failure("unsupported-environment"),
  );
  expect(f.transport.handle).not.toHaveBeenCalled();
  expect(f.read).not.toHaveBeenCalled();
});

it.each(["first-identity", "last-identity", "transport"] as const)(
  "cancels an ignored %s stall, removes the caller registration and suppresses late work",
  async (stage) => {
    fakeTimers();
    const f = fixture(),
      controller = new AbortController(),
      identity = f.identity;
    let release!: () => void,
      internal!: AbortSignal,
      identities = 0;
    const { reached, arrived } = barrier();
    const stall = async (signal: AbortSignal) => {
      internal = signal;
      reached();
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
      return page();
    });
    const remove = vi.spyOn(controller.signal, "removeEventListener"),
      dependencies = { ...f, signal: controller.signal };
    const pending = collectRetainedCloudArtifactObject(
      retained(),
      dependencies,
    );
    await arrived;
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

it("bounds stalled transport, credentials and streams at fifteen seconds and closes the transport", async () => {
  fakeTimers();
  for (const stage of ["transport", "credentials", "stream"] as const) {
    const f = fixture(),
      { reached, arrived } = barrier(),
      stream = new Readable({
        read() {
          reached();
        },
      });
    let release: (() => void) | undefined;
    const stall = async () => {
      reached();
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
      return stage === "stream"
        ? { response: { ...page().response, body: stream } }
        : page();
    });
    const pending = collectRetainedCloudArtifactObject(
      retained(),
      dependencies,
    );
    await arrived;
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

it("applies the overall deadline to an ignored first identity without a transport request", async () => {
  fakeTimers();
  const f = fixture();
  let release!: () => void;
  const identity = vi.fn(async (...args: Parameters<typeof f.identity>) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return f.identity(...args);
  });
  const pending = collectRetainedCloudArtifactObject(retained(), {
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
