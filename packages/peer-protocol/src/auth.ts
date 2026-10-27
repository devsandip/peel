// M0 session-binding primitives. No pairing UI, keystore, signaling or active app sync.
export const SESSION_LIFETIME_MS = 5 * 60 * 1000;
const hex64 = /^[0-9a-f]{64}$/;
const id = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export interface PublicIdentity {
  deviceId: string;
  publicKey: CryptoKey;
}
export interface DeviceIdentity extends PublicIdentity {
  privateKey: CryptoKey;
}
export interface SessionBinding {
  version: 1;
  libraryId: string;
  sessionId: string;
  initiatorId: string;
  responderId: string;
  initiatorNonce: string;
  responderNonce: string;
  offerHash: string;
  answerHash: string;
  expiresAt: number;
}
export interface SessionProof {
  signerId: string;
  binding: SessionBinding;
  signature: string;
}
const encode = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
const decode = (hex: string) =>
  Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
export const nonce = () =>
  encode(crypto.getRandomValues(new Uint8Array(32)).buffer);
export const hashDescription = async (description: string) => {
  const bytes = new TextEncoder().encode(description);
  if (!bytes.length || bytes.length > 65536)
    throw new Error("Invalid session description size");
  return encode(await crypto.subtle.digest("SHA-256", bytes));
};
const checkPublic = (key: CryptoKey) => {
  if (
    key.type !== "public" ||
    key.algorithm.name !== "ECDSA" ||
    (key.algorithm as EcKeyAlgorithm).namedCurve !== "P-256" ||
    !key.usages.includes("verify")
  )
    throw new Error("Unsupported peer key");
};
export async function publicIdentity(
  publicKey: CryptoKey,
): Promise<PublicIdentity> {
  checkPublic(publicKey);
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return {
    deviceId: encode(await crypto.subtle.digest("SHA-256", spki)),
    publicKey,
  };
}
export async function createIdentity(): Promise<DeviceIdentity> {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  return {
    ...(await publicIdentity(keys.publicKey)),
    privateKey: keys.privateKey,
  };
}
export async function exportPublic(identity: PublicIdentity): Promise<string> {
  return encode(await crypto.subtle.exportKey("spki", identity.publicKey));
}
export async function importPublic(spkiHex: string): Promise<PublicIdentity> {
  if (!/^[0-9a-f]{2,2048}$/.test(spkiHex) || spkiHex.length % 2)
    throw new Error("Invalid peer public key");
  const publicKey = await crypto.subtle.importKey(
    "spki",
    decode(spkiHex),
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["verify"],
  );
  return publicIdentity(publicKey);
}
function canonical(binding: SessionBinding) {
  if (
    binding.version !== 1 ||
    typeof binding.libraryId !== "string" ||
    !id.test(binding.libraryId) ||
    !hex64.test(binding.sessionId) ||
    ![
      binding.initiatorId,
      binding.responderId,
      binding.initiatorNonce,
      binding.responderNonce,
      binding.offerHash,
      binding.answerHash,
    ].every((v) => typeof v === "string" && hex64.test(v)) ||
    binding.initiatorId === binding.responderId ||
    binding.initiatorNonce === binding.responderNonce ||
    !Number.isSafeInteger(binding.expiresAt) ||
    binding.expiresAt < 0
  )
    throw new Error("Invalid session binding");
  return JSON.stringify([
    "Peel peer session v1",
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
  ]);
}
const signedBytes = (binding: SessionBinding, signerId: string) =>
  new TextEncoder().encode(JSON.stringify([canonical(binding), signerId]));
export function validateSessionBinding(binding: SessionBinding): void {
  canonical(binding);
}
export async function signSession(
  identity: DeviceIdentity,
  binding: SessionBinding,
): Promise<SessionProof> {
  const snapshot = structuredClone(binding);
  const signerId = identity.deviceId,
    privateKey = identity.privateKey;
  if (
    ![snapshot.initiatorId, snapshot.responderId].includes(signerId) ||
    privateKey.extractable
  )
    throw new Error("Invalid session signer");
  const signature = encode(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      signedBytes(snapshot, signerId),
    ),
  );
  return { signerId, binding: snapshot, signature };
}

/** Importing keys does not pair them. Only add a key after out-of-band confirmation. */
export class SessionVerifier {
  private peers = new Map<string, CryptoKey>();
  private consumed = new Map<string, number>();
  private generation = 0;
  constructor(
    private libraryId: string,
    private localDeviceId: string,
    private clock = () => Date.now(),
  ) {
    if (
      typeof libraryId !== "string" ||
      !id.test(libraryId) ||
      !hex64.test(localDeviceId)
    )
      throw new Error("Invalid local peer identity");
  }
  async addConfirmedPeer(identity: PublicIdentity) {
    const key = identity.publicKey,
      claimed = identity.deviceId;
    const generation = this.generation;
    if (
      (await publicIdentity(key)).deviceId !== claimed ||
      claimed === this.localDeviceId
    )
      throw new Error("Peer key identity mismatch");
    if (generation !== this.generation)
      throw new Error("Peer registry changed; confirm again");
    this.peers.set(claimed, key);
    this.generation++;
  }
  revoke(deviceId: string) {
    this.peers.delete(deviceId);
    this.generation++;
  }
  async verify(
    proof: SessionProof,
    expected: SessionBinding,
  ): Promise<boolean> {
    try {
      const packet = structuredClone(proof),
        local = structuredClone(expected);
      const transcript = canonical(local);
      if (
        transcript !== canonical(packet.binding) ||
        local.libraryId !== this.libraryId ||
        !/^[0-9a-f]{128}$/.test(packet.signature)
      )
        return false;
      const peerId =
        local.initiatorId === this.localDeviceId
          ? local.responderId
          : local.responderId === this.localDeviceId
            ? local.initiatorId
            : null;
      if (!peerId || packet.signerId !== peerId) return false;
      const key = this.peers.get(peerId),
        generation = this.generation;
      if (!key) return false;
      const localNonce =
        local.initiatorId === this.localDeviceId
          ? local.initiatorNonce
          : local.responderNonce;
      const current = () => {
        const now = this.clock();
        return (
          Number.isSafeInteger(now) &&
          now < local.expiresAt &&
          local.expiresAt - now <= SESSION_LIFETIME_MS
        );
      };
      if (!current()) return false;
      const valid = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key,
        decode(packet.signature),
        signedBytes(local, peerId),
      );
      if (
        !valid ||
        !current() ||
        generation !== this.generation ||
        this.peers.get(peerId) !== key
      )
        return false;
      const now = this.clock();
      for (const [challenge, expiry] of this.consumed)
        if (expiry <= now) this.consumed.delete(challenge);
      if (this.consumed.has(localNonce) || this.consumed.size >= 4096)
        return false;
      this.consumed.set(localNonce, local.expiresAt);
      return true;
    } catch {
      return false;
    }
  }
}
