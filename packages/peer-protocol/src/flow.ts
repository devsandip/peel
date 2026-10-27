import { validatePacket, type Packet } from "./wire";

// Isolated M0 flow contract, independent of transport and durable authorization.
export type Ack = Extract<Packet, { kind: "ack" }>;
export type DataPacket = Exclude<Packet, Ack>;
export type Control =
  | { version: 1; kind: "ready"; sessionId: string; credit: 1 }
  | { version: 1; kind: "ready-ack"; sessionId: string }
  | { version: 1; kind: "receipt"; sessionId: string; ack: Ack };
export const MAX_CONTROL_BYTES = 4096;
const validSessionId = (value: unknown) =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
function validateControl(input: unknown): Control {
  const control = input as Control;
  if (!control || control.version !== 1 || !validSessionId(control.sessionId))
    throw new Error("Invalid peer control identity");
  const keys =
    control.kind === "ready"
      ? ["credit"]
      : control.kind === "ready-ack"
        ? []
        : control.kind === "receipt"
          ? ["ack"]
          : null;
  if (!keys) throw new Error("Unknown peer control");
  const expected = ["version", "kind", "sessionId", ...keys];
  if (
    Object.keys(control).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(control, key))
  )
    throw new Error("Unexpected peer control fields");
  if (control.kind === "ready" && control.credit !== 1)
    throw new Error("Unsupported peer receive credit");
  if (control.kind === "receipt" && validatePacket(control.ack).kind !== "ack")
    throw new Error("Receipt must be body-free");
  return control;
}
export function encodeControl(input: Control): string {
  const text = JSON.stringify(validateControl(input));
  if (new TextEncoder().encode(text).length > MAX_CONTROL_BYTES)
    throw new Error("Peer control too large");
  return text;
}
export function decodeControl(text: string): Control {
  if (
    typeof text !== "string" ||
    !text.length ||
    new TextEncoder().encode(text).length > MAX_CONTROL_BYTES
  )
    throw new Error("Peer control too large or empty");
  return validateControl(JSON.parse(text));
}
export function packetAck(input: DataPacket): Ack {
  const packet = validatePacket(input);
  if (packet.kind === "ack") throw new Error("A receipt is not note data");
  return {
    version: 1,
    kind: "ack",
    operation: packet.kind,
    noteId:
      packet.kind === "edit" ? packet.edit.note.noteId : packet.purge.noteId,
    generation:
      packet.kind === "edit" ? packet.edit.editId : packet.purge.purgeId,
  };
}
const same = (a: Ack, b: Ack) =>
  a.noteId === b.noteId &&
  a.generation === b.generation &&
  a.operation === b.operation;

/** One receive credit in each direction. No in-memory note queue or restored active state. */
export class SessionFlow {
  private authenticated = false;
  private ended = false;
  private readySending = false;
  private readySent = false;
  private peerReady = false;
  private ackSending = false;
  private ackSent = false;
  private ackReceived = false;
  private outgoing: { ack: Ack; sent: boolean; settling: boolean } | null =
    null;
  private incoming: "idle" | "assembling" | Ack = "idle";
  constructor(readonly sessionId: string) {
    if (!validSessionId(sessionId)) throw new Error("Invalid flow session");
  }
  private live() {
    if (this.ended) throw new Error("Peer flow closed");
  }
  get active() {
    return (
      !this.ended &&
      this.authenticated &&
      this.readySent &&
      this.peerReady &&
      this.ackSent &&
      this.ackReceived
    );
  }
  get canSend() {
    return this.active && !this.outgoing;
  }
  get awaitingReceipt() {
    return !!this.outgoing;
  }
  get receiving() {
    return this.incoming !== "idle";
  }
  authorized() {
    this.live();
    if (this.authenticated) throw new Error("Peer flow already authenticated");
    this.authenticated = true;
  }
  nextControl(): Control | null {
    this.live();
    if (this.authenticated && !this.readySending && !this.readySent) {
      this.readySending = true;
      return {
        version: 1,
        kind: "ready",
        sessionId: this.sessionId,
        credit: 1,
      };
    }
    if (
      this.authenticated &&
      this.readySent &&
      this.peerReady &&
      !this.ackSending &&
      !this.ackSent
    ) {
      this.ackSending = true;
      return { version: 1, kind: "ready-ack", sessionId: this.sessionId };
    }
    return null;
  }
  sent(input: Control) {
    this.live();
    const control = validateControl(input);
    if (control.sessionId !== this.sessionId)
      throw new Error("Wrong flow session");
    if (control.kind === "ready") {
      if (!this.readySending || this.readySent)
        throw new Error("Unexpected Ready send");
      this.readySent = true;
    } else if (control.kind === "ready-ack") {
      if (!this.ackSending || this.ackSent)
        throw new Error("Unexpected Ready acknowledgement send");
      this.ackSent = true;
    } else {
      if (
        !this.active ||
        typeof this.incoming !== "object" ||
        !same(this.incoming, control.ack)
      )
        throw new Error("Unexpected durable receipt send");
      this.incoming = "idle";
    }
  }
  receive(input: Control): Ack | null {
    this.live();
    const control = validateControl(structuredClone(input));
    if (control.sessionId !== this.sessionId)
      throw new Error("Wrong flow session");
    if (control.kind === "ready") {
      if (this.peerReady) throw new Error("Duplicate peer Ready");
      this.peerReady = true;
    } else if (control.kind === "ready-ack") {
      if (!this.readySent || !this.peerReady || this.ackReceived)
        throw new Error("Unexpected Ready acknowledgement");
      this.ackReceived = true;
    } else {
      if (
        !this.active ||
        !this.outgoing?.sent ||
        this.outgoing.settling ||
        !same(this.outgoing.ack, control.ack)
      )
        throw new Error("Unsolicited or mismatched peer receipt");
      this.outgoing.settling = true;
      return control.ack;
    }
    return null;
  }
  beginSend(packet: DataPacket) {
    this.live();
    if (!this.canSend)
      throw new Error("Waiting for peer readiness or durable receipt");
    this.outgoing = { ack: packetAck(packet), sent: false, settling: false };
  }
  sentPacket(packet: DataPacket) {
    this.live();
    if (
      !this.outgoing ||
      this.outgoing.sent ||
      !same(this.outgoing.ack, packetAck(packet))
    )
      throw new Error("Unexpected completed packet send");
    this.outgoing.sent = true;
  }
  finishReceipt(input: Ack) {
    this.live();
    const ack = validatePacket(input) as Ack;
    if (
      ack.kind !== "ack" ||
      !this.outgoing?.settling ||
      !same(this.outgoing.ack, ack)
    )
      throw new Error("Unexpected completed receipt");
    this.outgoing = null;
  }
  beginReceive() {
    this.live();
    if (!this.active || this.incoming !== "idle")
      throw new Error("Note data before readiness or without receive credit");
    this.incoming = "assembling";
  }
  assembled(packet: DataPacket) {
    this.live();
    if (!this.active || this.incoming !== "assembling")
      throw new Error("Unexpected assembled note packet");
    this.incoming = packetAck(packet);
  }
  receipt(): Control {
    this.live();
    if (!this.active || typeof this.incoming !== "object")
      throw new Error("No complete incoming packet");
    return {
      version: 1,
      kind: "receipt",
      sessionId: this.sessionId,
      ack: structuredClone(this.incoming),
    };
  }
  close() {
    this.ended = true;
    this.outgoing = null;
    this.incoming = "idle";
  }
}
