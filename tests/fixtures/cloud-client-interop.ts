import {
  acknowledgeCloudMutation,
  cloudStatus,
  conflictCloudMutation,
  createCloudClient,
  resolveCloudConflict,
  retryCloudMutation,
  saveCloudDraft,
  startCloudMutation,
  verifyMutationHash,
  type CloudDraft,
  type CloudSnapshot,
} from "../../packages/cloud-protocol/src/index";

const collectionId = "synthetic-cloud-library";
const noteId = "synthetic-note";
const createdAt = "2026-10-27T03:00:00.000Z";
const note = (bodyMarkdown: string): CloudDraft => ({
  schemaVersion: 1,
  collectionId,
  noteId,
  bodyMarkdown,
  state: "active",
  createdAt,
  updatedAt: createdAt,
  deletedAt: null,
  purgeAfter: null,
});
const remote = (body: string, revision: number): CloudSnapshot => ({
  ...note(body),
  serverRevision: revision,
});

/** Deterministic source fixture for actual Node/Chrome Web Crypto comparison. */
export async function runCloudClientInterop() {
  let state = saveCloudDraft(createCloudClient(collectionId, noteId), {
    kind: "upsert",
    snapshot: note("First café ##work"),
  });
  const first = await startCloudMutation(state, "synthetic-op-1");
  state = saveCloudDraft(first, {
    kind: "upsert",
    snapshot: note("Later 原文 ##work"),
  });
  const retry = retryCloudMutation(state);
  if (!(await verifyMutationHash(retry))) throw Error("Cloud hash mismatch");
  state = acknowledgeCloudMutation(state, {
    opId: retry.opId,
    contentHash: retry.contentHash,
    revision: 1,
    snapshot: remote("First café ##work", 1),
  });
  const afterAck = {
    status: cloudStatus(state),
    baseRevision: state.baseRevision,
    pendingText: state.pending?.snapshot?.bodyMarkdown,
  };
  const second = await startCloudMutation(state, "synthetic-op-2");
  state = conflictCloudMutation(second, {
    opId: second.inFlight!.opId,
    contentHash: second.inFlight!.contentHash,
    revision: 2,
    snapshot: remote("Remote changed", 2),
  });
  const afterConflict = {
    status: cloudStatus(state),
    localText: state.conflict?.local.snapshot?.bodyMarkdown,
    remoteText: state.conflict?.remote?.bodyMarkdown,
  };
  state = resolveCloudConflict(state, {
    kind: "upsert",
    snapshot: note("Explicit merge"),
  });
  const merged = await startCloudMutation(state, "synthetic-op-3");
  return {
    hash: retry.contentHash,
    retryUnchanged: JSON.stringify(first.inFlight) === JSON.stringify(retry),
    afterAck,
    afterConflict,
    mergedBaseRevision: merged.inFlight?.baseRevision,
    mergedText: merged.inFlight?.snapshot?.bodyMarkdown,
    realNotesUsed: false,
    applicationDatabaseOpened: false,
    networkCalls: 0,
  };
}
