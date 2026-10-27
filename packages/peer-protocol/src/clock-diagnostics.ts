import {
  hashDescription,
  nonce,
  publicIdentity,
  validateSessionBinding,
  type DeviceIdentity,
  type PublicIdentity,
  type SessionBinding,
} from "./auth";

// M0 diagnostic only. No notes, stamps, durable trust/session claims or publication permission.
export const CLOCK_PROBE_LIFETIME_MS = 5000;
export const CLOCK_WALL_TOLERANCE_MS = 250;
export const CLOCK_RELATIVE_BOUND_MS = 120000;
export const CLOCK_INTERVAL_LIMIT_MS = 2500;
export const CLOCK_MESSAGE_LIMIT_BYTES = 4096;
const ACTIVE_LIMIT = 32,
  REPLAY_LIMIT = 512;
const hex64 = /^[0-9a-f]{64}$/;
export interface ClockReading {
  wall: number;
  mono: number;
}
interface Base {
  version: 1;
  bindingHash: string;
  from: string;
  to: string;
  nonce: string;
  signature: string;
}
export interface ClockProbe extends Base {
  kind: "clock-probe";
}
export interface ClockReply extends Base {
  kind: "clock-reply";
  peerReceivedWall: number;
  peerSentWall: number;
  peerElapsed: number;
}
export type ClockMessage = ClockProbe | ClockReply;
const invalid = (code: string): never => {
  throw new Error(`Clock diagnostic: ${code}`);
};
const wall = (value: number) => Number.isSafeInteger(value) && value >= 0;
const duration = (value: number) =>
  Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const reading = (value: ClockReading): ClockReading => {
  const { wall: time, mono } = value;
  if (!wall(time) || !duration(mono)) return invalid("invalid reading");
  return { wall: time, mono };
};
const elapsed = (start: ClockReading, end: ClockReading) => {
  const ms = end.mono - start.mono;
  if (ms < 0 || ms >= CLOCK_PROBE_LIFETIME_MS)
    return invalid("expired or nonmonotonic");
  if (Math.abs(end.wall - start.wall - ms) > CLOCK_WALL_TOLERANCE_MS)
    return invalid("wall jump");
  return ms;
};
function validate(input: unknown): asserts input is ClockMessage {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return invalid("message shape");
  const p = input as ClockMessage;
  const keys = [
    "version",
    "kind",
    "bindingHash",
    "from",
    "to",
    "nonce",
    "signature",
  ];
  if (p.kind === "clock-reply")
    keys.push("peerReceivedWall", "peerSentWall", "peerElapsed");
  else if (p.kind !== "clock-probe") return invalid("message kind");
  if (
    Object.keys(p).length !== keys.length ||
    Object.keys(p).some((key) => !keys.includes(key)) ||
    p.version !== 1 ||
    ![p.bindingHash, p.from, p.to, p.nonce].every(
      (v) => typeof v === "string" && hex64.test(v),
    ) ||
    p.from === p.to ||
    typeof p.signature !== "string" ||
    !/^[0-9a-f]{128}$/.test(p.signature)
  )
    return invalid("message shape");
  if (
    p.kind === "clock-reply" &&
    (!wall(p.peerReceivedWall) ||
      !wall(p.peerSentWall) ||
      !duration(p.peerElapsed) ||
      p.peerElapsed >= CLOCK_PROBE_LIFETIME_MS)
  )
    return invalid("reply times");
}
const bytes = (p: ClockMessage) => {
  validate(p);
  return new TextEncoder().encode(
    JSON.stringify([
      "Peel peer clock diagnostic v1",
      p.version,
      p.kind,
      p.bindingHash,
      p.from,
      p.to,
      p.nonce,
      ...(p.kind === "clock-reply"
        ? [p.peerReceivedWall, p.peerSentWall, p.peerElapsed]
        : []),
    ]),
  );
};
const decodeHex = (value: string) =>
  Uint8Array.from(value.match(/../g) ?? [], (v) => Number.parseInt(v, 16));
const encodeHex = (value: ArrayBuffer) =>
  [...new Uint8Array(value)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
export function encodeClockMessage(input: ClockMessage) {
  validate(input);
  const text = JSON.stringify(input);
  if (new TextEncoder().encode(text).length > CLOCK_MESSAGE_LIMIT_BYTES)
    return invalid("message size");
  return text;
}
export function decodeClockMessage(text: string): ClockMessage {
  if (
    typeof text !== "string" ||
    text.length > CLOCK_MESSAGE_LIMIT_BYTES ||
    new TextEncoder().encode(text).length > CLOCK_MESSAGE_LIMIT_BYTES
  )
    return invalid("message size");
  const packet: unknown = JSON.parse(text);
  validate(packet);
  return packet;
}
export function assessClockWindow(
  startInput: ClockReading,
  endInput: ClockReading,
  response: Pick<
    ClockReply,
    "peerReceivedWall" | "peerSentWall" | "peerElapsed"
  >,
) {
  const start = reading(startInput),
    end = reading(endInput),
    roundtripMs = elapsed(start, end);
  const { peerReceivedWall, peerSentWall, peerElapsed } = response;
  if (
    !wall(peerReceivedWall) ||
    !wall(peerSentWall) ||
    !duration(peerElapsed) ||
    peerElapsed >= CLOCK_PROBE_LIFETIME_MS ||
    peerElapsed > roundtripMs + CLOCK_WALL_TOLERANCE_MS ||
    Math.abs(peerSentWall - peerReceivedWall - peerElapsed) >
      CLOCK_WALL_TOLERANCE_MS
  )
    return invalid("inconsistent peer duration");
  const lower = peerSentWall - end.wall - 2 * CLOCK_WALL_TOLERANCE_MS;
  const upper = peerReceivedWall - start.wall + 2 * CLOCK_WALL_TOLERANCE_MS;
  const width = upper - lower;
  if (
    !Number.isSafeInteger(lower) ||
    !Number.isSafeInteger(upper) ||
    !Number.isSafeInteger(width) ||
    width < 0
  )
    return invalid("interval overflow");
  const assessment =
    lower > CLOCK_RELATIVE_BOUND_MS || upper < -CLOCK_RELATIVE_BOUND_MS
      ? "large-relative-skew"
      : width > CLOCK_INTERVAL_LIMIT_MS ||
          lower < -CLOCK_RELATIVE_BOUND_MS ||
          upper > CLOCK_RELATIVE_BOUND_MS
        ? "uncertain"
        : "within-relative-bound";
  return {
    kind: "peer-relative-observation" as const,
    assessment,
    lowerOffsetMs: lower,
    upperOffsetMs: upper,
    roundtripMs,
    intervalWidthMs: width,
  };
}
interface Context {
  peerId: string;
  key: CryptoKey;
  generation: number;
}
interface Pending extends Context {
  start: ClockReading;
  tag?: string;
}

/** Explicit in-memory confirmed keys only; not a replacement for TrustedReplica authorization. */
export class ClockDiagnostics {
  private peers = new Map<string, CryptoKey>();
  private pending = new Map<string, Pending>();
  private consumed = new Set<string>();
  private generation = 0;
  private responding = 0;
  private identity: DeviceIdentity;
  constructor(
    private libraryId: string,
    identity: DeviceIdentity,
    private clock: () => ClockReading = () => ({
      wall: Date.now(),
      mono: performance.now(),
    }),
  ) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(libraryId) ||
      !hex64.test(identity.deviceId) ||
      identity.privateKey.type !== "private" ||
      identity.privateKey.extractable ||
      identity.privateKey.algorithm.name !== "ECDSA" ||
      (identity.privateKey.algorithm as EcKeyAlgorithm).namedCurve !==
        "P-256" ||
      !identity.privateKey.usages.includes("sign")
    )
      invalid("local identity");
    this.identity = { ...identity };
  }
  private changed() {
    if (!Number.isSafeInteger(this.generation + 1))
      invalid("registry exhausted");
    this.generation++;
  }
  async addConfirmedPeer(input: PublicIdentity) {
    const key = input.publicKey,
      id = input.deviceId,
      generation = this.generation;
    if (
      (await publicIdentity(key)).deviceId !== id ||
      id === this.identity.deviceId ||
      generation !== this.generation ||
      (!this.peers.has(id) && this.peers.size >= 64)
    )
      invalid("confirmed identity");
    this.changed();
    this.peers.set(id, key);
  }
  revoke(peerId: string) {
    if (!hex64.test(peerId)) invalid("peer identity");
    this.changed();
    this.peers.delete(peerId);
  }
  private take() {
    return reading(this.clock());
  }
  private context(binding: SessionBinding): Context {
    validateSessionBinding(binding);
    const local = this.identity.deviceId;
    const peerId =
      binding.initiatorId === local
        ? binding.responderId
        : binding.responderId === local
          ? binding.initiatorId
          : "";
    const key = this.peers.get(peerId);
    if (binding.libraryId !== this.libraryId || !key)
      return invalid("peer not confirmed");
    return { peerId, key, generation: this.generation };
  }
  private current(context: Context) {
    if (
      context.generation !== this.generation ||
      this.peers.get(context.peerId) !== context.key
    )
      invalid("registry changed");
  }
  private async tag(binding: SessionBinding) {
    return hashDescription(
      JSON.stringify([
        "Peel installed clock binding v1",
        binding.version,
        binding.libraryId,
        binding.sessionId,
        binding.initiatorId,
        binding.responderId,
        binding.initiatorNonce,
        binding.responderNonce,
        binding.offerHash,
        binding.answerHash,
        binding.expiresAt,
      ]),
    );
  }
  private async sign(packet: ClockMessage) {
    return encodeHex(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        this.identity.privateKey,
        bytes(packet),
      ),
    );
  }
  private async verify(packet: ClockMessage, key: CryptoKey) {
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      decodeHex(packet.signature),
      bytes(packet),
    );
  }
  async begin(input: SessionBinding): Promise<ClockProbe> {
    const binding = structuredClone(input),
      context = this.context(binding),
      start = this.take();
    for (const [id, p] of this.pending)
      if (
        p.generation !== this.generation ||
        start.mono < p.start.mono ||
        start.mono - p.start.mono >= CLOCK_PROBE_LIFETIME_MS
      )
        this.pending.delete(id);
    if (this.pending.size >= ACTIVE_LIMIT) return invalid("outstanding limit");
    const id = nonce();
    if (this.pending.has(id)) return invalid("challenge collision");
    const pending: Pending = { ...context, start };
    this.pending.set(id, pending);
    try {
      pending.tag = await this.tag(binding);
      const packet: ClockProbe = {
        version: 1,
        kind: "clock-probe",
        bindingHash: pending.tag,
        from: this.identity.deviceId,
        to: context.peerId,
        nonce: id,
        signature: "0".repeat(128),
      };
      packet.signature = await this.sign(packet);
      this.current(context);
      elapsed(start, this.take());
      if (this.pending.get(id) !== pending)
        return invalid("challenge abandoned");
      return packet;
    } catch (error) {
      if (this.pending.get(id) === pending) this.pending.delete(id);
      throw error;
    }
  }
  async respond(
    input: ClockProbe,
    expected: SessionBinding,
  ): Promise<ClockReply> {
    const received = this.take();
    validate(input);
    if (input.kind !== "clock-probe") return invalid("expected probe");
    const packet = structuredClone(input),
      binding = structuredClone(expected),
      context = this.context(binding);
    if (this.responding >= ACTIVE_LIMIT)
      return invalid("responder concurrency");
    this.responding++;
    try {
      const tag = await this.tag(binding),
        claim = `${tag}/${context.peerId}/${packet.nonce}`;
      if (
        packet.bindingHash !== tag ||
        packet.from !== context.peerId ||
        packet.to !== this.identity.deviceId ||
        this.consumed.has(claim) ||
        this.consumed.size >= REPLAY_LIMIT
      )
        return invalid("request binding or replay");
      if (!(await this.verify(packet, context.key)))
        return invalid("request signature");
      this.current(context);
      if (this.consumed.has(claim) || this.consumed.size >= REPLAY_LIMIT)
        return invalid("request replay");
      this.consumed.add(claim);
      const sent = this.take(),
        peerElapsed = elapsed(received, sent);
      const reply: ClockReply = {
        version: 1,
        kind: "clock-reply",
        bindingHash: tag,
        from: this.identity.deviceId,
        to: context.peerId,
        nonce: packet.nonce,
        peerReceivedWall: received.wall,
        peerSentWall: sent.wall,
        peerElapsed,
        signature: "0".repeat(128),
      };
      reply.signature = await this.sign(reply);
      this.current(context);
      elapsed(received, this.take());
      return reply;
    } finally {
      this.responding--;
    }
  }
  async complete(input: ClockReply, expected: SessionBinding) {
    const received = this.take();
    validate(input);
    if (input.kind !== "clock-reply") return invalid("expected reply");
    const packet = structuredClone(input),
      binding = structuredClone(expected),
      pending = this.pending.get(packet.nonce);
    if (!pending?.tag) return invalid("unknown or consumed challenge");
    this.pending.delete(packet.nonce);
    this.current(pending);
    elapsed(pending.start, received);
    const context = this.context(binding),
      tag = await this.tag(binding);
    if (
      tag !== pending.tag ||
      packet.bindingHash !== tag ||
      packet.from !== pending.peerId ||
      packet.to !== this.identity.deviceId ||
      context.key !== pending.key
    )
      return invalid("reply binding");
    if (!(await this.verify(packet, pending.key)))
      return invalid("reply signature");
    this.current(pending);
    elapsed(pending.start, this.take());
    return assessClockWindow(pending.start, received, packet);
  }
}
