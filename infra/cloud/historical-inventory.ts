import { expectedInventoryV1 } from "./inventory-v1.ts";
import { readCloudRunManifest } from "./run-manifest.ts";

class HistoricalFailure extends Error {
  constructor() {
    super("Historical Cloud inventory unavailable");
    Object.freeze(this);
  }
}

/** Typed original expectations only; current provider ownership and lifecycle remain unproven. */
export function readHistoricalCloudInventory(
  json: string,
  pin: Parameters<typeof readCloudRunManifest>[1],
) {
  try {
    const retained = readCloudRunManifest(json, pin),
      raw = JSON.parse(retained.inventoryJson),
      inventory = expectedInventoryV1({
        accountId: raw.accountId,
        region: raw.region,
        runId: raw.runId,
        artifact: raw.artifact,
        lease: raw.lease,
        templatesSha256: raw.templatesSha256,
      });
    if (JSON.stringify(inventory) !== retained.inventoryJson)
      throw new HistoricalFailure();
    return Object.freeze({
      kind: "decoded" as const,
      inventory,
      profile: retained.profile,
      source: retained.source,
      planSha256: retained.planSha256,
      manifestSha256: retained.manifestSha256,
      ownership: "unproven" as const,
      resourceWrites: 0 as const,
    });
  } catch {
    throw new HistoricalFailure();
  }
}
