import { validateNote, type Note } from "../../core/src/index";
import {
  replica,
  receive,
  purge,
  prune,
  tick,
  type Edit,
  type Purge,
  type Replica,
  type Stamp,
  type Version,
} from "./index";
import {
  SESSION_LIFETIME_MS,
  validateSessionBinding,
  type SessionBinding,
} from "./auth";
import type { MetadataPage, ScanRequest } from "./inventory";

// Isolated M0 contract. No app repository, network or trust-registry integration.
export interface Row {
  key: string;
  noteId?: string;
  value: unknown;
}
export interface Snapshot {
  revision: number;
  rows: Row[];
}
export interface Change {
  key: string;
  row: Row | null;
}
export interface ReplicaStore {
  read(noteId: string | null, keys: string[]): Promise<Snapshot>;
  commit(expectedRevision: number, changes: Change[]): Promise<boolean>;
  close(): Promise<void>;
  scan?(request: ScanRequest): Promise<MetadataPage>;
}
export const STORE_PROTOCOL_VERSION = 4;
export interface StoreIdentity {
  schema: number;
  libraryId: string;
  deviceId: string;
  inventoryGeneration?: number;
  deliveryGeneration?: number;
}
export function validateStoreIdentity(
  snapshot: Snapshot,
  libraryId: string,
  deviceId: string,
) {
  const row = snapshot.rows.find((value) => value.key === "meta/identity");
  const identity = row?.value as StoreIdentity | undefined;
  if (
    row &&
    (!identity ||
      typeof identity !== "object" ||
      ![1, 2, 3, STORE_PROTOCOL_VERSION].includes(identity.schema) ||
      (identity.schema === STORE_PROTOCOL_VERSION &&
        [identity.inventoryGeneration, identity.deliveryGeneration].some(
          (counter) =>
            !Number.isSafeInteger(counter) || (counter as number) < 0,
        )))
  )
    throw new Error(
      "Unrecognized peer store protocol version; its data has not been changed",
    );
  if (
    identity &&
    (identity.libraryId !== libraryId || identity.deviceId !== deviceId)
  )
    throw new Error("Peer store belongs to another library or device");
  return identity;
}
export function nextStoreIdentity(
  snapshot: Snapshot,
  libraryId: string,
  deviceId: string,
  changed = { inventory: false, delivery: false },
): StoreIdentity {
  const previous = validateStoreIdentity(snapshot, libraryId, deviceId);
  const inventoryGeneration =
    (previous?.schema === STORE_PROTOCOL_VERSION
      ? previous.inventoryGeneration!
      : 0) + Number(changed.inventory);
  const deliveryGeneration =
    (previous?.schema === STORE_PROTOCOL_VERSION
      ? previous.deliveryGeneration!
      : 0) + Number(changed.delivery);
  if (![inventoryGeneration, deliveryGeneration].every(Number.isSafeInteger))
    throw new Error(
      "Peer inventory generation exhausted; local drafts remain available",
    );
  return {
    schema: STORE_PROTOCOL_VERSION,
    libraryId,
    deviceId,
    inventoryGeneration,
    deliveryGeneration,
  };
}
export interface Delivery {
  kind: "edit" | "purge";
  generation: string;
  awaiting: string[];
}
export interface Draft {
  generation: string;
  localRevision: number;
  baseEditId: string | null;
}
type Outcome = Awaited<ReturnType<typeof receive>>["outcome"];
export type Receipt =
  | {
      committed: true;
      outcome: Exclude<Outcome, "quarantined">;
      editId: string;
    }
  | { committed: false; outcome: "quarantined"; editId: string };
const identityKey = "meta/identity",
  clockKey = "meta/clock",
  sessionCountKey = "meta/session-count",
  sessionWallKey = "meta/session-wall";
const validId = (value: string) => {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
  )
    throw new Error("Invalid peer store identifier");
};
const readValue = <T>(snapshot: Snapshot, key: string) =>
  snapshot.rows.find((row) => row.key === key)?.value as T | undefined;
const record = (key: string, value: unknown, noteId?: string): Row =>
  noteId === undefined ? { key, value } : { key, value, noteId };
const change = (row: Row): Change => ({ key: row.key, row });
const content = (note: Note) =>
  JSON.stringify([
    note.schemaVersion,
    note.collectionId,
    note.noteId,
    note.bodyMarkdown,
    note.state,
    note.createdAt,
    note.updatedAt,
    note.deletedAt,
    note.purgeAfter,
    note.origin
      ? [note.origin.collectionId, note.origin.noteId, note.origin.moveId]
      : null,
  ]);
const modelKey = (key: string) =>
  ["head/", "history/", "seen/", "tombstone/"].some((p) => key.startsWith(p));

export class DurableReplica {
  constructor(
    private store: ReplicaStore,
    private libraryId: string,
    private deviceId: string,
  ) {
    replica(libraryId, deviceId);
  }
  private async load(noteId: string | null, keys: string[] = []) {
    if (noteId !== null) validId(noteId);
    const snapshot = await this.store.read(noteId, [
      identityKey,
      clockKey,
      ...keys,
    ]);
    validateStoreIdentity(snapshot, this.libraryId, this.deviceId);
    return snapshot;
  }
  private async transact<T>(
    noteId: string | null,
    keys: string[],
    transition: (
      snapshot: Snapshot,
    ) => Promise<{ changes: Change[]; result: T; skip?: boolean }>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 32; attempt++) {
      const snapshot = await this.load(noteId, keys);
      const next = await transition(snapshot);
      if (next.skip) return next.result;
      const token = (row: Row | null | undefined) => {
        if (!row) return null;
        if (row.key.startsWith("head/")) {
          const edit = row.value as Edit;
          return JSON.stringify([
            edit.editId,
            edit.libraryId,
            edit.note.noteId,
            edit.stamp,
          ]);
        }
        return JSON.stringify(row.value);
      };
      const changed = (prefixes: string[]) =>
        next.changes.some(
          (c) =>
            prefixes.some((prefix) => c.key.startsWith(prefix)) &&
            token(c.row) !==
              token(snapshot.rows.find((row) => row.key === c.key)),
        );
      const changes = [
        change(
          record(
            identityKey,
            nextStoreIdentity(snapshot, this.libraryId, this.deviceId, {
              inventory: changed(["head/", "tombstone/"]),
              delivery: changed(["pending/"]),
            }),
          ),
        ),
        ...(validateStoreIdentity(snapshot, this.libraryId, this.deviceId)
          ?.schema !== STORE_PROTOCOL_VERSION
          ? [{ key: "meta/inventory-cursor-key", row: null }]
          : []),
        ...next.changes,
      ];
      if (await this.store.commit(snapshot.revision, changes))
        return next.result;
    }
    throw new Error(
      "Peer store is busy. Nothing has been acknowledged; retry.",
    );
  }
  private model(snapshot: Snapshot): Replica {
    const state = replica(this.libraryId, this.deviceId);
    state.clock = readValue<Stamp>(snapshot, clockKey) ?? state.clock;
    for (const row of snapshot.rows) {
      if (row.key.startsWith("head/")) {
        const edit = row.value as Edit;
        state.heads[edit.note.noteId] = edit;
      } else if (row.key.startsWith("history/")) {
        const version = row.value as Version,
          id = version.edit.note.noteId;
        state.history[id] = [
          ...(Object.hasOwn(state.history, id) ? state.history[id] : []),
          version,
        ];
      } else if (row.key.startsWith("seen/")) {
        state.seen[row.key.slice(5)] = row.value as Replica["seen"][string];
      } else if (row.key.startsWith("tombstone/")) {
        const marker = row.value as Purge;
        state.tombstones[marker.noteId] = marker;
      }
    }
    return state;
  }
  private modelChanges(
    snapshot: Snapshot,
    state: Replica,
    noteId: string,
    preserveProjection = false,
  ): Change[] {
    const desired = new Map<string, Row>();
    const add = (key: string, value: unknown) =>
      desired.set(key, record(key, value, noteId));
    if (Object.hasOwn(state.heads, noteId))
      add(`head/${noteId}`, state.heads[noteId]);
    if (Object.hasOwn(state.tombstones, noteId))
      add(`tombstone/${noteId}`, state.tombstones[noteId]);
    for (const v of Object.hasOwn(state.history, noteId)
      ? state.history[noteId]
      : [])
      add(`history/${noteId}/${v.edit.editId}`, v);
    for (const [id, seen] of Object.entries(state.seen))
      if (seen.noteId === noteId) add(`seen/${id}`, seen);
    const changes: Change[] = [change(record(clockKey, state.clock))];
    for (const row of snapshot.rows)
      if (row.noteId === noteId && modelKey(row.key) && !desired.has(row.key))
        changes.push({ key: row.key, row: null });
    for (const row of desired.values()) changes.push(change(row));
    const previous = readValue<Edit>(snapshot, `head/${noteId}`),
      head = Object.hasOwn(state.heads, noteId)
        ? state.heads[noteId]
        : undefined;
    const draft = readValue<Draft>(snapshot, `draft/${noteId}`);
    if (Object.hasOwn(state.tombstones, noteId)) {
      changes.push({ key: `note/${noteId}`, row: null });
      if (draft) changes.push({ key: `draft/${noteId}`, row: null });
    } else if (draft || preserveProjection) {
      // A remote commit changes the protocol head, never a saved unstamped editor draft.
    } else if (head && previous?.editId !== head.editId) {
      const local = readValue<Note>(snapshot, `note/${noteId}`);
      const revision = (local?.localRevision ?? 0) + 1;
      if (!Number.isSafeInteger(revision))
        throw new Error("Local revision exhausted");
      changes.push(
        change(
          record(
            `note/${noteId}`,
            { ...head.note, serverRevision: null, localRevision: revision },
            noteId,
          ),
        ),
      );
    } else if (!head) changes.push({ key: `note/${noteId}`, row: null });
    return changes;
  }
  /** Commit local text without consulting clocks, cryptography, sessions or delivery targets. */
  async saveDraft(
    input: Note,
    expectedRevision: number,
    generation: string,
  ): Promise<Note> {
    const note = structuredClone(input);
    validateNote(note);
    validId(generation);
    if (note.collectionId !== "local")
      throw new Error("Peer drafts must be on-device copies");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error("Invalid local draft revision");
    return this.transact(note.noteId, [], async (snapshot) => {
      if (readValue<Purge>(snapshot, `tombstone/${note.noteId}`))
        throw new Error(
          "This note was permanently deleted; recover as a new ID",
        );
      const previous = readValue<Note>(snapshot, `note/${note.noteId}`),
        draft = readValue<Draft>(snapshot, `draft/${note.noteId}`);
      if (draft?.generation === generation) {
        if (
          previous &&
          draft.localRevision === expectedRevision + 1 &&
          previous.localRevision === draft.localRevision &&
          content(previous) === content(note)
        )
          return { changes: [], result: previous, skip: true };
        throw new Error(
          "Draft generation was reused; keep the latest text and reload",
        );
      }
      if ((previous?.localRevision ?? 0) !== expectedRevision)
        throw new Error("Local revision changed; keep the draft and reload");
      const revision = expectedRevision + 1;
      if (!Number.isSafeInteger(revision))
        throw new Error("Local revision exhausted");
      const saved = { ...note, serverRevision: null, localRevision: revision };
      return {
        changes: [
          change(record(`note/${note.noteId}`, saved, note.noteId)),
          change(
            record(
              `draft/${note.noteId}`,
              {
                generation,
                localRevision: revision,
                baseEditId: draft
                  ? draft.baseEditId
                  : (readValue<Edit>(snapshot, `head/${note.noteId}`)?.editId ??
                    null),
              } satisfies Draft,
              note.noteId,
            ),
          ),
        ],
        result: saved,
      };
    });
  }
  /** M0 only: caller must establish clock safety before publishing the exact saved draft. */
  async publishDraft(
    noteId: string,
    generation: string,
    expectedRevision: number,
    wall: number,
    editId: string,
    queueTo: string[],
  ): Promise<Note> {
    validId(generation);
    validId(editId);
    const targets = [...queueTo];
    return this.transact(noteId, [`seen/${editId}`], async (snapshot) => {
      const note = readValue<Note>(snapshot, `note/${noteId}`),
        draft = readValue<Draft>(snapshot, `draft/${noteId}`),
        head = readValue<Edit>(snapshot, `head/${noteId}`);
      if (
        !draft &&
        note?.localRevision === expectedRevision &&
        head?.editId === editId &&
        head.stamp.deviceId === this.deviceId &&
        content(head.note) === content(note)
      )
        return { changes: [], result: note, skip: true };
      if (
        !draft ||
        !note ||
        draft.generation !== generation ||
        draft.localRevision !== expectedRevision ||
        note.localRevision !== expectedRevision
      )
        throw new Error(
          "This draft changed or was removed; reload before publishing",
        );
      const state = this.model(snapshot),
        edit: Edit = {
          protocol: 1,
          libraryId: this.libraryId,
          editId,
          stamp: tick(state.clock, wall),
          note: { ...note, serverRevision: null, localRevision: 0 },
        };
      const next = await receive(state, edit, wall, new Set([this.deviceId]));
      if (next.outcome !== "applied")
        throw new Error(
          "Sync is paused for clock repair. The local draft remains saved.",
        );
      return {
        changes: [
          ...this.modelChanges(snapshot, next.state, noteId, true),
          { key: `draft/${noteId}`, row: null },
          this.delivery(
            snapshot,
            noteId,
            "edit",
            editId,
            targets,
            this.deviceId,
          ),
        ],
        result: note,
      };
    });
  }
  private delivery(
    snapshot: Snapshot,
    noteId: string,
    kind: Delivery["kind"],
    generation: string,
    queueTo: string[],
    author: string,
  ): Change {
    const previous = readValue<Delivery>(snapshot, `pending/${noteId}`);
    const awaiting = [...new Set([...(previous?.awaiting ?? []), ...queueTo])]
      .filter((id) => id !== this.deviceId && id !== author)
      .sort();
    for (const id of awaiting) validId(id);
    return {
      key: `pending/${noteId}`,
      row: awaiting.length
        ? record(`pending/${noteId}`, { kind, generation, awaiting }, noteId)
        : null,
    };
  }
  /** Input must already have authenticated library membership and verified authorship. */
  async applyEdit(
    input: Edit,
    wall: number,
    authors: ReadonlySet<string>,
    queueTo: string[] = [],
  ): Promise<Receipt> {
    const edit = structuredClone(input),
      verified = new Set(authors),
      targets = [...queueTo];
    validId(edit.note.noteId);
    validId(edit.editId);
    return this.transact<Receipt>(
      edit.note.noteId,
      [`seen/${edit.editId}`],
      async (snapshot) => {
        const next = await receive(this.model(snapshot), edit, wall, verified);
        if (next.outcome === "quarantined")
          return {
            changes: [],
            result: {
              committed: false,
              outcome: "quarantined",
              editId: edit.editId,
            },
            skip: true,
          };
        const changes = this.modelChanges(
          snapshot,
          next.state,
          edit.note.noteId,
        );
        if (next.outcome === "applied")
          changes.push(
            this.delivery(
              snapshot,
              edit.note.noteId,
              "edit",
              edit.editId,
              targets,
              edit.stamp.deviceId,
            ),
          );
        return {
          changes,
          result: {
            committed: true,
            outcome: next.outcome,
            editId: edit.editId,
          },
        };
      },
    );
  }
  /** Isolated stamped-write experiment, not the app's clock-independent capture path. */
  async saveLocal(
    input: Note,
    expectedRevision: number,
    wall: number,
    editId: string,
    queueTo: string[],
  ): Promise<Note> {
    const note = structuredClone(input),
      targets = [...queueTo];
    validateNote(note);
    validId(editId);
    return this.transact(note.noteId, [`seen/${editId}`], async (snapshot) => {
      if (readValue<Draft>(snapshot, `draft/${note.noteId}`))
        throw new Error(
          "An unstamped draft is saved. Publish that generation instead.",
        );
      const previous = readValue<Note>(snapshot, `note/${note.noteId}`);
      if ((previous?.localRevision ?? 0) !== expectedRevision)
        throw new Error(
          "Local revision changed; keep the draft and retry after reloading",
        );
      if (readValue<Purge>(snapshot, `tombstone/${note.noteId}`))
        throw new Error(
          "This note was permanently deleted; recover as a new ID",
        );
      const state = this.model(snapshot),
        edit: Edit = {
          protocol: 1,
          libraryId: this.libraryId,
          editId,
          stamp: tick(state.clock, wall),
          note: { ...note, serverRevision: null, localRevision: 0 },
        };
      const next = await receive(state, edit, wall, new Set([this.deviceId]));
      if (next.outcome !== "applied")
        throw new Error(
          "Peer stamp could not be committed; keep the local draft. Clock repair may be needed.",
        );
      const changes = this.modelChanges(snapshot, next.state, note.noteId);
      changes.push(
        this.delivery(
          snapshot,
          note.noteId,
          "edit",
          editId,
          targets,
          this.deviceId,
        ),
      );
      return {
        changes,
        result: structuredClone(
          changes.find((c) => c.key === `note/${note.noteId}`)!.row!
            .value as Note,
        ),
      };
    });
  }
  /** Expected revision is required only for a locally requested permanent deletion. */
  async applyPurge(
    input: Purge,
    authors: ReadonlySet<string>,
    queueTo: string[] = [],
    expectedRevision?: number,
  ) {
    const marker = structuredClone(input),
      verified = new Set(authors),
      targets = [...queueTo];
    validId(marker.noteId);
    return this.transact(marker.noteId, [], async (snapshot) => {
      if (
        expectedRevision !== undefined &&
        readValue<Note>(snapshot, `note/${marker.noteId}`)?.localRevision !==
          expectedRevision
      )
        throw new Error("Local revision changed; refresh before deleting");
      const state = purge(this.model(snapshot), marker, verified),
        chosen = state.tombstones[marker.noteId];
      const changes = this.modelChanges(snapshot, state, marker.noteId);
      if (
        readValue<Purge>(snapshot, `tombstone/${marker.noteId}`)?.purgeId !==
        chosen.purgeId
      )
        changes.push(
          this.delivery(
            snapshot,
            marker.noteId,
            "purge",
            chosen.purgeId,
            targets,
            chosen.deviceId,
          ),
        );
      return {
        changes,
        result: { committed: true as const, purgeId: chosen.purgeId },
      };
    });
  }
  async acknowledge(
    noteId: string,
    generation: string,
    peerId: string,
    operation: Delivery["kind"],
  ) {
    validId(peerId);
    return this.transact(noteId, [], async (snapshot) => {
      const pending = readValue<Delivery>(snapshot, `pending/${noteId}`);
      if (
        !pending ||
        pending.kind !== operation ||
        pending.generation !== generation ||
        !pending.awaiting.includes(peerId)
      )
        return { changes: [], result: false, skip: true };
      const awaiting = pending.awaiting.filter((id) => id !== peerId);
      return {
        changes: [
          {
            key: `pending/${noteId}`,
            row: awaiting.length
              ? record(`pending/${noteId}`, { ...pending, awaiting }, noteId)
              : null,
          },
        ],
        result: true,
      };
    });
  }
  async maintenance(noteId: string, now: number) {
    return this.transact(noteId, [], async (snapshot) => ({
      changes: this.modelChanges(
        snapshot,
        prune(this.model(snapshot), now),
        noteId,
      ),
      result: undefined,
    }));
  }
  async view(noteId: string) {
    const snapshot = await this.load(noteId);
    const delivery = readValue<Delivery>(snapshot, `pending/${noteId}`);
    return {
      note: readValue<Note>(snapshot, `note/${noteId}`) ?? null,
      draft: readValue<Draft>(snapshot, `draft/${noteId}`) ?? null,
      head: readValue<Edit>(snapshot, `head/${noteId}`) ?? null,
      history: snapshot.rows
        .filter((r) => r.key.startsWith(`history/${noteId}/`))
        .map((r) => r.value as Version),
      tombstone: readValue<Purge>(snapshot, `tombstone/${noteId}`) ?? null,
      clock:
        readValue<Stamp>(snapshot, clockKey) ??
        replica(this.libraryId, this.deviceId).clock,
      delivery: delivery
        ? {
            ...delivery,
            packet:
              delivery.kind === "edit"
                ? readValue<Edit>(snapshot, `head/${noteId}`)
                : readValue<Purge>(snapshot, `tombstone/${noteId}`),
          }
        : null,
    };
  }
  /** Caller must verify the signature, local transcript and current pairing BEFORE this boundary. */
  async claimVerifiedSession(
    input: SessionBinding,
    verifiedSignerId: string,
    clock = () => Date.now(),
  ) {
    const binding = structuredClone(input);
    validateSessionBinding(binding);
    const peerId =
      binding.initiatorId === this.deviceId
        ? binding.responderId
        : binding.responderId === this.deviceId
          ? binding.initiatorId
          : null;
    if (
      binding.libraryId !== this.libraryId ||
      !peerId ||
      peerId !== verifiedSignerId
    )
      throw new Error("Verified session identity mismatch");
    const challenge =
        binding.initiatorId === this.deviceId
          ? binding.initiatorNonce
          : binding.responderNonce,
      nonceKey = `nonce/${challenge}`,
      claimKey = `claim/${binding.sessionId}`;
    return this.transact(
      null,
      [nonceKey, claimKey, sessionCountKey, sessionWallKey],
      async (snapshot) => {
        const now = clock(),
          floor = readValue<number>(snapshot, sessionWallKey) ?? 0;
        if (
          !Number.isSafeInteger(now) ||
          now < floor ||
          now >= binding.expiresAt ||
          binding.expiresAt - now > SESSION_LIFETIME_MS
        )
          throw new Error("Session expired or local clock needs repair");
        if (readValue(snapshot, nonceKey) || readValue(snapshot, claimKey))
          throw new Error("Session challenge already consumed");
        const count = readValue<number>(snapshot, sessionCountKey) ?? 0;
        if (count >= 4096) throw new Error("M0 session claim capacity reached");
        const claim = {
          sessionId: binding.sessionId,
          peerId,
          challenge,
          expiresAt: binding.expiresAt,
        };
        return {
          changes: [
            change(record(nonceKey, claim)),
            change(record(claimKey, claim)),
            change(record(sessionCountKey, count + 1)),
            change(record(sessionWallKey, now)),
          ],
          result: claim,
        };
      },
    );
  }
}
