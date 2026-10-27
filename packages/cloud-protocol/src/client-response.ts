import type { DurableCloudClient } from "./durable";
import type { CloudResponse } from "./index";
import {
  validateCloudHead,
  validateCloudReceipt,
  type CloudMutationRequest,
  type CloudServerResult,
} from "./server";

/** Interpret only authenticated responses; preserve a later local draft while retiring an accepted operation. */
export function planCloudServerReply(
  input: CloudServerResult,
  expectedInput: CloudMutationRequest,
) {
  const result = structuredClone(input),
    expected = structuredClone(expectedInput);
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    Object.keys(result).length !== 3 ||
    !["receipt", "head", "replayed"].every((key) =>
      Object.hasOwn(result, key),
    ) ||
    typeof result.replayed !== "boolean"
  )
    throw Error("Invalid Cloud server reply");
  const receipt = validateCloudReceipt(result.receipt),
    head = validateCloudHead(result.head);
  const op = expected.mutation;
  if (
    receipt.opId !== op.opId ||
    receipt.contentHash !== op.contentHash ||
    receipt.noteId !== op.noteId ||
    head.noteId !== op.noteId ||
    receipt.collectionId !== expected.collectionId ||
    receipt.modeGeneration !== expected.modeGeneration ||
    head.revision < receipt.revision ||
    (head.kind === "note" &&
      head.snapshot.collectionId !== expected.collectionId)
  )
    throw Error("Cloud server reply identity or revision mismatch");
  if (receipt.outcome === "applied" && receipt.revision !== op.baseRevision + 1)
    throw Error(
      "Cloud server receipt does not advance the attempted base revision",
    );
  if (
    (receipt.outcome === "conflict" && head.revision <= op.baseRevision) ||
    head.kind === "missing"
  )
    return { kind: "reconcile-required" as const, receipt, head };
  if (receipt.outcome === "applied" && head.revision > receipt.revision) {
    if (op.kind === "purge")
      throw Error("Permanently purged Cloud identity cannot advance");
    return {
      kind: "accepted-head" as const,
      response: {
        opId: receipt.opId,
        contentHash: receipt.contentHash,
        acceptedRevision: receipt.revision,
        revision: head.revision,
        snapshot: head.kind === "note" ? head.snapshot : null,
      },
    };
  }
  if (
    receipt.outcome === "applied" &&
    (head.kind === "note") !== (op.kind === "upsert")
  )
    throw Error("Cloud server reply operation kind mismatch");
  const response: CloudResponse = {
    opId: receipt.opId,
    contentHash: receipt.contentHash,
    revision: head.revision,
    snapshot: head.kind === "note" ? head.snapshot : null,
  };
  return {
    kind:
      receipt.outcome === "applied"
        ? ("acknowledge" as const)
        : ("conflict" as const),
    response,
  };
}
export async function applyCloudServerReply(
  client: DurableCloudClient,
  expected: CloudMutationRequest,
  result: CloudServerResult,
) {
  const plan = planCloudServerReply(result, expected);
  if (plan.kind === "reconcile-required") return plan;
  const state =
    plan.kind === "accepted-head"
      ? await client.acceptedHead(expected.mutation.noteId, plan.response)
      : plan.kind === "acknowledge"
        ? await client.acknowledge(expected.mutation.noteId, plan.response)
        : await client.conflict(expected.mutation.noteId, plan.response);
  return { kind: plan.kind, state };
}
