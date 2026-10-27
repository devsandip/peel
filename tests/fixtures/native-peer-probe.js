// Runs only in the isolated hidden native example. No real library or external ICE server.
(() => {
  const run = async () => {
    const report = {
      scheme: location.protocol,
      userAgent: navigator.userAgent,
      checks: {
        customProtocol: location.protocol === "tauri:",
        secureContext: isSecureContext,
        webRTC: typeof RTCPeerConnection === "function",
        webCrypto: !!globalThis.crypto?.subtle,
      },
    };
    let stage = "capabilities",
      a,
      b,
      database;
    const progress = async (next) => {
      stage = next;
      await window.__TAURI_INTERNALS__.invoke("probe_progress", {
        stage,
        checks: report.checks,
      });
    };
    const bounded = (promise, ms) => {
      let timer;
      return Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("ProbeTimeout")), ms);
        }),
      ]).finally(() => clearTimeout(timer));
    };
    const request = (operation) =>
      new Promise((resolve, reject) => {
        operation.onsuccess = () => resolve(operation.result);
        operation.onerror = () => reject(operation.error);
      });
    const transaction = (tx) =>
      new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () =>
          reject(tx.error || new Error("IDBFailure"));
      });
    const openDatabase = async () => {
      const operation = indexedDB.open("peel-m0-peer-native-runtime", 1);
      operation.onupgradeneeded = () =>
        operation.result.createObjectStore("keys");
      return request(operation);
    };
    try {
      await progress("capabilities");
      if (!report.checks.webCrypto || !report.checks.webRTC)
        throw new Error("MissingCapability");
      await progress("p256");
      const key = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      );
      const message = new TextEncoder().encode(
        "Synthetic native runtime signature fixture",
      );
      const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        key.privateKey,
        message,
      );
      report.checks.p256SignVerify = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        key.publicKey,
        signature,
        message,
      );
      report.checks.privateKeyNonExtractable = !key.privateKey.extractable;
      await progress("crypto-key-idb");
      await progress("crypto-key-idb-open");
      database = await openDatabase();
      await progress("crypto-key-idb-write");
      const write = database.transaction("keys", "readwrite", {
        durability: "strict",
      });
      const committed = transaction(write);
      write.objectStore("keys").put(key.privateKey, "synthetic-private-key");
      await committed;
      database.close();
      await progress("crypto-key-idb-reopen");
      database = await openDatabase();
      await progress("crypto-key-idb-read");
      const read = database.transaction("keys", "readonly");
      const readDone = transaction(read);
      const restored = await request(
        read.objectStore("keys").get("synthetic-private-key"),
      );
      await readDone;
      await progress("crypto-key-idb-sign");
      const again = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        restored,
        message,
      );
      report.checks.cryptoKeyIndexedDBReopen =
        !restored.extractable &&
        (await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          key.publicKey,
          again,
          message,
        ));
      await progress("local-channel");
      a = new RTCPeerConnection({ iceServers: [] });
      b = new RTCPeerConnection({ iceServers: [] });
      const sender = a.createDataChannel("synthetic-probe", { ordered: true });
      const opened = new Promise((resolve, reject) => {
        sender.onopen = resolve;
        sender.onerror = () => reject(new Error("ChannelFailure"));
      });
      const payload = new TextEncoder().encode(
        "Synthetic native byte fixture. ".repeat(7000),
      );
      const received = new Uint8Array(payload.byteLength);
      let offset = 0,
        frames = 0;
      const complete = new Promise((resolve, reject) => {
        b.ondatachannel = ({ channel }) => {
          channel.binaryType = "arraybuffer";
          channel.onerror = () => reject(new Error("ChannelFailure"));
          channel.onmessage = ({ data }) => {
            if (
              !(data instanceof ArrayBuffer) ||
              data.byteLength > 16384 ||
              offset + data.byteLength > received.byteLength
            ) {
              reject(new Error("FrameLimit"));
              return;
            }
            received.set(new Uint8Array(data), offset);
            offset += data.byteLength;
            frames++;
            if (offset === received.byteLength) resolve();
          };
        };
      });
      const gathered = (pc) =>
        pc.iceGatheringState === "complete"
          ? Promise.resolve()
          : bounded(
              new Promise((resolve) => {
                const change = () => {
                  if (pc.iceGatheringState === "complete") {
                    pc.removeEventListener("icegatheringstatechange", change);
                    resolve();
                  }
                };
                pc.addEventListener("icegatheringstatechange", change);
              }),
              5000,
            );
      await a.setLocalDescription(await a.createOffer());
      await gathered(a);
      await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer());
      await gathered(b);
      await a.setRemoteDescription(b.localDescription);
      await bounded(opened, 10000);
      report.checks.dataChannelOpened = true;
      await progress("bounded-transfer");
      for (let start = 0; start < payload.byteLength; start += 16384)
        sender.send(payload.slice(start, start + 16384));
      await bounded(complete, 5000);
      const hash = async (bytes) =>
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const [expected, actual] = await Promise.all([
        hash(payload),
        hash(received),
      ]);
      report.checks.boundedTransferHashMatches = expected.every(
        (byte, index) => byte === actual[index],
      );
      report.payloadBytes = payload.byteLength;
      report.frameBytes = 16384;
      report.frames = frames;
      await progress("transport-stats");
      const stats = await a.getStats();
      const transport = [...stats.values()].find(
        (entry) =>
          entry.type === "transport" && entry.dtlsState === "connected",
      );
      report.checks.dtlsConnected = !!transport;
      const pair = transport && stats.get(transport.selectedCandidatePairId);
      report.localCandidateType =
        (pair && stats.get(pair.localCandidateId)?.candidateType) || "unknown";
      report.remoteCandidateType =
        (pair && stats.get(pair.remoteCandidateId)?.candidateType) || "unknown";
      a.close();
      b.close();
      await progress("bound-module");
      const boundModule = await bounded(import("/bound-probe.js"), 5000);
      await progress("bound-channel");
      report.bound = await bounded(
        boundModule.runBoundChannelExperiment(),
        20000,
      );
    } catch (error) {
      report.failureStage = stage;
      report.exception = /^[A-Za-z]{1,64}$/.test(error.name)
        ? error.name
        : "ProbeError";
    } finally {
      a?.close();
      b?.close();
      database?.close();
      await window.__TAURI_INTERNALS__.invoke("probe_result", { report });
    }
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => void run(), {
      once: true,
    });
  else void run();
})();
