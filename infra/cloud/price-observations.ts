import { createHash } from "node:crypto";
import { cloudDevelopmentCost } from "./deployment-plan.ts";
import {
  cloudPriceServices,
  cloudPriceUrl as url,
  cloudPriceMaxBytes as maxBytes,
  parseCloudPriceOffer,
} from "./price-offer.ts";
const deadlineMs = 10000;
const unavailable = (): never => {
  throw Error("Cloud pricing observation unavailable");
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function readBody(
  response: Response,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const length = response.headers.get("content-length"),
    encoding = response.headers.get("content-encoding"),
    type = response.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
  if (
    !response.ok ||
    response.redirected ||
    !["application/json", "application/octet-stream"].includes(type ?? "") ||
    (encoding && encoding !== "identity") ||
    (length !== null &&
      (!/^\d+$/.test(length) ||
        !Number.isSafeInteger(Number(length)) ||
        Number(length) > maxBytes)) ||
    !response.body
  )
    return unavailable();
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  try {
    if (signal.aborted) return unavailable();
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) return unavailable();
      chunks.push(result.value);
    }
    if (length !== null && bytes !== Number(length)) return unavailable();
    return Buffer.concat(chunks);
  } catch {
    void reader.cancel().catch(() => {});
    return unavailable();
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Fixed-origin public HTTPS only; abort all outstanding fetches on any failure. */
export async function collectCloudPriceObservations(
  dependencies: { fetch?: typeof fetch; clock?: () => number } = {},
) {
  const fetcher = dependencies.fetch ?? fetch,
    clock = dependencies.clock ?? Date.now,
    controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const started = clock();
    if (!Number.isSafeInteger(started) || started < 0) return unavailable();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(Error("Cloud pricing observation unavailable"));
      }, deadlineMs);
    });
    const sources = await Promise.race([
      Promise.all(
        cloudPriceServices.map(async (service) => {
          const address = url(service);
          const response = await fetcher(address, {
            method: "GET",
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            headers: {
              accept: "application/json",
              "accept-encoding": "identity",
            },
            signal: controller.signal,
          });
          if (response.url && response.url !== address) return unavailable();
          return parseCloudPriceOffer(
            service,
            await readBody(response, controller.signal),
            started,
          );
        }),
      ),
      timeout,
    ]);
    const ended = clock();
    if (
      !Number.isSafeInteger(ended) ||
      ended < started ||
      ended - started > deadlineMs
    )
      return unavailable();
    const rates = Object.freeze(
      Object.fromEntries(
        sources.flatMap((source) =>
          source.selected.map((s) => [s.field, s.normalizedRate]),
        ),
      ),
    );
    const quote = Object.freeze({
      checkedAt: new Date(started).toISOString(),
      region: "us-east-1",
      currency: "USD",
      sourceSha256: hash(JSON.stringify(sources)),
      rates,
    });
    cloudDevelopmentCost(quote, ended);
    return Object.freeze({ quote, sources: Object.freeze(sources) });
  } catch {
    controller.abort();
    return unavailable();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
