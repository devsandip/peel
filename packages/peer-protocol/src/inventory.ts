import { validateStamp, type Edit, type Purge, type Stamp } from "./index";
import { validatePacket, type Packet } from "./wire";
import {
  STORE_PROTOCOL_VERSION,
  nextStoreIdentity,
  validateStoreIdentity,
  type Change,
  type ReplicaStore,
  type Row,
  type Snapshot,
} from "./durable";

// Local M0 enumeration only. Metadata is a hint, never a durable acknowledgement.
export const MAX_SCAN_ROWS = 64;
export const MAX_SCAN_BYTES = 65536;
export type ScanPhase = "head" | "tombstone" | "pending";
export interface ScanRequest {
  phase: ScanPhase;
  after: string | null;
  limit: number;
  peerId?: string;
}
export interface MetadataPage extends Snapshot {
  nextKey: string | null;
  scanned: number;
}
export type InventoryItem =
  | {
      kind: "edit";
      libraryId: string;
      noteId: string;
      generation: string;
      authorId: string;
      stamp: Stamp;
    }
  | {
      kind: "purge";
      libraryId: string;
      noteId: string;
      generation: string;
      authorId: string;
      purgedAt: number;
    };
export interface PendingItem {
  kind: "pending";
  noteId: string;
  generation: string;
  operation: "edit" | "purge";
}
export interface InventoryCursor {
  integrity: string;
  version: 1;
  libraryId: string;
  deviceId: string;
  phase: ScanPhase;
  generation: number;
  after: string | null;
  peerId: string | null;
}
export interface InventoryPage<T> {
  changed: boolean;
  entries: T[];
  cursor: InventoryCursor | null;
  complete: boolean;
  scanned: number;
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
const integer = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const fields = (input: unknown, expected: string[]) => {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(input, key))
  )
    throw new Error("Unrecognized peer inventory metadata");
};
export function validateScan(request: ScanRequest) {
  if (
    !request ||
    !["head", "tombstone", "pending"].includes(request.phase) ||
    !Number.isInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > MAX_SCAN_ROWS ||
    (request.phase === "pending"
      ? !identifier(request.peerId)
      : request.peerId !== undefined)
  )
    throw new Error("Invalid bounded peer scan");
  const prefix = `${request.phase}/`;
  if (
    request.after !== null &&
    (typeof request.after !== "string" ||
      !request.after.startsWith(prefix) ||
      !identifier(request.after.slice(prefix.length)))
  )
    throw new Error("Invalid peer scan position");
  return { prefix, end: `${request.phase}0` };
}
export function projectMetadata(request: ScanRequest, row: Row): Row | null {
  const { prefix } = validateScan(request);
  const noteId = row.key.slice(prefix.length);
  if (
    !row.key.startsWith(prefix) ||
    !identifier(noteId) ||
    row.noteId !== noteId
  )
    throw new Error("Inventory record identity mismatch");
  let item: InventoryItem | PendingItem;
  if (request.phase === "head") {
    const edit = row.value as Edit;
    fields(edit, ["protocol", "libraryId", "editId", "stamp", "note"]);
    fields(edit.stamp, ["physical", "logical", "deviceId"]);
    validateStamp(edit.stamp);
    if (
      edit.protocol !== 1 ||
      !identifier(edit.libraryId) ||
      !identifier(edit.editId) ||
      edit.note?.noteId !== noteId
    )
      throw new Error("Invalid inventory head");
    item = {
      kind: "edit",
      libraryId: edit.libraryId,
      noteId,
      generation: edit.editId,
      authorId: edit.stamp.deviceId,
      stamp: structuredClone(edit.stamp),
    };
  } else if (request.phase === "tombstone") {
    const marker = row.value as Purge;
    fields(marker, [
      "protocol",
      "libraryId",
      "noteId",
      "purgeId",
      "deviceId",
      "purgedAt",
    ]);
    if (
      marker.protocol !== 1 ||
      !identifier(marker.libraryId) ||
      !identifier(marker.purgeId) ||
      !identifier(marker.deviceId) ||
      marker.noteId !== noteId ||
      !integer(marker.purgedAt)
    )
      throw new Error("Invalid inventory purge marker");
    item = {
      kind: "purge",
      libraryId: marker.libraryId,
      noteId,
      generation: marker.purgeId,
      authorId: marker.deviceId,
      purgedAt: marker.purgedAt,
    };
  } else {
    const delivery = row.value as {
      kind: "edit" | "purge";
      generation: string;
      awaiting: string[];
    };
    fields(delivery, ["kind", "generation", "awaiting"]);
    if (
      !["edit", "purge"].includes(delivery.kind) ||
      !identifier(delivery.generation) ||
      !Array.isArray(delivery.awaiting) ||
      delivery.awaiting.length > 64 ||
      delivery.awaiting.some((id) => !identifier(id)) ||
      new Set(delivery.awaiting).size !== delivery.awaiting.length
    )
      throw new Error("Invalid pending delivery metadata");
    if (!delivery.awaiting.includes(request.peerId!)) return null;
    item = {
      kind: "pending",
      noteId,
      generation: delivery.generation,
      operation: delivery.kind,
    };
  }
  return { key: row.key, noteId, value: item };
}
export function finishMetadataPage(
  revision: number,
  identity: Row | undefined,
  rows: Row[],
  scanned: number,
  nextKey: string | null,
): MetadataPage {
  if (
    !integer(revision) ||
    !Number.isInteger(scanned) ||
    scanned < 0 ||
    scanned > MAX_SCAN_ROWS ||
    new TextEncoder().encode(JSON.stringify(rows)).length > MAX_SCAN_BYTES
  )
    throw new Error("Peer metadata page exceeds its bounds");
  return {
    revision,
    rows: [...(identity ? [identity] : []), ...rows],
    scanned,
    nextKey,
  };
}

export class PeerInventory {
  constructor(
    private store: ReplicaStore,
    private libraryId: string,
    private deviceId: string,
  ) {
    if (!identifier(libraryId) || !identifier(deviceId))
      throw new Error("Invalid inventory identity");
  }
  private async prepare(
    withCursorKey = false,
    continuing = false,
  ): Promise<string | null> {
    const keyName = "meta/inventory-cursor-key";
    for (let attempt = 0; attempt < 32; attempt++) {
      const snapshot = await this.store.read(null, [
        "meta/identity",
        ...(withCursorKey ? [keyName] : []),
      ]);
      const identity = validateStoreIdentity(
        snapshot,
        this.libraryId,
        this.deviceId,
      );
      const current = identity?.schema === STORE_PROTOCOL_VERSION;
      const stored = snapshot.rows.find((row) => row.key === keyName);
      if (
        stored &&
        (typeof stored.value !== "string" ||
          !/^[0-9a-f]{64}$/.test(stored.value))
      )
        throw new Error(
          "Invalid local inventory cursor key; data has not been changed",
        );
      if (continuing && (!current || !stored))
        throw new Error(
          "Inventory cursor key unavailable; restart from the beginning",
        );
      if (current && (!withCursorKey || stored))
        return withCursorKey ? (stored!.value as string) : null;
      const changes: Change[] = [];
      if (!current)
        changes.push({
          key: "meta/identity",
          row: {
            key: "meta/identity",
            value: nextStoreIdentity(snapshot, this.libraryId, this.deviceId),
          },
        });
      let secret: string | null = null;
      if (withCursorKey) {
        secret = [...crypto.getRandomValues(new Uint8Array(32))]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        changes.push({ key: keyName, row: { key: keyName, value: secret } });
      } else if (!current) changes.push({ key: keyName, row: null });
      if (await this.store.commit(snapshot.revision, changes)) return secret;
    }
    throw new Error(
      "Inventory initialization busy; retry without blocking capture",
    );
  }
  private async cursorKey(secret: string) {
    return crypto.subtle.importKey(
      "raw",
      Uint8Array.from(secret.match(/../g)!, (byte) =>
        Number.parseInt(byte, 16),
      ),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }
  private cursorBytes(cursor: Omit<InventoryCursor, "integrity">) {
    return new TextEncoder().encode(
      JSON.stringify([
        "Peel local inventory cursor v1",
        cursor.version,
        cursor.libraryId,
        cursor.deviceId,
        cursor.phase,
        cursor.generation,
        cursor.after,
        cursor.peerId,
      ]),
    );
  }
  private validateCursor(
    cursor: InventoryCursor | null,
    peerId: string | null,
  ) {
    if (cursor === null) return;
    fields(cursor, [
      "integrity",
      "version",
      "libraryId",
      "deviceId",
      "phase",
      "generation",
      "after",
      "peerId",
    ]);
    if (
      typeof cursor.integrity !== "string" ||
      !/^[0-9a-f]{64}$/.test(cursor.integrity) ||
      cursor.version !== 1 ||
      cursor.libraryId !== this.libraryId ||
      cursor.deviceId !== this.deviceId ||
      cursor.peerId !== peerId ||
      !integer(cursor.generation) ||
      (peerId === null
        ? !["head", "tombstone"].includes(cursor.phase)
        : cursor.phase !== "pending")
    )
      throw new Error("Cursor belongs to another peer inventory or version");
    validateScan({
      phase: cursor.phase,
      after: cursor.after,
      limit: 1,
      ...(peerId === null ? {} : { peerId }),
    });
  }
  private async page(
    cursor: InventoryCursor | null,
    limit: number,
    peerId: string | null,
  ): Promise<InventoryPage<InventoryItem | PendingItem>> {
    cursor = cursor === null ? null : structuredClone(cursor);
    if (peerId !== null && !identifier(peerId))
      throw new Error("Invalid delivery target");
    this.validateCursor(cursor, peerId);
    const request: ScanRequest = {
      phase: cursor?.phase ?? (peerId === null ? "head" : "pending"),
      after: cursor?.after ?? null,
      limit,
      ...(peerId === null ? {} : { peerId }),
    };
    validateScan(request);
    if (!this.store.scan)
      throw new Error("This peer store cannot enumerate bounded metadata");
    const secret = (await this.prepare(true, cursor !== null))!;
    const cursorKey = await this.cursorKey(secret);
    if (
      cursor &&
      !(await crypto.subtle.verify(
        "HMAC",
        cursorKey,
        Uint8Array.from(cursor.integrity.match(/../g)!, (byte) =>
          Number.parseInt(byte, 16),
        ),
        this.cursorBytes(cursor),
      ))
    )
      throw new Error(
        "Inventory cursor integrity mismatch; restart from the beginning",
      );
    const page = await this.store.scan(request);
    const identity = validateStoreIdentity(page, this.libraryId, this.deviceId);
    if (identity?.schema !== STORE_PROTOCOL_VERSION)
      throw new Error("Inventory identity was not upgraded");
    const generation =
      peerId === null
        ? identity.inventoryGeneration!
        : identity.deliveryGeneration!;
    if (cursor && cursor.generation !== generation)
      return {
        changed: true,
        entries: [],
        cursor: null,
        complete: false,
        scanned: page.scanned,
      };
    const entries = page.rows
      .filter((row) => row.key !== "meta/identity")
      .map((row) => row.value as InventoryItem | PendingItem);
    if (
      entries.some(
        (entry) =>
          entry.kind !== "pending" && entry.libraryId !== this.libraryId,
      )
    )
      throw new Error("Inventory entry belongs to another library");
    const phase =
      !page.nextKey && request.phase === "head" ? "tombstone" : request.phase;
    const complete = !page.nextKey && request.phase !== "head";
    const nextFields = complete
      ? null
      : {
          version: 1 as const,
          libraryId: this.libraryId,
          deviceId: this.deviceId,
          phase,
          generation,
          after: page.nextKey,
          peerId,
        };
    const next = nextFields
      ? {
          ...nextFields,
          integrity: [
            ...new Uint8Array(
              await crypto.subtle.sign(
                "HMAC",
                cursorKey,
                this.cursorBytes(nextFields),
              ),
            ),
          ]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join(""),
        }
      : null;
    return {
      changed: false,
      entries,
      cursor: next,
      complete,
      scanned: page.scanned,
    };
  }
  async inventoryPage(
    cursor: InventoryCursor | null = null,
    limit = 32,
  ): Promise<InventoryPage<InventoryItem>> {
    return this.page(cursor, limit, null) as Promise<
      InventoryPage<InventoryItem>
    >;
  }
  async pendingPage(
    peerId: string,
    cursor: InventoryCursor | null = null,
    limit = 32,
  ): Promise<InventoryPage<PendingItem>> {
    return this.page(cursor, limit, peerId) as Promise<
      InventoryPage<PendingItem>
    >;
  }
  async resolvePending(
    peerId: string,
    input: PendingItem,
  ): Promise<
    | { outcome: "ready"; packet: Exclude<Packet, { kind: "ack" }> }
    | { outcome: "changed" }
    | { outcome: "author-proof-required" }
  > {
    const reference = structuredClone(input);
    fields(reference, ["kind", "noteId", "generation", "operation"]);
    if (
      !identifier(peerId) ||
      reference.kind !== "pending" ||
      !identifier(reference.noteId) ||
      !identifier(reference.generation) ||
      !["edit", "purge"].includes(reference.operation)
    )
      throw new Error("Invalid pending reference");
    await this.prepare();
    const snapshot = await this.store.read(null, [
      "meta/identity",
      `pending/${reference.noteId}`,
      `head/${reference.noteId}`,
      `tombstone/${reference.noteId}`,
    ]);
    validateStoreIdentity(snapshot, this.libraryId, this.deviceId);
    const pending = snapshot.rows.find(
      (row) => row.key === `pending/${reference.noteId}`,
    );
    const projected =
      pending &&
      projectMetadata(
        { phase: "pending", after: null, limit: 1, peerId },
        pending,
      );
    const current = projected?.value as PendingItem | undefined;
    if (
      !current ||
      current.generation !== reference.generation ||
      current.operation !== reference.operation
    )
      return { outcome: "changed" };
    const value = (key: string) =>
      snapshot.rows.find((row) => row.key === key)?.value;
    let packet: Exclude<Packet, { kind: "ack" }>;
    if (reference.operation === "edit") {
      const head = value(`head/${reference.noteId}`) as Edit | undefined;
      if (
        !head ||
        value(`tombstone/${reference.noteId}`) ||
        head.editId !== reference.generation ||
        head.note.noteId !== reference.noteId ||
        head.libraryId !== this.libraryId
      )
        return { outcome: "changed" };
      if (head.stamp.deviceId !== this.deviceId)
        return { outcome: "author-proof-required" };
      packet = { version: 1, kind: "edit", edit: head };
    } else {
      const marker = value(`tombstone/${reference.noteId}`) as
        Purge | undefined;
      if (
        !marker ||
        marker.purgeId !== reference.generation ||
        marker.noteId !== reference.noteId ||
        marker.libraryId !== this.libraryId
      )
        return { outcome: "changed" };
      if (marker.deviceId !== this.deviceId)
        return { outcome: "author-proof-required" };
      packet = { version: 1, kind: "purge", purge: marker };
    }
    validatePacket(packet);
    return { outcome: "ready", packet: structuredClone(packet) };
  }
}
