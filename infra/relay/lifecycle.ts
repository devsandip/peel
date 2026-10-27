import type { RunPlan } from "./guards";

export interface StackIdentity {
  stackId: string;
  stackName: string;
  accountId: string;
  region: string;
  environment: string;
  runId: string;
}
export interface RelayLifecycle<T> {
  checkpoint(stage: string): Promise<void>;
  create(): Promise<void>;
  waitReady(): Promise<void>;
  experiment(): Promise<T>;
  inspectOwnedName(): Promise<StackIdentity | null>;
  delete(stackId: string): Promise<void>;
  waitDeleted(stackId: string): Promise<void>;
}
export function assertOwned(stack: StackIdentity, plan: RunPlan) {
  if (
    stack.stackName !== `peel-m0-turn-${plan.runId}` ||
    stack.accountId !== plan.accountId ||
    stack.region !== plan.region ||
    stack.environment !== "isolated-m0" ||
    stack.runId !== plan.runId ||
    !stack.stackId.startsWith(
      `arn:aws:cloudformation:${plan.region}:${plan.accountId}:stack/${stack.stackName}/`,
    )
  )
    throw new Error("Refusing to delete a stack outside this isolated run");
}
/** Cleanup covers a lost create response as well as bootstrap/experiment failures. */
export async function runDisposable<T>(
  plan: RunPlan,
  port: RelayLifecycle<T>,
): Promise<T> {
  await port.checkpoint("create-attempted");
  try {
    await port.create();
    await port.checkpoint("waiting-for-relay");
    await port.waitReady();
    await port.checkpoint("running-synthetic-experiment");
    return await port.experiment();
  } finally {
    // A failed local status write must never prevent deletion of already-created resources.
    await port.checkpoint("cleanup-started").catch(() => {});
    const stack = await port.inspectOwnedName();
    if (stack) {
      assertOwned(stack, plan);
      await port.delete(stack.stackId);
      await port.waitDeleted(stack.stackId);
    }
    await port.checkpoint("cleanup-verified");
  }
}
