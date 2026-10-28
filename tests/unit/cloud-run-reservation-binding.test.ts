import { createHash } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  chmodSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { CloudRunLedger } from "../../infra/cloud/run-ledger.ts";
import { normalizeCloudLedgerAuthority } from "../../infra/cloud/ledger-store.ts";
import { createCloudRunPlanContext } from "../../infra/cloud/run-plan-context.ts";
import { inspectCloudRunReservationBinding } from "../../infra/cloud/run-reservation-binding.ts";
import * as current from "../../infra/cloud/expected-inventory.ts";
import * as policy from "../../infra/cloud/deployment-plan.ts";
import * as hosting from "../../infra/cloud/private-hosting.ts";
import * as cleanup from "../../infra/cloud/cleanup.ts";
import * as data from "../../infra/cloud/data-identity.ts";
import * as manifestCodec from "../../infra/cloud/run-manifest.ts";
import {
  cloudLedgerPlan,
  ledgerRunIds,
} from "../fixtures/cloud-ledger-plan.ts";
import { cloudNormalizedPlanFixture } from "../fixtures/cloud-normalized-plan.ts";

const parents: string[] = [],
  now = Date.parse("2026-10-27T12:00:00.000Z");
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function sample(second = false, id = ledgerRunIds[0], time = now) {
  const value = cloudNormalizedPlanFixture(second, id, time),
    context = createCloudRunPlanContext(value),
    f = cloudLedgerPlan(id, time);
  f.plan.source.templatesSha256 = context.plan.source.templatesSha256;
  f.observed.source.templatesSha256 = context.plan.source.templatesSha256;
  return { value, context, f };
}
function fixture(reserve = true) {
  const parent = mkdtempSync(join(tmpdir(), "peel-run-binding-"));
  parents.push(parent);
  const s = sample(),
    directory = join(parent, "ledger"),
    ledger = CloudRunLedger.create(directory, s.f.authorization);
  if (reserve)
    ledger.reserve(s.f.plan, s.f.observed, ledger.read().snapshotSha256, {
      clock: () => s.f.now,
    });
  const input = {
    contextJson: s.context.json,
    manifest: s.value.manifest,
    ledger: { directory, authority: s.f.authorization },
  };
  return { ...s, parent, directory, ledger, input };
}
function frozen(value: unknown) {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
function refused(work: () => unknown) {
  let caught: unknown;
  try {
    work();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toBe(
    "Original Cloud reservation binding unavailable",
  );
  expect(Object.keys(caught as object)).toEqual([]);
  expect(caught).not.toHaveProperty("cause");
  frozen(caught);
}
function sql(
  f: ReturnType<typeof fixture>,
  text: string,
  ...values: (string | number)[]
) {
  const db = new DatabaseSync(join(f.directory, "runs.sqlite"));
  try {
    db.prepare(text).run(...values);
  } finally {
    db.close();
  }
}
function changedContext(f: ReturnType<typeof fixture>, edit: (p: any) => void) {
  const p = JSON.parse(f.value.planJson);
  edit(p);
  const planJson = JSON.stringify(p),
    raw = JSON.parse(f.value.manifest.json);
  raw.planSha256 = hash(planJson);
  const json = JSON.stringify(raw),
    manifest = {
      json,
      pin: {
        ...f.value.manifest.pin,
        sha256: hash(json),
        planSha256: raw.planSha256,
      },
    };
  return {
    context: createCloudRunPlanContext({ planJson, manifest }),
    manifest,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const p of parents.splice(0))
    rmSync(p, { recursive: true, force: true });
});

it("reads the actual existing matching first reservation without changing records or returning paths/authority flags", () => {
  const f = fixture(),
    before = f.ledger.read(),
    dbBefore = readFileSync(join(f.directory, "runs.sqlite")),
    markerBefore = readFileSync(join(f.directory, "owner.json")),
    result = inspectCloudRunReservationBinding(f.input);
  expect(result).toMatchObject({
    kind: "observed",
    contextSha256: f.context.contextSha256,
    manifestSha256: f.context.manifestSha256,
    planSha256: f.context.planSha256,
    inventorySha256: f.context.inventorySha256,
    authorizationSha256: before.authorizationSha256,
    ledgerSnapshotSha256: before.snapshotSha256,
    reservation: {
      slot: 1,
      runId: f.f.plan.runId,
      planSha256: f.context.planSha256,
      reservedAt: new Date(now).toISOString(),
      cleanupReceiptRecorded: false,
    },
    ownership: "unproven",
    runAuthority: "unproven",
    resourceWrites: 0,
  });
  expect(f.ledger.read()).toEqual(before);
  expect(readFileSync(join(f.directory, "runs.sqlite"))).toEqual(dbBefore);
  expect(readFileSync(join(f.directory, "owner.json"))).toEqual(markerBefore);
  expect(JSON.stringify(result)).not.toContain(f.parent);
  expect(result).not.toHaveProperty("allowWrite");
  expect(result).not.toHaveProperty("verified");
  frozen(result);
  f.input.ledger.authority.identity.profile = "foreign";
  expect(result.reservation.runId).toBe(ledgerRunIds[0]);
});

it("matches a second slot and still reads the first original envelope after the current total grows", () => {
  const f = fixture(),
    first = f.ledger.read();
  f.ledger.recordCleanup(
    {
      runId: ledgerRunIds[0],
      planSha256: f.context.planSha256,
      inventorySha256: "9".repeat(64),
      checkedAt: new Date(now + 1000).toISOString(),
    },
    first.snapshotSha256,
    { clock: () => now + 1000 },
  );
  const second = sample(true, ledgerRunIds[1], now + 10000);
  f.ledger.reserve(
    second.f.plan,
    second.f.observed,
    f.ledger.read().snapshotSha256,
    { clock: () => second.f.now },
  );
  expect(f.ledger.read().reservedEnvelopeUSD).toBe(5);
  expect(inspectCloudRunReservationBinding(f.input).reservation).toMatchObject({
    slot: 1,
    cleanupReceiptRecorded: true,
  });
  const result = inspectCloudRunReservationBinding({
    ...f.input,
    contextJson: second.context.json,
    manifest: second.value.manifest,
  });
  expect(result.reservation).toMatchObject({
    slot: 2,
    runId: ledgerRunIds[1],
    cleanupReceiptRecorded: false,
  });
  expect(result.runAuthority).toBe("unproven");
  expect(result.ownership).toBe("unproven");
  frozen(result);
});

it("rejects an absent/other reservation and a different valid plan digest instead of accepting supplied JSON facts", () => {
  const empty = fixture(false),
    before = empty.ledger.read();
  refused(() => inspectCloudRunReservationBinding(empty.input));
  expect(empty.ledger.read()).toEqual(before);
  const f = fixture(),
    other = sample(false, ledgerRunIds[1]);
  refused(() =>
    inspectCloudRunReservationBinding({
      ...f.input,
      contextJson: other.context.json,
      manifest: other.value.manifest,
    }),
  );
  const changed = changedContext(f, (p) => {
    p.quoteSha256 = "9".repeat(64);
  });
  refused(() =>
    inspectCloudRunReservationBinding({
      ...f.input,
      contextJson: changed.context.json,
      manifest: changed.manifest,
    }),
  );
  expect(f.ledger.read().runs).toHaveLength(1);
});

it("checks original slot and recorded timing coherence beyond the ledger's row schema", () => {
  const envelope = fixture(),
    changed = changedContext(envelope, (p) => {
      p.reservedEnvelopeUSD = 5;
    });
  sql(
    envelope,
    "UPDATE reservations SET plan_sha256=?",
    changed.context.planSha256,
  );
  expect(envelope.ledger.read().runs).toHaveLength(1);
  refused(() =>
    inspectCloudRunReservationBinding({
      ...envelope.input,
      contextJson: changed.context.json,
      manifest: changed.manifest,
    }),
  );
  for (const time of [now - 1, now + 30001, now + 90 * 60000]) {
    const f = fixture();
    sql(
      f,
      "UPDATE reservations SET reserved_at=?",
      new Date(time).toISOString(),
    );
    expect(f.ledger.read().runs).toHaveLength(1);
    refused(() => inspectCloudRunReservationBinding(f.input));
  }
  const created = fixture(),
    earliest = changedContext(created, (p) => {
      p.createdAt = new Date(now - 15 * 60000).toISOString();
    });
  sql(
    created,
    "UPDATE reservations SET plan_sha256=?,reserved_at=?",
    earliest.context.planSha256,
    new Date(now + 1).toISOString(),
  );
  refused(() =>
    inspectCloudRunReservationBinding({
      ...created.input,
      contextJson: earliest.context.json,
      manifest: earliest.manifest,
    }),
  );
});

it("checks original authority identity/margin and actual stored authority without using current expiry", () => {
  const f = fixture();
  for (const authority of [
    {
      ...f.f.authorization,
      identity: { ...f.f.authorization.identity, accountId: "222233334444" },
    },
    {
      ...f.f.authorization,
      identity: { ...f.f.authorization.identity, profile: "foreign" },
    },
    { ...f.f.authorization, authorizedUntil: "2026-10-27T13:59:59.999Z" },
    { ...f.f.authorization, authorizedUntil: "2026-10-27T19:00:00.000Z" },
  ])
    refused(() =>
      inspectCloudRunReservationBinding({
        ...f.input,
        ledger: { ...f.input.ledger, authority },
      }),
    );
  expect(inspectCloudRunReservationBinding(f.input).reservation.slot).toBe(1);
  const normalized = normalizeCloudLedgerAuthority(f.f.authorization);
  frozen(normalized);
  expect(normalized).toEqual(f.f.authorization);
});

it("refuses malformed pins/context/getters/overrides before opening any namespace", () => {
  const f = fixture(),
    open = vi.spyOn(CloudRunLedger, "open"),
    getter = vi.fn(() => "private");
  for (const input of [
    null,
    { ...f.input, reservation: { slot: 1 } },
    { ...f.input, approved: true },
    { ...f.input, contextJson: f.input.contextJson + " " },
    {
      ...f.input,
      manifest: {
        ...f.input.manifest,
        pin: { ...f.input.manifest.pin, sha256: "9".repeat(64) },
      },
    },
    { ...f.input, ledger: { ...f.input.ledger, reset: true } },
    { ...f.input, ledger: { ...f.input.ledger, directory: "relative" } },
    {
      ...f.input,
      ledger: { ...f.input.ledger, directory: f.directory + "\n" },
    },
    Object.defineProperty({ ...f.input }, "contextJson", { get: getter }),
    {
      ...f.input,
      ledger: Object.defineProperty({ ...f.input.ledger }, "authority", {
        get: getter,
      }),
    },
    {
      ...f.input,
      ledger: {
        ...f.input.ledger,
        authority: Object.defineProperty({ ...f.f.authorization }, "identity", {
          get: getter,
        }),
      },
    },
  ])
    refused(() => inspectCloudRunReservationBinding(input as typeof f.input));
  expect(getter).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("does not initialize or replace a missing directory/file and preserves unknown namespaces", () => {
  const f = fixture(),
    missing = join(f.parent, "missing");
  refused(() =>
    inspectCloudRunReservationBinding({
      ...f.input,
      ledger: { ...f.input.ledger, directory: missing },
    }),
  );
  expect(existsSync(missing)).toBe(false);
  const unknown = join(f.directory, "private-foreign.txt");
  writeFileSync(unknown, "synthetic unknown", { flag: "wx" });
  refused(() => inspectCloudRunReservationBinding(f.input));
  expect(readFileSync(unknown, "utf8")).toBe("synthetic unknown");
  const absent = fixture();
  rmSync(join(absent.directory, "runs.sqlite"));
  refused(() => inspectCloudRunReservationBinding(absent.input));
  expect(existsSync(join(absent.directory, "runs.sqlite"))).toBe(false);
});

it("preserves linked/permissive/corrupt storage and keeps failures private", () => {
  const linked = fixture(),
    alias = join(linked.parent, "alias");
  symlinkSync(linked.directory, alias);
  refused(() =>
    inspectCloudRunReservationBinding({
      ...linked.input,
      ledger: { ...linked.input.ledger, directory: alias },
    }),
  );
  expect(linked.ledger.read().runs).toHaveLength(1);
  expect(lstatSync(alias).isSymbolicLink()).toBe(true);
  const permissive = fixture(),
    db = join(permissive.directory, "runs.sqlite"),
    bytes = readFileSync(db);
  chmodSync(db, 0o644);
  refused(() => inspectCloudRunReservationBinding(permissive.input));
  expect(readFileSync(db)).toEqual(bytes);
  expect(lstatSync(db).mode & 0o777).toBe(0o644);
  const corrupt = fixture(),
    target = join(corrupt.directory, "runs.sqlite");
  writeFileSync(target, "synthetic corrupt");
  refused(() => inspectCloudRunReservationBinding(corrupt.input));
  expect(readFileSync(target, "utf8")).toBe("synthetic corrupt");
});

it("refuses a busy actual ledger without retry, record mutation or fallback", () => {
  const f = fixture(),
    before = f.ledger.read(),
    db = new DatabaseSync(join(f.directory, "runs.sqlite"));
  try {
    db.exec("BEGIN EXCLUSIVE");
    refused(() => inspectCloudRunReservationBinding(f.input));
  } finally {
    db.exec("ROLLBACK");
    db.close();
  }
  expect(f.ledger.read()).toEqual(before);
});

it("reads expired original records with every current factory/validator/cost/writer and live clock unavailable", () => {
  const f = fixture(),
    unavailable = () => {
      throw Error("private current source unavailable");
    },
    spies = [
      vi
        .spyOn(current, "cloudExpectedInventory")
        .mockImplementation(unavailable),
      vi
        .spyOn(policy, "validateCloudDeploymentPlan")
        .mockImplementation(unavailable),
      vi.spyOn(policy, "cloudDevelopmentCost").mockImplementation(unavailable),
      vi
        .spyOn(hosting, "cloudPrivateHostingTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(hosting, "cloudArtifactBootstrapTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(cleanup, "cloudCleanupGuardTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(cleanup, "cloudCleanupSentinelTemplate")
        .mockImplementation(unavailable),
      vi.spyOn(cleanup, "cloudDevStackNames").mockImplementation(unavailable),
      vi
        .spyOn(data, "cloudDataIdentityTemplate")
        .mockImplementation(unavailable),
      vi
        .spyOn(manifestCodec, "createCloudRunManifest")
        .mockImplementation(unavailable),
    ],
    clock = vi.spyOn(Date, "now").mockImplementation(unavailable);
  let result!: ReturnType<typeof inspectCloudRunReservationBinding>;
  try {
    result = inspectCloudRunReservationBinding(f.input);
  } finally {
    clock.mockRestore();
  }
  expect(result.reservation.slot).toBe(1);
  expect(result.runAuthority).toBe("unproven");
  spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  frozen(result);
});
