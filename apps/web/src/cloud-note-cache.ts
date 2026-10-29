import { titleOf } from "../../../packages/core/src/index";
import type { CloudClientState } from "../../../packages/cloud-protocol/src/index";
import {
  cloudStateInScope,
  validateCloudNoteId,
  validateCloudScope,
  type CloudScope,
} from "../../../packages/cloud-protocol/src/durable";

/** Cache integrity/presentation only. This does not authenticate a user or server. */
export function projectCloudCachedNote(
  inputScope: CloudScope,
  noteId: string,
  input: CloudClientState | null,
) {
  const scope = validateCloudScope(inputScope);
  validateCloudNoteId(noteId);
  const state = input === null ? null : cloudStateInScope(scope, noteId, input);
  if (!state?.current)
    return Object.freeze({
      status: "No cached Cloud note" as const,
      title: null,
      bodyMarkdown: null,
    });
  const status = state.conflict
    ? ("Conflict" as const)
    : state.pending || state.inFlight || state.baseRevision === 0
      ? ("Pending upload" as const)
      : state.current.kind === "purge"
        ? ("Deleted in Cloud" as const)
        : ("Saved in Cloud" as const);
  const draft = state.current.snapshot;
  return Object.freeze({
    status,
    title: draft ? titleOf(draft.bodyMarkdown) : null,
    bodyMarkdown: draft?.bodyMarkdown ?? null,
  });
}
