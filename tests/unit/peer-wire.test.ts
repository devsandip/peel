import { describe, expect, it } from "vitest";
import { newNote } from "../../packages/core/src/index";
import {
  encodePacket,
  decodePacket,
  frames,
  FrameAssembler,
  FRAME_BYTES,
  MAX_WIRE_BYTES,
  type Packet,
} from "../../packages/peer-protocol/src/wire";
const edit = (): Packet => ({
  version: 1,
  kind: "edit",
  edit: {
    protocol: 1,
    libraryId: "library-1",
    editId: "edit-1",
    stamp: { physical: 1793030400000, logical: 0, deviceId: "a".repeat(64) },
    note: newNote("local", "# Synthetic\n原文 café. ##fixture"),
  },
});
const collect = (packet: Packet) => {
  const assembler = new FrameAssembler();
  let result: Uint8Array | null = null;
  for (const frame of frames(encodePacket(packet), 17))
    result = assembler.push(frame);
  return decodePacket(result!);
};
describe("M0 bounded peer wire, AC-03/12/21 partial", () => {
  it("round trips Unicode and a maximally JSON-escaped 256 KiB body in bounded frames", () => {
    const packet = edit();
    expect(collect(packet)).toEqual(packet);
    if (packet.kind !== "edit") throw new Error("fixture");
    packet.edit.note.bodyMarkdown = "\u0000".repeat(256 * 1024);
    packet.edit.note.origin = {
      collectionId: "synthetic-origin",
      noteId: "original-note",
      moveId: "copy-1",
    };
    const bytes = encodePacket(packet),
      chunks = [...frames(bytes, 0xffffffff)];
    expect(bytes.length).toBeGreaterThan(256 * 1024 * 5);
    expect(chunks.every((c) => c.length <= FRAME_BYTES)).toBe(true);
    expect(collect(packet)).toEqual(packet);
  });
  it("rejects unexpected metadata, Cloud copies, invalid revisions and unbounded fields", () => {
    const packet = edit();
    if (packet.kind !== "edit") throw new Error("fixture");
    const invalid = [
      { ...packet, extra: "unexpected" },
      { ...packet, version: 2 },
      {
        ...packet,
        edit: { ...packet.edit, stamp: { ...packet.edit.stamp, extra: 1 } },
      },
      { ...packet, edit: { ...packet.edit, libraryId: "x".repeat(129) } },
      ...[
        { collectionId: "cloud" },
        { localRevision: -1 },
        { localRevision: Infinity },
        { serverRevision: 4 },
        { createdAt: "x".repeat(65) },
        { bodyMarkdown: "x".repeat(262145) },
        { extra: "unexpected" },
        { origin: { collectionId: "a", noteId: "b", moveId: "x".repeat(257) } },
      ].map((change) => ({
        ...packet,
        edit: { ...packet.edit, note: { ...packet.edit.note, ...change } },
      })),
    ];
    for (const value of invalid)
      expect(() => encodePacket(value as Packet)).toThrow();
    expect(() =>
      decodePacket(
        new TextEncoder().encode(
          '{"version":1,"kind":"ack","noteId":"a","generation":"b","operation":"edit","__proto__":{}}',
        ),
      ),
    ).toThrow();
  });
  it("rejects invalid UTF-8, JSON and packet byte limits before decoding", () => {
    for (const bytes of [
      new Uint8Array(),
      new Uint8Array(MAX_WIRE_BYTES + 1),
      new Uint8Array([0xc0, 0xaf]),
      new TextEncoder().encode("not JSON"),
    ])
      expect(() => decodePacket(bytes)).toThrow();
    expect(() => [...frames(new Uint8Array(), 1)]).toThrow();
    expect(() => [...frames(new Uint8Array(1), -1)]).toThrow();
    expect(() => [...frames(new Uint8Array(1), 0x100000000)]).toThrow();
  });
  it("rejects malformed headers without retaining an in-progress allocation", () => {
    const base = [...frames(encodePacket(edit()), 1)][0];
    const cases = [base.slice(0, 24), new Uint8Array(FRAME_BYTES + 1)];
    for (const [offset, value] of [
      [0, 0],
      [8, 2],
      [12, 1],
      [16, 0],
      [16, MAX_WIRE_BYTES + 1],
      [20, 0],
    ]) {
      const frame = base.slice();
      new DataView(frame.buffer).setUint32(offset, value);
      if (offset !== 8) cases.push(frame);
    }
    const reserved = base.slice();
    reserved[5] = 1;
    cases.push(reserved);
    const version = base.slice();
    version[4] = 2;
    cases.push(version);
    const assembler = new FrameAssembler();
    for (const frame of cases) {
      expect(() => assembler.push(frame)).toThrow();
      expect(assembler.push(base)).not.toBeNull();
    }
  });
  it("rejects interleaving, duplicate chunks and reordered offsets; reset drops partial transfers", () => {
    const packet = edit();
    if (packet.kind !== "edit") throw new Error("fixture");
    packet.edit.note.bodyMarkdown = "x".repeat(50000);
    const parts = [...frames(encodePacket(packet), 1)],
      other = [...frames(encodePacket(packet), 2)];
    for (const wrong of [parts[0], parts[2], other[1]]) {
      const assembler = new FrameAssembler();
      expect(assembler.push(parts[0])).toBeNull();
      expect(() => assembler.push(wrong)).toThrow();
      expect(() => assembler.push(parts[1])).toThrow();
    }
    const assembler = new FrameAssembler();
    assembler.push(parts[0]);
    assembler.reset();
    expect(() => assembler.push(parts[1])).toThrow();
    let complete: Uint8Array | null = null;
    for (const part of parts) complete = assembler.push(part);
    expect(decodePacket(complete!)).toEqual(packet);
  });
  it("acknowledges only note, operation kind and generation and keeps purge body-free", () => {
    const ack: Packet = {
      version: 1,
      kind: "ack",
      noteId: "note-1",
      generation: "op-1",
      operation: "purge",
    };
    expect(collect(ack)).toEqual(ack);
    expect(() =>
      encodePacket({ ...ack, bodyMarkdown: "forbidden" } as Packet),
    ).toThrow();
    const purge: Packet = {
      version: 1,
      kind: "purge",
      purge: {
        protocol: 1,
        libraryId: "library-1",
        noteId: "note-1",
        purgeId: "purge-1",
        deviceId: "a".repeat(64),
        purgedAt: 1793030400000,
      },
    };
    expect(collect(purge)).toEqual(purge);
    expect(() =>
      encodePacket({ ...purge, purge: { ...purge.purge, purgedAt: -1 } }),
    ).toThrow();
  });
});
