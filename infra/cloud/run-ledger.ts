import { createHash } from "node:crypto";
import { type DatabaseSync } from "node:sqlite";
import { validateCloudDeploymentPlan } from "./deployment-plan.ts";
import { CloudLedgerStore, CloudRunLedgerError } from "./ledger-store.ts";
function fail(
  code: ConstructorParameters<typeof CloudRunLedgerError>[0],
): never {
  throw new CloudRunLedgerError(code);
}
function stored<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return fail("unrecognized");
  }
}
const hash = (data: string) => createHash("sha256").update(data).digest("hex");
const full = (value: unknown, re: RegExp): value is string =>
  typeof value === "string" && re.exec(value)?.[0] === value;
function record(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length
  )
    return fail("invalid-input");
  const d = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(d).sort().join() !== [...keys].sort().join() ||
    Object.values(d).some((v) => !v.enumerable || !("value" in v))
  )
    return fail("invalid-input");
  return Object.fromEntries(keys.map((k) => [k, d[k].value])) as Record<
    string,
    unknown
  >;
}
function iso(value: unknown) {
  if (
    !full(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) ||
    !Number.isSafeInteger(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return fail("invalid-input");
  return value;
}
function digest(value: unknown) {
  if (!full(value, /^[a-f0-9]{64}$/)) return fail("invalid-input");
  return value;
}
function uuid(value: unknown) {
  if (
    !full(
      value,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    )
  )
    return fail("invalid-input");
  return value;
}
function reservation(row: unknown) {
  const r = record(row, ["slot", "run_id", "plan_sha256", "reserved_at"]);
  if (r.slot !== 1 && r.slot !== 2) return fail("unrecognized");
  return Object.freeze({
    slot: r.slot,
    runId: uuid(r.run_id),
    planSha256: digest(r.plan_sha256),
    reservedAt: iso(r.reserved_at),
  });
}
function receipt(value: unknown) {
  const r = record(value, [
    "runId",
    "planSha256",
    "inventorySha256",
    "checkedAt",
  ]);
  return Object.freeze({
    runId: uuid(r.runId),
    planSha256: digest(r.planSha256),
    inventorySha256: digest(r.inventorySha256),
    checkedAt: iso(r.checkedAt),
  });
}
type Hooks = {
  clock?: () => number;
  beforeCommit?: () => void;
  afterCommit?: () => void;
};

/** Durable local accounting only. Collector and cleanup provenance remain external gates. */
export class CloudRunLedger {
  readonly directory: string;
  private readonly store: CloudLedgerStore;
  private constructor(store: CloudLedgerStore) {
    this.store = store;
    this.directory = store.directory;
  }
  static create(directory: string, authority: unknown) {
    const ledger = new CloudRunLedger(
      CloudLedgerStore.create(directory, authority),
    );
    ledger.read();
    return ledger;
  }
  static open(directory: string, authority: unknown) {
    return new CloudRunLedger(CloudLedgerStore.open(directory, authority));
  }
  private snapshot(db: DatabaseSync) {
    const rows = db
      .prepare(
        "SELECT slot,run_id,plan_sha256,reserved_at FROM reservations ORDER BY slot",
      )
      .all();
    if (rows.length > 2) return fail("unrecognized");
    const reservations = rows.map((r) => stored(() => reservation(r)));
    if (
      reservations.some((r, i) => r.slot !== i + 1) ||
      new Set(reservations.map((r) => r.runId)).size !== reservations.length
    )
      return fail("unrecognized");
    const raw = db
      .prepare(
        "SELECT run_id,plan_sha256,inventory_sha256,checked_at FROM cleanup_receipts ORDER BY run_id",
      )
      .all();
    if (raw.length > reservations.length) return fail("unrecognized");
    const receipts = raw.map((r) =>
      stored(() =>
        receipt({
          runId: r.run_id,
          planSha256: r.plan_sha256,
          inventorySha256: r.inventory_sha256,
          checkedAt: r.checked_at,
        }),
      ),
    );
    if (
      receipts.some(
        (c) =>
          !reservations.some(
            (r) =>
              r.runId === c.runId &&
              r.planSha256 === c.planSha256 &&
              Date.parse(c.checkedAt) >= Date.parse(r.reservedAt),
          ),
      )
    )
      return fail("unrecognized");
    const runs = Object.freeze(
      reservations.map((r) =>
        Object.freeze({
          ...r,
          cleanup: receipts.find((c) => c.runId === r.runId) ?? null,
        }),
      ),
    );
    if (runs.length === 2 && !runs[0].cleanup) return fail("unrecognized");
    const data = {
      format: 1 as const,
      authorizationSha256: this.store.scopeSha256,
      runs,
    };
    return Object.freeze({
      ...data,
      snapshotSha256: hash(JSON.stringify(data)),
      reservedEnvelopeUSD: runs.length * 2 + 1,
      policyLedger: Object.freeze({
        format: 1 as const,
        runs: Object.freeze(
          runs.map((r) =>
            Object.freeze({
              runId: r.runId,
              cleanup: r.cleanup ? "verified" : "pending",
            }),
          ),
        ),
      }),
    });
  }

  read() {
    return this.store.use(true, (db) => {
      db.exec("BEGIN");
      const state = this.snapshot(db);
      db.exec("COMMIT");
      return state;
    });
  }
  readReservation(runId: string) {
    uuid(runId);
    return this.store.use(false, (db) => {
      const row = db
        .prepare(
          "SELECT slot,run_id,plan_sha256,reserved_at FROM reservations WHERE run_id=?",
        )
        .get(runId);
      return row ? stored(() => reservation(row)) : null;
    });
  }
  private transaction<T>(
    strict: boolean,
    work: (db: DatabaseSync) => T,
    hooks: Hooks,
    recheck?: () => void,
  ): T {
    let commitAttempted = false;
    try {
      return this.store.use(strict, (db) => {
        try {
          db.exec("BEGIN IMMEDIATE");
          const result = work(db);
          hooks.beforeCommit?.();
          recheck?.();
          commitAttempted = true;
          db.exec("COMMIT");
          hooks.afterCommit?.();
          return result;
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch {}
          throw error;
        }
      });
    } catch (error) {
      if (commitAttempted) return fail("uncertain");
      throw error;
    }
  }
  reserve(
    plan: unknown,
    observed: unknown,
    expectedSnapshotSha256: string,
    hooks: Hooks = {},
  ) {
    digest(expectedSnapshotSha256);
    let checkedAt = 0,
      capturedPlan: unknown,
      capturedObserved: unknown,
      prior: unknown;
    return this.transaction(
      true,
      (db) => {
        const state = this.snapshot(db);
        if (state.snapshotSha256 !== expectedSnapshotSha256)
          return fail("stale");
        if (state.runs.length === 2) return fail("exhausted");
        const requested = record(plan, [
          "format",
          "runId",
          "createdAt",
          "identity",
          "lease",
          "source",
          "quoteSha256",
        ]);
        if (state.runs.some((r) => r.runId === requested.runId))
          return fail("duplicate");
        if (state.runs.some((r) => !r.cleanup)) return fail("unresolved");
        checkedAt = (hooks.clock ?? Date.now)();
        prior = state.policyLedger;
        let approved: ReturnType<typeof validateCloudDeploymentPlan>;
        try {
          approved = validateCloudDeploymentPlan(
            plan,
            this.store.authority,
            observed,
            prior,
            checkedAt,
          );
        } catch {
          return fail("policy-refused");
        }
        capturedPlan = JSON.parse(JSON.stringify(plan));
        capturedObserved = JSON.parse(JSON.stringify(observed));
        const planSha256 = hash(JSON.stringify(approved));
        db.prepare("INSERT INTO reservations VALUES(?,?,?,?)").run(
          state.runs.length + 1,
          approved.runId,
          planSha256,
          new Date(checkedAt).toISOString(),
        );
        return this.snapshot(db);
      },
      hooks,
      () => {
        const now = (hooks.clock ?? Date.now)();
        if (now < checkedAt) return fail("policy-refused");
        try {
          validateCloudDeploymentPlan(
            capturedPlan,
            this.store.authority,
            capturedObserved,
            prior,
            now,
          );
        } catch {
          return fail("policy-refused");
        }
      },
    );
  }
  /** Persist an externally verified receipt. The caller must establish real inventory provenance separately. */
  recordCleanup(
    value: unknown,
    expectedSnapshotSha256: string,
    hooks: Hooks = {},
  ) {
    const checked = receipt(value);
    digest(expectedSnapshotSha256);
    return this.transaction(
      false,
      (db) => {
        const state = this.snapshot(db),
          run = state.runs.find((r) => r.runId === checked.runId);
        if (!run || run.planSha256 !== checked.planSha256)
          return fail("receipt-conflict");
        if (run.cleanup) {
          if (JSON.stringify(run.cleanup) !== JSON.stringify(checked))
            return fail("receipt-conflict");
          return state;
        }
        if (state.snapshotSha256 !== expectedSnapshotSha256)
          return fail("stale");
        const now = (hooks.clock ?? Date.now)();
        if (
          !Number.isSafeInteger(now) ||
          Date.parse(checked.checkedAt) > now ||
          Date.parse(checked.checkedAt) < Date.parse(run.reservedAt)
        )
          return fail("invalid-input");
        db.prepare("INSERT INTO cleanup_receipts VALUES(?,?,?,?)").run(
          checked.runId,
          checked.planSha256,
          checked.inventorySha256,
          checked.checkedAt,
        );
        return this.snapshot(db);
      },
      hooks,
    );
  }
}
