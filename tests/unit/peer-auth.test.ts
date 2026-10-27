import { beforeAll, describe, expect, it } from "vitest";
import {
  createIdentity,
  publicIdentity,
  exportPublic,
  importPublic,
  hashDescription,
  nonce,
  signSession,
  SessionVerifier,
  SESSION_LIFETIME_MS,
  type DeviceIdentity,
  type SessionBinding,
} from "../../packages/peer-protocol/src/auth";
let mac: DeviceIdentity, phone: DeviceIdentity;
const now = 1793030400000;
const binding = (): SessionBinding => ({
  version: 1,
  libraryId: "library-1",
  sessionId: nonce(),
  initiatorId: mac.deviceId,
  responderId: phone.deviceId,
  initiatorNonce: nonce(),
  responderNonce: nonce(),
  offerHash: "a".repeat(64),
  answerHash: "b".repeat(64),
  expiresAt: now + 60000,
});
const verifier = () =>
  new SessionVerifier("library-1", mac.deviceId, () => now);
beforeAll(async () => {
  mac = await createIdentity();
  phone = await createIdentity();
});
describe("M0 signed peer session binding, AC-21 partial", () => {
  it("keeps private keys non-extractable and preserves public identity through SPKI", async () => {
    expect(mac.privateKey.extractable).toBe(false);
    await expect(
      crypto.subtle.exportKey("pkcs8", mac.privateKey),
    ).rejects.toThrow();
    const imported = await importPublic(await exportPublic(mac));
    expect(imported.deviceId).toBe(mac.deviceId);
    expect((await publicIdentity(mac.publicKey)).deviceId).toBe(mac.deviceId);
    await expect(importPublic("0")).rejects.toThrow();
    await expect(hashDescription("x".repeat(65537))).rejects.toThrow("size");
  });
  it("requires an existing confirmed pairing and rejects reflected local proofs", async () => {
    const expected = binding(),
      check = verifier();
    const proof = await signSession(phone, expected);
    expect(await check.verify(proof, expected)).toBe(false);
    await check.addConfirmedPeer(phone);
    expect(await check.verify(await signSession(mac, expected), expected)).toBe(
      false,
    );
    expect(await check.verify(proof, expected)).toBe(true);
    expect(await check.verify(proof, expected)).toBe(false);
  });
  it("binds both identities, challenges, library, descriptions and expiry to the signature", async () => {
    const expected = binding();
    const proof = await signSession(phone, expected);
    const changes = [
      { libraryId: "other-library" },
      { sessionId: nonce() },
      { initiatorId: "c".repeat(64) },
      { responderId: "d".repeat(64) },
      { initiatorNonce: nonce() },
      { responderNonce: nonce() },
      { offerHash: "c".repeat(64) },
      { answerHash: "d".repeat(64) },
      { expiresAt: expected.expiresAt + 1 },
    ];
    for (const change of changes) {
      const check = verifier();
      await check.addConfirmedPeer(phone);
      const tampered = { ...proof, binding: { ...expected, ...change } };
      expect(await check.verify(tampered, expected)).toBe(false);
      expect(await check.verify(tampered, tampered.binding)).toBe(false);
      // A failed attempt never consumes the valid local challenge.
      expect(await check.verify(proof, expected)).toBe(true);
    }
  });
  it("rejects expiry, excessive lifetime, malformed signatures and a swapped public key", async () => {
    const check = verifier();
    await check.addConfirmedPeer(phone);
    for (const expiresAt of [now, now - 1, now + SESSION_LIFETIME_MS + 1]) {
      const expected = { ...binding(), expiresAt };
      expect(
        await check.verify(await signSession(phone, expected), expected),
      ).toBe(false);
    }
    const expected = binding(),
      proof = await signSession(phone, expected);
    expect(await check.verify({ ...proof, signature: "00" }, expected)).toBe(
      false,
    );
    expect(
      await check.verify({ ...proof, signature: "0".repeat(128) }, expected),
    ).toBe(false);
    await expect(
      check.addConfirmedPeer({
        deviceId: phone.deviceId,
        publicKey: mac.publicKey,
      }),
    ).rejects.toThrow("mismatch");
  });
  it("consumes a challenge exactly once under concurrent verification and across session IDs", async () => {
    const check = verifier();
    await check.addConfirmedPeer(phone);
    const expected = binding(),
      proof = await signSession(phone, expected);
    const outcomes = await Promise.all([
      check.verify(proof, expected),
      check.verify(proof, expected),
    ]);
    expect(outcomes.sort()).toEqual([false, true]);
    const reused = { ...expected, sessionId: nonce(), responderNonce: nonce() };
    expect(await check.verify(await signSession(phone, reused), reused)).toBe(
      false,
    );
  });
  it("revocation cancels pending verification and a pending pairing cannot restore a revoked key", async () => {
    const check = verifier();
    await check.addConfirmedPeer(phone);
    const expected = binding(),
      proof = await signSession(phone, expected);
    const pending = check.verify(proof, expected);
    check.revoke(phone.deviceId);
    expect(await pending).toBe(false);
    expect(await check.verify(proof, expected)).toBe(false);
    const pairing = check.addConfirmedPeer(phone);
    check.revoke(phone.deviceId);
    await expect(pairing).rejects.toThrow("registry changed");
  });
  it("snapshots transcript data before signing and verifying asynchronously", async () => {
    const expected = binding(),
      original = structuredClone(expected);
    const signing = signSession(phone, expected);
    expected.offerHash = "c".repeat(64);
    const proof = await signing;
    const check = verifier();
    await check.addConfirmedPeer(phone);
    const verifying = check.verify(proof, original);
    original.answerHash = "d".repeat(64);
    proof.signature = "0".repeat(128);
    expect(await verifying).toBe(true);
  });
});
