import { expect, it, vi } from "vitest";
import {
  createCloudDownloadWebSender,
  CLOUD_DOWNLOAD_DEADLINE_MS,
} from "../../apps/web/src/cloud-download-web-transport";
import type { CloudDownloadRequest } from "../../apps/web/src/cloud-library-download";
import { CLOUD_PAGE_WIRE_BYTES } from "../../packages/cloud-protocol/src/pull";

const config = () => ({
  origin: "https://synthetic.example",
  csrfToken: "c".repeat(43),
});
const bootstrap: CloudDownloadRequest = {
  kind: "bootstrap",
  scope: { version: 1, collectionId: "synthetic-library", modeGeneration: 1 },
};
const signal = () => new AbortController().signal;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
const fake = (operation: () => Promise<Response>) =>
  vi.fn(operation) as unknown as typeof fetch;

it("captures configuration and constrains encoded routes, methods, credentials and referrer", async () => {
  const original = config(),
    calls: { url: string; options: RequestInit }[] = [];
  const fetcher = vi.fn(async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ accepted: true }, { status: 401 });
  }) as unknown as typeof fetch;
  const send = createCloudDownloadWebSender(original, fetcher);
  original.origin = "https://changed.example";
  original.csrfToken = "d".repeat(43);
  for (const request of [
    bootstrap,
    { kind: "page", location: { kind: "heads", token: "a&b?=/#" } },
    { kind: "page", location: { kind: "changes", token: "changes" } },
    { kind: "resume", checkpoint: "c&after=other" },
  ] as CloudDownloadRequest[]) {
    expect(await send(request, signal())).toEqual({
      status: 401,
      body: { accepted: true },
    });
  }
  expect(calls[0].url).toBe("https://synthetic.example/v1/sync/bootstrap");
  expect(calls[0].options.method).toBe("POST");
  expect(JSON.parse(calls[0].options.body as string)).toEqual(bootstrap.scope);
  const heads = new URL(calls[1].url),
    resume = new URL(calls[3].url);
  expect(heads.pathname).toBe("/v1/notes");
  expect([...heads.searchParams]).toEqual([
    ["pageToken", "a&b?=/#"],
    ["limit", "32"],
  ]);
  expect(new URL(calls[2].url).pathname).toBe("/v1/sync");
  expect([...resume.searchParams]).toEqual([["after", "c&after=other"]]);
  for (const { options } of calls) {
    expect(options).toMatchObject({
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    expect(new Headers(options.headers).get("x-peel-csrf")).toBe(
      "c".repeat(43),
    );
  }
  expect(
    calls
      .slice(1)
      .every(
        (call) =>
          call.options.method === "GET" && call.options.body === undefined,
      ),
  ).toBe(true);
});

it.each([
  "http://remote.example",
  "https://user:private@synthetic.example",
  "https://synthetic.example/path",
  "https://synthetic.example?query",
  "https://synthetic.example#hash",
  "https://synthetic.example/",
  "data:text/plain,private",
  "not a URL",
])("rejects unsafe origin configuration before dispatch: %s", (origin) => {
  const fetcher = vi.fn();
  expect(() =>
    createCloudDownloadWebSender({ ...config(), origin }, fetcher),
  ).toThrow("Cloud download transport unavailable");
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  "http://127.0.0.1:49152",
  "http://localhost:49152",
  "http://[::1]:49152",
])("permits explicit loopback development origin %s", (origin) => {
  expect(() =>
    createCloudDownloadWebSender({ ...config(), origin }, vi.fn()),
  ).not.toThrow();
});
it.each(["", "x".repeat(44), "invalid csrf"])(
  "requires an issued-token-shaped CSRF value",
  (csrfToken) => {
    expect(() =>
      createCloudDownloadWebSender({ ...config(), csrfToken }, vi.fn()),
    ).toThrow();
  },
);
it.each([
  null,
  { kind: "other" },
  { ...bootstrap, secret: "private" },
  { kind: "bootstrap", scope: { ...bootstrap.scope, modeGeneration: 0 } },
  {
    kind: "bootstrap",
    scope: { ...bootstrap.scope, ownerSubject: "not-authority" },
  },
  { kind: "resume", checkpoint: "" },
  { kind: "resume", checkpoint: "x".repeat(4097) },
  { kind: "page", location: { kind: "other", token: "t" } },
])("rejects malformed download requests without a fetch", async (request) => {
  const fetcher = vi.fn();
  const send = createCloudDownloadWebSender(config(), fetcher);
  await expect(send(request as any, signal())).rejects.toThrow(
    "Cloud download transport unavailable",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("accepts the exact byte boundary and releases its body reader", async () => {
  const response = new Response(
    JSON.stringify("x".repeat(CLOUD_PAGE_WIRE_BYTES - 2)),
    { headers: { "Content-Type": 'application/json; charset="utf-8"' } },
  );
  const result = await createCloudDownloadWebSender(
    config(),
    fake(async () => response),
  )(bootstrap, signal());
  expect(result.body).toHaveLength(CLOUD_PAGE_WIRE_BYTES - 2);
  expect(response.body!.locked).toBe(false);
});
it.each(["header", "stream"])(
  "cancels an oversized %s without retry or retaining a reader",
  async (kind) => {
    const canceled = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          if (kind === "stream")
            controller.enqueue(new Uint8Array(CLOUD_PAGE_WIRE_BYTES + 1));
        },
        cancel: canceled,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...(kind === "header"
            ? { "Content-Length": String(CLOUD_PAGE_WIRE_BYTES + 1) }
            : {}),
        },
      },
    );
    const fetcher = fake(async () => response);
    await expect(
      createCloudDownloadWebSender(config(), fetcher)(bootstrap, signal()),
    ).rejects.toThrow("Cloud download transport unavailable");
    expect(canceled).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(response.body!.locked).toBe(false);
  },
);
it.each([
  "type",
  "charset",
  "unbalanced-charset",
  "utf8",
  "json",
  "redirect",
  "foreign-url",
  "empty",
])("refuses invalid response %s with a generic error", async (kind) => {
  const response = new Response(
    kind === "empty"
      ? null
      : kind === "utf8"
        ? new Uint8Array([0xff])
        : kind === "json"
          ? "private diagnostic"
          : "{}",
    {
      headers: {
        "Content-Type":
          kind === "type"
            ? "text/html"
            : kind === "charset"
              ? "application/json; charset=utf-16"
              : kind === "unbalanced-charset"
                ? 'application/json; charset="utf-8'
                : "application/json",
      },
    },
  );
  if (kind === "redirect")
    Object.defineProperty(response, "redirected", { value: true });
  if (kind === "foreign-url")
    Object.defineProperty(response, "url", {
      value: "https://other.example/private",
    });
  const fetcher = fake(async () => response);
  await expect(
    createCloudDownloadWebSender(config(), fetcher)(bootstrap, signal()),
  ).rejects.toThrow(/^Cloud download transport unavailable$/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  if (response.body) expect(response.body.locked).toBe(false);
});

it.each(["headers", "body"])(
  "enforces one deadline through stalled %s even if the fetch implementation ignores abort",
  async (phase) => {
    vi.useFakeTimers();
    try {
      const canceled = vi.fn();
      const response = new Response(new ReadableStream({ cancel: canceled }), {
        headers: { "Content-Type": "application/json" },
      });
      const fetcher = fake(() =>
        phase === "headers" ? new Promise(() => {}) : Promise.resolve(response),
      );
      const send = createCloudDownloadWebSender(config(), fetcher);
      const task = send(bootstrap, signal()),
        check = expect(task).rejects.toThrow(
          /^Cloud download transport unavailable$/,
        );
      await vi.advanceTimersByTimeAsync(CLOUD_DOWNLOAD_DEADLINE_MS + 1);
      await check;
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      if (phase === "body") {
        expect(canceled).toHaveBeenCalledTimes(1);
        expect(response.body!.locked).toBe(false);
      }
    } finally {
      vi.useRealTimers();
    }
  },
);
it("refuses a canceled context before dispatch", async () => {
  const controller = new AbortController(),
    fetcher = vi.fn();
  controller.abort("Private reason");
  await expect(
    createCloudDownloadWebSender(config(), fetcher)(
      bootstrap,
      controller.signal,
    ),
  ).rejects.toThrow(/^Cloud download transport unavailable$/);
  expect(fetcher).not.toHaveBeenCalled();
});
it("cancels and releases a stalled body on account abort", async () => {
  const controller = new AbortController(),
    entered = deferred<void>(),
    canceled = vi.fn();
  const response = new Response(new ReadableStream({ cancel: canceled }), {
    headers: { "Content-Type": "application/json" },
  });
  const original = response.body!.getReader.bind(response.body!);
  vi.spyOn(response.body!, "getReader").mockImplementation(() => {
    entered.resolve();
    return original();
  });
  const task = createCloudDownloadWebSender(
    config(),
    fake(async () => response),
  )(bootstrap, controller.signal);
  const check = expect(task).rejects.toThrow(
    /^Cloud download transport unavailable$/,
  );
  await entered.promise;
  controller.abort();
  await check;
  expect(canceled).toHaveBeenCalledTimes(1);
  expect(response.body!.locked).toBe(false);
});
it("cancels a late response body after the account lifetime ended", async () => {
  const controller = new AbortController(),
    late = deferred<Response>(),
    canceled = vi.fn();
  const response = new Response(new ReadableStream({ cancel: canceled }), {
    headers: { "Content-Type": "application/json" },
  });
  const task = createCloudDownloadWebSender(
    config(),
    fake(() => late.promise),
  )(bootstrap, controller.signal);
  const check = expect(task).rejects.toThrow(
    /^Cloud download transport unavailable$/,
  );
  controller.abort();
  await check;
  late.resolve(response);
  await Promise.resolve();
  expect(canceled).toHaveBeenCalledTimes(1);
});
