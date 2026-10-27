import { validateNote, type Note } from "../../core/src/index";

// Isolated M0 client contract. No app imports, network, account or entitlement authority.
export type CloudDraft = Omit<Note, "localRevision" | "serverRevision">;
export type CloudSnapshot = CloudDraft & { serverRevision: number };
export type CloudAction =
  { kind: "upsert"; snapshot: CloudDraft } | { kind: "purge"; snapshot: null };
export interface CloudMutation {
  version: 1;
  opId: string;
  noteId: string;
  baseRevision: number;
  kind: CloudAction["kind"];
  snapshot: CloudDraft | null;
  contentHash: string;
}
export interface CloudResponse {
  opId: string;
  contentHash: string;
  revision: number;
  snapshot: CloudSnapshot | null;
}
export interface CloudAcceptedHead extends CloudResponse {
  acceptedRevision: number;
}
export interface CloudClientState {
  version: 2;
  collectionId: string;
  noteId: string;
  generation: number;
  baseRevision: number;
  base: CloudSnapshot | null;
  current: CloudAction | null;
  pending: CloudAction | null;
  inFlight: CloudMutation | null;
  observed: CloudRemoteHead | null;
  conflict: {
    local: CloudAction;
    remote: CloudSnapshot | null;
    remoteRevision: number;
  } | null;
}
export interface CloudRemoteHead {
  revision: number;
  snapshot: CloudSnapshot | null;
}
const id = /^[a-zA-Z0-9-]{1,128}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const draftFields = [
  "schemaVersion",
  "collectionId",
  "noteId",
  "bodyMarkdown",
  "state",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "purgeAfter",
];
const validRevision = (n: number) => Number.isSafeInteger(n) && n >= 0;
const clone = <T>(input: T): T => structuredClone(input);
const nextGeneration = (n: number) => {
  if (!validRevision(n) || !Number.isSafeInteger(n + 1))
    throw Error("Cloud client generation exhausted");
  return n + 1;
};
function fields(input: object, required: string[], optional: string[] = []) {
  const keys = Object.keys(input);
  if (
    required.some((key) => !Object.hasOwn(input, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw Error("Invalid Cloud snapshot fields");
}
export function validateCloudDraft(input: CloudDraft): CloudDraft {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid Cloud snapshot");
  fields(input, draftFields, ["origin"]);
  if (!id.test(input.collectionId) || !id.test(input.noteId))
    throw Error("Invalid Cloud collection or note ID");
  validateNote({ ...input, serverRevision: null, localRevision: 0 });
  if (
    (input.state === "trashed" &&
      Date.parse(input.purgeAfter!) <= Date.parse(input.deletedAt!)) ||
    (input.state !== "trashed" &&
      (input.deletedAt !== null || input.purgeAfter !== null))
  )
    throw Error("Invalid Cloud retention dates");
  if (input.origin) {
    fields(input.origin, ["collectionId", "noteId", "moveId"]);
    if (
      typeof input.origin.collectionId !== "string" ||
      typeof input.origin.noteId !== "string" ||
      typeof input.origin.moveId !== "string" ||
      !id.test(input.origin.collectionId) ||
      !id.test(input.origin.noteId) ||
      !id.test(input.origin.moveId)
    )
      throw Error("Invalid Cloud origin");
  }
  return clone(input);
}
export function validateCloudSnapshot(input: CloudSnapshot): CloudSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Invalid Cloud server snapshot");
  fields(input, [...draftFields, "serverRevision"], ["origin"]);
  if (!validRevision(input.serverRevision) || input.serverRevision === 0)
    throw Error("Invalid Cloud server revision");
  validateCloudDraft(
    Object.fromEntries(
      Object.entries(input).filter(([key]) => key !== "serverRevision"),
    ) as CloudDraft,
  );
  return clone(input);
}
export function asCloudDraft(snapshot: CloudSnapshot): CloudDraft {
  const { serverRevision: _revision, ...draft } =
    validateCloudSnapshot(snapshot);
  return draft;
}
function validAction(
  action: CloudAction,
  collectionId: string,
  noteId: string,
): CloudAction {
  if (!action || typeof action !== "object" || Array.isArray(action))
    throw Error("Invalid Cloud action");
  fields(action, ["kind", "snapshot"]);
  if (action.kind === "purge" && action.snapshot === null)
    return { kind: "purge", snapshot: null };
  if (action.kind !== "upsert" || !action.snapshot)
    throw Error("Invalid Cloud action");
  const snapshot = validateCloudDraft(action.snapshot);
  if (snapshot.collectionId !== collectionId || snapshot.noteId !== noteId)
    throw Error("Cloud action belongs to another note or collection");
  return { kind: "upsert", snapshot };
}
function contentTuple(draft: CloudDraft | null) {
  if (!draft) return null;
  return [
    draft.schemaVersion,
    draft.collectionId,
    draft.noteId,
    draft.bodyMarkdown,
    draft.state,
    draft.createdAt,
    draft.updatedAt,
    draft.deletedAt,
    draft.purgeAfter,
    draft.origin
      ? [draft.origin.collectionId, draft.origin.noteId, draft.origin.moveId]
      : null,
  ];
}
export async function mutationHash(
  input: Omit<CloudMutation, "contentHash">,
): Promise<string> {
  const mutation = clone(input);
  if (!mutation || typeof mutation !== "object" || Array.isArray(mutation))
    throw Error("Invalid Cloud mutation");
  fields(mutation, [
    "version",
    "opId",
    "noteId",
    "baseRevision",
    "kind",
    "snapshot",
  ]);
  if (
    mutation.version !== 1 ||
    typeof mutation.opId !== "string" ||
    !id.test(mutation.opId) ||
    typeof mutation.noteId !== "string" ||
    !id.test(mutation.noteId) ||
    !validRevision(mutation.baseRevision)
  )
    throw Error("Invalid Cloud mutation identity");
  const action = validAction(
    { kind: mutation.kind, snapshot: mutation.snapshot } as CloudAction,
    mutation.snapshot?.collectionId ?? "unused",
    mutation.noteId,
  );
  const encoded = new TextEncoder().encode(
    JSON.stringify([
      "Peel cloud mutation v1",
      mutation.version,
      mutation.opId,
      mutation.noteId,
      mutation.baseRevision,
      action.kind,
      contentTuple(action.snapshot),
    ]),
  );
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoded))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyMutationHash(input: CloudMutation) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return false;
    fields(input, [
      "version",
      "opId",
      "noteId",
      "baseRevision",
      "kind",
      "snapshot",
      "contentHash",
    ]);
    if (!hashPattern.test(input.contentHash)) return false;
    const { contentHash, ...payload } = clone(input);
    return contentHash === (await mutationHash(payload));
  } catch {
    return false;
  }
}
export function createCloudClient(
  collectionId: string,
  noteId: string,
  base: CloudSnapshot | null = null,
): CloudClientState {
  if (
    typeof collectionId !== "string" ||
    typeof noteId !== "string" ||
    !id.test(collectionId) ||
    !id.test(noteId)
  )
    throw Error("Invalid Cloud client identity");
  const saved = base ? validateCloudSnapshot(base) : null;
  if (saved && (saved.collectionId !== collectionId || saved.noteId !== noteId))
    throw Error("Cloud base belongs to another note or collection");
  return {
    version: 2,
    collectionId,
    noteId,
    generation: 0,
    baseRevision: saved?.serverRevision ?? 0,
    base: saved,
    current: saved ? { kind: "upsert", snapshot: asCloudDraft(saved) } : null,
    pending: null,
    inFlight: null,
    observed: null,
    conflict: null,
  };
}
export const cloudStatus = (state: CloudClientState) =>
  state.conflict
    ? "conflict"
    : state.inFlight || state.pending
      ? "waiting"
      : "synced";
export function saveCloudDraft(
  input: CloudClientState,
  actionInput: CloudAction,
): CloudClientState {
  const state = clone(input);
  const action = validAction(actionInput, state.collectionId, state.noteId);
  if (
    action.kind === "upsert" &&
    (state.pending?.kind === "purge" || state.inFlight?.kind === "purge")
  )
    throw Error(
      "Cloud permanent deletion is pending; recover text as a new note ID",
    );
  if (
    !state.conflict &&
    state.baseRevision > 0 &&
    !state.base &&
    action.kind === "upsert"
  )
    throw Error("Purged Cloud identity cannot be recreated; use a new note ID");
  state.current = action;
  if (state.conflict) state.conflict.local = action;
  else state.pending = action;
  state.generation = nextGeneration(state.generation);
  return state;
}
export async function startCloudMutation(
  input: CloudClientState,
  opId: string,
): Promise<CloudClientState> {
  const state = clone(input);
  if (state.conflict) throw Error("Resolve Cloud conflict before sending");
  if (state.inFlight) throw Error("Cloud mutation is already in flight");
  if (!state.pending) throw Error("No pending Cloud mutation");
  const payload = {
    version: 1 as const,
    opId,
    noteId: state.noteId,
    baseRevision: state.baseRevision,
    kind: state.pending.kind,
    snapshot: state.pending.snapshot,
  };
  state.inFlight = { ...payload, contentHash: await mutationHash(payload) };
  state.pending = null;
  state.generation = nextGeneration(state.generation);
  return state;
}
export function retryCloudMutation(state: CloudClientState): CloudMutation {
  if (!state.inFlight || state.conflict)
    throw Error("No retryable Cloud mutation");
  return clone(state.inFlight);
}
function matchResponse(state: CloudClientState, response: CloudResponse) {
  const inFlight = state.inFlight;
  if (!response || typeof response !== "object" || Array.isArray(response))
    throw Error("Invalid Cloud response");
  fields(response, ["opId", "contentHash", "revision", "snapshot"]);
  if (
    !inFlight ||
    response.opId !== inFlight.opId ||
    response.contentHash !== inFlight.contentHash ||
    !validRevision(response.revision) ||
    response.revision === 0
  )
    throw Error("Unmatched Cloud response");
  const remote = response.snapshot
    ? validateCloudSnapshot(response.snapshot)
    : null;
  if (
    remote &&
    (remote.collectionId !== state.collectionId ||
      remote.noteId !== state.noteId ||
      remote.serverRevision !== response.revision)
  )
    throw Error("Cloud response belongs to another note or revision");
  return remote;
}
export function acknowledgeCloudMutation(
  input: CloudClientState,
  responseInput: CloudResponse,
): CloudClientState {
  const state = clone(input);
  const response = clone(responseInput);
  const remote = matchResponse(state, response);
  if (
    response.revision !== state.baseRevision + 1 ||
    (state.inFlight!.kind === "upsert") !== !!remote
  )
    throw Error("Unexpected Cloud acknowledgement revision or kind");
  state.baseRevision = response.revision;
  state.base = remote;
  state.inFlight = null;
  if (!state.pending)
    state.current = remote
      ? { kind: "upsert", snapshot: asCloudDraft(remote) }
      : { kind: "purge", snapshot: null };
  state.generation = nextGeneration(state.generation);
  return consumeObserved(state);
}
export function conflictCloudMutation(
  input: CloudClientState,
  responseInput: CloudResponse,
): CloudClientState {
  const state = clone(input);
  const response = clone(responseInput);
  const remote = matchResponse(state, response);
  if (response.revision === state.baseRevision)
    throw Error("Cloud conflict has no newer revision");
  if (response.revision < state.baseRevision)
    throw Error("Cloud conflict moved backwards");
  const local = state.current;
  if (!local) throw Error("Cloud local branch missing");
  state.conflict = {
    local: clone(local),
    remote,
    remoteRevision: response.revision,
  };
  state.inFlight = null;
  state.pending = null;
  state.generation = nextGeneration(state.generation);
  return consumeObserved(state);
}
/** An exact success receipt retires the old operation; only a later local action needs conflict UI. */
export function reconcileAcceptedCloudHead(
  input: CloudClientState,
  responseInput: CloudAcceptedHead,
): CloudClientState {
  const state = clone(input),
    response = clone(responseInput);
  const { acceptedRevision, ...current } = response;
  const remote = matchResponse(state, current);
  if (
    !validRevision(acceptedRevision) ||
    acceptedRevision !== state.baseRevision + 1 ||
    current.revision <= acceptedRevision ||
    state.inFlight!.kind === "purge"
  )
    throw Error("Invalid accepted Cloud operation/current head transition");
  if (state.pending) return conflictCloudMutation(state, current);
  state.baseRevision = current.revision;
  state.base = remote;
  state.current = remote
    ? { kind: "upsert", snapshot: asCloudDraft(remote) }
    : { kind: "purge", snapshot: null };
  state.inFlight = null;
  state.pending = null;
  state.conflict = null;
  state.generation = nextGeneration(state.generation);
  return consumeObserved(state);
}
/** Persist remote observations during an immutable send; otherwise adopt or preserve a dirty branch. */
export function applyRemoteCloudHead(
  input: CloudClientState,
  incoming: CloudRemoteHead,
): CloudClientState {
  const state = clone(input),
    head = clone(incoming);
  fields(head, ["revision", "snapshot"]);
  if (!validRevision(head.revision) || head.revision < 1)
    throw Error("Invalid remote Cloud revision");
  const snapshot =
    head.snapshot === null ? null : validateCloudSnapshot(head.snapshot);
  if (
    snapshot &&
    (snapshot.noteId !== state.noteId ||
      snapshot.collectionId !== state.collectionId ||
      snapshot.serverRevision !== head.revision)
  )
    throw Error("Remote Cloud head belongs to another note or collection");
  const known =
    state.observed ??
    (state.conflict
      ? {
          revision: state.conflict.remoteRevision,
          snapshot: state.conflict.remote,
        }
      : { revision: state.baseRevision, snapshot: state.base });
  if (head.revision < known.revision) return state;
  if (head.revision === known.revision) {
    if (
      JSON.stringify(contentTuple(snapshot)) !==
      JSON.stringify(contentTuple(known.snapshot))
    )
      throw Error("Cloud server revision reused with different content");
    return state;
  }
  if (known.revision > 0 && known.snapshot === null)
    throw Error("Permanent Cloud tombstone cannot advance");
  if (state.inFlight) state.observed = { revision: head.revision, snapshot };
  else if (state.pending || state.conflict) {
    if (!state.current) throw Error("Cloud local branch missing");
    state.conflict = {
      local: clone(state.current),
      remote: snapshot,
      remoteRevision: head.revision,
    };
    state.pending = null;
  } else {
    state.baseRevision = head.revision;
    state.base = snapshot;
    state.current = snapshot
      ? { kind: "upsert", snapshot: asCloudDraft(snapshot) }
      : { kind: "purge", snapshot: null };
  }
  state.generation = nextGeneration(state.generation);
  return state;
}
function consumeObserved(state: CloudClientState) {
  const observed = state.observed;
  if (!observed) return state;
  const knownRevision = state.conflict?.remoteRevision ?? state.baseRevision;
  if (observed.snapshot === null && knownRevision > observed.revision)
    throw Error("Permanent Cloud tombstone cannot advance");
  state.observed = null;
  const next = applyRemoteCloudHead(state, observed);
  next.generation = state.generation;
  return next;
}
export function resolveCloudConflict(
  input: CloudClientState,
  chosenInput: CloudAction,
): CloudClientState {
  const state = clone(input);
  if (!state.conflict) throw Error("No Cloud conflict to resolve");
  const chosen = validAction(chosenInput, state.collectionId, state.noteId);
  if (!state.conflict.remote) {
    if (chosen.kind !== "purge")
      throw Error(
        "Purged Cloud identity cannot be recreated; use a new note ID",
      );
    return acceptRemoteCloudConflict(input);
  }
  state.baseRevision = state.conflict.remoteRevision;
  state.base = state.conflict.remote;
  state.current = chosen;
  state.pending = chosen;
  state.conflict = null;
  state.generation = nextGeneration(state.generation);
  return state;
}
export function acceptRemoteCloudConflict(input: CloudClientState) {
  const state = clone(input);
  if (!state.conflict) throw Error("No Cloud conflict to resolve");
  state.baseRevision = state.conflict.remoteRevision;
  state.base = state.conflict.remote;
  state.current = state.base
    ? { kind: "upsert", snapshot: asCloudDraft(state.base) }
    : { kind: "purge", snapshot: null };
  state.pending = null;
  state.inFlight = null;
  state.conflict = null;
  state.generation = nextGeneration(state.generation);
  return state;
}

/** Validate stored structure without crypto so local capture stays independent of hashing. */
export function validateCloudClientState(
  input: CloudClientState,
): CloudClientState {
  let state = clone(input);
  if (!state || typeof state !== "object" || Array.isArray(state))
    throw Error("Invalid stored Cloud state");
  const legacy = state as unknown as Record<string, unknown>;
  if (legacy.version === 1) {
    fields(legacy, [
      "version",
      "collectionId",
      "noteId",
      "generation",
      "baseRevision",
      "base",
      "current",
      "pending",
      "inFlight",
      "conflict",
    ]);
    state = {
      ...legacy,
      version: 2,
      observed: null,
    } as unknown as CloudClientState;
  }
  fields(state, [
    "version",
    "collectionId",
    "noteId",
    "generation",
    "baseRevision",
    "base",
    "current",
    "pending",
    "inFlight",
    "observed",
    "conflict",
  ]);
  if (
    state.version !== 2 ||
    typeof state.collectionId !== "string" ||
    typeof state.noteId !== "string" ||
    !id.test(state.collectionId) ||
    !id.test(state.noteId) ||
    !validRevision(state.generation) ||
    !validRevision(state.baseRevision)
  )
    throw Error("Unsupported or invalid stored Cloud state");
  const snapshot = (value: CloudSnapshot | null, revision: number) => {
    if (value === null) return null;
    const checked = validateCloudSnapshot(value);
    if (
      checked.collectionId !== state.collectionId ||
      checked.noteId !== state.noteId ||
      checked.serverRevision !== revision
    )
      throw Error("Stored Cloud base identity or revision mismatch");
    return checked;
  };
  snapshot(state.base, state.baseRevision);
  if (state.observed !== null) {
    fields(state.observed, ["revision", "snapshot"]);
    if (
      !state.inFlight ||
      !validRevision(state.observed.revision) ||
      state.observed.revision <= state.baseRevision ||
      (state.baseRevision > 0 && state.base === null)
    )
      throw Error("Invalid deferred Cloud head");
    snapshot(state.observed.snapshot, state.observed.revision);
  }
  if (state.baseRevision === 0 && state.base !== null)
    throw Error("Invalid initial Cloud base");
  const action = (value: CloudAction | null) =>
    value === null
      ? null
      : validAction(value, state.collectionId, state.noteId);
  const current = action(state.current),
    pending = action(state.pending);
  if (state.generation > 0 && current === null)
    throw Error("Stored Cloud state has no local projection");
  const same = (a: CloudAction | null, b: CloudAction | null) =>
    JSON.stringify(a ? [a.kind, contentTuple(a.snapshot)] : null) ===
    JSON.stringify(b ? [b.kind, contentTuple(b.snapshot)] : null);
  if (state.inFlight !== null) {
    const op = state.inFlight;
    fields(op, [
      "version",
      "opId",
      "noteId",
      "baseRevision",
      "kind",
      "snapshot",
      "contentHash",
    ]);
    if (
      op.version !== 1 ||
      typeof op.opId !== "string" ||
      !id.test(op.opId) ||
      op.noteId !== state.noteId ||
      op.baseRevision !== state.baseRevision ||
      typeof op.contentHash !== "string" ||
      !hashPattern.test(op.contentHash)
    )
      throw Error("Invalid stored Cloud operation");
    const sending = action({
      kind: op.kind,
      snapshot: op.snapshot,
    } as CloudAction);
    if (!pending && !same(current, sending))
      throw Error("Stored Cloud current text differs from its operation");
  }
  if (pending && !same(current, pending))
    throw Error("Stored Cloud current text differs from its pending draft");
  if (state.inFlight?.kind === "purge" && pending?.kind === "upsert")
    throw Error("Stored Cloud state would reuse a pending purged identity");
  if (state.conflict !== null) {
    const conflict = state.conflict;
    fields(conflict, ["local", "remote", "remoteRevision"]);
    const local = action(conflict.local);
    if (
      state.inFlight ||
      pending ||
      !validRevision(conflict.remoteRevision) ||
      conflict.remoteRevision <= state.baseRevision ||
      !local ||
      !same(current, local)
    )
      throw Error("Invalid stored Cloud conflict");
    snapshot(conflict.remote, conflict.remoteRevision);
  } else if (!state.inFlight && !pending) {
    const expected: CloudAction | null = state.base
      ? { kind: "upsert", snapshot: asCloudDraft(state.base) }
      : state.baseRevision > 0
        ? { kind: "purge", snapshot: null }
        : null;
    if (!same(current, expected))
      throw Error("Stored Cloud projection has no pending action");
  }
  if (
    !state.conflict &&
    state.baseRevision > 0 &&
    !state.base &&
    current?.kind === "upsert"
  )
    throw Error("Stored Cloud state would recreate a purged identity");
  return state;
}
