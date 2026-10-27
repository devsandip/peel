import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cloudDataIdentityTemplate } from "../infra/cloud/data-identity.ts";
import {
  cloudCleanupGuardTemplate,
  cloudCleanupSentinelTemplate,
} from "../infra/cloud/cleanup.ts";
import {
  cloudArtifactBootstrapTemplate,
  cloudPrivateHostingTemplate,
} from "../infra/cloud/private-hosting.ts";

// Render a fixed synthetic fixture only. Actual provisioning needs the later guarded runner.
const runId = "00000000-0000-4000-8000-000000000001";
const lease = {
  startedAt: "2026-10-27T12:00:00.000Z",
  expiresAt: "2026-10-27T13:00:00.000Z",
};
const manifest = JSON.parse(
  await readFile(
    new URL("../artifacts/cloud-lambda/manifest.json", import.meta.url),
  ),
);
const templates = {
  "data-identity": cloudDataIdentityTemplate(runId),
  "artifact-bootstrap": cloudArtifactBootstrapTemplate(runId),
  "cleanup-guard": cloudCleanupGuardTemplate({ runId, lease }),
  "cleanup-sentinel": cloudCleanupSentinelTemplate(runId),
  "private-hosting": cloudPrivateHostingTemplate({
    runId,
    artifact: { sha256: manifest.zipSha256, bytes: manifest.zipBytes },
    lease,
  }),
};
const output = new URL("../artifacts/cloud-iac/", import.meta.url);
await mkdir(output, { recursive: true });
for (const [name, template] of Object.entries(templates))
  await writeFile(
    new URL(name + ".json", output),
    JSON.stringify(template, null, 2) + "\n",
  );
console.log("Rendered five synthetic Cloud templates; no AWS account call");
