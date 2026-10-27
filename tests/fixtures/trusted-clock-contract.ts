import {
  createIdentity,
  nonce,
  type SessionBinding,
} from "../../packages/peer-protocol/src/auth";
import type { ClockReading } from "../../packages/peer-protocol/src/clock-diagnostics";
import { CurrentTrustClockDiagnostics } from "../../packages/peer-protocol/src/trusted-clock";
import { TrustedReplica } from "../../packages/peer-protocol/src/trusted";
import type { ReplicaStore } from "../../packages/peer-protocol/src/durable";
import type { StoreFactory } from "./peer-store-contract";

const BASE = 1800000000000;
const library = "synthetic-clock-trust";
const assert = (ok: unknown, label: string) => {
  if (!ok) throw new Error(`Trusted clock fixture: ${label}`);
};
const rejects = async (run: () => Promise<unknown>, label: string) => {
  try {
    await run();
  } catch {
    return;
  }
  throw new Error(`Trusted clock fixture: ${label}`);
};
class FakeClock {
  value: ClockReading = { wall: BASE, mono: 10000 };
  at(ms: number) {
    this.value = { wall: BASE + ms, mono: 10000 + ms };
  }
  read = () => ({ ...this.value });
}
const binding = (left: string, right: string): SessionBinding => ({
  version: 1,
  libraryId: library,
  sessionId: nonce(),
  initiatorId: left,
  responderId: right,
  initiatorNonce: nonce(),
  responderNonce: nonce(),
  offerHash: nonce(),
  answerHash: nonce(),
  expiresAt: BASE + 300000,
});
async function heldVerify(
  run: (entered: Promise<void>, release: () => void) => Promise<void>,
) {
  const method = crypto.subtle.verify;
  const original = method.bind(crypto.subtle);
  let signal!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => (signal = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  crypto.subtle.verify = async (...args) => {
    signal();
    await gate;
    return original(...args);
  };
  try {
    await run(entered, release);
  } finally {
    release();
    crypto.subtle.verify = method;
  }
}

/** Shared synthetic contract, run against actual SQLite and IndexedDB adapters. */
export async function runTrustedClockContract(factory: StoreFactory) {
  const alice = await createIdentity();
  const bob = await createIdentity();
  const stores = new Set<ReplicaStore>();
  const open = (name: string) => {
    const store = factory(name);
    stores.add(store);
    return store;
  };
  const as = open("alice"),
    bs = open("bob"),
    ac = new FakeClock(),
    bc = new FakeClock(),
    at = new TrustedReplica(as, library, alice.deviceId),
    bt = new TrustedReplica(bs, library, bob.deviceId),
    a = new CurrentTrustClockDiagnostics(as, library, alice, ac.read),
    b = new CurrentTrustClockDiagnostics(bs, library, bob, bc.read);
  let count = 0;
  try {
    const first = binding(alice.deviceId, bob.deviceId);
    await rejects(() => a.begin(first), "unpaired begin accepted");
    await at.confirmPeer(bob);
    const request = await a.begin(first);
    await rejects(
      () => b.respond(request, first),
      "incoming probe paired peer",
    );
    await bt.confirmPeer(alice);
    const oldTrust = await at.confirmedClockPeer(bob.deviceId);
    count++;

    const beforeA = (await as.read(null, [])).revision;
    const beforeB = (await bs.read(null, [])).revision;
    bc.at(10);
    const reply = await b.respond(request, first);
    ac.at(100);
    const result = await a.complete(reply, first);
    assert(
      result.kind === "peer-relative-observation" &&
        result.assessment === "within-relative-bound" &&
        result.lowerOffsetMs <= 0 &&
        result.upperOffsetMs >= 0,
      "ordinary signed observation",
    );
    assert(
      (await as.read(null, [])).revision === beforeA &&
        (await bs.read(null, [])).revision === beforeB,
      "diagnostic wrote durable state",
    );
    const untouched = await as.read(null, [
      "meta/clock",
      "meta/session-count",
      `claim/${first.sessionId}`,
    ]);
    assert(
      untouched.rows.length === 0,
      "diagnostic claimed a session or clock",
    );
    count++;

    ac.at(200);
    const second = binding(alice.deviceId, bob.deviceId);
    const pending = await a.begin(second);
    bc.at(210);
    const oldReply = await b.respond(pending, second);
    await at.revokePeer(bob.deviceId);
    ac.at(300);
    await rejects(() => a.complete(oldReply, second), "revoked reply accepted");
    await at.confirmPeer(bob);
    await rejects(
      () => a.complete(oldReply, second),
      "reconfirmation revived old challenge",
    );
    const currentTrust = await at.confirmedClockPeer(bob.deviceId);
    let entered!: () => void;
    let release!: () => void;
    const reachedRead = new Promise<void>((resolve) => (entered = resolve));
    const readGate = new Promise<void>((resolve) => (release = resolve));
    const delayed: ReplicaStore = {
      read: async (noteId, keys) => {
        const snapshot = await as.read(noteId, keys);
        if (keys.includes(`trust/${bob.deviceId}`)) {
          entered();
          await readGate;
        }
        return snapshot;
      },
      commit: (revision, changes) => as.commit(revision, changes),
      close: async () => {},
    };
    const guard = new TrustedReplica(delayed, library, alice.deviceId);
    const mutableExpected = {
      peerId: oldTrust.peerId,
      spki: oldTrust.spki,
      generation: oldTrust.generation,
    };
    const checking = guard.assertConfirmedClockPeer(mutableExpected);
    await reachedRead;
    mutableExpected.generation = currentTrust.generation;
    release();
    await rejects(
      () => checking,
      "mutated expected generation bypassed durable trust",
    );
    ac.at(400);
    const fresh = binding(alice.deviceId, bob.deviceId);
    const freshProbe = await a.begin(fresh);
    bc.at(410);
    const freshReply = await b.respond(freshProbe, fresh);
    ac.at(500);
    assert(
      (await a.complete(freshReply, fresh)).assessment ===
        "within-relative-bound",
      "fresh confirmation failed",
    );
    count++;

    ac.at(600);
    const race = binding(alice.deviceId, bob.deviceId);
    const raceProbe = await a.begin(race);
    bc.at(610);
    await heldVerify(async (entered, release) => {
      const response = b.respond(raceProbe, race);
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          entered,
          new Promise<never>((_, reject) => {
            watchdog = setTimeout(() => reject(Error("verify watchdog")), 3000);
          }),
        ]);
      } finally {
        clearTimeout(watchdog);
      }
      await bt.revokePeer(alice.deviceId);
      release();
      await rejects(() => response, "revocation during verify returned reply");
    });
    await rejects(() => b.respond(raceProbe, race), "revoked peer retried");
    count++;

    return { count, realNotesUsed: false, durableDiagnosticWrites: 0 };
  } finally {
    await Promise.all([...stores].map((store) => store.close()));
  }
}
