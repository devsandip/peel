import { expect, it } from "vitest";
import {
  cloudPriceServices,
  parseCloudPriceOffer,
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
const parse = (service: CloudPriceService, doc: PriceFixture) =>
  parseCloudPriceOffer(service, wire(doc), now);
const failure = new Error("Cloud pricing observation unavailable");

it("normalizes all twelve paid rates and preserves immutable source/selection provenance for the actual cost model", () => {
  const docs = cloudPriceFixtures(),
    sources = cloudPriceServices.map((service) =>
      parse(service, docs[service]),
    );
  const rates = Object.fromEntries(
    sources.flatMap((source) =>
      source.selected.map((d) => [d.field, d.normalizedRate]),
    ),
  );
  expect(rates).toEqual({
    lambdaRequestsPerMillion: 0.2,
    lambdaGbSecond: 0.0000166667,
    dynamoWritesPerMillion: 0.625,
    dynamoReadsPerMillion: 0.125,
    dynamoGbMonth: 0.25,
    cognitoMau: 0.015,
    secretMonth: 0.4,
    secretPerTenThousand: 0.05,
    s3GbMonth: 0.023,
    s3PutsPerThousand: 0.005,
    s3GetsPerThousand: 0.0004,
    schedulerPerMillion: 1,
  });
  expect(
    cloudDevelopmentCost(
      {
        checkedAt: new Date(now).toISOString(),
        region: "us-east-1",
        currency: "USD",
        sourceSha256: "f".repeat(64),
        rates,
      },
      now,
    ).estimateUSD,
  ).toBe(1.488729);
  for (const source of sources) {
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(source.bytes).toBeGreaterThan(0);
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.selected)).toBe(true);
    for (const selected of source.selected)
      expect(Object.isFrozen(selected)).toBe(true);
  }
});

it("skips leading free ranges and later discounts while excluding ARM, IA, addon and non-Standard lookalikes", () => {
  const docs = cloudPriceFixtures();
  for (const [service, usage, changes] of [
    [
      "AWSLambda",
      "Lambda-GB-Second",
      { usagetype: "Lambda-GB-Second-ARM", group: "AWS-Lambda-Duration-ARM" },
    ],
    [
      "AmazonDynamoDB",
      "TimedStorage-ByteHrs",
      { volumeType: "Amazon DynamoDB - Indexed DataStore - IA" },
    ],
    [
      "AmazonCognito",
      "USE1-CognitoEssentialsMAU",
      { usagetype: "USE1-CognitoEssentialsMRRMAU" },
    ],
    [
      "AmazonS3",
      "TimedStorage-ByteHrs",
      { storageClass: "Files", volumeType: "Files" },
    ],
  ] as const) {
    const doc = docs[service],
      p = fixtureProduct(doc, usage).product,
      sku = "9999999999999999";
    doc.products[sku] = {
      ...p,
      sku,
      attributes: { ...p.attributes, ...changes },
    };
    expect(() => parse(service, doc)).not.toThrow();
  }
  expect(parse("AWSEvents", docs.AWSEvents).selected[0]).toMatchObject({
    beginRange: "14000000",
    normalizedRate: 1,
  });
  expect(
    parse("AmazonDynamoDB", docs.AmazonDynamoDB).selected.find(
      (s) => s.field === "dynamoGbMonth",
    ),
  ).toMatchObject({ beginRange: "25", normalizedRate: 0.25 });
  expect(
    parse("AWSLambda", docs.AWSLambda).selected.find(
      (s) => s.field === "lambdaGbSecond",
    ),
  ).toMatchObject({
    beginRange: "0",
    endRange: "6000000000",
    normalizedRate: 0.0000166667,
  });
});

it("rejects changed region, service, family, operation, location and identity attributes instead of accepting a nearby product", () => {
  for (const [key, value] of [
    ["regionCode", "us-west-2"],
    ["servicecode", "OtherService"],
    ["locationType", "AWS Local Zone"],
    ["location", "US West (Oregon)"],
    ["operation", "Provisioned"],
    ["group", "OtherGroup"],
  ]) {
    const doc = cloudPriceFixtures().AWSLambda;
    fixtureProduct(doc, "Request").product.attributes[key] = value;
    expect(() => parse("AWSLambda", doc)).toThrow(failure);
  }
  const doc = cloudPriceFixtures().AWSLambda;
  fixtureProduct(doc, "Request").product.productFamily = "OtherFamily";
  expect(() => parse("AWSLambda", doc)).toThrow(failure);
});

it("refuses absent/ambiguous SKUs and terms and mismatched map/rate identities", () => {
  for (const mutate of [
    (d: PriceFixture) => {
      delete d.products[fixtureProduct(d, "Request").product.sku];
    },
    (d: PriceFixture) => {
      const p = fixtureProduct(d, "Request").product;
      d.products["9999999999999999"] = { ...p, sku: "9999999999999999" };
    },
    (d: PriceFixture) => {
      const p = fixtureProduct(d, "Request");
      d.terms.OnDemand[p.product.sku].other = p.term;
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").product.sku = "9999999999999999";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").term.sku = "9999999999999999";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").dimensions[0].rateCode = "wrong";
    },
  ]) {
    const doc = cloudPriceFixtures().AWSLambda;
    mutate(doc);
    expect(() => parse("AWSLambda", doc)).toThrow(failure);
  }
});

it("requires the actual unit, unqualified OnDemand terms and one numeric USD wire price", () => {
  for (const mutate of [
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").dimensions[0].unit = "Millions of Requests";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").dimensions[0].pricePerUnit = {
        EUR: "0.0000002",
      };
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").dimensions[0].pricePerUnit.EUR = "0.0000002";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").dimensions[0].appliesTo = ["other-sku"];
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").term.termAttributes = {
        LeaseContractLength: "1yr",
      };
    },
  ]) {
    const doc = cloudPriceFixtures().AWSLambda;
    mutate(doc);
    expect(() => parse("AWSLambda", doc)).toThrow(failure);
  }
  for (const price of [
    "NaN",
    "Infinity",
    "-1",
    "1e-7",
    "0.2\n",
    "not-a-price",
  ]) {
    const doc = cloudPriceFixtures().AWSLambda;
    fixtureProduct(doc, "Request").dimensions[0].pricePerUnit.USD = price;
    expect(() => parse("AWSLambda", doc)).toThrow(failure);
  }
});

it("rejects range gaps, overlap, missing coverage, nonmonotone paid tiers and free-only quotes", () => {
  for (const mutate of [
    (d: PriceFixture) => {
      fixtureProduct(d, "Lambda-GB-Second").dimensions[0].beginRange = "0\n";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Lambda-GB-Second").dimensions[0].endRange =
        "6000000000\n";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Lambda-GB-Second").dimensions[1].beginRange =
        "6000000001";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Lambda-GB-Second").dimensions[1].beginRange =
        "5999999999";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Lambda-GB-Second").dimensions[2].endRange =
        "16000000000";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Lambda-GB-Second").dimensions[1].pricePerUnit.USD =
        "0.0000200000";
    },
    (d: PriceFixture) => {
      const dims = fixtureProduct(d, "Lambda-GB-Second").dimensions;
      dims[0].pricePerUnit.USD = "0.023000000000000000";
      dims[1].pricePerUnit.USD = "0.023000000000000001";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Lambda-GB-Second").dimensions[2].pricePerUnit.USD =
        "0.0000000000";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").dimensions[0].pricePerUnit.USD =
        "0.0000000000";
    },
  ]) {
    const doc = cloudPriceFixtures().AWSLambda;
    mutate(doc);
    expect(() => parse("AWSLambda", doc)).toThrow(failure);
  }
});

it("refuses future/invalid publication and effective dates, provider format drift, invalid UTF8 and malformed JSON", () => {
  for (const mutate of [
    (d: PriceFixture) => {
      d.publicationDate = "2026-10-28T00:00:00Z";
    },
    (d: PriceFixture) => {
      d.publicationDate = "2026-02-30T00:00:00Z";
    },
    (d: PriceFixture) => {
      fixtureProduct(d, "Request").term.effectiveDate = "2026-10-28T00:00:00Z";
    },
    (d: PriceFixture) => {
      d.formatVersion = "v2.0";
    },
    (d: PriceFixture) => {
      d.offerCode = "AmazonS3";
    },
  ]) {
    const doc = cloudPriceFixtures().AWSLambda;
    mutate(doc);
    expect(() => parse("AWSLambda", doc)).toThrow(failure);
  }
  for (const body of [
    new Uint8Array([255]),
    new TextEncoder().encode('{"products":'),
    new Uint8Array(2 * 1024 * 1024 + 1),
  ])
    expect(() => parseCloudPriceOffer("AWSLambda", body, now)).toThrow(failure);
});

it("changes raw-source provenance and normalized rates when a valid paid price changes", () => {
  const doc = cloudPriceFixtures().AWSLambda,
    before = parse("AWSLambda", doc);
  fixtureProduct(doc, "Request").dimensions[0].pricePerUnit.USD =
    "0.0000003000";
  const after = parse("AWSLambda", doc);
  expect(after.sha256).not.toBe(before.sha256);
  expect(
    after.selected.find((s) => s.field === "lambdaRequestsPerMillion")
      ?.normalizedRate,
  ).toBe(0.3);
});
