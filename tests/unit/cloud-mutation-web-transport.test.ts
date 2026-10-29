import { expect, it, vi } from "vitest";
import { createCloudMutationWebSender } from "../../apps/web/src/cloud-mutation-web-transport";
import {
  createCloudWebJSONSender,
  CLOUD_WEB_DEADLINE_MS,
} from "../../apps/web/src/cloud-web-json";
import { MAX_CLOUD_REQUEST_BYTES } from "../../packages/cloud-protocol/src/server-http";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
} from "../../packages/cloud-protocol/src/index";
import type { CloudMutationRequest } from "../../packages/cloud-protocol/src/server";
import { cloudDraft, cloudScope } from "../fixtures/cloud-durable-contract";

const config = () => ({
  origin: "https://synthetic.example",
  csrfToken: "c".repeat(43),
});
const signal = () => new AbortController().signal;
async function request(
  body = "Original retained source",
): Promise<CloudMutationRequest> {
  const state = await startCloudMutation(
    saveCloudDraft(
      createCloudClient(cloudScope.collectionId, "synthetic-note"),
      { kind: "upsert", snapshot: cloudDraft(body) },
    ),
    "synthetic-operation",
  );
  return {
    version: 1,
    collectionId: cloudScope.collectionId,
    modeGeneration: cloudScope.modeGeneration,
    mutation: state.inFlight!,
  };
}
function fake(run: (...args: any[]) => Promise<Response>) {
  return vi.fn(run) as unknown as typeof fetch;
}

it("captures origin/CSRF and the immutable operation before asynchronous verification", async () => {
  const original = config(),
    outgoing = await request(),
    initial = structuredClone(outgoing),
    calls: { url: string; options: RequestInit }[] = [];
  const fetcher = fake(async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ accepted: true }, { status: 409 });
  });
  const send = createCloudMutationWebSender(original, fetcher);
  original.origin = "https://other.example";
  original.csrfToken = "d".repeat(43);
  const task = send(outgoing, signal());
  outgoing.mutation.snapshot!.bodyMarkdown =
    "Later typing must not retarget the operation";
  expect(await task).toEqual({ status: 409, body: { accepted: true } });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://synthetic.example/v1/mutations");
  expect(calls[0].options).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    mode: "same-origin",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  expect(new Headers(calls[0].options.headers).get("x-peel-csrf")).toBe(
    "c".repeat(43),
  );
  expect(JSON.parse(calls[0].options.body as string)).toEqual(initial);
});

it.each([
  "null",
  "extra-authority",
  "version",
  "collection",
  "generation",
  "missing-mutation",
  "hash",
  "snapshot-collection",
  "mutation-fields",
])("refuses malformed outgoing %s before I/O", async (failure) => {
  let outgoing: any = await request();
  if (failure === "null") outgoing = null;
  if (failure === "extra-authority") outgoing.paid = true;
  if (failure === "version") outgoing.version = 99;
  if (failure === "collection") outgoing.collectionId = "../other";
  if (failure === "generation") outgoing.modeGeneration = 0;
  if (failure === "missing-mutation") outgoing.mutation = null;
  if (failure === "hash") outgoing.mutation.contentHash = "0".repeat(64);
  if (failure === "snapshot-collection")
    outgoing.collectionId = "another-library";
  if (failure === "mutation-fields")
    outgoing.mutation.ownerSubject = "not-authority";
  const fetcher = vi.fn();
  await expect(
    createCloudMutationWebSender(config(), fetcher)(outgoing, signal()),
  ).rejects.toThrow(/^Cloud upload transport unavailable$/);
  expect(fetcher).not.toHaveBeenCalled();
});

it("sends a valid maximum-size source without truncation", async () => {
  const outgoing = await request("x".repeat(256 * 1024));
  let body = "";
  const fetcher = fake(async (_, options) => {
    body = options.body;
    return Response.json({ accepted: true });
  });
  await createCloudMutationWebSender(config(), fetcher)(outgoing, signal());
  expect(JSON.parse(body).mutation.snapshot.bodyMarkdown).toHaveLength(
    256 * 1024,
  );
  expect(new TextEncoder().encode(body).length).toBeLessThan(
    MAX_CLOUD_REQUEST_BYTES,
  );
});

it("refuses account cancellation during hash preparation before dispatch", async () => {
  const outgoing = await request(),
    controller = new AbortController(),
    fetcher = vi.fn();
  const task = createCloudMutationWebSender(config(), fetcher)(
    outgoing,
    controller.signal,
  );
  controller.abort("Private cancellation reason");
  await expect(task).rejects.toThrow(/^Cloud upload transport unavailable$/);
  expect(fetcher).not.toHaveBeenCalled();
});

it("includes stalled asynchronous preparation in the complete-operation deadline", async () => {
  const outgoing = await request();
  vi.useFakeTimers();
  const digest = vi
    .spyOn(crypto.subtle, "digest")
    .mockImplementation(() => new Promise(() => {}));
  try {
    const fetcher = vi.fn(),
      task = createCloudMutationWebSender(config(), fetcher)(
        outgoing,
        signal(),
      );
    const check = expect(task).rejects.toThrow(
      /^Cloud upload transport unavailable$/,
    );
    await vi.advanceTimersByTimeAsync(CLOUD_WEB_DEADLINE_MS + 1);
    await check;
    expect(fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    digest.mockRestore();
    vi.useRealTimers();
  }
});

it("bounds encoded request bytes before fetch", async () => {
  const fetcher = vi.fn();
  const send = createCloudWebJSONSender(
    config(),
    () => ({
      path: "/v1/mutations",
      body: JSON.stringify("x".repeat(MAX_CLOUD_REQUEST_BYTES)),
    }),
    () => Error("Generic request refusal"),
    fetcher,
  );
  await expect(send(null, signal())).rejects.toThrow("Generic request refusal");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  "//other.example/v1/mutations",
  "https://other.example/v1/mutations",
  "/v1/mutations#private",
])("refuses an unsafe internal destination %s", async (path) => {
  const fetcher = vi.fn(),
    send = createCloudWebJSONSender(
      config(),
      () => ({ path, body: "{}" }),
      () => Error("Generic destination refusal"),
      fetcher,
    );
  await expect(send(null, signal())).rejects.toThrow(
    "Generic destination refusal",
  );
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps failed fetch diagnostics generic and performs no retry", async () => {
  const fetcher = fake(async () => {
    throw Error("Private transport diagnostics");
  });
  await expect(
    createCloudMutationWebSender(config(), fetcher)(await request(), signal()),
  ).rejects.toThrow(/^Cloud upload transport unavailable$/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
