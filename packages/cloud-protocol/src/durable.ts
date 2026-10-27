import {
  acknowledgeCloudMutation,
  acceptRemoteCloudConflict,
  conflictCloudMutation,
  createCloudClient,
  resolveCloudConflict,
  retryCloudMutation,
  saveCloudDraft,
  startCloudMutation,
  verifyMutationHash,
  validateCloudClientState,
  reconcileAcceptedCloudHead,
  type CloudAction,
  type CloudClientState,
  type CloudResponse,
  type CloudAcceptedHead,
} from "./index";

// Isolated M0 local store. It provides no account authentication or entitlement authority.
export interface CloudScope {
  version: 1;
  ownerSubject: string;
  collectionId: string;
  modeGeneration: number;
}
export function validateCloudScope(input: CloudScope): CloudScope {
  const scope = structuredClone(input);
  const keys = ["version", "ownerSubject", "collectionId", "modeGeneration"];
  if (
    !scope ||
    typeof scope !== "object" ||
    Array.isArray(scope) ||
    Object.keys(scope).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(scope, key)) ||
    scope.version !== 1 ||
    typeof scope.ownerSubject !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,255}$/.test(scope.ownerSubject) ||
    typeof scope.collectionId !== "string" ||
    !/^[a-zA-Z0-9-]{1,128}$/.test(scope.collectionId) ||
    !Number.isSafeInteger(scope.modeGeneration) ||
    scope.modeGeneration < 1
  )
    throw Error("Unrecognized Cloud local scope");
  return scope;
}
export function assertCloudScope(
  stored: CloudScope | null,
  expected: CloudScope,
) {
  const scope = validateCloudScope(expected);
  if (stored !== null) {
    const saved = validateCloudScope(stored);
    if (
      saved.ownerSubject !== scope.ownerSubject ||
      saved.collectionId !== scope.collectionId ||
      saved.modeGeneration !== scope.modeGeneration
    )
      throw Error(
        "Cloud local store belongs to another account, library or mode generation",
      );
  }
  return scope;
}
export const validateCloudNoteId = (noteId: string) => {
  if (typeof noteId !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(noteId))
    throw Error("Invalid Cloud local note ID");
};
export interface CloudStateStore {
  read(scope: CloudScope, noteId: string): Promise<CloudClientState | null>;
  commit(
    scope: CloudScope,
    noteId: string,
    expectedGeneration: number | null,
    next: CloudClientState,
  ): Promise<boolean>;
  close(): Promise<void>;
}
export function cloudStateInScope(
  scope: CloudScope,
  noteId: string,
  input: CloudClientState,
) {
  validateCloudNoteId(noteId);
  const state = validateCloudClientState(input);
  if (state.collectionId !== scope.collectionId || state.noteId !== noteId)
    throw Error("Cloud local state belongs to another note or collection");
  return state;
}
export function cloudStateWrite(
  scope: CloudScope,
  noteId: string,
  expectedGeneration: number | null,
  input: CloudClientState,
) {
  const next = cloudStateInScope(scope, noteId, input);
  if (
    (expectedGeneration !== null &&
      (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0)) ||
    !Number.isSafeInteger((expectedGeneration ?? 0) + 1) ||
    next.generation !== (expectedGeneration ?? 0) + 1
  )
    throw Error("Invalid Cloud local generation transition");
  return next;
}
const changed = () =>
  Error(
    "Cloud local generation changed; latest text remains saved, reload and retry",
  );
export class DurableCloudClient {
  private scope: CloudScope;
  constructor(
    private store: CloudStateStore,
    scope: CloudScope,
  ) {
    this.scope = validateCloudScope(scope);
  }
  get(noteId: string) {
    return this.store.read(this.scope, noteId);
  }
  async save(
    noteId: string,
    actionInput: CloudAction,
    expectedGeneration: number | null,
  ) {
    const action = structuredClone(actionInput);
    const previous = await this.get(noteId);
    if ((previous?.generation ?? null) !== expectedGeneration) throw changed();
    const next = saveCloudDraft(
      previous ?? createCloudClient(this.scope.collectionId, noteId),
      action,
    );
    if (
      !(await this.store.commit(this.scope, noteId, expectedGeneration, next))
    )
      throw changed();
    return next;
  }
  async prepare(noteId: string, expectedGeneration: number, opId: string) {
    const previous = await this.get(noteId);
    if (!previous || previous.generation !== expectedGeneration)
      throw changed();
    const next = await startCloudMutation(previous, opId);
    if (
      !(await this.store.commit(this.scope, noteId, expectedGeneration, next))
    )
      throw changed();
    return next;
  }
  private async response<T extends CloudResponse>(
    noteId: string,
    input: T,
    transition: (state: CloudClientState, response: T) => CloudClientState,
  ) {
    const response = structuredClone(input);
    for (let attempt = 0; attempt < 32; attempt++) {
      const previous = await this.get(noteId);
      if (!previous) throw Error("Cloud local note missing");
      const next = transition(previous, response);
      if (
        await this.store.commit(this.scope, noteId, previous.generation, next)
      )
        return next;
    }
    throw Error("Cloud local store busy; response was not committed, retry");
  }
  acknowledge(noteId: string, response: CloudResponse) {
    return this.response(noteId, response, acknowledgeCloudMutation);
  }
  conflict(noteId: string, response: CloudResponse) {
    return this.response(noteId, response, conflictCloudMutation);
  }
  acceptedHead(noteId: string, response: CloudAcceptedHead) {
    return this.response(noteId, response, reconcileAcceptedCloudHead);
  }
  async resolve(
    noteId: string,
    expectedGeneration: number,
    choice: CloudAction | "remote",
  ) {
    const selected = structuredClone(choice);
    const previous = await this.get(noteId);
    if (!previous || previous.generation !== expectedGeneration)
      throw changed();
    const next =
      selected === "remote"
        ? acceptRemoteCloudConflict(previous)
        : resolveCloudConflict(previous, selected);
    if (
      !(await this.store.commit(this.scope, noteId, expectedGeneration, next))
    )
      throw changed();
    return next;
  }
  async retry(noteId: string) {
    const previous = await this.get(noteId);
    if (!previous) throw Error("Cloud local note missing");
    const operation = retryCloudMutation(previous);
    if (!(await verifyMutationHash(operation)))
      throw Error(
        "Stored Cloud operation hash mismatch; local text remains saved",
      );
    const current = await this.get(noteId);
    if (
      !current?.inFlight ||
      JSON.stringify(current.inFlight) !== JSON.stringify(operation)
    )
      throw changed();
    return operation;
  }
}
