import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
// Own synthetic experiment only: no profile, accounts, external STUN or real notes.
const server = createServer((_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Cache-Control": "no-store",
  });
  res.end("<!doctype html><title>Peel isolated peer experiment</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.PEEL_BROWSER_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async () => {
    const a = new RTCPeerConnection({ iceServers: [] });
    const b = new RTCPeerConnection({ iceServers: [] });
    const channel = a.createDataChannel("peel-synthetic", { ordered: true });
    a.onicecandidate = ({ candidate }) => {
      if (candidate) void b.addIceCandidate(candidate);
    };
    b.onicecandidate = ({ candidate }) => {
      if (candidate) void a.addIceCandidate(candidate);
    };
    const timeout = (promise, label) =>
      Promise.race([
        promise,
        new Promise((_r, reject) =>
          setTimeout(() => reject(new Error(label)), 10000),
        ),
      ]);
    const remote = new Promise(
      (resolve) => (b.ondatachannel = ({ channel }) => resolve(channel)),
    );
    const opened = new Promise((resolve) => (channel.onopen = resolve));
    const start = performance.now();
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription);
    await timeout(opened, "Local data channel did not open");
    const connectMs = performance.now() - start;
    const receiver = await remote;
    receiver.binaryType = "arraybuffer";
    const wire = new TextEncoder().encode(
      "# Synthetic peer fixture\n" + "原文 café. ".repeat(18000),
    );
    const chunks = [];
    let received = 0;
    const complete = new Promise(
      (resolve) =>
        (receiver.onmessage = ({ data }) => {
          const chunk = new Uint8Array(data);
          chunks.push(chunk);
          received += chunk.byteLength;
          if (received === wire.byteLength) resolve();
        }),
    );
    const negotiatedMax = a.sctp.maxMessageSize;
    const frameBytes = Math.min(16384, negotiatedMax || 16384);
    channel.bufferedAmountLowThreshold = 32768;
    const transferStart = performance.now();
    for (let offset = 0; offset < wire.byteLength; offset += frameBytes) {
      if (channel.bufferedAmount > 65536)
        await timeout(
          new Promise((resolve) =>
            channel.addEventListener("bufferedamountlow", resolve, {
              once: true,
            }),
          ),
          "Backpressure did not drain",
        );
      channel.send(wire.slice(offset, offset + frameBytes));
    }
    await timeout(complete, "Synthetic transfer incomplete");
    const transferMs = performance.now() - transferStart;
    const output = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const digest = async (bytes) =>
      [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
    const equal = (await digest(output)) === (await digest(wire));
    const stats = await a.getStats();
    const transport = [...stats.values()].find((s) => s.type === "transport");
    const pair = stats.get(transport?.selectedCandidatePairId);
    const local = stats.get(pair?.localCandidateId);
    const peer = stats.get(pair?.remoteCandidateId);
    const direct = {
      bytes: received,
      chunks: chunks.length,
      frameBytes,
      negotiatedMax,
      connectMs,
      transferMs,
      equal,
      dtlsState: transport?.dtlsState,
      localCandidateType: local?.candidateType,
      remoteCandidateType: peer?.candidateType,
      protocol: local?.protocol,
    };
    a.close();
    b.close();
    // Without a TURN service, relay-only must not silently fall back to host ICE.
    const relay = new RTCPeerConnection({
      iceServers: [],
      iceTransportPolicy: "relay",
    });
    relay.createDataChannel("negative-control");
    const candidates = [];
    const gathered = new Promise(
      (resolve) =>
        (relay.onicecandidate = ({ candidate }) => {
          if (candidate) candidates.push(candidate.type);
          else resolve();
        }),
    );
    await relay.setLocalDescription(await relay.createOffer());
    await timeout(
      gathered,
      "Relay-only negative control did not finish gathering",
    );
    const negative = {
      requestedPolicy: relay.getConfiguration().iceTransportPolicy,
      candidateTypes: candidates,
      connected: relay.connectionState === "connected",
    };
    relay.close();
    return { direct, relayWithoutServer: negative };
  });
  const report = {
    scope:
      "M0 same-page Chrome host-channel experiment; not cross-network, relay, pairing, native or iPhone acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      browser: await browser.version(),
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
    },
    externalIceServers: 0,
    payloadsPersistedByServer: 0,
    pageErrors,
    ...result,
  };
  await mkdir("scratch", { recursive: true });
  await writeFile(
    "scratch/peer-channel.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (
    pageErrors.length ||
    report.direct.bytes > 262144 ||
    !report.direct.equal ||
    report.relayWithoutServer.connected ||
    report.relayWithoutServer.candidateTypes.length
  )
    process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
