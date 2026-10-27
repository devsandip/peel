interface Lease {
  username: string;
  credential: string;
  urls: string[];
}
const limit = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Synthetic relay boundary timed out")),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
};
const gathered = (pc: RTCPeerConnection) =>
  pc.iceGatheringState === "complete"
    ? Promise.resolve()
    : limit(
        new Promise<void>((resolve) => {
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete") resolve();
          });
        }),
        15000,
      );
const configuration = (
  lease: Lease,
  mode: "udp" | "tcp",
): RTCConfiguration => ({
  iceTransportPolicy: "relay",
  iceServers: [
    {
      urls: lease.urls.find((url) => url.endsWith(`transport=${mode}`))!,
      username: lease.username,
      credential: lease.credential,
    },
  ],
});
export async function relayTransfer(lease: Lease, mode: "udp" | "tcp") {
  const a = new RTCPeerConnection(configuration(lease, mode)),
    b = new RTCPeerConnection(configuration(lease, mode));
  let phase = "offer",
    candidatesA = 0,
    candidatesB = 0;
  let partial: Record<string, unknown> | null = null;
  const errorCodes = new Set<number>();
  a.onicecandidate = ({ candidate }) => {
    if (candidate) candidatesA++;
  };
  b.onicecandidate = ({ candidate }) => {
    if (candidate) candidatesB++;
  };
  for (const pc of [a, b])
    pc.onicecandidateerror = (event) => {
      if (event.errorCode >= 0 && event.errorCode <= 999)
        errorCodes.add(event.errorCode);
    };
  try {
    const sender = a.createDataChannel("peel-synthetic-relay", {
      ordered: true,
    });
    const opened = new Promise<void>((resolve) => {
      sender.onopen = () => resolve();
    });
    const source = new TextEncoder().encode(
      "Synthetic relay byte fixture. ".repeat(4000),
    );
    const received = new Uint8Array(source.byteLength);
    let offset = 0,
      frames = 0;
    const complete = new Promise<void>((resolve, reject) => {
      b.ondatachannel = ({ channel }) => {
        channel.binaryType = "arraybuffer";
        channel.onmessage = ({ data }) => {
          if (
            !(data instanceof ArrayBuffer) ||
            data.byteLength > 16384 ||
            offset + data.byteLength > received.length
          ) {
            reject(new Error("Synthetic frame limit"));
            return;
          }
          received.set(new Uint8Array(data), offset);
          offset += data.byteLength;
          frames++;
          if (offset === received.length) resolve();
        };
      };
    });
    void complete.catch(() => {});
    await a.setLocalDescription(await a.createOffer());
    phase = "gather-offer";
    await gathered(a);
    phase = "answer";
    await b.setRemoteDescription(a.localDescription!);
    await b.setLocalDescription(await b.createAnswer());
    phase = "gather-answer";
    await gathered(b);
    phase = "connect";
    await a.setRemoteDescription(b.localDescription!);
    await limit(opened, 20000);
    phase = "transfer";
    sender.bufferedAmountLowThreshold = 32768;
    for (let start = 0; start < source.length; start += 16384) {
      if (sender.bufferedAmount > 65536)
        await limit(
          new Promise<void>((resolve) =>
            sender.addEventListener("bufferedamountlow", () => resolve(), {
              once: true,
            }),
          ),
          10000,
        );
      sender.send(source.slice(start, start + 16384));
    }
    await limit(complete, 15000);
    const hash = async (value: Uint8Array<ArrayBuffer>) =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", value));
    const [expected, actual] = await Promise.all([
      hash(source),
      hash(received),
    ]);
    phase = "statistics";
    const selected = async (pc: RTCPeerConnection) => {
      const stats = await pc.getStats();
      const transport = [...stats.values()].find(
        (value) => value.type === "transport" && value.selectedCandidatePairId,
      );
      const pair = stats.get(transport?.selectedCandidatePairId);
      const local = stats.get(pair?.localCandidateId),
        remote = stats.get(pair?.remoteCandidateId);
      return {
        localCandidateType: local?.candidateType ?? "unknown",
        remoteCandidateType: remote?.candidateType ?? "unknown",
        dtlsConnected: transport?.dtlsState === "connected",
        relayProtocol: local?.relayProtocol ?? "unknown",
      };
    };
    const [endpointA, endpointB] = await Promise.all([
      selected(a),
      selected(b),
    ]);
    const result = {
      mode,
      payloadBytes: source.length,
      frameBytes: 16384,
      frames,
      hashMatches: expected.every((byte, i) => byte === actual[i]),
      endpointA,
      endpointB,
    };
    partial = result;
    if (
      !result.hashMatches ||
      [endpointA, endpointB].some(
        (endpoint) =>
          !endpoint.dtlsConnected ||
          endpoint.localCandidateType !== "relay" ||
          endpoint.relayProtocol !== mode,
      )
    )
      throw new Error("Synthetic forced-relay validation failed");
    return result;
  } catch {
    throw Object.assign(new Error("Synthetic relay stage failed"), {
      diagnostic: {
        mode,
        phase,
        candidatesA,
        candidatesB,
        errorCodes: [...errorCodes].slice(0, 8),
        stateA: a.connectionState,
        stateB: b.connectionState,
        gatheringA: a.iceGatheringState,
        gatheringB: b.iceGatheringState,
        partial,
      },
    });
  } finally {
    a.close();
    b.close();
  }
}
export async function rejectedLease(lease: Lease) {
  const pc = new RTCPeerConnection(configuration(lease, "udp"));
  let candidates = 0,
    wrongType = false;
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      candidates++;
      if (candidate.type !== "relay") wrongType = true;
    }
  };
  try {
    pc.createDataChannel("peel-synthetic-negative");
    await pc.setLocalDescription(await pc.createOffer());
    let gatheringCompleted = true;
    try {
      await gathered(pc);
    } catch {
      gatheringCompleted = false;
    }
    return {
      noCandidateWithinBound: candidates === 0,
      noHostFallback: !wrongType,
      gatheringCompleted,
    };
  } finally {
    pc.close();
  }
}
