import { describe, expect, it } from "vitest";
import { newNote } from "../../packages/core/src/index";
import {
  SessionFlow,
  decodeControl,
  encodeControl,
  packetAck,
  MAX_CONTROL_BYTES,
  type Control,
  type DataPacket,
} from "../../packages/peer-protocol/src/flow";
const id = "a".repeat(64);
const packet = (generation = "edit-1"): DataPacket => ({
  version: 1,
  kind: "edit",
  edit: {
    protocol: 1,
    libraryId: "synthetic-library",
    editId: generation,
    stamp: { physical: 1000, logical: 0, deviceId: "b".repeat(64) },
    note: {
      ...newNote("local", "Synthetic flow source"),
      noteId: "synthetic-note",
    },
  },
});
const exchange = (a: SessionFlow, b: SessionFlow) => {
  for (let i = 0; i < 8; i++) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const control = from.nextControl();
      if (control) {
        from.sent(control);
        to.receive(control);
      }
    }
  }
};
const pair = () => {
  const a = new SessionFlow(id),
    b = new SessionFlow(id);
  a.authorized();
  b.authorized();
  exchange(a, b);
  expect(a.active && b.active).toBe(true);
  return { a, b };
};
describe("M0 mutual peer readiness and one-credit duplex flow, AC-12/21 partial", () => {
  it("waits for durable local authorization and both Ready acknowledgements", () => {
    const a = new SessionFlow(id),
      b = new SessionFlow(id);
    a.authorized();
    exchange(a, b);
    expect(a.active || b.active).toBe(false);
    expect(() => a.beginSend(packet())).toThrow();
    expect(() => b.beginReceive()).toThrow();
    expect(b.nextControl()).toBeNull();
    b.authorized();
    exchange(a, b);
    expect(a.active && b.active).toBe(true);
    expect(() => b.authorized()).toThrow();
  });
  it("does not count a queued control as handed to transport", () => {
    const a = new SessionFlow(id);
    a.authorized();
    const ready = a.nextControl()!;
    a.receive({ version: 1, kind: "ready", sessionId: id, credit: 1 });
    expect(a.nextControl()).toBeNull();
    expect(() =>
      a.receive({ version: 1, kind: "ready-ack", sessionId: id }),
    ).toThrow();
    a.sent(ready);
    const ack = a.nextControl()!;
    a.receive({ version: 1, kind: "ready-ack", sessionId: id });
    expect(a.active).toBe(false);
    a.sent(ack);
    expect(a.active).toBe(true);
  });
  it("permits simultaneous directions and receipts during an incoming commit", () => {
    const { a, b } = pair();
    const ab = packet("a-edit"),
      ba = packet("b-edit");
    a.beginSend(ab);
    b.beginSend(ba);
    a.sentPacket(ab);
    b.sentPacket(ba);
    a.beginReceive();
    b.beginReceive();
    a.assembled(ba);
    b.assembled(ab);
    const receipt = a.receipt();
    a.sent(receipt);
    const ack = b.receive(receipt)!;
    expect(b.receiving).toBe(true);
    expect(b.canSend).toBe(false);
    b.finishReceipt(ack);
    expect(b.canSend).toBe(true);
    expect(b.receiving).toBe(true);
    const other = b.receipt();
    b.sent(other);
    a.finishReceipt(a.receive(other)!);
    expect(a.canSend && !a.receiving && b.canSend && !b.receiving).toBe(true);
  });
  it("retains credit until matching durable completion and rejects receipt replay", () => {
    const { a, b } = pair();
    const note = packet();
    a.beginSend(note);
    b.beginReceive();
    b.assembled(note);
    const receipt = b.receipt();
    expect(() => a.receive(receipt)).toThrow();
    a.sentPacket(note);
    const ack = a.receive(receipt)!;
    expect(a.canSend).toBe(false);
    expect(b.receiving).toBe(true);
    expect(() => a.beginSend(packet("next"))).toThrow();
    expect(() => a.receive(receipt)).toThrow();
    a.finishReceipt(ack);
    expect(a.canSend).toBe(true);
    b.sent(receipt);
    expect(b.receiving).toBe(false);
    expect(() => a.receive(receipt)).toThrow();
  });
  it("rejects extra packets, wrong sessions and generation/operation substitutions", () => {
    const { a, b } = pair();
    const note = packet();
    a.beginSend(note);
    a.sentPacket(note);
    b.beginReceive();
    b.assembled(note);
    expect(() => b.beginReceive()).toThrow();
    const receipt = b.receipt();
    if (receipt.kind !== "receipt") throw new Error("fixture");
    for (const wrong of [
      { ...receipt, sessionId: "f".repeat(64) },
      { ...receipt, ack: { ...receipt.ack, generation: "wrong" } },
      { ...receipt, ack: { ...receipt.ack, operation: "purge" as const } },
      { ...receipt, ack: { ...receipt.ack, noteId: "other-note" } },
    ])
      expect(() => a.receive(wrong)).toThrow();
    expect(a.awaitingReceipt).toBe(true);
    const ack = a.receive(receipt)!;
    a.finishReceipt(ack);
    a.beginSend(packet("next"));
    a.sentPacket(packet("next"));
    expect(() => a.receive(receipt)).toThrow();
  });
  it("rejects duplicate/early Ready acknowledgement and closes without restored credit", () => {
    const fresh = new SessionFlow(id);
    expect(() =>
      fresh.receive({ version: 1, kind: "ready-ack", sessionId: id }),
    ).toThrow();
    const { a } = pair();
    expect(() =>
      a.receive({ version: 1, kind: "ready", sessionId: id, credit: 1 }),
    ).toThrow();
    a.beginSend(packet());
    a.close();
    expect(a.active || a.canSend || a.receiving).toBe(false);
    expect(() => a.authorized()).toThrow();
    expect(() => a.nextControl()).toThrow();
    expect(new SessionFlow(id).active).toBe(false);
    expect(() => new SessionFlow("bad")).toThrow();
  });
  it("strictly bounds control metadata and keeps receipts body-free", () => {
    const controls: Control[] = [
      { version: 1, kind: "ready", sessionId: id, credit: 1 },
      { version: 1, kind: "ready-ack", sessionId: id },
      { version: 1, kind: "receipt", sessionId: id, ack: packetAck(packet()) },
    ];
    for (const control of controls)
      expect(decodeControl(encodeControl(control))).toEqual(control);
    const invalid: unknown[] = [
      "",
      "not JSON",
      "x".repeat(MAX_CONTROL_BYTES + 1),
      JSON.stringify({ ...controls[0], credit: 2 }),
      JSON.stringify({ ...controls[0], version: 2 }),
      JSON.stringify({ ...controls[0], extra: 1 }),
      JSON.stringify({ ...controls[1], sessionId: "bad" }),
      JSON.stringify({
        version: 1,
        kind: "receipt",
        sessionId: id,
        ack: packet(),
      }),
      JSON.stringify({
        version: 1,
        kind: "receipt",
        sessionId: id,
        ack: { ...packetAck(packet()), bodyMarkdown: "forbidden" },
      }),
    ];
    for (const text of invalid)
      expect(() => decodeControl(text as string)).toThrow();
  });
});
