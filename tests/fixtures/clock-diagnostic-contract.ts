import {
  createIdentity,
  exportPublic,
  importPublic,
  nonce,
  signSession,
  SessionVerifier,
  type SessionBinding,
} from "../../packages/peer-protocol/src/auth";
import {
  ClockDiagnostics,
  assessClockWindow,
  decodeClockMessage,
  encodeClockMessage,
  type ClockReading,
  type ClockReply,
} from "../../packages/peer-protocol/src/clock-diagnostics";
const BASE = 1800000000000,
  YEAR = 365 * 24 * 60 * 60 * 1000;
const assert = (ok: unknown, label: string) => {
  if (!ok) throw Error(`Clock fixture: ${label}`);
};
const rejects = async (
  run: () => unknown | Promise<unknown>,
  reason?: string,
) => {
  try {
    await run();
  } catch (error) {
    if (reason)
      assert(
        error instanceof Error && error.message.includes(reason),
        "wrong rejection reason",
      );
    return;
  }
  throw Error("Clock fixture: expected rejection");
};
class FakeClock {
  value: ClockReading = { wall: BASE, mono: 10000 };
  queue: ClockReading[] = [];
  at(ms: number, offset = 0) {
    this.value = { wall: BASE + ms + offset, mono: 10000 + ms };
  }
  read = () => ({ ...(this.queue.shift() ?? this.value) });
}
/** Synthetic RPC fixture only. Private keys remain in this runtime's closure. */
export async function createClockEndpoint(offset = 0) {
  const identity = await createIdentity(),
    clock = new FakeClock();
  clock.at(0, offset);
  const diagnostics = new ClockDiagnostics(
    "fixture-library",
    identity,
    clock.read,
  );
  return {
    deviceId: identity.deviceId,
    spki: await exportPublic(identity),
    confirm: async (spki: string) =>
      diagnostics.addConfirmedPeer(await importPublic(spki)),
    at: (ms: number) => clock.at(ms, offset),
    begin: (binding: SessionBinding) => diagnostics.begin(binding),
    respond: (
      request: Parameters<ClockDiagnostics["respond"]>[0],
      binding: SessionBinding,
    ) => diagnostics.respond(request, binding),
    complete: (reply: ClockReply, binding: SessionBinding) =>
      diagnostics.complete(reply, binding),
  };
}
async function setup(offsetA = 0, offsetB = 0) {
  const a = await createIdentity(),
    b = await createIdentity(),
    ac = new FakeClock(),
    bc = new FakeClock();
  ac.at(0, offsetA);
  bc.at(0, offsetB);
  const left = new ClockDiagnostics("fixture-library", a, ac.read),
    right = new ClockDiagnostics("fixture-library", b, bc.read);
  await left.addConfirmedPeer(b);
  await right.addConfirmedPeer(a);
  const binding: SessionBinding = {
    version: 1,
    libraryId: "fixture-library",
    sessionId: nonce(),
    initiatorId: a.deviceId,
    responderId: b.deviceId,
    initiatorNonce: nonce(),
    responderNonce: nonce(),
    offerHash: nonce(),
    answerHash: nonce(),
    expiresAt: BASE + 300000,
  };
  return { a, b, ac, bc, left, right, binding };
}
type Pair = Awaited<ReturnType<typeof setup>>;
async function exchange(p: Pair, offsetA = 0, offsetB = 0, roundtrip = 100) {
  const request = await p.left.begin(p.binding);
  p.bc.at(10, offsetB);
  const response = await p.right.respond(
    decodeClockMessage(encodeClockMessage(request)) as typeof request,
    p.binding,
  );
  p.ac.at(roundtrip, offsetA);
  return {
    request,
    response,
    result: await p.left.complete(
      decodeClockMessage(encodeClockMessage(response)) as ClockReply,
      p.binding,
    ),
  };
}
async function heldVerify(
  run: (wait: () => Promise<void>, release: () => void) => Promise<void>,
) {
  const method = crypto.subtle.verify;
  const original = method.bind(crypto.subtle);
  let entered!: () => void, release!: () => void;
  const seen = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  crypto.subtle.verify = async (...args) => {
    entered();
    await gate;
    return original(...args);
  };
  const wait = () =>
    Promise.race([
      seen,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(Error("Clock fixture: verify watchdog")),
          3000,
        );
        seen.then(() => clearTimeout(timer));
      }),
    ]);
  try {
    await run(wait, release);
  } finally {
    release();
    crypto.subtle.verify = method;
  }
}
export async function runClockDiagnosticContract() {
  const checks: string[] = [];
  {
    const p = await setup(),
      { request, response, result } = await exchange(p);
    assert(
      result.assessment === "within-relative-bound" &&
        result.lowerOffsetMs <= 0 &&
        result.upperOffsetMs >= 0 &&
        result.roundtripMs === 100,
      "asymmetric interval",
    );
    assert(
      result.kind === "peer-relative-observation" &&
        !Object.hasOwn(result, "stamp") &&
        !Object.hasOwn(result, "publish"),
      "not publication permission",
    );
    await rejects(() => p.left.complete(response, p.binding));
    await rejects(() => p.right.respond(request, p.binding));
    const verifier = new SessionVerifier(
      "fixture-library",
      p.a.deviceId,
      () => BASE + 100,
    );
    await verifier.addConfirmedPeer(p.b);
    assert(
      !(await verifier.verify(
        {
          signerId: p.b.deviceId,
          binding: p.binding,
          signature: response.signature,
        },
        p.binding,
      )),
      "clock proof cannot become session proof",
    );
    assert(
      await verifier.verify(await signSession(p.b, p.binding), p.binding),
      "diagnostic does not consume authorization challenge",
    );
    checks.push("signed-asymmetric-interval-and-one-use-replay");
  }
  {
    for (const offset of [YEAR, -YEAR]) {
      const p = await setup(0, offset),
        { result } = await exchange(p, 0, offset);
      assert(
        result.assessment === "large-relative-skew" &&
          result.lowerOffsetMs <= offset &&
          result.upperOffsetMs >= offset,
        "year skew",
      );
      const verifier = new SessionVerifier(
        "fixture-library",
        p.b.deviceId,
        () => BASE + offset,
      );
      await verifier.addConfirmedPeer(p.a);
      assert(
        !(await verifier.verify(await signSession(p.a, p.binding), p.binding)),
        "diagnostic did not bypass session expiry",
      );
    }
    const p = await setup(YEAR, YEAR),
      { result } = await exchange(p, YEAR, YEAR);
    assert(
      result.assessment === "within-relative-bound",
      "equally wrong clocks are not UTC proof",
    );
    checks.push("one-year-forward-back-and-both-wrong-no-session-bypass");
  }
  {
    const narrow = assessClockWindow(
      { wall: BASE, mono: 0 },
      { wall: BASE + 100, mono: 100 },
      { peerReceivedWall: BASE + 10, peerSentWall: BASE + 10, peerElapsed: 0 },
    );
    const wide = assessClockWindow(
      { wall: BASE, mono: 0 },
      { wall: BASE + 2000, mono: 2000 },
      { peerReceivedWall: BASE + 10, peerSentWall: BASE + 10, peerElapsed: 0 },
    );
    const border = assessClockWindow(
      { wall: BASE, mono: 0 },
      { wall: BASE + 100, mono: 100 },
      {
        peerReceivedWall: BASE + 120000,
        peerSentWall: BASE + 120000,
        peerElapsed: 0,
      },
    );
    assert(
      narrow.assessment === "within-relative-bound" &&
        wide.assessment === "uncertain" &&
        border.assessment === "uncertain",
      "uncertainty boundaries",
    );
    for (const response of [
      { peerReceivedWall: BASE, peerSentWall: BASE + 1000, peerElapsed: 0 },
      { peerReceivedWall: BASE, peerSentWall: BASE, peerElapsed: 1000 },
      { peerReceivedWall: NaN, peerSentWall: BASE, peerElapsed: 0 },
    ])
      await rejects(() =>
        assessClockWindow(
          { wall: BASE, mono: 0 },
          { wall: BASE + 100, mono: 100 },
          response,
        ),
      );
    await rejects(() =>
      assessClockWindow(
        { wall: Number.MAX_SAFE_INTEGER, mono: 0 },
        { wall: Number.MAX_SAFE_INTEGER, mono: 0 },
        { peerReceivedWall: 0, peerSentWall: 0, peerElapsed: 0 },
      ),
    );
    checks.push("uncertainty-impossible-duration-and-overflow");
  }
  {
    const p = await setup(),
      request = await p.left.begin(p.binding);
    await rejects(() =>
      p.right.respond({ ...request, signature: "0".repeat(128) }, p.binding),
    );
    await rejects(() =>
      p.right.respond(request, { ...p.binding, answerHash: nonce() }),
    );
    const proof = await signSession(p.a, p.binding);
    await rejects(() =>
      p.right.respond({ ...request, signature: proof.signature }, p.binding),
    );
    const stranger = await createIdentity();
    await rejects(() =>
      p.right.addConfirmedPeer({
        deviceId: p.a.deviceId,
        publicKey: stranger.publicKey,
      }),
    );
    const unpaired = new ClockDiagnostics("fixture-library", p.b, p.bc.read);
    await rejects(() => unpaired.respond(request, p.binding));
    const response = await p.right.respond(request, p.binding);
    await rejects(() =>
      p.left.complete(
        { ...response, peerSentWall: response.peerSentWall + 1 },
        p.binding,
      ),
    );
    await rejects(() => p.left.complete(response, p.binding));
    checks.push("forgery-domain-transcript-confirmation-and-tamper");
  }
  {
    const p = await setup(),
      request = await p.left.begin(p.binding),
      response = await p.right.respond(request, p.binding);
    p.ac.at(100, YEAR);
    await rejects(() => p.left.complete(response, p.binding));
    const q = await setup(),
      probe = await q.left.begin(q.binding);
    q.bc.queue = [
      { wall: BASE, mono: 10000 },
      { wall: BASE - YEAR, mono: 10050 },
    ];
    await rejects(() => q.right.respond(probe, q.binding));
    const r = await setup(),
      req = await r.left.begin(r.binding),
      rep = await r.right.respond(req, r.binding);
    r.ac.at(5000);
    await rejects(() => r.left.complete(rep, r.binding));
    const s = await setup(),
      rq = await s.left.begin(s.binding),
      rp = await s.right.respond(rq, s.binding);
    s.ac.queue = [
      { wall: BASE + 100, mono: 10100 },
      { wall: BASE + 5000, mono: 15000 },
    ];
    await rejects(() => s.left.complete(rp, s.binding));
    checks.push("wall-jumps-expiry-and-post-verification-expiry");
  }
  {
    const p = await setup(),
      req = await p.left.begin(p.binding),
      rep = await p.right.respond(req, p.binding);
    await heldVerify(async (wait, release) => {
      const pending = p.left.complete(rep, p.binding);
      await wait();
      p.left.revoke(p.b.deviceId);
      release();
      await rejects(() => pending);
    });
    const q = await setup(),
      request = await q.left.begin(q.binding);
    const pending = q.right.respond(request, q.binding);
    q.right.revoke(q.a.deviceId);
    await rejects(() => pending);
    checks.push("revocation-during-real-verify-and-response");
  }
  {
    const p = await setup(),
      requests = await Promise.all(
        Array.from({ length: 32 }, () => p.left.begin(p.binding)),
      );
    await rejects(() => p.left.begin(p.binding), "outstanding limit");
    const response = await p.right.respond(requests[0], p.binding);
    p.ac.at(100);
    const outcomes = await Promise.allSettled([
      p.left.complete(response, p.binding),
      p.left.complete(response, p.binding),
    ]);
    assert(
      outcomes.filter((r) => r.status === "fulfilled").length === 1,
      "concurrent completion one use",
    );
    p.ac.at(5000);
    await p.left.begin(p.binding);
    checks.push("outstanding-reservation-concurrency-and-expiry-reclamation");
  }
  {
    const p = await setup();
    for (let index = 0; index < 500; index++) {
      const request = await p.left.begin(p.binding),
        response = await p.right.respond(request, p.binding);
      await p.left.complete(response, p.binding);
    }
    const requests = await Promise.all(
      Array.from({ length: 32 }, () => p.left.begin(p.binding)),
    );
    const responses = Promise.allSettled(
      requests.map((request) => p.right.respond(request, p.binding)),
    );
    await rejects(
      () => p.right.respond(requests[0], p.binding),
      "responder concurrency",
    );
    const completed = await responses;
    assert(
      completed.filter((result) => result.status === "fulfilled").length === 12,
      "concurrent replay capacity never overshoots",
    );
    for (const response of completed)
      if (response.status === "fulfilled")
        await p.left.complete(response.value, p.binding);
    await rejects(async () =>
      p.right.respond(await p.left.begin(p.binding), p.binding),
    );
    checks.push("concurrent-responder-limit-and-actual-replay-capacity-512");
  }
  {
    const p = await setup(),
      request = await p.left.begin(p.binding),
      pristine = encodeClockMessage(request);
    const expected = structuredClone(p.binding);
    const pending = p.right.respond(request, expected);
    expected.answerHash = nonce();
    request.bindingHash = nonce();
    request.from = p.b.deviceId;
    request.signature = "0".repeat(128);
    const response = await pending;
    await p.left.complete(response, p.binding);
    const original = decodeClockMessage(pristine);
    await rejects(() => decodeClockMessage("x".repeat(4097)));
    await rejects(() =>
      decodeClockMessage(JSON.stringify({ ...original, body: "unexpected" })),
    );
    await rejects(() => decodeClockMessage("[]"));
    await rejects(() => decodeClockMessage("{"));
    checks.push("immutable-async-input-and-bounded-body-free-codec");
  }
  return {
    checks,
    count: checks.length,
    simulatedClocks: true,
    realWebCrypto: true,
    applicationDatabasesOpened: 0,
    realNotesUsed: false,
  };
}
