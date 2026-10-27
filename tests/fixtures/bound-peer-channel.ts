import type { Edit, Purge } from "../../packages/peer-protocol/src/index";
import { newNote } from "../../packages/core/src/index";
import {
  createIdentity,
  nonce,
  hashDescription,
  signSession,
  type DeviceIdentity,
  type SessionBinding,
  type SessionProof,
} from "../../packages/peer-protocol/src/auth";
import {
  DurableReplica,
  type ReplicaStore,
} from "../../packages/peer-protocol/src/durable";
import {
  TrustedReplica,
  type PeerSession,
} from "../../packages/peer-protocol/src/trusted";
import { IndexedDBReplicaStore } from "../../packages/peer-protocol/src/store-idb";
import {
  FrameAssembler,
  encodePacket,
  decodePacket,
  frames,
  FRAME_BYTES,
  type Packet,
} from "../../packages/peer-protocol/src/wire";

import {
  SessionFlow,
  decodeControl,
  encodeControl,
  type Control,
  type DataPacket,
} from "../../packages/peer-protocol/src/flow";
import type { InventoryCursor } from "../../packages/peer-protocol/src/inventory";

// Synthetic same-page M0 harness. Not a production signaling/session manager.
const library = "synthetic-bound-library";
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const until = async (
  predicate: () => boolean | Promise<boolean>,
  label: string,
) => {
  const start = performance.now();
  while (!(await predicate())) {
    if (performance.now() - start > 5000)
      throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
const stage = (label: string) => {
  (globalThis as typeof globalThis & { peelFlowStage?: string }).peelFlowStage =
    label;
};
const bounded = async <T>(promise: Promise<T>, label: string) => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 5000);
    }),
  ]).finally(() => clearTimeout(timer));
};
const exact = (value: unknown, keys: string[]) =>
  !!value &&
  typeof value === "object" &&
  Object.keys(value).length === keys.length &&
  keys.every((k) => Object.hasOwn(value, k));
class Endpoint {
  active = false;
  closed = false;
  claimCommitted = false;
  proofSeen = false;
  busy = false;
  dropAck = false;
  receivedBytes = 0;
  controlBytes = 0;
  controlFrames = 0;
  packetsCommitted = 0;
  packetsRead = 0;
  acknowledgementsSent = 0;
  acknowledgementsDropped = 0;
  receiptsProcessed = 0;
  reason = "";
  private session: PeerSession | undefined;
  private flow: SessionFlow;
  private flushingControls = false;
  private readyTimer: ReturnType<typeof setTimeout>;
  private lifetimeTimer: ReturnType<typeof setTimeout>;
  private receiptTimer: ReturnType<typeof setTimeout> | undefined;
  private localSdp: string;
  private remoteSdp: string;
  private descriptionChanged: () => void;
  closeCompletion = Promise.resolve();
  private assembler = new FrameAssembler();
  private assemblyTimer: ReturnType<typeof setTimeout> | undefined;
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  ready = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve;
    this.rejectReady = reject;
  });
  constructor(
    readonly pc: RTCPeerConnection,
    readonly channel: RTCDataChannel,
    readonly identity: DeviceIdentity,
    readonly peer: DeviceIdentity,
    private trusted: TrustedReplica,
    private expected: SessionBinding,
  ) {
    void this.ready.catch(() => {});
    this.flow = new SessionFlow(expected.sessionId);
    this.localSdp = pc.localDescription!.sdp;
    this.remoteSdp = pc.remoteDescription!.sdp;
    this.descriptionChanged = () => {
      if (!this.bound()) this.close("Installed descriptions changed");
    };
    pc.addEventListener("signalingstatechange", this.descriptionChanged);
    this.readyTimer = setTimeout(() => this.close("Readiness timeout"), 5000);
    this.lifetimeTimer = setTimeout(
      () => this.close("Session expired"),
      Math.max(0, Math.min(300000, expected.expiresAt - Date.now())),
    );
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 32768;
    channel.onclose = () => this.close("Channel closed");
    channel.onerror = () => this.close("Channel error");
    channel.onmessage = ({ data }) => {
      if (this.closed) return;
      if (typeof data === "string") {
        const bytes = new TextEncoder().encode(data).length;
        this.controlFrames++;
        this.controlBytes += bytes;
        if (
          bytes > 4096 ||
          this.controlFrames > 512 ||
          this.controlBytes > 262144
        )
          return this.close("Control limit exceeded");
        let proof = false;
        try {
          proof = JSON.parse(data).kind === "proof";
        } catch {
          return this.close("Malformed control");
        }
        if (proof) {
          if (this.proofSeen || this.active)
            return this.close("Invalid proof frame");
          this.proofSeen = true;
          void this.acceptProof(data).catch(() => this.close("Proof rejected"));
        } else {
          if (!this.proofSeen) return this.close("Control before peer proof");
          void this.acceptControl(data).catch(() =>
            this.close("Control or receipt rejected"),
          );
        }
        return;
      }
      if (!this.usable() || !(data instanceof ArrayBuffer) || this.busy)
        return this.close("Data before readiness or without credit");
      try {
        if (!this.assemblyTimer) this.flow.beginReceive();
        this.receivedBytes += data.byteLength;
        if (this.receivedBytes > 8 * 1024 * 1024)
          throw new Error("Experiment byte limit");
        this.assemblyTimer ??= setTimeout(
          () => this.close("Incomplete transfer"),
          2000,
        );
        const complete = this.assembler.push(new Uint8Array(data));
        if (!complete) return;
        const packet = decodePacket(complete);
        if (packet.kind === "ack")
          throw new Error("Binary receipt is not data");
        this.flow.assembled(packet);
        this.packetsRead++;
        clearTimeout(this.assemblyTimer);
        this.assemblyTimer = undefined;
        this.busy = true;
        void this.acceptPacket(packet)
          .catch(() => this.close("Packet or local commit failed"))
          .finally(() => {
            this.busy = false;
          });
      } catch {
        this.close("Malformed transfer");
      }
    };
  }
  private bound() {
    return (
      this.pc.localDescription?.sdp === this.localSdp &&
      this.pc.remoteDescription?.sdp === this.remoteSdp
    );
  }
  private async acceptProof(text: string) {
    const envelope = JSON.parse(text);
    if (
      !exact(envelope, ["version", "kind", "proof"]) ||
      envelope.version !== 1 ||
      envelope.kind !== "proof" ||
      !exact(envelope.proof, ["signerId", "binding", "signature"]) ||
      !exact(envelope.proof.binding, Object.keys(this.expected)) ||
      !this.bound()
    )
      throw new Error("Invalid proof envelope or installed descriptions");
    this.session = await this.trusted.authorizeSession(
      envelope.proof,
      this.expected,
    );
    if (this.closed || Date.now() >= this.expected.expiresAt || !this.bound()) {
      await this.trusted.closeSession(this.session);
      throw new Error("Session closed during claim");
    }
    this.claimCommitted = true;
    this.flow.authorized();
    await this.flushControls();
    this.activate();
  }
  private activate() {
    if (this.closed || !this.flow.active) return;
    this.active = true;
    clearTimeout(this.readyTimer);
    this.resolveReady();
  }
  private async flushControls() {
    if (this.flushingControls || this.closed) return;
    this.flushingControls = true;
    try {
      while (!this.closed) {
        const control = this.flow.nextControl();
        if (!control) break;
        await this.sendControl(control);
        this.flow.sent(control);
        this.activate();
      }
    } finally {
      this.flushingControls = false;
    }
  }
  private async sendControl(control: Control) {
    if (!this.session || this.closed) throw new Error("No claimed session");
    await this.trusted.assertCurrent(this.session);
    if (
      this.closed ||
      !this.bound() ||
      this.channel.readyState !== "open" ||
      Date.now() >= this.expected.expiresAt
    )
      throw new Error("Connection changed before control send");
    this.channel.send(encodeControl(control));
  }
  private async acceptControl(text: string) {
    const ack = this.flow.receive(decodeControl(text));
    if (ack) {
      if (!this.usable() || !this.session) throw new Error("Inactive receipt");
      await this.trusted.acknowledge(
        this.session,
        ack.noteId,
        ack.generation,
        ack.operation,
      );
      // A newer delivery can remain pending; this receipt still returns the in-flight credit.
      this.flow.finishReceipt(ack);
      clearTimeout(this.receiptTimer);
      this.receiptsProcessed++;
      return;
    }
    await this.flushControls();
    this.activate();
  }
  usable() {
    if (
      !this.closed &&
      (!this.bound() || Date.now() >= this.expected.expiresAt)
    )
      this.close("Session expired or descriptions changed");
    return (
      this.active &&
      !this.closed &&
      this.flow.active &&
      this.channel.readyState === "open"
    );
  }
  private async acceptPacket(packet: DataPacket) {
    if (!this.usable() || !this.session) throw new Error("Inactive session");
    if (packet.kind === "edit") {
      const receipt = await this.trusted.applyEdit(
        this.session,
        packet.edit,
        Date.now(),
      );
      if (!receipt.committed) return;
    } else await this.trusted.applyPurge(this.session, packet.purge);
    this.packetsCommitted++;
    if (!this.usable()) return;
    if (this.dropAck) {
      this.acknowledgementsDropped++;
      return;
    }
    const receipt = this.flow.receipt();
    await this.sendControl(receipt);
    this.flow.sent(receipt);
    this.acknowledgementsSent++;
  }
  async send(packet: Packet) {
    if (!this.usable()) throw new Error("Session is not ready");
    if (packet.kind === "ack") throw new Error("Receipts use the control path");
    if ((this.pc.sctp?.maxMessageSize ?? 0) < FRAME_BYTES)
      throw new Error("Unsupported negotiated frame limit");
    const bytes = encodePacket(packet);
    this.flow.beginSend(packet);
    this.receiptTimer = setTimeout(
      () => this.close("Durable receipt timeout"),
      2000,
    );
    try {
      for (const frame of frames(
        bytes,
        crypto.getRandomValues(new Uint32Array(1))[0],
      )) {
        if (!this.usable()) throw new Error("Session closed during transfer");
        if (this.channel.bufferedAmount > 65536) {
          await new Promise<void>((resolve, reject) => {
            const finish = (error?: Error) => {
              clearTimeout(timer);
              this.channel.removeEventListener("bufferedamountlow", low);
              this.channel.removeEventListener("close", closed);
              error ? reject(error) : resolve();
            };
            const low = () => finish(),
              closed = () => finish(new Error("Channel closed while draining"));
            const timer = setTimeout(
              () => finish(new Error("Drain timeout")),
              2000,
            );
            this.channel.addEventListener("bufferedamountlow", low);
            this.channel.addEventListener("close", closed);
            if (this.channel.bufferedAmount <= 65536) finish();
          });
        }
        if (!this.session) throw new Error("Missing session handle");
        await this.trusted.assertCurrent(this.session);
        if (!this.usable()) throw new Error("Session closed before sending");
        this.channel.send(frame);
      }
      this.flow.sentPacket(packet);
    } catch (error) {
      this.close("Packet send failed");
      throw error;
    }
  }
  get canSend() {
    return this.usable() && this.flow.canSend;
  }
  async sendNextPending(): Promise<
    "sent" | "empty" | "deferred" | "author-proof-required"
  > {
    if (!this.session || !this.canSend)
      throw new Error("Session not ready for delivery enumeration");
    let cursor: InventoryCursor | null = null;
    for (let pageNumber = 0; pageNumber < 32; pageNumber++) {
      const page = await this.trusted.pendingPage(this.session, cursor, 8);
      if (page.changed) return "deferred";
      const reference = page.entries[0];
      if (reference) {
        const resolved = await this.trusted.resolvePending(
          this.session,
          reference,
        );
        if (resolved.outcome === "changed") return "deferred";
        if (resolved.outcome === "author-proof-required")
          return "author-proof-required";
        await this.send(resolved.packet);
        return "sent";
      }
      if (page.complete) return "empty";
      cursor = page.cursor;
    }
    return "deferred";
  }
  proof(proof: SessionProof) {
    this.channel.send(JSON.stringify({ version: 1, kind: "proof", proof }));
  }
  async revoke() {
    this.close("Peer revoked");
    await this.trusted.revokePeer(this.peer.deviceId);
  }
  close(reason = "Experiment closed") {
    if (this.closed) return;
    this.closed = true;
    this.active = false;
    this.reason = reason;
    this.flow.close();
    if (this.session)
      this.closeCompletion = this.trusted
        .closeSession(this.session)
        .catch(() => {});
    clearTimeout(this.readyTimer);
    clearTimeout(this.receiptTimer);
    clearTimeout(this.lifetimeTimer);
    clearTimeout(this.assemblyTimer);
    this.assembler.reset();
    this.pc.removeEventListener(
      "signalingstatechange",
      this.descriptionChanged,
    );
    this.rejectReady(new Error(reason));
    this.channel.close();
    this.pc.close();
  }
}

export async function runBoundChannelExperiment() {
  const alice = await createIdentity(),
    bob = await createIdentity(),
    checks: Record<string, boolean> = {};
  let failCommit = false,
    failSenderCommit = false,
    claimHook: (() => void) | undefined;
  const suffix = nonce().slice(0, 12),
    storeA = new IndexedDBReplicaStore(`peel-m0-peer-bound-a-${suffix}`, () => {
      if (failSenderCommit)
        throw new Error("Synthetic sender receipt commit failure");
    });
  const recipientHook = () => {
    if (failCommit) throw new Error("Synthetic write failure");
    claimHook?.();
  };
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  };
  let commitGate:
    | {
        prefix: string;
        reached: ReturnType<typeof deferred>;
        resume: ReturnType<typeof deferred>;
      }
    | undefined;
  const recipientStore = (base: ReplicaStore): ReplicaStore => ({
    read: (noteId, keys) => base.read(noteId, keys),
    close: () => base.close(),
    commit: async (revision, changes) => {
      const gate = commitGate;
      if (
        gate &&
        changes.some((change) => change.key.startsWith(gate.prefix))
      ) {
        gate.reached.resolve();
        await gate.resume.promise;
      }
      return base.commit(revision, changes);
    },
  });
  let storeB = new IndexedDBReplicaStore(
      `peel-m0-peer-bound-b-${suffix}`,
      recipientHook,
    ),
    wrappedB = recipientStore(storeB),
    engineB = new DurableReplica(wrappedB, library, bob.deviceId);
  const engineA = new DurableReplica(storeA, library, alice.deviceId);
  const trustedA = new TrustedReplica(storeA, library, alice.deviceId);
  let trustedB = new TrustedReplica(wrappedB, library, bob.deviceId);
  const sessions: { a: Endpoint; b: Endpoint }[] = [];
  const negotiate = async () => {
    const a = new RTCPeerConnection({ iceServers: [] }),
      b = new RTCPeerConnection({ iceServers: [] });
    const local = a.createDataChannel("peel-bound-synthetic", {
      ordered: true,
    });
    const remote = new Promise<RTCDataChannel>((resolve) => {
      b.ondatachannel = ({ channel }) => resolve(channel);
    });
    const gathered = async (
      pc: RTCPeerConnection,
      description: RTCSessionDescriptionInit,
    ) => {
      await pc.setLocalDescription(description);
      await until(() => pc.iceGatheringState === "complete", "ICE gathering");
      return pc.localDescription!;
    };
    await b.setRemoteDescription(await gathered(a, await a.createOffer()));
    await a.setRemoteDescription(await gathered(b, await b.createAnswer()));
    await until(() => local.readyState === "open", "data channel open");
    const peerChannel = await remote;
    const negotiation = {
      sessionId: nonce(),
      initiatorNonce: nonce(),
      responderNonce: nonce(),
      expiresAt: Date.now() + 60000,
    };
    // Build each expected transcript independently from that endpoint's actual connection.
    const expected = async (
      pc: RTCPeerConnection,
      initiator: boolean,
    ): Promise<SessionBinding> => ({
      version: 1,
      libraryId: library,
      initiatorId: alice.deviceId,
      responderId: bob.deviceId,
      ...negotiation,
      offerHash: await hashDescription(
        (initiator ? pc.localDescription : pc.remoteDescription)!.sdp,
      ),
      answerHash: await hashDescription(
        (initiator ? pc.remoteDescription : pc.localDescription)!.sdp,
      ),
    });
    const expectedA = await expected(a, true),
      expectedB = await expected(b, false);
    assert(
      expectedA.offerHash === expectedB.offerHash &&
        expectedA.answerHash === expectedB.answerHash,
      "Installed SDP transcripts differ",
    );
    const endpointA = new Endpoint(a, local, alice, bob, trustedA, expectedA),
      endpointB = new Endpoint(b, peerChannel, bob, alice, trustedB, expectedB);
    const session = { a: endpointA, b: endpointB };
    sessions.push(session);
    return { ...session, expectedA, expectedB };
  };
  const authenticate = async (
    session: Awaited<ReturnType<typeof negotiate>>,
    tamper = false,
  ) => {
    const proofA = await signSession(
        alice,
        tamper
          ? { ...session.expectedA, offerHash: "f".repeat(64) }
          : session.expectedA,
      ),
      proofB = await signSession(bob, session.expectedB);
    session.a.proof(proofA);
    session.b.proof(proofB);
    await Promise.race([
      Promise.all([session.a.ready, session.b.ready]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Authentication timeout")), 5000),
      ),
    ]);
  };
  const close = async (session: { a: Endpoint; b: Endpoint }) => {
    session.a.close();
    session.b.close();
    await bounded(
      Promise.all([session.a.closeCompletion, session.b.closeCompletion]),
      "session closure commits",
    );
  };
  try {
    await trustedA.confirmPeer(bob);
    await trustedB.confirmPeer(alice);
    let session = await negotiate();
    await authenticate(session);
    checks.actualInstalledDescriptionsBoundToBothProofs =
      session.a.active && session.b.active;
    const body = "# Synthetic bound fixture\n" + "原文 café. ".repeat(18000);
    let note = await engineA.saveLocal(
      newNote("local", body),
      0,
      Date.now(),
      nonce(),
      [bob.deviceId],
    );
    const pending = (await engineA.view(note.noteId)).delivery!;
    await session.a.send({
      version: 1,
      kind: "edit",
      edit: pending.packet as Edit,
    });
    await until(
      async () => !(await engineA.view(note.noteId)).delivery,
      "durable acknowledgement",
    );
    const received = await engineB.view(note.noteId);
    checks.unicodeNoteCommittedBeforeAcknowledgement =
      received.note?.bodyMarkdown === body &&
      received.note.localRevision === 1 &&
      session.b.acknowledgementsSent === 1;
    const stats = await session.a.pc.getStats(),
      transport = [...stats.values()].find((s) => s.type === "transport"),
      pair = stats.get(transport?.selectedCandidatePairId);
    const connectivity = {
      dtlsState: transport?.dtlsState,
      localCandidateType: stats.get(pair?.localCandidateId)?.candidateType,
      remoteCandidateType: stats.get(pair?.remoteCandidateId)?.candidateType,
      frameBytes: FRAME_BYTES,
      payloadBytes: new TextEncoder().encode(body).length,
    };
    await close(session);

    session = await negotiate();
    await authenticate(session);
    const future = {
      protocol: 1 as const,
      libraryId: library,
      editId: nonce(),
      stamp: {
        physical: Date.now() + 365 * 86400000,
        logical: 0,
        deviceId: alice.deviceId,
      },
      note: newNote("local", "Synthetic future-clock fixture"),
    };
    await session.a.send({ version: 1, kind: "edit", edit: future });
    await until(
      () => session.b.packetsRead === 1 && !session.b.busy,
      "future stamp quarantine",
    );
    checks.quarantinedEditSendsNoAcknowledgement =
      session.b.acknowledgementsSent === 0 &&
      !(await engineB.view(future.note.noteId)).note;
    await close(session);

    note = await engineA.saveLocal(
      { ...note, bodyMarkdown: body + "\nSynthetic second edit" },
      1,
      Date.now(),
      nonce(),
      [bob.deviceId],
    );
    const replacement = (await engineA.view(note.noteId)).delivery!;
    session = await negotiate();
    await authenticate(session);
    failCommit = true;
    await session.a.send({
      version: 1,
      kind: "edit",
      edit: replacement.packet as Edit,
    });
    await until(() => session.b.closed, "injected write failure");
    failCommit = false;
    checks.failedRecipientCommitSendsNoAcknowledgement =
      session.b.acknowledgementsSent === 0 &&
      !!(await engineA.view(note.noteId)).delivery &&
      (await engineB.view(note.noteId)).note?.localRevision === 1;
    await close(session);

    session = await negotiate();
    await authenticate(session);
    session.b.dropAck = true;
    await session.a.send({
      version: 1,
      kind: "edit",
      edit: replacement.packet as Edit,
    });
    await until(
      () => session.b.acknowledgementsDropped === 1,
      "dropped acknowledgement",
    );
    checks.lostAcknowledgementRetainsSenderDelivery =
      !!(await engineA.view(note.noteId)).delivery &&
      (await engineB.view(note.noteId)).note?.localRevision === 2;
    await close(session);
    await storeB.close();
    storeB = new IndexedDBReplicaStore(
      `peel-m0-peer-bound-b-${suffix}`,
      recipientHook,
    );
    wrappedB = recipientStore(storeB);
    engineB = new DurableReplica(wrappedB, library, bob.deviceId);
    trustedB = new TrustedReplica(wrappedB, library, bob.deviceId);
    checks.recipientStoreReopenRetainsUnacknowledgedCommit =
      (await engineB.view(note.noteId)).note?.localRevision === 2;
    session = await negotiate();
    await authenticate(session);
    await session.a.send({
      version: 1,
      kind: "edit",
      edit: replacement.packet as Edit,
    });
    await until(
      async () => !(await engineA.view(note.noteId)).delivery,
      "duplicate retry acknowledgement",
    );
    checks.retryAfterReconnectDeduplicatesRecipient =
      (await engineB.view(note.noteId)).note?.localRevision === 2 &&
      (await engineB.view(note.noteId)).head?.editId === replacement.generation;
    await engineA.applyPurge(
      {
        protocol: 1,
        libraryId: library,
        noteId: note.noteId,
        purgeId: nonce(),
        deviceId: alice.deviceId,
        purgedAt: Date.now(),
      },
      new Set([alice.deviceId]),
      [bob.deviceId],
      2,
    );
    const deletion = (await engineA.view(note.noteId)).delivery!;
    await until(() => !session.a.busy, "ack handler completion");
    await session.a.send({
      version: 1,
      kind: "purge",
      purge: deletion.packet as Purge,
    });
    await until(
      async () => !(await engineA.view(note.noteId)).delivery,
      "purge acknowledgement",
    );
    const purged = await engineB.view(note.noteId);
    checks.purgeCommitsWithoutRetainedBody =
      !purged.note &&
      !purged.head &&
      !purged.history.length &&
      !!purged.tombstone;
    await session.b.revoke();
    let rejected = false;
    try {
      await session.b.send({
        version: 1,
        kind: "ack",
        operation: "edit",
        noteId: note.noteId,
        generation: replacement.generation,
      });
    } catch {
      rejected = true;
    }
    checks.activeRevocationClosesAndRejectsNewTraffic =
      session.b.closed && !session.b.active && rejected;
    await close(session);
    await trustedB.confirmPeer(alice);

    session = await negotiate();
    let tamperRejected = false;
    try {
      await authenticate(session, true);
    } catch {
      tamperRejected = true;
    }
    checks.wrongInstalledDescriptionProofRejected =
      tamperRejected && !session.b.active && session.b.packetsCommitted === 0;
    await close(session);

    session = await negotiate();
    const early = [
      ...frames(
        encodePacket({
          version: 1,
          kind: "edit",
          edit: replacement.packet as Edit,
        }),
        1,
      ),
    ][0];
    session.a.channel.send(early);
    await until(() => session.b.closed, "pre-authentication data rejection");
    checks.earlyNoteFramesRejectedBeforeStore =
      !session.b.active && session.b.packetsCommitted === 0;
    await close(session);

    session = await negotiate();
    const revoking = session;
    let pendingRevoke: Promise<void> | undefined;
    claimHook = () => {
      claimHook = undefined;
      pendingRevoke = revoking.b.revoke();
      void pendingRevoke.catch(() => {});
    };
    let pendingRevocationRejected = false;
    try {
      await authenticate(session);
    } catch {
      pendingRevocationRejected = true;
    }
    claimHook = undefined;
    await pendingRevoke;
    checks.revocationDuringClaimPreventsActivation =
      pendingRevocationRejected && session.b.closed && !session.b.active;
    await close(session);
    await trustedB.confirmPeer(alice);

    session = await negotiate();
    await authenticate(session);
    const wrongAuthor = structuredClone(replacement.packet as Edit);
    wrongAuthor.stamp.deviceId = "f".repeat(64);
    await session.a.send({ version: 1, kind: "edit", edit: wrongAuthor });
    await until(() => session.b.closed, "third-party author rejection");
    checks.unverifiedForwardedAuthorRejected = session.b.packetsCommitted === 0;
    await close(session);

    session = await negotiate();
    await authenticate(session);
    session.a.channel.send(new Uint8Array([1, 2, 3]));
    await until(() => session.b.closed, "malformed frame rejection");
    checks.malformedFrameClosesWithoutAcknowledgement =
      session.b.reason === "Malformed transfer" &&
      session.b.acknowledgementsSent === 0;
    await close(session);

    session = await negotiate();
    await authenticate(session);
    session.a.channel.send(early);
    await until(() => session.b.closed, "partial-transfer timeout");
    checks.partialTransferTimesOutWithoutAcknowledgement =
      session.b.reason === "Incomplete transfer" &&
      session.b.acknowledgementsSent === 0;
    await close(session);

    session = await negotiate();
    await authenticate(session);
    stage("sender-receipt-commit-failure");
    const failedAckNote = await engineA.saveLocal(
      newNote("local", "Synthetic sender receipt failure"),
      0,
      Date.now(),
      nonce(),
      [bob.deviceId],
    );
    const failedAckPacket = (await engineA.view(failedAckNote.noteId)).delivery!
      .packet as Edit;
    failSenderCommit = true;
    try {
      await session.a.send({ version: 1, kind: "edit", edit: failedAckPacket });
      await until(() => session.a.closed, "failed sender receipt commit");
    } finally {
      failSenderCommit = false;
    }
    checks.failedSenderReceiptCommitRetainsDelivery =
      !!(await engineA.view(failedAckNote.noteId)).delivery &&
      (await engineB.view(failedAckNote.noteId)).note?.localRevision === 1 &&
      session.a.receiptsProcessed === 0;
    await close(session);
    session = await negotiate();
    await authenticate(session);
    await session.a.send({ version: 1, kind: "edit", edit: failedAckPacket });
    await until(
      async () => !(await engineA.view(failedAckNote.noteId)).delivery,
      "retry after sender receipt failure",
    );
    checks.senderReceiptFailureRetryDoesNotReapply =
      (await engineB.view(failedAckNote.noteId)).note?.localRevision === 1;
    await close(session);

    session = await negotiate();
    await authenticate(session);
    stage("durable-receipt-timeout");
    const timeoutNote = await engineA.saveLocal(
      newNote("local", "Synthetic receipt timeout"),
      0,
      Date.now(),
      nonce(),
      [bob.deviceId],
    );
    session.b.dropAck = true;
    await session.a.send({
      version: 1,
      kind: "edit",
      edit: (await engineA.view(timeoutNote.noteId)).delivery!.packet as Edit,
    });
    await until(() => session.a.closed, "durable receipt timeout");
    checks.receiptTimeoutClosesWithDeliveryIntact =
      session.a.reason === "Durable receipt timeout" &&
      !!(await engineA.view(timeoutNote.noteId)).delivery &&
      (await engineB.view(timeoutNote.noteId)).note?.bodyMarkdown ===
        timeoutNote.bodyMarkdown;
    await close(session);
    stage("delayed-claim");

    session = await negotiate();
    commitGate = { prefix: "claim/", reached: deferred(), resume: deferred() };
    const delayed = commitGate;
    const authentication = authenticate(session);
    void authentication.catch(() => {});
    await bounded(delayed.reached.promise, "held claim entry");
    await until(
      () => session.a.claimCommitted,
      "opposite durable session claim",
    );
    let earlyRejected = false;
    try {
      await session.a.send({
        version: 1,
        kind: "edit",
        edit: replacement.packet as Edit,
      });
    } catch {
      earlyRejected = true;
    }
    checks.oneClaimCannotBypassMutualReadiness =
      session.a.claimCommitted &&
      !session.b.claimCommitted &&
      !session.a.active &&
      !session.b.active &&
      earlyRejected &&
      session.b.packetsRead === 0;
    commitGate = undefined;
    delayed.resume.resolve();
    stage("delayed-released");
    await authentication;
    checks.delayedClaimCompletesReadyWithoutCoordinator =
      session.a.active && session.b.active;
    await close(session);

    session = await negotiate();
    await authenticate(session);
    stage("duplex");
    const duplexA = await engineA.saveLocal(
      newNote("local", "Synthetic A duplex source"),
      0,
      Date.now(),
      nonce(),
      [bob.deviceId],
    );
    const duplexB = await engineB.saveLocal(
      newNote("local", "Synthetic B duplex source"),
      0,
      Date.now(),
      nonce(),
      [alice.deviceId],
    );
    const packetA = (await engineA.view(duplexA.noteId)).delivery!
      .packet as Edit;
    const packetB = (await engineB.view(duplexB.noteId)).delivery!
      .packet as Edit;
    commitGate = {
      prefix: `head/${duplexA.noteId}`,
      reached: deferred(),
      resume: deferred(),
    };
    stage("duplex-gate");
    const held = commitGate;
    stage("duplex-send-a");
    await session.a.send({ version: 1, kind: "edit", edit: packetA });
    await bounded(held.reached.promise, "held recipient commit entry");
    let extraRejected = false;
    try {
      stage("duplex-extra-send");
      await session.a.send({ version: 1, kind: "edit", edit: packetA });
    } catch {
      extraRejected = true;
    }
    const newer = await engineA.saveLocal(
      { ...duplexA, bodyMarkdown: "Synthetic A coalesced source" },
      1,
      Date.now(),
      nonce(),
      [bob.deviceId],
    );
    await session.b.send({ version: 1, kind: "edit", edit: packetB });
    await until(
      async () => !(await engineB.view(duplexB.noteId)).delivery,
      "duplex receipt while opposite commit is held",
    );
    stage("duplex-receipt");
    checks.duplexReceiptProgressesDuringOppositeCommit =
      session.b.busy &&
      session.b.receiptsProcessed === 1 &&
      (await engineA.view(duplexB.noteId)).note?.bodyMarkdown ===
        duplexB.bodyMarkdown;
    checks.oneCreditRejectsExtraSendWithoutClosing =
      extraRejected &&
      !session.a.closed &&
      !!(await engineA.view(duplexA.noteId)).delivery;
    commitGate = undefined;
    held.resume.resolve();
    await until(
      () => session.a.receiptsProcessed === 1 && !session.b.busy,
      "held commit receipt",
    );
    stage("duplex-newer");
    const pendingNewer = (await engineA.view(newer.noteId)).delivery!;
    checks.oldInflightReceiptRetainsCoalescedGeneration =
      pendingNewer.generation !== packetA.editId &&
      (await engineA.view(newer.noteId)).note?.bodyMarkdown ===
        newer.bodyMarkdown;
    await session.a.send({
      version: 1,
      kind: "edit",
      edit: pendingNewer.packet as Edit,
    });
    await until(
      async () => !(await engineA.view(newer.noteId)).delivery,
      "coalesced next generation receipt",
    );
    checks.duplexAndCoalescedEditsConverge =
      (await engineB.view(newer.noteId)).note?.bodyMarkdown ===
        newer.bodyMarkdown &&
      (await engineB.view(newer.noteId)).note?.localRevision === 2 &&
      (await engineA.view(duplexB.noteId)).note?.bodyMarkdown ===
        duplexB.bodyMarkdown;
    await close(session);

    session = await negotiate();
    await authenticate(session);
    stage("wrong-session-control");
    session.a.channel.send(
      encodeControl({ version: 1, kind: "ready-ack", sessionId: nonce() }),
    );
    await until(() => session.b.closed, "wrong-session control rejection");
    checks.wrongSessionControlClosesBeforeData =
      session.b.packetsRead === 0 && !session.b.active;
    await close(session);

    session = await negotiate();
    await authenticate(session);
    stage("renegotiation");
    const changed = session.a.pc.createDataChannel("synthetic-renegotiation");
    const offer = await session.a.pc.createOffer({ iceRestart: true });
    // The guard closes this connection during signaling. Do not await a cancelled
    // set-description operation; WebRTC may abort its queued completion on close.
    const changing = session.a.pc.setLocalDescription(offer);
    void changing.catch(() => {});
    await until(() => session.a.closed, "changed installed descriptions");
    checks.renegotiationRequiresFreshBoundSession =
      session.a.reason === "Installed descriptions changed" &&
      !session.a.active;
    changed.close();
    await close(session);

    session = await negotiate();
    await authenticate(session);
    stage("enumerated-pending-delivery");
    const archived = await engineA.saveLocal(
      {
        ...newNote("local", "Synthetic enumerated archived source"),
        state: "archived",
      },
      0,
      Date.now(),
      nonce(),
      [bob.deviceId],
    );
    const trashed = await engineA.saveLocal(
      {
        ...newNote("local", "Synthetic enumerated Trash source"),
        state: "trashed",
        deletedAt: new Date().toISOString(),
        purgeAfter: new Date(Date.now() + 30 * 86400000).toISOString(),
      },
      0,
      Date.now(),
      nonce(),
      [bob.deviceId],
    );
    let drained = false,
      enumerated = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      await until(() => session.a.canSend, "enumerated delivery credit");
      const outcome = await session.a.sendNextPending();
      if (outcome === "empty") {
        drained = true;
        break;
      }
      assert(
        outcome === "sent",
        "Unexpected deferred or unverified author during synthetic enumeration",
      );
      enumerated++;
    }
    checks.scopedEnumerationDrivesFreshSessionBacklogWithoutKnownIds =
      drained &&
      enumerated === 3 &&
      session.a.receiptsProcessed === 3 &&
      (await engineB.view(timeoutNote.noteId)).note?.localRevision === 1;
    checks.enumeratedArchiveAndTrashRetainExactStateAndSource =
      (await engineB.view(archived.noteId)).note?.state === "archived" &&
      (await engineB.view(archived.noteId)).note?.bodyMarkdown ===
        archived.bodyMarkdown &&
      (await engineB.view(trashed.noteId)).note?.state === "trashed" &&
      (await engineB.view(trashed.noteId)).note?.bodyMarkdown ===
        trashed.bodyMarkdown;
    await close(session);

    session = await negotiate();
    await authenticate(session);
    stage("independent-revocation");
    const independent = new TrustedReplica(storeA, library, alice.deviceId);
    await independent.revokePeer(bob.deviceId);
    let outgoingRejected = false;
    try {
      await session.a.send({
        version: 1,
        kind: "edit",
        edit: replacement.packet as Edit,
      });
    } catch {
      outgoingRejected = true;
    }
    checks.independentDurableRevocationBlocksOutgoingFrames =
      outgoingRejected && session.a.closed && session.b.packetsRead === 0;
    await close(session);
    for (const [name, passed] of Object.entries(checks))
      assert(passed, `Bound channel check failed: ${name}`);
    return {
      checks,
      connectivity,
      sessions: sessions.length,
      payloadsPersistedByServer: 0,
      appDatabasesOpened: 0,
      externalIceServers: 0,
    };
  } finally {
    failSenderCommit = false;
    stage("cleanup");
    commitGate?.resume.resolve();
    for (const session of sessions) await close(session);
    await storeA.close();
    await storeB.close();
  }
}
