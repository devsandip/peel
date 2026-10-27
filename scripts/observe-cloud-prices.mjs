import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { collectCloudPriceObservations } from "../infra/cloud/price-observations.ts";
import { cloudDevelopmentCost } from "../infra/cloud/deployment-plan.ts";

if (process.argv.length !== 2)
  throw Error("The public-price observation command accepts no arguments");
const observed = await collectCloudPriceObservations();
const cost = cloudDevelopmentCost(observed.quote, Date.now());
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "artifacts", "cloud-prices");
await mkdir(output, { recursive: true, mode: 0o700 });
const folder = await mkdtemp(join(output, "observed-"));
const file = join(folder, "observation.json");
await writeFile(file, JSON.stringify({ ...observed, cost }, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify(
    {
      region: observed.quote.region,
      currency: observed.quote.currency,
      checkedAt: observed.quote.checkedAt,
      sourceCount: observed.sources.length,
      bytes: observed.sources.reduce((sum, source) => sum + source.bytes, 0),
      ...cost,
      allowanceUSD: 2,
      withinAllowance: cost.estimateUSD <= 2,
      accountOperations: 0,
      resourcesCreated: 0,
      observationFile: relative(root, file),
    },
    null,
    2,
  ),
);
