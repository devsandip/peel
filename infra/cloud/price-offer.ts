import { createHash } from "node:crypto";

export const cloudPriceServices = Object.freeze([
  "AWSLambda",
  "AmazonDynamoDB",
  "AmazonCognito",
  "AWSSecretsManager",
  "AmazonS3",
  "AWSEvents",
] as const);
export type CloudPriceService = (typeof cloudPriceServices)[number];
export const cloudPriceMaxBytes = 2 * 1024 * 1024;
const unavailable = (): never => {
  throw Error("Cloud pricing observation unavailable");
};
export const cloudPriceUrl = (service: CloudPriceService) => {
  if (!cloudPriceServices.includes(service)) return unavailable();
  return `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${service}/current/us-east-1/index.json`;
};
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return unavailable();
  return value as Record<string, unknown>;
}
function date(value: unknown, now: number): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) ||
    value.length > 24
  )
    return unavailable();
  const time = Date.parse(value);
  if (!Number.isSafeInteger(time) || time > now) return unavailable();
  const canonical = new Date(time).toISOString();
  if (value !== canonical && value !== canonical.replace(".000Z", "Z"))
    return unavailable();
  return canonical;
}
interface Selector {
  field: string;
  service: CloudPriceService;
  family: string;
  unit: string;
  scale: number;
  attributes: Record<string, string>;
}
const select = (
  field: string,
  service: CloudPriceService,
  family: string,
  usage: string,
  operation: string,
  unit: string,
  scale: number,
  extra: Record<string, string> = {},
): Selector => ({
  field,
  service,
  family,
  unit,
  scale,
  attributes: {
    servicecode: service,
    regionCode: "us-east-1",
    locationType: "AWS Region",
    location: "US East (N. Virginia)",
    usagetype: usage,
    operation,
    ...extra,
  },
});
const selectors = [
  select(
    "lambdaRequestsPerMillion",
    "AWSLambda",
    "Serverless",
    "Request",
    "",
    "Requests",
    6,
    { group: "AWS-Lambda-Requests" },
  ),
  select(
    "lambdaGbSecond",
    "AWSLambda",
    "Serverless",
    "Lambda-GB-Second",
    "",
    "Lambda-GB-Second",
    0,
    { group: "AWS-Lambda-Duration" },
  ),
  select(
    "dynamoWritesPerMillion",
    "AmazonDynamoDB",
    "Amazon DynamoDB PayPerRequest Throughput",
    "WriteRequestUnits",
    "PayPerRequestThroughput",
    "WriteRequestUnits",
    6,
    { group: "DDB-WriteUnits" },
  ),
  select(
    "dynamoReadsPerMillion",
    "AmazonDynamoDB",
    "Amazon DynamoDB PayPerRequest Throughput",
    "ReadRequestUnits",
    "PayPerRequestThroughput",
    "ReadRequestUnits",
    6,
    { group: "DDB-ReadUnits" },
  ),
  select(
    "dynamoGbMonth",
    "AmazonDynamoDB",
    "Database Storage",
    "TimedStorage-ByteHrs",
    "",
    "GB-Mo",
    0,
    { volumeType: "Amazon DynamoDB - Indexed DataStore" },
  ),
  select(
    "cognitoMau",
    "AmazonCognito",
    "Amazon Cognito - Essentials",
    "USE1-CognitoEssentialsMAU",
    "CognitoEssentialsOperation",
    "CognitoUserPoolsMAU",
    0,
  ),
  select(
    "secretMonth",
    "AWSSecretsManager",
    "Secret",
    "USE1-AWSSecretsManager-Secrets",
    "",
    "Secrets",
    0,
    { group: "AWSSecretsManager-Secret" },
  ),
  select(
    "secretPerTenThousand",
    "AWSSecretsManager",
    "API Request",
    "USE1-AWSSecretsManagerAPIRequest",
    "",
    "API Requests",
    4,
    { group: "AWSSecretsManager-APIRequest" },
  ),
  select(
    "s3GbMonth",
    "AmazonS3",
    "Storage",
    "TimedStorage-ByteHrs",
    "",
    "GB-Mo",
    0,
    { storageClass: "General Purpose", volumeType: "Standard" },
  ),
  select(
    "s3PutsPerThousand",
    "AmazonS3",
    "API Request",
    "Requests-Tier1",
    "",
    "Requests",
    3,
    { group: "S3-API-Tier1" },
  ),
  select(
    "s3GetsPerThousand",
    "AmazonS3",
    "API Request",
    "Requests-Tier2",
    "",
    "Requests",
    3,
    { group: "S3-API-Tier2" },
  ),
  select(
    "schedulerPerMillion",
    "AWSEvents",
    "EventBridge",
    "USE1-ScheduledInvocation",
    "Invocation",
    "Invocations",
    6,
    { invocation: "Scheduled Invocation", timeWindow: "N/A" },
  ),
];
function range(value: unknown): number {
  if (
    typeof value !== "string" ||
    value.length > 16 ||
    !/^(0|[1-9]\d*)$/.test(value)
  )
    return unavailable();
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return unavailable();
  return number;
}
function greaterDecimal(a: string, b: string) {
  const [aw, af = ""] = a.split("."),
    [bw, bf = ""] = b.split("."),
    places = Math.max(af.length, bf.length);
  return (
    BigInt(aw + af.padEnd(places, "0")) > BigInt(bw + bf.padEnd(places, "0"))
  );
}
function paidDimension(
  spec: Selector,
  sku: string,
  terms: Record<string, unknown>,
  now: number,
) {
  const entries = Object.entries(object(terms[sku]));
  if (entries.length !== 1) return unavailable();
  const [termKey, value] = entries[0],
    term = object(value);
  if (
    typeof term.offerTermCode !== "string" ||
    !/^[A-Z0-9]{10}$/.test(term.offerTermCode) ||
    term.offerTermCode.length !== 10 ||
    termKey !== `${sku}.${term.offerTermCode}` ||
    term.sku !== sku ||
    Object.keys(object(term.termAttributes)).length
  )
    return unavailable();
  const effectiveAt = date(term.effectiveDate, now);
  const dimensions = Object.entries(object(term.priceDimensions))
    .map(([key, value]) => {
      const d = object(value),
        prices = object(d.pricePerUnit),
        wireUSD = prices.USD;
      if (
        d.rateCode !== key ||
        !key.startsWith(termKey + ".") ||
        !/^[A-Z0-9]{16}\.[A-Z0-9]{10}\.[A-Z0-9]{10}$/.test(key) ||
        key.length !== 38 ||
        d.unit !== spec.unit ||
        Object.keys(prices).join() !== "USD" ||
        typeof wireUSD !== "string" ||
        wireUSD.length > 32 ||
        !/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(wireUSD) ||
        !Array.isArray(d.appliesTo) ||
        d.appliesTo.length
      )
        return unavailable();
      const begin = range(d.beginRange),
        end = d.endRange === "Inf" ? Infinity : range(d.endRange),
        rate = Number(wireUSD + "e" + spec.scale);
      if (end <= begin || !Number.isFinite(rate) || rate < 0)
        return unavailable();
      return {
        begin,
        end,
        rate,
        wireUSD,
        rateCode: key,
        beginRange: d.beginRange as string,
        endRange: d.endRange as string,
      };
    })
    .sort((a, b) => a.begin - b.begin);
  if (
    !dimensions.length ||
    dimensions[0].begin !== 0 ||
    dimensions.at(-1)!.end !== Infinity
  )
    return unavailable();
  let previousPaid: string | undefined,
    seenPaid = false;
  for (let index = 0; index < dimensions.length; index++) {
    const d = dimensions[index];
    if (index && dimensions[index - 1].end !== d.begin) return unavailable();
    if (d.rate === 0) {
      if (seenPaid) return unavailable();
    } else {
      if (previousPaid !== undefined && greaterDecimal(d.wireUSD, previousPaid))
        return unavailable();
      seenPaid = true;
      previousPaid = d.wireUSD;
    }
  }
  const paid = dimensions.find((d) => d.rate > 0);
  if (!paid) return unavailable();
  return Object.freeze({
    field: spec.field,
    sku,
    termCode: term.offerTermCode,
    effectiveAt,
    rateCode: paid.rateCode,
    unit: spec.unit,
    beginRange: paid.beginRange,
    endRange: paid.endRange,
    wireUSD: paid.wireUSD,
    normalizedRate: paid.rate,
  });
}

/** Parse only a bounded public offer. No credential or account access. */
export function parseCloudPriceOffer(
  service: CloudPriceService,
  body: Uint8Array,
  now: number,
) {
  try {
    if (
      !cloudPriceServices.includes(service) ||
      !(body instanceof Uint8Array) ||
      body.byteLength > cloudPriceMaxBytes ||
      !Number.isSafeInteger(now) ||
      now < 0
    )
      return unavailable();
    const doc = object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)),
    );
    if (
      doc.formatVersion !== "v1.0" ||
      doc.offerCode !== service ||
      typeof doc.version !== "string" ||
      doc.version.length !== 14 ||
      !/^\d{14}$/.test(doc.version)
    )
      return unavailable();
    const publishedAt = date(doc.publicationDate, now),
      products = object(doc.products),
      terms = object(object(doc.terms).OnDemand);
    const selected = selectors
      .filter((s) => s.service === service)
      .map((spec) => {
        const matches = Object.entries(products).filter(([, value]) => {
          const p = object(value),
            a = object(p.attributes);
          return (
            p.productFamily === spec.family &&
            Object.entries(spec.attributes).every(
              ([key, expected]) => a[key] === expected,
            )
          );
        });
        if (matches.length !== 1) return unavailable();
        const [sku, value] = matches[0],
          product = object(value);
        if (
          !/^[A-Z0-9]{16}$/.test(sku) ||
          sku.length !== 16 ||
          product.sku !== sku
        )
          return unavailable();
        return paidDimension(spec, sku, terms, now);
      });
    return Object.freeze({
      service,
      url: cloudPriceUrl(service),
      sha256: hash(body),
      bytes: body.byteLength,
      version: doc.version,
      publishedAt,
      selected: Object.freeze(selected),
    });
  } catch {
    return unavailable();
  }
}
