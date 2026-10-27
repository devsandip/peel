import type { CloudPriceService } from "../../infra/cloud/price-offer";

interface Dimension {
  rateCode: string;
  unit: string;
  beginRange: string;
  endRange: string;
  pricePerUnit: Record<string, string>;
  appliesTo: string[];
}
interface Term {
  sku: string;
  offerTermCode: string;
  effectiveDate: string;
  termAttributes: Record<string, string>;
  priceDimensions: Record<string, Dimension>;
}
export interface PriceFixture {
  formatVersion: string;
  offerCode: string;
  version: string;
  publicationDate: string;
  products: Record<
    string,
    { sku: string; productFamily: string; attributes: Record<string, string> }
  >;
  terms: { OnDemand: Record<string, Record<string, Term>> };
}
type Row = [
  CloudPriceService,
  string,
  string,
  string,
  string,
  Record<string, string>,
  [string, string, string][],
];
// Small synthetic identities with wire units/ranges inspected in the official regional offers.
const rows: Row[] = [
  [
    "AWSLambda",
    "Serverless",
    "Request",
    "",
    "Requests",
    { group: "AWS-Lambda-Requests" },
    [["0", "Inf", "0.0000002000"]],
  ],
  [
    "AWSLambda",
    "Serverless",
    "Lambda-GB-Second",
    "",
    "Lambda-GB-Second",
    { group: "AWS-Lambda-Duration" },
    [
      ["0", "6000000000", "0.0000166667"],
      ["6000000000", "15000000000", "0.0000150000"],
      ["15000000000", "Inf", "0.0000133334"],
    ],
  ],
  [
    "AmazonDynamoDB",
    "Amazon DynamoDB PayPerRequest Throughput",
    "WriteRequestUnits",
    "PayPerRequestThroughput",
    "WriteRequestUnits",
    { group: "DDB-WriteUnits" },
    [["0", "Inf", "0.0000006250"]],
  ],
  [
    "AmazonDynamoDB",
    "Amazon DynamoDB PayPerRequest Throughput",
    "ReadRequestUnits",
    "PayPerRequestThroughput",
    "ReadRequestUnits",
    { group: "DDB-ReadUnits" },
    [["0", "Inf", "0.0000001250"]],
  ],
  [
    "AmazonDynamoDB",
    "Database Storage",
    "TimedStorage-ByteHrs",
    "",
    "GB-Mo",
    { volumeType: "Amazon DynamoDB - Indexed DataStore" },
    [
      ["0", "25", "0.0000000000"],
      ["25", "Inf", "0.2500000000"],
    ],
  ],
  [
    "AmazonCognito",
    "Amazon Cognito - Essentials",
    "USE1-CognitoEssentialsMAU",
    "CognitoEssentialsOperation",
    "CognitoUserPoolsMAU",
    {},
    [["0", "Inf", "0.0150000000"]],
  ],
  [
    "AWSSecretsManager",
    "Secret",
    "USE1-AWSSecretsManager-Secrets",
    "",
    "Secrets",
    { group: "AWSSecretsManager-Secret" },
    [["0", "Inf", "0.4000000000"]],
  ],
  [
    "AWSSecretsManager",
    "API Request",
    "USE1-AWSSecretsManagerAPIRequest",
    "",
    "API Requests",
    { group: "AWSSecretsManager-APIRequest" },
    [["0", "Inf", "0.0000050000"]],
  ],
  [
    "AmazonS3",
    "Storage",
    "TimedStorage-ByteHrs",
    "",
    "GB-Mo",
    { storageClass: "General Purpose", volumeType: "Standard" },
    [
      ["0", "51200", "0.0230000000"],
      ["51200", "512000", "0.0220000000"],
      ["512000", "Inf", "0.0210000000"],
    ],
  ],
  [
    "AmazonS3",
    "API Request",
    "Requests-Tier1",
    "",
    "Requests",
    { group: "S3-API-Tier1" },
    [["0", "Inf", "0.0000050000"]],
  ],
  [
    "AmazonS3",
    "API Request",
    "Requests-Tier2",
    "",
    "Requests",
    { group: "S3-API-Tier2" },
    [["0", "Inf", "0.0000004000"]],
  ],
  [
    "AWSEvents",
    "EventBridge",
    "USE1-ScheduledInvocation",
    "Invocation",
    "Invocations",
    { invocation: "Scheduled Invocation", timeWindow: "N/A" },
    [
      ["0", "14000000", "0.0000000000"],
      ["14000000", "Inf", "0.0000010000"],
    ],
  ],
];
export function cloudPriceFixtures() {
  const docs = {} as Record<CloudPriceService, PriceFixture>;
  for (const [
    index,
    [service, family, usage, operation, unit, extra, tiers],
  ] of rows.entries()) {
    const doc = (docs[service] ??= {
      formatVersion: "v1.0",
      offerCode: service,
      version: "20261027000000",
      publicationDate: "2026-10-27T00:00:00Z",
      products: {},
      terms: { OnDemand: {} },
    });
    const sku = (index + 1).toString().padStart(16, "0"),
      termCode = "JRTCKXETXF",
      termKey = sku + "." + termCode;
    doc.products[sku] = {
      sku,
      productFamily: family,
      attributes: {
        servicecode: service,
        regionCode: "us-east-1",
        locationType: "AWS Region",
        location: "US East (N. Virginia)",
        usagetype: usage,
        operation,
        ...extra,
      },
    };
    const dimensions = Object.fromEntries(
      tiers.map(([beginRange, endRange, price], index) => {
        const rateCode =
          termKey + "." + (index + 1).toString().padStart(10, "0");
        return [
          rateCode,
          {
            rateCode,
            unit,
            beginRange,
            endRange,
            pricePerUnit: { USD: price },
            appliesTo: [],
          },
        ];
      }),
    );
    doc.terms.OnDemand[sku] = {
      [termKey]: {
        sku,
        offerTermCode: termCode,
        effectiveDate: "2026-10-01T00:00:00Z",
        termAttributes: {},
        priceDimensions: dimensions,
      },
    };
  }
  return docs;
}
export function fixtureProduct(doc: PriceFixture, usage: string) {
  const product = Object.values(doc.products).find(
    (p) => p.attributes.usagetype === usage,
  )!;
  const term = Object.values(doc.terms.OnDemand[product.sku])[0];
  return { product, term, dimensions: Object.values(term.priceDimensions) };
}
