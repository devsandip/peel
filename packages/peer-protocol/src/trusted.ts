import {
  exportPublic,
  importPublic,
  SessionVerifier,
  SESSION_LIFETIME_MS,
  validateSessionBinding,
  type PublicIdentity,
  type SessionBinding,
  type SessionProof,
} from "./auth";
import {
  DurableReplica,
  nextStoreIdentity,
  STORE_PROTOCOL_VERSION,
  validateStoreIdentity,
  type Change,
  type Delivery,
  type ReplicaStore,
  type Snapshot,
} from "./durable";
import type { Edit, Purge } from "./index";
import {
  PeerInventory,
  type InventoryCursor,
  type PendingItem,
} from "./inventory";

// Isolated M0 authorization boundary. No application pairing or keystore.
const identityKey = "meta/identity",
  countKey = "meta/session-count",
  wallKey = "meta/session-wall",
  peerCountKey = "meta/trust-count";
const device = (id: string) => {
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id))
    throw new Error("Invalid authenticated device ID");
};
const value = <T>(snapshot: Snapshot, key: string) =>
  snapshot.rows.find((row) => row.key === key)?.value as T | undefined;
const put = (key: string, data: unknown): Change => ({
  key,
  row: { key, value: data },
});
interface Trust {
  peerId: string;
  spki: string;
  generation: number;
  confirmed: boolean;
}
interface Claim {
  sessionId: string;
  peerId: string;
  challenge: string;
  expiresAt: number;
  trustGeneration: number;
  status: "claimed" | "closed";
}
/** The object is an opaque instance-local handle, not a bearer token for storage or the wire. */
export interface PeerSession {
  readonly sessionId: string;
  readonly peerId: string;
  readonly expiresAt: number;
}
interface Capability extends PeerSession {
  spki: string;
  trustGeneration: number;
  active: boolean;
}
/** A read-only snapshot, not a session or note authorization capability. */
export interface ConfirmedClockPeer {
  peerId: string;
  spki: string;
  generation: number;
  identity: PublicIdentity;
}
function trust(snapshot: Snapshot, peerId: string): Trust | undefined {
  const row = snapshot.rows.find((row) => row.key === `trust/${peerId}`);
  if (!row) return undefined;
  const entry = row.value as Trust;
  if (
    !entry ||
    entry.peerId !== peerId ||
    typeof entry.spki !== "string" ||
    !/^[0-9a-f]{2,2048}$/.test(entry.spki) ||
    entry.spki.length % 2 ||
    !Number.isSafeInteger(entry.generation) ||
    entry.generation < 1 ||
    typeof entry.confirmed !== "boolean"
  )
    throw new Error("Unrecognized durable peer trust");
  return entry;
}
const counter = (snapshot: Snapshot, key: string) => {
  const row = snapshot.rows.find((row) => row.key === key);
  const current = row ? (row.value as number) : 0;
  if (!Number.isSafeInteger(current) || current < 0)
    throw new Error("Invalid authorization counter");
  return current;
};

export class TrustedReplica {
  private capabilities = new WeakMap<PeerSession, Capability>();
  constructor(
    private store: ReplicaStore,
    private libraryId: string,
    private deviceId: string,
    private clock = () => Date.now(),
  ) {
    device(deviceId);
    new SessionVerifier(libraryId, deviceId, clock);
  }
  private async read(noteId: string | null, keys: string[]) {
    const snapshot = await this.store.read(noteId, [identityKey, ...keys]);
    validateStoreIdentity(snapshot, this.libraryId, this.deviceId);
    return snapshot;
  }
  /** Only a previously confirmed durable key may enter pre-session clock diagnostics. */
  async confirmedClockPeer(peerId: string): Promise<ConfirmedClockPeer> {
    device(peerId);
    if (peerId === this.deviceId)
      throw new Error("Cannot diagnose the local device as a peer");
    const snapshot = await this.read(null, [`trust/${peerId}`]);
    const entry = trust(snapshot, peerId);
    if (!entry?.confirmed) throw new Error("Peer is not currently trusted");
    const identity = await importPublic(entry.spki);
    if (identity.deviceId !== peerId)
      throw new Error("Stored peer key mismatch");
    const result = {
      peerId,
      spki: entry.spki,
      generation: entry.generation,
      identity,
    };
    await this.assertConfirmedClockPeer(result);
    return result;
  }
  /** Recheck after asynchronous diagnostic work, before exposing its result. */
  async assertConfirmedClockPeer(
    expected: Pick<ConfirmedClockPeer, "peerId" | "spki" | "generation">,
  ): Promise<void> {
    const { peerId, spki, generation } = expected;
    device(peerId);
    const snapshot = await this.read(null, [`trust/${peerId}`]);
    const entry = trust(snapshot, peerId);
    if (
      !entry?.confirmed ||
      entry.spki !== spki ||
      entry.generation !== generation
    )
      throw new Error("Peer clock diagnostic trust changed");
  }
  private async transact<T>(
    keys: string[],
    transition: (
      snapshot: Snapshot,
    ) => Promise<{ changes: Change[]; result: T }>,
  ) {
    for (let attempt = 0; attempt < 32; attempt++) {
      const snapshot = await this.read(null, keys);
      const next = await transition(snapshot);
      if (
        await this.store.commit(snapshot.revision, [
          put(
            identityKey,
            nextStoreIdentity(snapshot, this.libraryId, this.deviceId),
          ),
          ...(validateStoreIdentity(snapshot, this.libraryId, this.deviceId)
            ?.schema !== STORE_PROTOCOL_VERSION
            ? [{ key: "meta/inventory-cursor-key", row: null }]
            : []),
          ...next.changes,
        ])
      )
        return next.result;
    }
    throw new Error("Peer authorization store busy; retry");
  }
  /** Only call after out-of-band user confirmation. Incoming proofs cannot add a peer. */
  async confirmPeer(input: PublicIdentity) {
    const claimedId = input.deviceId;
    device(claimedId);
    if (claimedId === this.deviceId)
      throw new Error("Cannot pair this device with itself");
    const spki = await exportPublic(input);
    if ((await importPublic(spki)).deviceId !== claimedId)
      throw new Error("Peer public identity mismatch");
    return this.transact(
      [`trust/${claimedId}`, peerCountKey],
      async (snapshot) => {
        const previous = trust(snapshot, claimedId);
        const count = counter(snapshot, peerCountKey);
        if (!previous && count >= 64)
          throw new Error("M0 trust capacity reached");
        const generation = (previous?.generation ?? 0) + 1;
        if (!Number.isSafeInteger(generation))
          throw new Error("Trust generation exhausted");
        return {
          changes: [
            put(`trust/${claimedId}`, {
              peerId: claimedId,
              spki,
              generation,
              confirmed: true,
            } satisfies Trust),
            put(peerCountKey, count + (previous ? 0 : 1)),
          ],
          result: generation,
        };
      },
    );
  }
  async revokePeer(peerId: string) {
    device(peerId);
    return this.transact([`trust/${peerId}`], async (snapshot) => {
      const previous = trust(snapshot, peerId);
      if (!previous) throw new Error("Peer is not paired");
      const generation = previous.generation + 1;
      if (!Number.isSafeInteger(generation))
        throw new Error("Trust generation exhausted");
      return {
        changes: [
          put(`trust/${peerId}`, { ...previous, generation, confirmed: false }),
        ],
        result: generation,
      };
    });
  }
  async authorizeSession(
    input: SessionProof,
    expected: SessionBinding,
  ): Promise<PeerSession> {
    const proof = structuredClone(input),
      binding = structuredClone(expected);
    validateSessionBinding(binding);
    const peerId =
      binding.initiatorId === this.deviceId
        ? binding.responderId
        : binding.responderId === this.deviceId
          ? binding.initiatorId
          : "";
    device(peerId);
    if (binding.libraryId !== this.libraryId || proof.signerId !== peerId)
      throw new Error("Session identity mismatch");
    const challenge =
      binding.initiatorId === this.deviceId
        ? binding.initiatorNonce
        : binding.responderNonce;
    const claimKey = `claim/${binding.sessionId}`,
      nonceKey = `nonce/${challenge}`;
    const capability = await this.transact(
      [`trust/${peerId}`, claimKey, nonceKey, countKey, wallKey],
      async (snapshot) => {
        const entry = trust(snapshot, peerId);
        if (!entry?.confirmed) throw new Error("Peer is not currently trusted");
        if (
          snapshot.rows.some(
            (row) => row.key === nonceKey || row.key === claimKey,
          )
        )
          throw new Error("Session challenge already consumed");
        const count = counter(snapshot, countKey);
        if (count >= 4096) throw new Error("M0 session claim capacity reached");
        const verifier = new SessionVerifier(
          this.libraryId,
          this.deviceId,
          this.clock,
        );
        const identity = await importPublic(entry.spki);
        if (identity.deviceId !== peerId)
          throw new Error("Stored peer key mismatch");
        await verifier.addConfirmedPeer(identity);
        if (!(await verifier.verify(proof, binding)))
          throw new Error("Session proof rejected");
        const now = this.clock();
        if (
          !Number.isSafeInteger(now) ||
          now < counter(snapshot, wallKey) ||
          now >= binding.expiresAt ||
          binding.expiresAt - now > SESSION_LIFETIME_MS
        )
          throw new Error("Session expired or clock needs repair");
        const claim: Claim = {
          sessionId: binding.sessionId,
          peerId,
          challenge,
          expiresAt: binding.expiresAt,
          trustGeneration: entry.generation,
          status: "claimed",
        };
        return {
          changes: [
            put(nonceKey, claim),
            put(claimKey, claim),
            put(countKey, count + 1),
            put(wallKey, now),
          ],
          result: {
            sessionId: binding.sessionId,
            peerId,
            expiresAt: binding.expiresAt,
            spki: entry.spki,
            trustGeneration: entry.generation,
            active: true,
          } satisfies Capability,
        };
      },
    );
    const handle = Object.freeze({
      sessionId: capability.sessionId,
      peerId: capability.peerId,
      expiresAt: capability.expiresAt,
    });
    this.capabilities.set(handle, capability);
    return handle;
  }
  private capability(handle: PeerSession) {
    const current = this.capabilities.get(handle);
    if (!current?.active)
      throw new Error("Session handle is not active on this instance");
    return current;
  }
  private check(snapshot: Snapshot, capability: Capability) {
    const entry = trust(snapshot, capability.peerId);
    const claim = value<Claim>(snapshot, `claim/${capability.sessionId}`);
    const now = this.clock();
    if (
      !capability.active ||
      !entry?.confirmed ||
      entry.generation !== capability.trustGeneration ||
      entry.spki !== capability.spki ||
      !claim ||
      claim.status !== "claimed" ||
      claim.sessionId !== capability.sessionId ||
      claim.peerId !== capability.peerId ||
      claim.trustGeneration !== capability.trustGeneration ||
      claim.expiresAt !== capability.expiresAt ||
      !Number.isSafeInteger(now) ||
      now < counter(snapshot, wallKey) ||
      now >= capability.expiresAt
    )
      throw new Error("Session expired, closed or peer trust changed");
  }
  private scoped(handle: PeerSession) {
    const capability = this.capability(handle);
    const keys = [
      `trust/${capability.peerId}`,
      `claim/${capability.sessionId}`,
      wallKey,
    ];
    const scoped: ReplicaStore = {
      read: async (noteId, requested) => {
        const snapshot = await this.read(noteId, [...requested, ...keys]);
        this.check(snapshot, capability);
        return snapshot;
      },
      commit: async (revision, changes) => {
        const current = await this.read(null, keys);
        this.check(current, capability);
        if (current.revision !== revision) return false;
        return this.store.commit(revision, changes);
      },
      close: async () => {},
    };
    if (this.store.scan)
      scoped.scan = async (request) => {
        request = structuredClone(request);
        if (request.phase === "pending" && request.peerId !== capability.peerId)
          throw new Error("Session cannot enumerate another peer's delivery");
        this.check(await this.read(null, keys), capability);
        const page = await this.store.scan!(request);
        this.check(await this.read(null, keys), capability);
        return page;
      };
    return {
      engine: new DurableReplica(scoped, this.libraryId, this.deviceId),
      inventory: new PeerInventory(scoped, this.libraryId, this.deviceId),
      capability,
    };
  }
  async inventoryPage(
    handle: PeerSession,
    cursor: InventoryCursor | null = null,
    limit = 32,
  ) {
    const page = await this.scoped(handle).inventory.inventoryPage(
      cursor,
      limit,
    );
    await this.assertCurrent(handle);
    return page;
  }
  async pendingPage(
    handle: PeerSession,
    cursor: InventoryCursor | null = null,
    limit = 32,
  ) {
    const { inventory, capability } = this.scoped(handle);
    const page = await inventory.pendingPage(capability.peerId, cursor, limit);
    await this.assertCurrent(handle);
    return page;
  }
  async resolvePending(handle: PeerSession, reference: PendingItem) {
    const { inventory, capability } = this.scoped(handle);
    const result = await inventory.resolvePending(capability.peerId, reference);
    await this.assertCurrent(handle);
    return result;
  }
  /** Check before handing a frame to transport. Already-sent bytes cannot be recalled. */
  async assertCurrent(handle: PeerSession) {
    const capability = this.capability(handle);
    const snapshot = await this.read(null, [
      `trust/${capability.peerId}`,
      `claim/${capability.sessionId}`,
      wallKey,
    ]);
    this.check(snapshot, capability);
  }
  async applyEdit(handle: PeerSession, edit: Edit, wall: number) {
    const { engine, capability } = this.scoped(handle);
    if (edit.stamp.deviceId !== capability.peerId)
      throw new Error("Only direct authors accepted");
    return engine.applyEdit(edit, wall, new Set([capability.peerId]));
  }
  async applyPurge(handle: PeerSession, purge: Purge) {
    const { engine, capability } = this.scoped(handle);
    if (purge.deviceId !== capability.peerId)
      throw new Error("Only direct authors accepted");
    return engine.applyPurge(purge, new Set([capability.peerId]));
  }
  async acknowledge(
    handle: PeerSession,
    noteId: string,
    generation: string,
    operation: Delivery["kind"],
  ) {
    const { engine, capability } = this.scoped(handle);
    return engine.acknowledge(noteId, generation, capability.peerId, operation);
  }
  async closeSession(handle: PeerSession) {
    const capability = this.capability(handle);
    capability.active = false;
    const key = `claim/${capability.sessionId}`;
    await this.transact([key], async (snapshot) => {
      const claim = value<Claim>(snapshot, key);
      if (
        !claim ||
        claim.peerId !== capability.peerId ||
        claim.trustGeneration !== capability.trustGeneration
      )
        throw new Error("Session claim changed");
      return {
        changes: [put(key, { ...claim, status: "closed" })],
        result: undefined,
      };
    });
  }
}
