import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  renameSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CloudRunLedger } from "../../infra/cloud/run-ledger.ts";
import { CloudRunLedgerError } from "../../infra/cloud/ledger-store.ts";
import {
  cloudLedgerPlan,
  ledgerRunIds,
} from "../fixtures/cloud-ledger-plan.ts";

const parents: string[] = [],
  children: ChildProcess[] = [];
function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "peel-run-ledger-"));
  parents.push(parent);
  const sample = cloudLedgerPlan(),
    directory = join(parent, "ledger"),
    ledger = CloudRunLedger.create(directory, sample.authorization);
  return { parent, directory, ledger, sample };
}
function cleanup(
  ledger: CloudRunLedger,
  state: ReturnType<CloudRunLedger["read"]>,
  now: number,
) {
  const run = state.runs.at(-1)!;
  const value = {
    runId: run.runId,
    planSha256: run.planSha256,
    inventorySha256: "9".repeat(64),
    checkedAt: new Date(now).toISOString(),
  };
  return {
    value,
    state: ledger.recordCleanup(value, state.snapshotSha256, {
      clock: () => now,
    }),
  };
}
function code(work: () => unknown, expected: string) {
  try {
    work();
    throw Error("not refused");
  } catch (error) {
    expect(error).toBeInstanceOf(CloudRunLedgerError);
    expect((error as CloudRunLedgerError).code).toBe(expected);
    expect((error as Error).message).toBe("Cloud run ledger unavailable");
    expect(error).not.toHaveProperty("cause");
  }
}
async function exited(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null)
    await once(child, "exit");
}
function worker(
  f: ReturnType<typeof fixture>,
  sample: ReturnType<typeof cloudLedgerPlan>,
  expectedSnapshotSha256: string,
  mode = "normal",
  checkpoint?: string,
) {
  const request = join(f.parent, sample.plan.runId + "-" + mode + ".json");
  writeFileSync(
    request,
    JSON.stringify({
      ...sample,
      directory: f.directory,
      expectedSnapshotSha256,
    }),
    { flag: "wx", mode: 0o600 },
  );
  const script = fileURLToPath(
    new URL("../fixtures/cloud-ledger-worker.mjs", import.meta.url),
  );
  const child = spawn(process.execPath, [script, request, mode], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  const line = new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(Error("Ledger worker checkpoint timed out")),
      10000,
    );
    child.stdout!.on("data", (chunk) => {
      output += String(chunk);
      if (output.length > 8192) {
        clearTimeout(timer);
        reject(Error("Ledger worker output bound"));
        return;
      }
      const found = output
        .split("\n")
        .find((s) => (checkpoint ? s === checkpoint : s.startsWith("{")));
      if (found) {
        clearTimeout(timer);
        resolve(found);
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("Ledger worker failed"));
    });
    child.on("close", () => {
      if (
        !output
          .split("\n")
          .some((s) => (checkpoint ? s === checkpoint : s.startsWith("{")))
      ) {
        clearTimeout(timer);
        reject(Error("Ledger worker exited before checkpoint"));
      }
    });
    child.stderr!.on("data", () => {});
  });
  return { child, line };
}
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await exited(child);
  }
  for (const parent of parents.splice(0))
    rmSync(parent, { recursive: true, force: true });
});
describe("Durable Cloud run-slot ledger", () => {
  it("never recreates a missing known ledger or refunds its archived reservation", () => {
    const f = fixture(),
      state = f.ledger.reserve(
        f.sample.plan,
        f.sample.observed,
        f.ledger.read().snapshotSha256,
        { clock: () => f.sample.now },
      );
    const archived = join(f.parent, "archived");
    renameSync(f.directory, archived);
    code(
      () => CloudRunLedger.open(f.directory, f.sample.authorization),
      "unavailable",
    );
    expect(readdirSync(f.parent)).toEqual(["archived"]);
    expect(
      CloudRunLedger.open(archived, f.sample.authorization).read(),
    ).toEqual(state);
  });
  it("books against the actual stored projection and survives reopen with a bound immutable plan receipt", () => {
    const f = fixture(),
      empty = f.ledger.read();
    expect(empty.reservedEnvelopeUSD).toBe(1);
    const state = f.ledger.reserve(
      f.sample.plan,
      f.sample.observed,
      empty.snapshotSha256,
      { clock: () => f.sample.now },
    );
    expect(state.runs).toHaveLength(1);
    expect(state.reservedEnvelopeUSD).toBe(3);
    expect(state.runs[0].cleanup).toBeNull();
    expect(state.policyLedger.runs).toEqual([
      { runId: ledgerRunIds[0], cleanup: "pending" },
    ]);
    expect(Object.isFrozen(state.runs) && Object.isFrozen(state.runs[0])).toBe(
      true,
    );
    expect(
      CloudRunLedger.open(f.directory, f.sample.authorization).read(),
    ).toEqual(state);
    expect(f.ledger.readReservation(ledgerRunIds[0])).toMatchObject({
      runId: ledgerRunIds[0],
      slot: 1,
      planSha256: state.runs[0].planSha256,
    });
    expect(f.ledger.readReservation(ledgerRunIds[2])).toBeNull();
  });
  it("refuses stale, duplicate and unresolved bookings without refunding the first slot", () => {
    const f = fixture(),
      empty = f.ledger.read(),
      state = f.ledger.reserve(
        f.sample.plan,
        f.sample.observed,
        empty.snapshotSha256,
        { clock: () => f.sample.now },
      );
    const second = cloudLedgerPlan(ledgerRunIds[1], f.sample.now + 1000);
    code(
      () =>
        f.ledger.reserve(second.plan, second.observed, empty.snapshotSha256, {
          clock: () => second.now,
        }),
      "stale",
    );
    code(
      () =>
        f.ledger.reserve(
          f.sample.plan,
          f.sample.observed,
          state.snapshotSha256,
          { clock: () => f.sample.now },
        ),
      "duplicate",
    );
    code(
      () =>
        f.ledger.reserve(second.plan, second.observed, state.snapshotSha256, {
          clock: () => second.now,
        }),
      "unresolved",
    );
    expect(f.ledger.read()).toEqual(state);
  });
  it("records exact external cleanup receipts idempotently, permits one second slot and refuses a third", () => {
    const f = fixture(),
      first = f.ledger.reserve(
        f.sample.plan,
        f.sample.observed,
        f.ledger.read().snapshotSha256,
        { clock: () => f.sample.now },
      );
    const recorded = cleanup(f.ledger, first, f.sample.now + 1000);
    expect(
      f.ledger.recordCleanup(recorded.value, first.snapshotSha256, {
        clock: () => f.sample.now + 1000,
      }),
    ).toEqual(recorded.state);
    expect(recorded.state.policyLedger.runs[0].cleanup).toBe("verified");
    const second = cloudLedgerPlan(ledgerRunIds[1], f.sample.now + 2000),
      state = f.ledger.reserve(
        second.plan,
        second.observed,
        recorded.state.snapshotSha256,
        { clock: () => second.now },
      );
    expect(state.reservedEnvelopeUSD).toBe(5);
    expect(state.runs).toHaveLength(2);
    const third = cloudLedgerPlan(ledgerRunIds[2], second.now + 1000);
    code(
      () =>
        f.ledger.reserve(third.plan, third.observed, state.snapshotSha256, {
          clock: () => third.now,
        }),
      "exhausted",
    );
    expect(f.ledger.read()).toEqual(state);
    code(
      () =>
        f.ledger.recordCleanup(
          { ...recorded.value, inventorySha256: "8".repeat(64) },
          state.snapshotSha256,
          { clock: () => third.now },
        ),
      "receipt-conflict",
    );
  });
  it("validates the full plan under lock, then rechecks freshness/time before commit", () => {
    const f = fixture(),
      before = f.ledger.read(),
      bad = structuredClone(f.sample.observed);
    bad.safety.hooks = "unknown";
    code(
      () =>
        f.ledger.reserve(f.sample.plan, bad, before.snapshotSha256, {
          clock: () => f.sample.now,
        }),
      "policy-refused",
    );
    for (const later of [f.sample.now + 30001, f.sample.now - 1, NaN]) {
      const times = [f.sample.now, later];
      code(
        () =>
          f.ledger.reserve(
            f.sample.plan,
            f.sample.observed,
            before.snapshotSha256,
            { clock: () => times.shift()! },
          ),
        "policy-refused",
      );
    }
    expect(f.ledger.read()).toEqual(before);
  });
  it("rolls back a local precommit failure but retains a committed slot when acknowledgement is lost", () => {
    const f = fixture(),
      before = f.ledger.read();
    code(
      () =>
        f.ledger.reserve(
          f.sample.plan,
          f.sample.observed,
          before.snapshotSha256,
          {
            clock: () => f.sample.now,
            beforeCommit() {
              throw Error("synthetic private failure");
            },
          },
        ),
      "unavailable",
    );
    expect(f.ledger.read()).toEqual(before);
    code(
      () =>
        f.ledger.reserve(
          f.sample.plan,
          f.sample.observed,
          before.snapshotSha256,
          {
            clock: () => f.sample.now,
            afterCommit() {
              throw Error("synthetic lost acknowledgement");
            },
          },
        ),
      "uncertain",
    );
    const found = CloudRunLedger.open(
      f.directory,
      f.sample.authorization,
    ).read();
    expect(found.runs).toHaveLength(1);
    expect(found.runs[0].cleanup).toBeNull();
  });
  it("does not use new-run expiry/quote/budget gates to inspect a known run or record its later cleanup", () => {
    const f = fixture(),
      state = f.ledger.reserve(
        f.sample.plan,
        f.sample.observed,
        f.ledger.read().snapshotSha256,
        { clock: () => f.sample.now },
      );
    const late = Date.parse(f.sample.authorization.authorizedUntil) + 86400000;
    const reopened = CloudRunLedger.open(f.directory, f.sample.authorization);
    expect(reopened.readReservation(ledgerRunIds[0])?.runId).toBe(
      ledgerRunIds[0],
    );
    expect(
      cleanup(reopened, state, late).state.runs[0].cleanup?.checkedAt,
    ).toBe(new Date(late).toISOString());
    const other = cloudLedgerPlan(ledgerRunIds[1], late);
    code(
      () =>
        reopened.reserve(
          other.plan,
          other.observed,
          reopened.read().snapshotSha256,
          { clock: () => late },
        ),
      "policy-refused",
    );
  });
  it("rejects unrelated or stale cleanup claims without modifying a pending reservation", () => {
    const f = fixture(),
      before = f.ledger.read(),
      state = f.ledger.reserve(
        f.sample.plan,
        f.sample.observed,
        before.snapshotSha256,
        { clock: () => f.sample.now },
      );
    const value = {
      runId: ledgerRunIds[0],
      planSha256: state.runs[0].planSha256,
      inventorySha256: "9".repeat(64),
      checkedAt: new Date(f.sample.now + 1000).toISOString(),
    };
    code(
      () =>
        f.ledger.recordCleanup(
          { ...value, runId: ledgerRunIds[1] },
          state.snapshotSha256,
          { clock: () => f.sample.now + 1000 },
        ),
      "receipt-conflict",
    );
    code(
      () =>
        f.ledger.recordCleanup(value, before.snapshotSha256, {
          clock: () => f.sample.now + 1000,
        }),
      "stale",
    );
    code(
      () =>
        f.ledger.recordCleanup(
          { ...value, token: "synthetic private" },
          state.snapshotSha256,
          { clock: () => f.sample.now + 1000 },
        ),
      "invalid-input",
    );
    expect(f.ledger.read()).toEqual(state);
  });
  it("allows cleanup inspection to leave a foreign extra file untouched while new work refuses it", () => {
    const f = fixture(),
      state = f.ledger.reserve(
        f.sample.plan,
        f.sample.observed,
        f.ledger.read().snapshotSha256,
        { clock: () => f.sample.now },
      );
    const extra = join(f.directory, "keep.txt");
    writeFileSync(extra, "synthetic private extra");
    expect(f.ledger.readReservation(ledgerRunIds[0])?.planSha256).toBe(
      state.runs[0].planSha256,
    );
    code(() => f.ledger.read(), "unrecognized");
    expect(readFileSync(extra, "utf8")).toBe("synthetic private extra");
  });
  it("lets only one independent process book against the same prior snapshot", async () => {
    const f = fixture(),
      prior = f.ledger.read(),
      a = worker(f, f.sample, prior.snapshotSha256),
      b = worker(f, cloudLedgerPlan(ledgerRunIds[1]), prior.snapshotSha256);
    const outcomes = (await Promise.all([a.line, b.line])).map((line) =>
      JSON.parse(line),
    );
    await Promise.all([exited(a.child), exited(b.child)]);
    expect(outcomes.filter((r) => r.kind === "ok")).toHaveLength(1);
    expect(outcomes.filter((r) => r.kind === "error")).toHaveLength(1);
    expect(outcomes.find((r) => r.kind === "error").code).not.toBe(
      "unexpected",
    );
    const state = CloudRunLedger.open(
      f.directory,
      f.sample.authorization,
    ).read();
    expect(state.runs).toHaveLength(1);
    expect(state.reservedEnvelopeUSD).toBe(3);
  }, 20000);
  it("recovers acknowledged and commit-before-ack reservations after terminating the writer", async () => {
    for (const [mode, checkpoint] of [
      ["after-ack", "acknowledged"],
      ["after-commit", "committed"],
    ]) {
      const f = fixture(),
        w = worker(
          f,
          f.sample,
          f.ledger.read().snapshotSha256,
          mode,
          checkpoint,
        );
      await w.line;
      w.child.kill("SIGKILL");
      await exited(w.child);
      const state = CloudRunLedger.open(
        f.directory,
        f.sample.authorization,
      ).read();
      expect(state.runs).toHaveLength(1);
      expect(state.runs[0].runId).toBe(ledgerRunIds[0]);
      const second = cloudLedgerPlan(ledgerRunIds[1]);
      code(
        () =>
          f.ledger.reserve(second.plan, second.observed, state.snapshotSha256, {
            clock: () => second.now,
          }),
        "unresolved",
      );
    }
  }, 20000);
  it("rolls back an interrupted transaction before any reservation acknowledgement", async () => {
    const f = fixture(),
      prior = f.ledger.read(),
      w = worker(
        f,
        f.sample,
        prior.snapshotSha256,
        "before-commit",
        "prepared",
      );
    await w.line;
    w.child.kill("SIGKILL");
    await exited(w.child);
    expect(
      CloudRunLedger.open(f.directory, f.sample.authorization).read(),
    ).toEqual(prior);
    expect(
      f.ledger.reserve(f.sample.plan, f.sample.observed, prior.snapshotSha256, {
        clock: () => f.sample.now,
      }).runs,
    ).toHaveLength(1);
  }, 20000);
});
