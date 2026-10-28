import { createHash } from "node:crypto";
import { cloudLedgerPlan, ledgerRunIds } from "./cloud-ledger-plan.ts";
import { validateCloudDeploymentPlan } from "../../infra/cloud/deployment-plan.ts";
import { createCloudRunManifest } from "../../infra/cloud/run-manifest.ts";
import { cloudDataIdentityTemplate } from "../../infra/cloud/data-identity.ts";
import {
  cloudArtifactBootstrapTemplate,
  cloudPrivateHostingTemplate,
} from "../../infra/cloud/private-hosting.ts";
import {
  cloudCleanupGuardTemplate,
  cloudCleanupSentinelTemplate,
} from "../../infra/cloud/cleanup.ts";

// Actual validators/factories over synthetic inputs, never provider/budget approval.
export function cloudNormalizedPlanFixture(
  secondSlot = false,
  runId = ledgerRunIds[0],
  now = Date.parse("2026-10-27T12:00:00.000Z"),
) {
  const hash = (s: string) => createHash("sha256").update(s).digest("hex"),
    f = cloudLedgerPlan(runId, now),
    inventory = {
      accountId: f.plan.identity.accountId,
      region: "us-east-1" as const,
      runId: f.plan.runId,
      artifact: {
        sha256: f.plan.source.zipSha256,
        bytes: f.plan.source.zipBytes,
      },
      lease: { ...f.plan.lease },
      templatesSha256: "",
    },
    templates = JSON.stringify({
      "data-identity": cloudDataIdentityTemplate(inventory.runId),
      "artifact-bootstrap": cloudArtifactBootstrapTemplate(inventory.runId),
      "cleanup-guard": cloudCleanupGuardTemplate(inventory),
      "cleanup-sentinel": cloudCleanupSentinelTemplate(inventory.runId),
      "private-hosting": cloudPrivateHostingTemplate(inventory),
    });
  inventory.templatesSha256 = hash(templates);
  f.plan.source.templatesSha256 = inventory.templatesSha256;
  f.observed.source.templatesSha256 = inventory.templatesSha256;
  const plan = validateCloudDeploymentPlan(
      f.plan,
      f.authorization,
      f.observed,
      {
        format: 1,
        runs: secondSlot
          ? [
              {
                runId: ledgerRunIds.find((id) => id !== runId)!,
                cleanup: "verified",
              },
            ]
          : [],
      },
      f.now,
    ),
    planJson = JSON.stringify(plan),
    manifest = createCloudRunManifest({
      profile: plan.identity.profile,
      source: {
        commit: plan.source.commit,
        tree: plan.source.tree,
        lockSha256: plan.source.lockSha256,
      },
      planSha256: hash(planJson),
      inventory,
      templates,
    });
  return { planJson, manifest };
}
