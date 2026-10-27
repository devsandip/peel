import { beforeEach, expect, it, vi } from "vitest";
import { createCloudLambdaAdapter } from "../../packages/cloud-protocol/src/lambda-event";
import { MAX_CLOUD_REQUEST_BYTES } from "../../packages/cloud-protocol/src/server-http";
const origin = "https://peel.example";
const event = (extra = {}) => ({
  version: "2.0",
  rawPath: "/v1/mutations",
  rawQueryString: "",
  headers: { "content-type": "application/json" },
  requestContext: { http: { method: "POST" } },
  body: "{}",
  isBase64Encoded: false,
  ...extra,
});
const service = vi.fn(async (_request: Request) => Response.json({ ok: true }));
const handler = createCloudLambdaAdapter(origin, service);
beforeEach(() => {
  service.mockReset();
  service.mockImplementation(async () => Response.json({ ok: true }));
});
it("rejects malformed destinations, methods and headers before entering the service", async () => {
  for (const value of [
    "http://peel.example",
    "https://peel.example/path",
    "https://private:secret@peel.example",
  ])
    expect(() => createCloudLambdaAdapter(value, service)).toThrow(
      "Invalid Cloud Lambda origin",
    );
  const invalid = [
    null,
    [],
    {},
    event({ version: "1.0" }),
    event({ isBase64Encoded: undefined }),
    event({ rawPath: "//untrusted.example/v1/mutations" }),
    event({ rawPath: "/v1/../mutations" }),
    event({ rawPath: "/v1/%ZZ" }),
    event({ rawPath: "/v1/notes/%00" }),
    event({ rawPath: "/v1/notes/a%2Fb" }),
    event({ rawPath: "/v1/notes?wrong" }),
    event({ rawQueryString: "value=%ZZ" }),
    event({ rawQueryString: "value=private#fragment" }),
    event({ rawQueryString: "x".repeat(10241) }),
    event({ requestContext: { http: { method: "post" } } }),
    event({ headers: [] }),
    event({ headers: { authorization: "a", Authorization: "b" } }),
    event({ headers: { "bad name": "value" } }),
    event({ headers: { valid: "bad\r\nvalue" } }),
    event({ headers: { valid: "\u0100" } }),
    event({ headers: { valid: 1 } }),
    event({ headers: { "transfer-encoding": "chunked" } }),
    event({ headers: { large: "x".repeat(8193) } }),
    event({
      headers: {
        a: "x".repeat(8000),
        b: "x".repeat(8000),
        c: "x".repeat(8000),
      },
    }),
    event({
      headers: Object.fromEntries(
        Array.from({ length: 65 }, (_, i) => ["header" + i, "x"]),
      ),
    }),
  ];
  for (const input of invalid) {
    const response = await handler(input);
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toEqual({ error: "invalid-http-event" });
    expect(response.headers["cache-control"]).toBe("no-store");
  }
  expect(service).not.toHaveBeenCalled();
});
it("bounds actual UTF-8/base64 bytes and rejects ambiguous length or invalid encoding", async () => {
  for (const input of [
    event({ body: "x".repeat(MAX_CLOUD_REQUEST_BYTES + 1) }),
    event({ body: "界".repeat(Math.ceil(MAX_CLOUD_REQUEST_BYTES / 3)) }),
    event({
      body: "e".repeat(Math.ceil(MAX_CLOUD_REQUEST_BYTES / 3) * 4 + 1),
      isBase64Encoded: true,
    }),
  ])
    expect((await handler(input)).statusCode).toBe(413);
  for (const input of [
    event({ body: null }),
    event({ body: "\ud800" }),
    event({ body: "e30", isBase64Encoded: true }),
    event({ body: " e30=", isBase64Encoded: true }),
    event({ body: "/w==", isBase64Encoded: true }),
    event({ headers: { "content-length": "3" } }),
    event({ headers: { "content-length": "2,2" } }),
    event({ requestContext: { http: { method: "GET" } } }),
  ])
    expect((await handler(input)).statusCode).toBe(400);
  expect(service).not.toHaveBeenCalled();
  const body = JSON.stringify({ body: "Synthetic 笔记" });
  expect(
    (
      await handler(
        event({
          body: Buffer.from(body).toString("base64"),
          isBase64Encoded: true,
          headers: { "content-length": String(Buffer.byteLength(body)) },
        }),
      )
    ).statusCode,
  ).toBe(200);
  expect(await service.mock.calls.at(-1)![0].text()).toBe(body);
});
it("preserves raw query duplicates and cookies, ignores identity metadata, and rejects conflicting cookie sources", async () => {
  for (const cookies of [
    null,
    "cookie=value",
    [1],
    ["a=b,c=d"],
    ["a=bad\nvalue"],
    ["x=" + "x".repeat(8192)],
    Array(33).fill("a=b"),
  ])
    expect((await handler(event({ cookies }))).statusCode).toBe(400);
  expect(
    (await handler(event({ cookies: ["a=b"], headers: { cookie: "c=d" } })))
      .statusCode,
  ).toBe(400);
  expect(service).not.toHaveBeenCalled();
  expect(
    (
      await handler(
        event({
          rawQueryString: "pageToken=one&pageToken=two",
          cookies: ["session=one", "session=two"],
          headers: {
            host: "untrusted.example",
            "x-forwarded-host": "untrusted.example",
          },
          requestContext: {
            http: { method: "POST" },
            domainName: "untrusted.example",
            authorizer: { sub: "forged-owner" },
          },
        }),
      )
    ).statusCode,
  ).toBe(200);
  const request = service.mock.calls.at(-1)![0];
  expect(new URL(request.url).origin).toBe(origin);
  expect(new URL(request.url).searchParams.getAll("pageToken")).toEqual([
    "one",
    "two",
  ]);
  expect(request.headers.get("cookie")).toBe("session=one; session=two");
  expect(request.headers.has("authorization")).toBe(false);
});
it("preserves response status, retry headers and separate cookies, bounds streams and hides private failures", async () => {
  const headers = new Headers({
    "cache-control": "public",
    "retry-after": "5",
  });
  headers.append("set-cookie", "synthetic-a=one; Path=/");
  headers.append("set-cookie", "synthetic-b=two; Path=/");
  service.mockResolvedValueOnce(
    new Response("Synthetic response", { status: 429, headers }),
  );
  const response = await handler(event());
  expect(response.statusCode).toBe(429);
  expect(response.headers["retry-after"]).toBe("5");
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.cookies).toEqual([
    "synthetic-a=one; Path=/",
    "synthetic-b=two; Path=/",
  ]);
  expect(response.headers).not.toHaveProperty("set-cookie");
  expect(response.isBase64Encoded).toBe(false);
  const cancelled = vi.fn();
  service.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_CLOUD_REQUEST_BYTES + 1));
        },
        cancel: cancelled,
      }),
    ),
  );
  expect((await handler(event())).statusCode).toBe(503);
  expect(cancelled).toHaveBeenCalledTimes(1);
  service.mockRejectedValueOnce(Error("Private synthetic token/body detail"));
  const failed = await handler(event());
  expect(failed.statusCode).toBe(503);
  expect(JSON.parse(failed.body)).toEqual({ error: "service-unavailable" });
  expect(failed.headers["cache-control"]).toBe("no-store");
});
