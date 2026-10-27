import {
  createIdentity,
  hashDescription,
  nonce,
  signSession,
  SessionVerifier,
  type SessionBinding,
} from "../../packages/peer-protocol/src/auth";
import {
  decodeClockMessage,
  encodeClockMessage,
  type ClockReading,
} from "../../packages/peer-protocol/src/clock-diagnostics";
import { IndexedDBReplicaStore } from "../../packages/peer-protocol/src/store-idb";
import { TrustedReplica } from "../../packages/peer-protocol/src/trusted";
import { CurrentTrustClockDiagnostics } from "../../packages/peer-protocol/src/trusted-clock";

const BASE = 1800000000000;
const YEAR = 365 * 24 * 60 * 60 * 1000;
const LIBRARY = "synthetic-bound-clock";
function assert(value: unknown, label: string): asserts value {
  if (!value) throw Error(`Bound clock fixture: ${label}`);
}
const rejects = async (run: () => Promise<unknown>, label: string) => {
  try {
    await run();
  } catch {
    return;
  }
  throw Error(`Bound clock fixture: ${label}`);
};
const until = async (predicate: () => boolean, label: string) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start >= 5000)
      throw Error(`Bound clock fixture: timed out ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
class FakeClock {
  value: ClockReading = { wall: BASE, mono: 10000 };
  constructor(private offset: number) {}
  at(ms: number) {
    this.value = { wall: BASE + ms + this.offset, mono: 10000 + ms };
  }
  read = () => ({ ...this.value });
}
class Inbox {
  private queued: string[] = [];
  private waiting: ((value: string) => void) | null = null;
  constructor(channel: RTCDataChannel) {
    channel.onmessage = ({ data }) => {
      if (typeof data !== "string") throw Error("Unexpected binary clock data");
      const waiting = this.waiting;
      if (waiting) {
        this.waiting = null;
        waiting(data);
      } else this.queued.push(data);
    };
  }
  async next(): Promise<string> {
    const queued = this.queued.shift();
    if (queued !== undefined) return queued;
    if (this.waiting) throw Error("Concurrent clock inbox read");
    let timer: ReturnType<typeof setTimeout> | undefined;
    return new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => {
        this.waiting = null;
        reject(Error("Clock packet timeout"));
      }, 3000);
      this.waiting = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
    });
  }
}
async function negotiate() {
  const a = new RTCPeerConnection({ iceServers: [] });
  const b = new RTCPeerConnection({ iceServers: [] });
  const channelA = a.createDataChannel("peel-clock-synthetic", {
    ordered: true,
  });
  const remote = new Promise<RTCDataChannel>((resolve) => {
    b.ondatachannel = ({ channel }) => resolve(channel);
  });
  const gather = async (
    pc: RTCPeerConnection,
    description: RTCSessionDescriptionInit,
  ) => {
    await pc.setLocalDescription(description);
    await until(() => pc.iceGatheringState === "complete", "ICE gathering");
    return pc.localDescription!;
  };
  await b.setRemoteDescription(await gather(a, await a.createOffer()));
  await a.setRemoteDescription(await gather(b, await b.createAnswer()));
  await until(() => channelA.readyState === "open", "data channel open");
  const channelB = await remote;
  await until(() => channelB.readyState === "open", "peer data channel open");
  return { a, b, channelA, channelB, gather };
}
export async function runBoundClockChannelExperiment() {
  const alice = await createIdentity();
  const bob = await createIdentity();
  const suffix = nonce().slice(0, 16);
  const databaseA = `peel-m0-peer-boundclock-a-${suffix}`;
  const databaseB = `peel-m0-peer-boundclock-b-${suffix}`;
  const storeA = new IndexedDBReplicaStore(databaseA);
  const storeB = new IndexedDBReplicaStore(databaseB);
  let connection: Awaited<ReturnType<typeof negotiate>> | undefined;
  const checks: Record<string, boolean> = {};
  try {
    const trustedA = new TrustedReplica(storeA, LIBRARY, alice.deviceId);
    const trustedB = new TrustedReplica(storeB, LIBRARY, bob.deviceId);
    await trustedA.confirmPeer(bob);
    await trustedB.confirmPeer(alice);
    const clockA = new FakeClock(0);
    const clockB = new FakeClock(YEAR);
    clockA.at(0);
    clockB.at(0);
    const diagnosticA = new CurrentTrustClockDiagnostics(
      storeA,
      LIBRARY,
      alice,
      clockA.read,
    );
    const diagnosticB = new CurrentTrustClockDiagnostics(
      storeB,
      LIBRARY,
      bob,
      clockB.read,
    );
    connection = await negotiate();
    const { a, b, channelA, channelB, gather } = connection;
    const inboxA = new Inbox(channelA);
    const inboxB = new Inbox(channelB);
    const session = {
      sessionId: nonce(),
      initiatorNonce: nonce(),
      responderNonce: nonce(),
      expiresAt: BASE + 300000,
    };
    const expected = async (
      pc: RTCPeerConnection,
      initiator: boolean,
    ): Promise<SessionBinding> => ({
      version: 1,
      libraryId: LIBRARY,
      initiatorId: alice.deviceId,
      responderId: bob.deviceId,
      ...session,
      offerHash: await hashDescription(
        (initiator ? pc.localDescription : pc.remoteDescription)!.sdp,
      ),
      answerHash: await hashDescription(
        (initiator ? pc.remoteDescription : pc.localDescription)!.sdp,
      ),
    });
    const expectedA = await expected(a, true);
    const expectedB = await expected(b, false);
    assert(
      expectedA.offerHash === expectedB.offerHash &&
        expectedA.answerHash === expectedB.answerHash,
      "independent installed bindings differ",
    );
    checks.independentInstalledDescriptions = true;
    const installedA = [a.localDescription!.sdp, a.remoteDescription!.sdp];
    const installedB = [b.localDescription!.sdp, b.remoteDescription!.sdp];
    const bound = (pc: RTCPeerConnection, installed: string[]) => {
      if (
        pc.localDescription?.sdp !== installed[0] ||
        pc.remoteDescription?.sdp !== installed[1]
      )
        throw Error("Installed descriptions changed");
    };
    const begin = async () => {
      bound(a, installedA);
      const packet = await diagnosticA.begin(expectedA);
      bound(a, installedA);
      channelA.send(encodeClockMessage(packet));
      return packet;
    };
    const respond = async (binding = expectedB) => {
      const text = await inboxB.next();
      bound(b, installedB);
      const packet = decodeClockMessage(text);
      if (packet.kind !== "clock-probe") throw Error("Expected clock probe");
      const response = await diagnosticB.respond(packet, binding);
      bound(b, installedB);
      channelB.send(encodeClockMessage(response));
      return response;
    };
    const complete = async () => {
      const text = await inboxA.next();
      bound(a, installedA);
      const packet = decodeClockMessage(text);
      if (packet.kind !== "clock-reply") throw Error("Expected clock reply");
      const observation = await diagnosticA.complete(packet, expectedA);
      bound(a, installedA);
      return observation;
    };
    const beforeA = (await storeA.read(null, [])).revision;
    const beforeB = (await storeB.read(null, [])).revision;
    const first = await begin();
    clockB.at(10);
    await respond();
    clockA.at(100);
    const observation = await complete();
    assert(
      observation.assessment === "large-relative-skew" &&
        observation.lowerOffsetMs <= YEAR &&
        observation.upperOffsetMs >= YEAR,
      "signed year-skew interval",
    );
    checks.signedYearSkewAcrossOpenedChannel = true;
    const verifier = new SessionVerifier(
      LIBRARY,
      bob.deviceId,
      () => BASE + YEAR + 100,
    );
    await verifier.addConfirmedPeer(alice);
    assert(
      !(await verifier.verify(await signSession(alice, expectedB), expectedB)),
      "diagnostic bypassed absolute session expiry",
    );
    checks.absoluteSessionExpiryStillRejects = true;
    assert(
      (await storeA.read(null, [])).revision === beforeA &&
        (await storeB.read(null, [])).revision === beforeB,
      "diagnostic wrote durable state",
    );
    checks.noDurableDiagnosticWrite = true;
    await rejects(
      () => diagnosticB.respond(first, expectedB),
      "consumed probe replay accepted",
    );
    checks.consumedProbeReplayRejected = true;

    clockA.at(200);
    await begin();
    clockB.at(210);
    await rejects(
      () => respond({ ...expectedB, offerHash: nonce() }),
      "wrong installed binding accepted",
    );
    checks.wrongBindingRejected = true;
    channelA.send('{"version":1,"kind":"edit"}');
    await rejects(
      async () => decodeClockMessage(await inboxB.next()),
      "non-clock packet decoded",
    );
    checks.nonClockPacketRejected = true;

    clockA.at(300);
    await begin();
    const inFlight = decodeClockMessage(await inboxB.next());
    assert(inFlight.kind === "clock-probe", "expected in-flight probe");
    await trustedB.revokePeer(alice.deviceId);
    clockB.at(310);
    await rejects(
      () => diagnosticB.respond(inFlight, expectedB),
      "revoked peer received a clock reply",
    );
    checks.currentRevocationRejectsInFlight = true;
    const untouchedA = await storeA.read(null, [
      "meta/clock",
      "meta/session-count",
      `claim/${session.sessionId}`,
      "head/synthetic-note",
      "pending/synthetic-note",
    ]);
    const untouchedB = await storeB.read(null, [
      "meta/clock",
      "meta/session-count",
      `claim/${session.sessionId}`,
      "head/synthetic-note",
      "pending/synthetic-note",
    ]);
    assert(
      untouchedA.rows.length === 0 && untouchedB.rows.length === 0,
      "diagnostic touched note/session rows",
    );
    checks.noNoteSessionOrAckRows = true;

    const stats = await a.getStats();
    const transport = [...stats.values()].find(
      (item) => item.type === "transport",
    );
    const pair = stats.get(transport?.selectedCandidatePairId);
    const connectivity = {
      dtlsState: transport?.dtlsState ?? null,
      localCandidateType:
        stats.get(pair?.localCandidateId)?.candidateType ?? null,
      remoteCandidateType:
        stats.get(pair?.remoteCandidateId)?.candidateType ?? null,
    };
    a.createDataChannel("synthetic-renegotiation");
    await b.setRemoteDescription(await gather(a, await a.createOffer()));
    await a.setRemoteDescription(await gather(b, await b.createAnswer()));
    await rejects(
      async () => bound(a, installedA),
      "changed installed descriptions accepted",
    );
    checks.changedInstalledDescriptionsRejected = true;
    return {
      checks,
      connectivity,
      observation,
      confirmedPublicKeysOnly: true,
      privateKeysExported: false,
      applicationDatabasesOpened: 0,
      realNotesUsed: false,
      durableDiagnosticWrites: 0,
    };
  } finally {
    connection?.channelA.close();
    connection?.channelB.close();
    connection?.a.close();
    connection?.b.close();
    await storeA.close();
    await storeB.close();
    for (const name of [databaseA, databaseB])
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(name);
        deletion.onsuccess = () => resolve();
        deletion.onerror = () => reject(deletion.error);
        deletion.onblocked = () =>
          reject(Error("Synthetic database still open"));
      });
  }
}
