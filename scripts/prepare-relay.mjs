// Read-only AWS preflight. This script never creates a stack or changes an account.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { relayTemplate } from "../infra/relay/template.ts";
import { validateRun, validateRelayTemplate } from "../infra/relay/guards.ts";
import { renderBootstrap } from "../infra/relay/bootstrap.ts";
import { createHash } from "node:crypto";

const execute = promisify(execFile);
const profile = "admin",
  region = "us-east-1";
const aws = async (args) => {
  try {
    const { stdout } = await execute(
      "aws",
      [
        "--profile",
        profile,
        "--region",
        region,
        "--no-cli-pager",
        "--cli-connect-timeout",
        "5",
        "--cli-read-timeout",
        "15",
        ...args,
        "--output",
        "json",
      ],
      { timeout: 25000, maxBuffer: 4 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } catch {
    throw new Error(
      `Read-only AWS ${args[0]} ${args[1]} failed; no deployment attempted`,
    );
  }
};
const rate = async (service, filters, unit) => {
  const result = await aws([
    "pricing",
    "get-products",
    "--service-code",
    service,
    "--max-results",
    "20",
    "--filters",
    JSON.stringify(
      Object.entries(filters).map(([Field, Value]) => ({
        Type: "TERM_MATCH",
        Field,
        Value,
      })),
    ),
  ]);
  const rates = result.PriceList.flatMap((raw) =>
    Object.values(JSON.parse(raw).terms.OnDemand).flatMap((term) =>
      Object.values(term.priceDimensions),
    ),
  ).filter((value) => value.unit === unit);
  if (rates.length !== 1)
    throw new Error(
      "Unexpected current pricing shape; no deployment attempted",
    );
  const value = Number(rates[0].pricePerUnit.USD);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("Unverified current rate");
  return value;
};
const expected = JSON.parse(
  await readFile("scratch/aws-development-identity.json", "utf8"),
);
const identity = await aws(["sts", "get-caller-identity"]);
if (
  identity.Account !== expected.identity.Account ||
  expected.profile !== profile ||
  expected.region !== region
)
  throw new Error("AWS identity changed from the private verified account");
const clientIp = (
  await (
    await fetch("https://checkip.amazonaws.com", {
      signal: AbortSignal.timeout(10000),
    })
  ).text()
).trim();
const parameter = await aws([
  "ssm",
  "get-parameter",
  "--name",
  "/aws/service/canonical/ubuntu/server/noble/stable/current/arm64/hvm/ebs-gp3/ami-id",
]);
const images = await aws([
  "ec2",
  "describe-images",
  "--image-ids",
  parameter.Parameter.Value,
]);
const image = images.Images[0];
if (
  images.Images.length !== 1 ||
  image.OwnerId !== "099720109477" ||
  image.Architecture !== "arm64" ||
  image.State !== "available" ||
  image.RootDeviceType !== "ebs" ||
  !image.Name.startsWith(
    "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-",
  )
)
  throw new Error("The regional image is not the verified Canonical candidate");
const [instanceHour, ipv4Hour, diskGbMonth] = await Promise.all([
  rate(
    "AmazonEC2",
    {
      regionCode: region,
      instanceType: "t4g.micro",
      operatingSystem: "Linux",
      tenancy: "Shared",
      preInstalledSw: "NA",
      capacitystatus: "Used",
    },
    "Hrs",
  ),
  rate(
    "AmazonVPC",
    { regionCode: region, usagetype: "USE1-PublicIPv4:InUseAddress" },
    "Hrs",
  ),
  rate(
    "AmazonEC2",
    { regionCode: region, volumeApiName: "gp3", productFamily: "Storage" },
    "GB-Mo",
  ),
]);
// Deliberately budget two hours of base cost and one GB at a conservative transfer allowance.
const estimatedUSD =
  2 * (instanceHour + ipv4Hour + (8 * diskGbMonth) / 730) + 0.2;
const now = Date.now(),
  runId = `r${now.toString(36)}-${randomBytes(3).toString("hex")}`;
const plan = {
  profile,
  region,
  accountId: identity.Account,
  runId,
  clientCidr: clientIp + "/32",
  imageId: image.ImageId,
  createdAt: new Date(now).toISOString(),
  terminateAt: new Date(now + 45 * 60000).toISOString(),
  allowanceUSD: 2,
  estimatedUSD,
};
validateRun(plan, { accountId: identity.Account, clientIp, now });
const source = await readFile("infra/relay/bootstrap.sh", "utf8");
const helper = await readFile("infra/relay/lease.py", "utf8");
const health = await readFile("infra/relay/health.py", "utf8");
const template = relayTemplate(renderBootstrap(source, helper, health));
validateRelayTemplate(template);
const folder = join("scratch", `relay-${runId}`);
await mkdir(folder, { mode: 0o700 });
const privateWrite = async (name, value) => {
  const path = join(folder, name);
  await writeFile(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
};
await privateWrite("template.json", template);
await privateWrite("plan.json", {
  ...plan,
  templateHash: createHash("sha256")
    .update(JSON.stringify(template))
    .digest("hex"),
  prices: { instanceHour, ipv4Hour, diskGbMonth },
  image: {
    id: image.ImageId,
    name: image.Name,
    owner: image.OwnerId,
    createdAt: image.CreationDate,
  },
});
const validated = await aws([
  "cloudformation",
  "validate-template",
  "--template-body",
  `file://${folder}/template.json`,
]);
await privateWrite("validation.json", {
  validatedAt: new Date().toISOString(),
  capabilities: validated.Capabilities,
  resourcesCreated: 0,
});
console.log(
  JSON.stringify(
    {
      planFolder: folder,
      region,
      accountVerified: true,
      clientRestrictedToOneAddress: true,
      officialArm64ImageVerified: true,
      currentPricesVerified: true,
      templateValidated: true,
      resourcesCreated: 0,
      estimatedUSD,
      allowanceUSD: 2,
    },
    null,
    2,
  ),
);
