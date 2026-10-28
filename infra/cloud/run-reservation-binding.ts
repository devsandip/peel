import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { normalizeCloudLedgerAuthority } from "./ledger-store.ts";
import { readCloudRunPlanContext } from "./run-plan-context.ts";
import { CloudRunLedger } from "./run-ledger.ts";

type Input = {
  contextJson: string;
  manifest: Parameters<typeof readCloudRunPlanContext>[1];
  ledger: { directory: string; authority: unknown };
};
class BindingFailure extends Error {
  constructor() {
    super("Original Cloud reservation binding unavailable");
    Object.freeze(this);
  }
}
const fail = (): never => {
  throw new BindingFailure();
};
function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return fail();
  const d = Object.getOwnPropertyDescriptors(value);
  return Object.fromEntries(
    keys.map((key) => {
      if (!d[key]?.enumerable || !("value" in d[key])) return fail();
      return [key, d[key].value];
    }),
  );
}
function frozen<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(frozen);
    Object.freeze(value);
  }
  return value;
}

/** Existing local records only. No new grant, durability acknowledgement or provider provenance. */
export function inspectCloudRunReservationBinding(input: Input) {
  try {
    const r = record(input, ["contextJson", "manifest", "ledger"]),
      selected = record(r.ledger, ["directory", "authority"]),
      context = readCloudRunPlanContext(
        r.contextJson as string,
        r.manifest as Input["manifest"],
      ),
      authority = normalizeCloudLedgerAuthority(selected.authority),
      directory = selected.directory;
    if (
      typeof directory !== "string" ||
      directory.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(directory) ||
      !isAbsolute(directory) ||
      resolve(directory) !== directory ||
      dirname(directory) === directory ||
      JSON.stringify(authority.identity) !==
        JSON.stringify(context.plan.identity) ||
      Date.parse(authority.authorizedUntil) < Date.parse(context.plan.cleanupBy)
    )
      return fail();
    // Open only the independently selected namespace; never create or choose a replacement on failure.
    const snapshot = CloudRunLedger.open(directory, authority).read(),
      authoritySha256 = createHash("sha256")
        .update(JSON.stringify(authority))
        .digest("hex"),
      run = snapshot.runs.find((entry) => entry.runId === context.plan.runId);
    if (
      snapshot.authorizationSha256 !== authoritySha256 ||
      !run ||
      run.planSha256 !== context.planSha256 ||
      context.plan.reservedEnvelopeUSD !== run.slot * 2 + 1
    )
      return fail();
    const reserved = Date.parse(run.reservedAt),
      start = Date.parse(context.plan.lease.startedAt),
      created = Date.parse(context.plan.createdAt);
    if (
      reserved < start ||
      reserved - start > 30000 ||
      reserved < created ||
      reserved - created > 15 * 60000
    )
      return fail();
    return frozen({
      kind: "observed" as const,
      contextSha256: context.contextSha256,
      manifestSha256: context.manifestSha256,
      planSha256: context.planSha256,
      inventorySha256: context.inventorySha256,
      authorizationSha256: snapshot.authorizationSha256,
      ledgerSnapshotSha256: snapshot.snapshotSha256,
      reservation: {
        slot: run.slot,
        runId: run.runId,
        planSha256: run.planSha256,
        reservedAt: run.reservedAt,
        cleanupReceiptRecorded: run.cleanup !== null,
      },
      ownership: "unproven" as const,
      runAuthority: "unproven" as const,
      resourceWrites: 0 as const,
    });
  } catch {
    return fail();
  }
}
