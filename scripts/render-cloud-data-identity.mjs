import { mkdir, writeFile } from "node:fs/promises";
import { cloudDataIdentityTemplate } from "../infra/cloud/data-identity.ts";

// Render a fixed synthetic fixture only. Actual provisioning needs the later guarded runner.
const template = cloudDataIdentityTemplate(
  "00000000-0000-4000-8000-000000000001",
);
const output = new URL("../artifacts/cloud-iac/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL("data-identity.json", output),
  JSON.stringify(template, null, 2) + "\n",
);
console.log("Rendered synthetic data/identity template; no AWS account call");
