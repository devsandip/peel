import { validateNote, type Note } from "../../core/src/index";

// M0 model only. No app imports, peer authentication, encryption, transport or durable acknowledgement.
export const HISTORY_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_FUTURE_MS = 5 * 60 * 1000;
export interface Stamp {
  physical: number;
  logical: number;
  deviceId: string;
}
export interface Edit {
  protocol: 1;
  libraryId: string;
  editId: string;
  stamp: Stamp;
  note: Note;
}
export interface Purge {
  protocol: 1;
  libraryId: string;
  noteId: string;
  purgeId: string;
  deviceId: string;
  purgedAt: number;
}
export interface Version {
  edit: Edit;
  expiresAt: number;
}
export interface Replica {
  libraryId: string;
  deviceId: string;
  clock: Stamp;
  heads: Record<string, Edit>;
  history: Record<string, Version[]>;
  tombstones: Record<string, Purge>;
  seen: Record<string, { noteId: string; digest: string }>;
}
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const validId = (value: string) => {
  if (typeof value !== "string" || !identifier.test(value))
    throw new Error("Invalid protocol identifier");
};
const validTime = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("Invalid protocol clock");
};
export function validateStamp(stamp: Stamp) {
  validId(stamp.deviceId);
  validTime(stamp.physical);
  validTime(stamp.logical);
}
const compareId = (a: string, b: string) => (a === b ? 0 : a < b ? -1 : 1);
const own = <T>(record: Record<string, T>, key: string) =>
  Object.hasOwn(record, key) ? record[key] : undefined;
export const compareStamp = (a: Stamp, b: Stamp) =>
  Math.sign(a.physical - b.physical) ||
  Math.sign(a.logical - b.logical) ||
  compareId(a.deviceId, b.deviceId);
export const compareEdit = (a: Edit, b: Edit) =>
  compareStamp(a.stamp, b.stamp) || compareId(a.editId, b.editId);

/** Advance a local clock. Never rewrite the stamp on a received edit. */
export function tick(last: Stamp, wall: number, observed?: Stamp): Stamp {
  validateStamp(last);
  validTime(wall);
  if (observed) validateStamp(observed);
  const physical = Math.max(wall, last.physical, observed?.physical ?? 0);
  const logical =
    physical === last.physical && physical === observed?.physical
      ? Math.max(last.logical, observed.logical) + 1
      : physical === last.physical
        ? last.logical + 1
        : physical === observed?.physical
          ? observed.logical + 1
          : 0;
  validTime(logical);
  return { physical, logical, deviceId: last.deviceId };
}
export function replica(libraryId: string, deviceId: string): Replica {
  validId(libraryId);
  validId(deviceId);
  return {
    libraryId,
    deviceId,
    clock: { physical: 0, logical: 0, deviceId },
    heads: {},
    history: {},
    tombstones: {},
    seen: {},
  };
}
export function prune(state: Replica, now: number): Replica {
  validTime(now);
  const history = Object.fromEntries(
    Object.entries(state.history).flatMap(([id, versions]) => {
      const kept = versions.filter((v) => v.expiresAt > now);
      return kept.length ? [[id, kept]] : [];
    }),
  );
  return { ...state, history };
}
function retain(state: Replica, edit: Edit, now: number) {
  const versions = own(state.history, edit.note.noteId) ?? [];
  if (!versions.some((v) => v.edit.editId === edit.editId))
    state.history[edit.note.noteId] = [
      ...versions,
      { edit: structuredClone(edit), expiresAt: now + HISTORY_MS },
    ];
}
/** Caller must authenticate the peer and verify author signatures before this boundary. */
export async function receive(
  state: Replica,
  input: Edit,
  now: number,
  verifiedAuthors: ReadonlySet<string>,
): Promise<{
  state: Replica;
  outcome: "applied" | "stale" | "duplicate" | "purged" | "quarantined";
}> {
  input = structuredClone(input);
  validTime(now);
  validateStamp(input.stamp);
  validId(input.editId);
  if (
    input.protocol !== 1 ||
    input.libraryId !== state.libraryId ||
    !verifiedAuthors.has(input.stamp.deviceId)
  )
    throw new Error("Peer identity or protocol mismatch");
  validateNote(input.note);
  if (input.note.collectionId !== "local")
    throw new Error("Peer notes must be on-device copies");
  const id = input.note.noteId;
  validId(id);
  const next = prune(structuredClone(state), now);
  if (Object.hasOwn(next.tombstones, id))
    return { state: next, outcome: "purged" };
  if (input.stamp.physical > now + MAX_FUTURE_MS)
    return { state: next, outcome: "quarantined" };
  const note = input.note;
  const canonical = JSON.stringify([
    input.protocol,
    input.libraryId,
    input.editId,
    input.stamp.physical,
    input.stamp.logical,
    input.stamp.deviceId,
    note.schemaVersion,
    note.collectionId,
    note.noteId,
    note.bodyMarkdown,
    note.state,
    note.createdAt,
    note.updatedAt,
    note.deletedAt,
    note.purgeAfter,
    note.serverRevision,
    note.localRevision,
    note.origin
      ? [note.origin.collectionId, note.origin.noteId, note.origin.moveId]
      : null,
  ]);
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical),
      ),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const seen = own(next.seen, input.editId);
  if (seen) {
    if (seen.digest !== digest || seen.noteId !== id)
      throw new Error("Edit identity reused with different content");
    return { state: next, outcome: "duplicate" };
  }
  next.seen[input.editId] = { noteId: id, digest };
  const previous = own(next.heads, id);
  next.clock = tick(next.clock, now, input.stamp);
  if (previous && compareEdit(input, previous) < 0) {
    retain(next, input, now);
    return { state: next, outcome: "stale" };
  }
  if (previous) retain(next, previous, now);
  next.heads[id] = structuredClone(input);
  return { state: next, outcome: "applied" };
}
export function purge(
  state: Replica,
  marker: Purge,
  verifiedAuthors: ReadonlySet<string>,
): Replica {
  validId(marker.noteId);
  validId(marker.purgeId);
  validId(marker.deviceId);
  validTime(marker.purgedAt);
  if (
    marker.protocol !== 1 ||
    marker.libraryId !== state.libraryId ||
    !verifiedAuthors.has(marker.deviceId)
  )
    throw new Error("Peer identity or protocol mismatch");
  const next = structuredClone(state);
  const previous = own(next.tombstones, marker.noteId);
  // A stable marker choice keeps snapshots convergent without carrying note content.
  if (!previous || compareId(marker.purgeId, previous.purgeId) > 0)
    next.tombstones[marker.noteId] = structuredClone(marker);
  delete next.heads[marker.noteId];
  delete next.history[marker.noteId];
  for (const [id, seen] of Object.entries(next.seen))
    if (seen.noteId === marker.noteId) delete next.seen[id];
  return next;
}
