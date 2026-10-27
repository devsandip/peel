import { validateNote, type Note } from "../../core/src/index";
import { validateStamp, type Edit, type Purge } from "./index";

// Isolated M0 wire codec. No pairing, transport authorization or app integration.
export const FRAME_BYTES = 16384;
export const MAX_WIRE_BYTES = 2 * 1024 * 1024;
const HEADER_BYTES = 24,
  MAGIC = 0x5045454c;
export type Packet =
  | { version: 1; kind: "edit"; edit: Edit }
  | { version: 1; kind: "purge"; purge: Purge }
  | {
      version: 1;
      kind: "ack";
      noteId: string;
      generation: string;
      operation: "edit" | "purge";
    };
const identifier = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v);
const deviceId = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const integer = (v: unknown) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function fields(
  value: unknown,
  required: string[],
  optional: string[] = [],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid peer record");
  const keys = Object.keys(value);
  if (
    required.some((k) => !Object.hasOwn(value, k)) ||
    keys.some((k) => !required.includes(k) && !optional.includes(k))
  )
    throw new Error("Unexpected peer fields");
  return value as Record<string, unknown>;
}
function note(value: unknown): Note {
  const n = fields(
    value,
    [
      "schemaVersion",
      "collectionId",
      "noteId",
      "bodyMarkdown",
      "state",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "purgeAfter",
      "serverRevision",
      "localRevision",
    ],
    ["origin"],
  );
  if (
    n.collectionId !== "local" ||
    n.serverRevision !== null ||
    !integer(n.localRevision)
  )
    throw new Error("Invalid peer note revision or mode");
  for (const key of ["createdAt", "updatedAt", "deletedAt", "purgeAfter"])
    if (
      n[key] !== null &&
      (typeof n[key] !== "string" || (n[key] as string).length > 64)
    )
      throw new Error("Invalid peer date size");
  if (n.origin !== undefined) {
    const origin = fields(n.origin, ["collectionId", "noteId", "moveId"]);
    if (
      Object.values(origin).some(
        (v) => typeof v !== "string" || !v.length || v.length > 256,
      )
    )
      throw new Error("Invalid peer origin");
  }
  return validateNote(value);
}
export function validatePacket(input: unknown): Packet {
  const p = input as Packet;
  if (!p || p.version !== 1) throw new Error("Unsupported peer wire version");
  if (p.kind === "edit") {
    fields(p, ["version", "kind", "edit"]);
    const e = fields(p.edit, [
      "protocol",
      "libraryId",
      "editId",
      "stamp",
      "note",
    ]);
    fields(e.stamp, ["physical", "logical", "deviceId"]);
    validateStamp(p.edit.stamp);
    if (
      e.protocol !== 1 ||
      !identifier(e.libraryId) ||
      !identifier(e.editId) ||
      !deviceId(p.edit.stamp.deviceId)
    )
      throw new Error("Invalid peer edit identity");
    note(e.note);
  } else if (p.kind === "purge") {
    fields(p, ["version", "kind", "purge"]);
    const m = fields(p.purge, [
      "protocol",
      "libraryId",
      "noteId",
      "purgeId",
      "deviceId",
      "purgedAt",
    ]);
    if (
      m.protocol !== 1 ||
      !identifier(m.libraryId) ||
      !identifier(m.noteId) ||
      !identifier(m.purgeId) ||
      !deviceId(m.deviceId) ||
      !integer(m.purgedAt)
    )
      throw new Error("Invalid peer purge identity");
  } else if (p.kind === "ack") {
    fields(p, ["version", "kind", "noteId", "generation", "operation"]);
    if (
      !identifier(p.noteId) ||
      !identifier(p.generation) ||
      !["edit", "purge"].includes(p.operation)
    )
      throw new Error("Invalid peer acknowledgement");
  } else throw new Error("Unknown peer packet kind");
  return p;
}
export function encodePacket(input: Packet): Uint8Array {
  const bytes = new TextEncoder().encode(JSON.stringify(validatePacket(input)));
  if (bytes.length > MAX_WIRE_BYTES) throw new Error("Peer packet too large");
  return bytes;
}
export function decodePacket(bytes: Uint8Array): Packet {
  if (!bytes.length || bytes.length > MAX_WIRE_BYTES)
    throw new Error("Peer packet too large or empty");
  return validatePacket(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
}
export function* frames(
  bytes: Uint8Array,
  transferId: number,
): Generator<Uint8Array<ArrayBuffer>> {
  if (
    !integer(transferId) ||
    transferId > 0xffffffff ||
    !bytes.length ||
    bytes.length > MAX_WIRE_BYTES
  )
    throw new Error("Invalid peer transfer");
  for (
    let offset = 0;
    offset < bytes.length;
    offset += FRAME_BYTES - HEADER_BYTES
  ) {
    const payload = bytes.subarray(offset, offset + FRAME_BYTES - HEADER_BYTES),
      frame = new Uint8Array(HEADER_BYTES + payload.length),
      view = new DataView(frame.buffer);
    view.setUint32(0, MAGIC);
    view.setUint8(4, 1);
    view.setUint32(8, transferId);
    view.setUint32(12, offset);
    view.setUint32(16, bytes.length);
    view.setUint32(20, payload.length);
    frame.set(payload, HEADER_BYTES);
    yield frame;
  }
}
/** One ordered transfer at a time. Caller must close/reset on timeout or any error. */
export class FrameAssembler {
  private current: { id: number; offset: number; bytes: Uint8Array } | null =
    null;
  reset() {
    this.current = null;
  }
  push(frame: Uint8Array): Uint8Array | null {
    try {
      if (frame.length <= HEADER_BYTES || frame.length > FRAME_BYTES)
        throw new Error("Invalid peer frame size");
      const view = new DataView(
        frame.buffer,
        frame.byteOffset,
        frame.byteLength,
      );
      const id = view.getUint32(8),
        offset = view.getUint32(12),
        total = view.getUint32(16),
        length = view.getUint32(20);
      if (
        view.getUint32(0) !== MAGIC ||
        view.getUint8(4) !== 1 ||
        frame[5] ||
        frame[6] ||
        frame[7] ||
        !total ||
        total > MAX_WIRE_BYTES ||
        length !== frame.length - HEADER_BYTES ||
        offset + length > total
      )
        throw new Error("Invalid peer frame header");
      if (!this.current) {
        if (offset !== 0) throw new Error("Missing peer transfer start");
        this.current = { id, offset: 0, bytes: new Uint8Array(total) };
      }
      const current = this.current;
      if (
        current.id !== id ||
        current.offset !== offset ||
        current.bytes.length !== total
      )
        throw new Error("Interleaved or reordered peer transfer");
      current.bytes.set(frame.subarray(HEADER_BYTES), offset);
      current.offset += length;
      if (current.offset !== total) return null;
      this.current = null;
      return current.bytes;
    } catch (error) {
      this.reset();
      throw error;
    }
  }
}
