import type { ReplicaStore } from "./durable";
import {
  ClockDiagnostics,
  type ClockProbe,
  type ClockReading,
  type ClockReply,
} from "./clock-diagnostics";
import {
  validateSessionBinding,
  type DeviceIdentity,
  type SessionBinding,
} from "./auth";
import { TrustedReplica, type ConfirmedClockPeer } from "./trusted";

/** Pre-session M0 diagnostics. Durable trust is checked; no session or note access is granted. */
export class CurrentTrustClockDiagnostics {
  private diagnostics: ClockDiagnostics;
  private trusted: TrustedReplica;
  private installed = new Map<string, string>();
  private installs: Promise<void> = Promise.resolve();
  private deviceId: string;

  constructor(
    store: ReplicaStore,
    libraryId: string,
    identity: DeviceIdentity,
    clock?: () => ClockReading,
  ) {
    this.deviceId = identity.deviceId;
    this.trusted = new TrustedReplica(store, libraryId, identity.deviceId);
    this.diagnostics = new ClockDiagnostics(libraryId, identity, clock);
  }

  private peer(binding: SessionBinding): string {
    validateSessionBinding(binding);
    if (binding.initiatorId === this.deviceId) return binding.responderId;
    if (binding.responderId === this.deviceId) return binding.initiatorId;
    throw new Error("Clock binding does not include local device");
  }

  private async install(current: ConfirmedClockPeer): Promise<void> {
    // Serialize registry changes only. Independent diagnostic crypto remains concurrent.
    const previous = this.installs;
    let release!: () => void;
    this.installs = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      const token = `${current.generation}/${current.spki}`;
      if (this.installed.get(current.peerId) !== token) {
        await this.diagnostics.addConfirmedPeer(current.identity);
        this.installed.set(current.peerId, token);
      }
    } finally {
      release();
    }
  }

  private async run<T>(
    expected: SessionBinding,
    operation: (binding: SessionBinding) => Promise<T>,
  ): Promise<T> {
    const binding = structuredClone(expected);
    const peerId = this.peer(binding);
    const current = await this.trusted.confirmedClockPeer(peerId);
    await this.install(current);
    try {
      return await operation(binding);
    } finally {
      try {
        await this.trusted.assertConfirmedClockPeer(current);
      } catch (error) {
        this.diagnostics.revoke(peerId);
        this.installed.delete(peerId);
        throw error;
      }
    }
  }

  begin(binding: SessionBinding): Promise<ClockProbe> {
    return this.run(binding, (expected) => this.diagnostics.begin(expected));
  }

  respond(probe: ClockProbe, binding: SessionBinding): Promise<ClockReply> {
    const packet = structuredClone(probe);
    return this.run(binding, (expected) =>
      this.diagnostics.respond(packet, expected),
    );
  }

  complete(reply: ClockReply, binding: SessionBinding) {
    const packet = structuredClone(reply);
    return this.run(binding, (expected) =>
      this.diagnostics.complete(packet, expected),
    );
  }
}
