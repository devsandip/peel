import { createHash } from "node:crypto";
import { join } from "node:path";
import matched from "./cloud-run-plan-context-v1.json" with { type: "json" };
import { normalizeCloudRunManifestPin } from "../../infra/cloud/run-manifest.ts";

/** Frozen historical synthetic recipe; no current factory or actual source store. */
export function cloudJournalInput(workspaceDirectory: string) {
  const pin = normalizeCloudRunManifestPin(matched.manifest.pin),
    json = JSON.stringify({
      format: 1,
      kind: "peel-cloud-run-plan-context",
      manifestSha256: pin.sha256,
      planJson: matched.planJson,
    });
  return {
    anchor: {
      workspaceDirectory,
      ledgerDirectory: join(workspaceDirectory, "funding"),
      authority: {
        identity: {
          profile: pin.profile,
          accountId: pin.accountId,
          region: pin.region,
        },
        authorizedUntil: "2026-10-27T18:00:00.000Z",
      },
      reservation: {
        slot: 1 as const,
        runId: pin.runId,
        planSha256: pin.planSha256,
        reservedAt: "2026-10-27T12:00:10.000Z",
      },
    },
    manifest: {
      directory: join(workspaceDirectory, "recipe"),
      json: matched.manifest.json,
      pin,
    },
    context: {
      directory: join(workspaceDirectory, "context"),
      json,
      sha256: createHash("sha256").update(json).digest("hex"),
    },
  };
}
