import { it, expect } from "vitest";
import {
  runDisposable,
  type RelayLifecycle,
  type StackIdentity,
} from "../../infra/relay/lifecycle";
import type { RunPlan } from "../../infra/relay/guards";

const plan: RunPlan = {
  profile: "admin",
  region: "us-east-1",
  accountId: "111122223333",
  runId: "synthetic-lifecycle",
  clientCidr: "8.8.8.8/32",
  imageId: "ami-0123456789abcdef0",
  createdAt: "2026-10-27T00:00:00Z",
  terminateAt: "2026-10-27T00:45:00Z",
  estimatedUSD: 0.1,
  allowanceUSD: 2,
};
const owned: StackIdentity = {
  stackId:
    "arn:aws:cloudformation:us-east-1:111122223333:stack/peel-m0-turn-synthetic-lifecycle/fixture",
  stackName: "peel-m0-turn-synthetic-lifecycle",
  accountId: plan.accountId,
  region: plan.region,
  environment: "isolated-m0",
  runId: plan.runId,
};
function fixture(
  fail?: "create" | "ready" | "experiment" | "delete" | "checkpoint",
  identity: StackIdentity | null = owned,
) {
  const events: string[] = [];
  const action = async (name: string) => {
    events.push(name);
    if (name === fail || (fail === "checkpoint" && name === "cleanup-started"))
      throw new Error(`Synthetic ${name} failure`);
  };
  const port: RelayLifecycle<boolean> = {
    checkpoint: (stage) => action(stage),
    create: () => action("create"),
    waitReady: () => action("ready"),
    experiment: async () => {
      await action("experiment");
      return true;
    },
    inspectOwnedName: async () => {
      await action("inspect");
      return identity;
    },
    delete: () => action("delete"),
    waitDeleted: () => action("gone"),
  };
  return { events, port };
}
it("cleans up and verifies the owned stack before returning a successful relay result", async () => {
  const { port, events } = fixture();
  expect(await runDisposable(plan, port)).toBe(true);
  expect(events.slice(-5)).toEqual([
    "cleanup-started",
    "inspect",
    "delete",
    "gone",
    "cleanup-verified",
  ]);
});
it("recovers a lost create response and cleans up readiness and experiment failures", async () => {
  for (const fail of ["create", "ready", "experiment"] as const) {
    const { port, events } = fixture(fail);
    await expect(runDisposable(plan, port)).rejects.toThrow(
      `Synthetic ${fail} failure`,
    );
    expect(events.slice(-4)).toEqual([
      "inspect",
      "delete",
      "gone",
      "cleanup-verified",
    ]);
  }
});
it("refuses unrelated account/run/environment identities and does not report failed cleanup as verified", async () => {
  for (const change of [
    { accountId: "444455556666" },
    { environment: "production" },
    { runId: "other-run" },
    {
      stackId: owned.stackId.replace("fixture", "../unrelated"),
      stackName: "unrelated",
    },
  ]) {
    const { port, events } = fixture(undefined, { ...owned, ...change });
    await expect(runDisposable(plan, port)).rejects.toThrow(
      "Refusing to delete",
    );
    expect(events).not.toContain("delete");
    expect(events).not.toContain("cleanup-verified");
  }
  const { port, events } = fixture("delete");
  await expect(runDisposable(plan, port)).rejects.toThrow(
    "Synthetic delete failure",
  );
  expect(events).not.toContain("cleanup-verified");
});
it("deletes the owned resources even when the local cleanup-start checkpoint cannot be written", async () => {
  const { port, events } = fixture("checkpoint");
  expect(await runDisposable(plan, port)).toBe(true);
  expect(events.slice(-4)).toEqual([
    "inspect",
    "delete",
    "gone",
    "cleanup-verified",
  ]);
});
