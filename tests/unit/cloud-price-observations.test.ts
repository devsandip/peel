import { expect, it, vi } from "vitest";
import { collectCloudPriceObservations } from "../../infra/cloud/price-observations";
import {
  cloudPriceServices,
  type CloudPriceService,
} from "../../infra/cloud/price-offer";
import { cloudDevelopmentCost } from "../../infra/cloud/deployment-plan";
import {
  cloudPriceFixtures,
  fixtureProduct,
  type PriceFixture,
} from "../fixtures/cloud-prices";
const now = Date.parse("2026-10-27T20:00:00.000Z");
const wire = (doc: PriceFixture) =>
  new TextEncoder().encode(JSON.stringify(doc));
function response(doc: PriceFixture) {
  const body = wire(doc);
  return new Response(body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(body.byteLength),
    },
  });
}
function network(
  docs = cloudPriceFixtures(),
  override?: (service: CloudPriceService) => Response | undefined,
) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const service = new URL(String(input)).pathname.split(
      "/",
    )[4] as CloudPriceService;
    return override?.(service) ?? response(docs[service]);
  });
}
const failure = new Error("Cloud pricing observation unavailable");

it("collects twelve paid regional rates from six fixed credential-free origins and binds complete public provenance", async () => {
  const fetcher = network(),
    observed = await collectCloudPriceObservations({
      fetch: fetcher,
      clock: () => now,
    });
  expect(fetcher).toHaveBeenCalledTimes(6);
  for (const [input, options] of fetcher.mock.calls) {
    expect(
      cloudPriceServices.map(
        (s) =>
          `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${s}/current/us-east-1/index.json`,
      ),
    ).toContain(input);
    expect(options).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: { accept: "application/json", "accept-encoding": "identity" },
    });
    expect(Object.keys(options!.headers!)).toHaveLength(2);
  }
  expect(observed.quote).toMatchObject({
    checkedAt: new Date(now).toISOString(),
    region: "us-east-1",
    currency: "USD",
    rates: {
      lambdaRequestsPerMillion: 0.2,
      lambdaGbSecond: 0.0000166667,
      cognitoMau: 0.015,
      dynamoWritesPerMillion: 0.625,
      dynamoReadsPerMillion: 0.125,
      dynamoGbMonth: 0.25,
      secretMonth: 0.4,
      secretPerTenThousand: 0.05,
      s3GbMonth: 0.023,
      s3PutsPerThousand: 0.005,
      s3GetsPerThousand: 0.0004,
      schedulerPerMillion: 1,
    },
  });
  expect(cloudDevelopmentCost(observed.quote, now).estimateUSD).toBe(1.488729);
  expect(observed.sources.flatMap((s) => s.selected)).toHaveLength(12);
  for (const source of observed.sources) {
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.bytes).toBeGreaterThan(0);
    expect(Object.isFrozen(source.selected)).toBe(true);
  }
  for (const object of [
    observed,
    observed.quote,
    observed.quote.rates,
    observed.sources,
  ])
    expect(Object.isFrozen(object)).toBe(true);
});

it("binds changed source/rate data into a new quote without a stale hardcoded fallback", async () => {
  const first = await collectCloudPriceObservations({
      fetch: network(),
      clock: () => now,
    }),
    docs = cloudPriceFixtures();
  fixtureProduct(docs.AWSLambda, "Request").dimensions[0].pricePerUnit.USD =
    "0.0000003000";
  const changed = await collectCloudPriceObservations({
    fetch: network(docs),
    clock: () => now,
  });
  expect(changed.quote.rates.lambdaRequestsPerMillion).toBe(0.3);
  expect(changed.quote.sourceSha256).not.toBe(first.quote.sourceSha256);
  expect(cloudDevelopmentCost(changed.quote, now).quoteSha256).not.toBe(
    cloudDevelopmentCost(first.quote, now).quoteSha256,
  );
});

it("refuses bad status, content/encoding/length, redirects and wrong response origins", async () => {
  for (const build of [
    () => new Response("unavailable", { status: 503 }),
    () => new Response("redirect", { status: 302 }),
    () => new Response("<html/>", { headers: { "content-type": "text/html" } }),
    () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
      }),
    () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": String(2 * 1024 * 1024 + 1),
        },
      }),
    () =>
      new Response("{}", {
        headers: {
          "content-type": "application/json",
          "content-length": "invalid",
        },
      }),
    () =>
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "3" },
      }),
    () => {
      const r = response(cloudPriceFixtures().AWSLambda);
      Object.defineProperty(r, "url", { value: "https://other.example/" });
      return r;
    },
    () => {
      const r = response(cloudPriceFixtures().AWSLambda);
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    },
  ]) {
    const fetcher = network(undefined, (s) =>
      s === "AWSLambda" ? build() : undefined,
    );
    await expect(
      collectCloudPriceObservations({ fetch: fetcher, clock: () => now }),
    ).rejects.toThrow(failure);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(
      fetcher.mock.calls.every(([, options]) => options!.signal!.aborted),
    ).toBe(true);
  }
});

it("enforces streamed size limits without relying on Content-Length and cancels the reader", async () => {
  const cancel = vi.fn(),
    body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      },
      cancel,
    });
  const fetcher = network(undefined, (s) =>
    s === "AWSLambda"
      ? new Response(body, { headers: { "content-type": "application/json" } })
      : undefined,
  );
  await expect(
    collectCloudPriceObservations({ fetch: fetcher, clock: () => now }),
  ).rejects.toThrow(failure);
  expect(cancel).toHaveBeenCalled();
});

it("bounds a stalled body by the shared deadline and aborts every request", async () => {
  vi.useFakeTimers();
  try {
    const cancel = vi.fn(),
      body = new ReadableStream({ cancel });
    const fetcher = network(undefined, (s) =>
      s === "AWSLambda"
        ? new Response(body, {
            headers: { "content-type": "application/json" },
          })
        : undefined,
    );
    const collected = collectCloudPriceObservations({
      fetch: fetcher,
      clock: () => now,
    });
    const rejected = expect(collected).rejects.toThrow(failure);
    await vi.advanceTimersByTimeAsync(10000);
    await rejected;
    expect(cancel).toHaveBeenCalled();
    expect(
      fetcher.mock.calls.every(([, options]) => options!.signal!.aborted),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("cancels another stalled source immediately when one provider fails", async () => {
  const cancel = vi.fn(),
    body = new ReadableStream({ cancel });
  const fetcher = network(undefined, (service) => {
    if (service === "AWSLambda")
      return new Response("unavailable", { status: 503 });
    if (service === "AmazonDynamoDB")
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    return undefined;
  });
  await expect(
    collectCloudPriceObservations({ fetch: fetcher, clock: () => now }),
  ).rejects.toThrow(failure);
  expect(cancel).toHaveBeenCalled();
  expect(
    fetcher.mock.calls.every(([, options]) => options!.signal!.aborted),
  ).toBe(true);
});

it("rejects clock reversal/overrun and clears the deadline after an otherwise valid collection", async () => {
  for (const ended of [now - 1, now + 10001, NaN]) {
    const clock = vi.fn().mockReturnValueOnce(now).mockReturnValue(ended);
    await expect(
      collectCloudPriceObservations({ fetch: network(), clock }),
    ).rejects.toThrow(failure);
  }
});
