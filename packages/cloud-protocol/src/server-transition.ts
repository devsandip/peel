import {
  validateCloudAccount,
  validateCloudHead,
  validateCloudReceipt,
  validateCloudChange,
  type CloudServerCommit,
  type CloudServerRead,
} from "./server";

/** Shared invariants; the adapter must still guard the observed revisions atomically. */
export function validateCloudServerTransition(
  owner: string,
  noteId: string,
  transition: CloudServerCommit,
  read: CloudServerRead,
): boolean {
  const next = validateCloudAccount(transition.account);
  const nextHead = transition.head ? validateCloudHead(transition.head) : null;
  const receipt = transition.receipt
    ? validateCloudReceipt(transition.receipt)
    : null;
  const change = transition.change
    ? validateCloudChange(transition.change)
    : null;
  const old = read.account,
    head = read.head;
  if (
    !old ||
    old.revision !== transition.expectedAccountRevision ||
    head.revision !== transition.expectedHeadRevision
  ) {
    return false;
  }
  if (
    old.status !== "active" ||
    old.entitlement !== "active" ||
    next.ownerSubject !== owner ||
    next.collectionId !== old.collectionId ||
    next.modeGeneration !== old.modeGeneration ||
    next.status !== old.status ||
    next.entitlement !== old.entitlement ||
    next.revision !== old.revision + 1 ||
    next.sequence !== old.sequence + Number(!!change) ||
    next.wall < old.wall ||
    (!receipt && !nextHead) ||
    !!nextHead !== !!change
  )
    throw Error("Invalid conditional Cloud server transition");
  if (
    nextHead &&
    (nextHead.noteId !== noteId ||
      nextHead.kind === "missing" ||
      nextHead.revision !== head.revision + 1 ||
      head.kind === "purged" ||
      (nextHead.kind === "note" &&
        nextHead.snapshot.collectionId !== old.collectionId))
  )
    throw Error("Invalid Cloud server head transition");
  if (
    change &&
    (change.noteId !== noteId ||
      change.revision !== nextHead!.revision ||
      change.sequence !== next.sequence ||
      change.kind !== (nextHead!.kind === "note" ? "upsert" : "purge") ||
      change.createdAt !== next.wall)
  )
    throw Error("Invalid Cloud server change transition");
  if (receipt) {
    if (
      receipt.noteId !== noteId ||
      receipt.collectionId !== old.collectionId ||
      receipt.modeGeneration !== old.modeGeneration ||
      receipt.createdAt !== next.wall ||
      receipt.revision !== (nextHead ?? head).revision ||
      receipt.outcome !== (nextHead ? "applied" : "conflict") ||
      receipt.sequence !== (nextHead ? next.sequence : null)
    )
      throw Error("Invalid Cloud server receipt transition");
    const previous = read.receipt;
    if (previous && previous.expiresAt > next.wall) {
      return false;
    }
  }
  return true;
}
