import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import {
  createIdentity,
  exportPublic,
  importPublic,
  nonce,
  hashDescription,
  signSession,
  SessionVerifier,
} from "../scratch/auth-module/auth.js";
const module = await readFile(
  new URL("../scratch/auth-module/auth.js", import.meta.url),
);
const server = createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": req.url === "/auth.js" ? "text/javascript" : "text/html",
    "Cache-Control": "no-store",
  });
  res.end(
    req.url === "/auth.js"
      ? module
      : "<!doctype html><title>Peel isolated authentication experiment</title>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const mac = await createIdentity();
  browser = await chromium.launch({
    executablePath:
      process.env.PEEL_BROWSER_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const phone = await page.evaluate(async () => {
    const auth = await import("/auth.js");
    const identity = await auth.createIdentity();
    window.authFixture = { identity, challenge: auth.nonce() };
    const open = indexedDB.open("peel-synthetic-key-fixture", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("keys");
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction("keys", "readwrite", { durability: "strict" });
    tx.objectStore("keys").put(identity.privateKey, "private");
    tx.objectStore("keys").put(identity.publicKey, "public");
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    let exportBlocked = false;
    try {
      await crypto.subtle.exportKey("pkcs8", identity.privateKey);
    } catch {
      exportBlocked = true;
    }
    return {
      public: await auth.exportPublic(identity),
      challenge: window.authFixture.challenge,
      deviceId: identity.deviceId,
      exportBlocked,
    };
  });
  const importedPhone = await importPublic(phone.public);
  const binding = {
    version: 1,
    libraryId: "synthetic-library",
    sessionId: nonce(),
    initiatorId: mac.deviceId,
    responderId: phone.deviceId,
    initiatorNonce: nonce(),
    responderNonce: phone.challenge,
    offerHash: await hashDescription(
      "Synthetic offer descriptor; no note data",
    ),
    answerHash: await hashDescription(
      "Synthetic answer descriptor; no note data",
    ),
    expiresAt: Date.now() + 60000,
  };
  const nodeProof = await signSession(mac, binding);
  const exchange = await page.evaluate(
    async ({ macPublic, proof, expected }) => {
      const auth = await import("/auth.js"),
        fixture = window.authFixture;
      if (
        fixture.identity.deviceId !== expected.responderId ||
        fixture.challenge !== expected.responderNonce
      )
        throw new Error("Local challenge mismatch");
      const verifier = new auth.SessionVerifier(
        "synthetic-library",
        fixture.identity.deviceId,
      );
      await verifier.addConfirmedPeer(await auth.importPublic(macPublic));
      const verified = await verifier.verify(proof, expected);
      const replayRejected = !(await verifier.verify(proof, expected));
      return {
        verified,
        replayRejected,
        proof: await auth.signSession(fixture.identity, expected),
      };
    },
    { macPublic: await exportPublic(mac), proof: nodeProof, expected: binding },
  );
  const verifier = new SessionVerifier("synthetic-library", mac.deviceId);
  await verifier.addConfirmedPeer(importedPhone);
  const browserProofVerified = await verifier.verify(exchange.proof, binding);
  await page.reload();
  const restored = await page.evaluate(async () => {
    const auth = await import("/auth.js"),
      open = indexedDB.open("peel-synthetic-key-fixture", 1);
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction("keys", "readonly");
    const get = (key) =>
      new Promise((resolve, reject) => {
        const request = tx.objectStore("keys").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const [privateKey, publicKey] = await Promise.all([
      get("private"),
      get("public"),
    ]);
    db.close();
    const identity = { ...(await auth.publicIdentity(publicKey)), privateKey };
    window.authFixture = { identity, challenge: auth.nonce() };
    return {
      deviceId: identity.deviceId,
      nonExtractable: !privateKey.extractable,
      challenge: window.authFixture.challenge,
    };
  });
  const fresh = {
    ...binding,
    sessionId: nonce(),
    initiatorNonce: nonce(),
    responderNonce: restored.challenge,
    expiresAt: Date.now() + 60000,
  };
  const restoredProof = await page.evaluate(
    async (expected) =>
      (await import("/auth.js")).signSession(
        window.authFixture.identity,
        expected,
      ),
    fresh,
  );
  const restoredVerified = await verifier.verify(restoredProof, fresh);
  const checks = {
    nodePrivateKeyNonExtractable: !mac.privateKey.extractable,
    chromePrivateKeyExportBlocked: phone.exportBlocked,
    nodeToChromeVerified: exchange.verified,
    chromeToNodeVerified: browserProofVerified,
    replayRejected: exchange.replayRejected,
    browserIdentityStableAcrossReload: restored.deviceId === phone.deviceId,
    restoredKeyNonExtractable: restored.nonExtractable,
    restoredKeySignatureVerified: restoredVerified,
  };
  const report = {
    scope:
      "M0 ephemeral Node/Chrome signature and browser CryptoKey persistence experiment; no production pairing, native Keychain, durable replay or network-session acceptance",
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      browser: await browser.version(),
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0].model,
    },
    algorithm: "Web Crypto ECDSA P-256 / SHA-256",
    signatureFormat: "64-byte raw Web Crypto signature",
    privateKeysExported: 0,
    keys: "Generated synthetic keys; temporary isolated profile only",
    ...checks,
    errors,
  };
  await mkdir("scratch", { recursive: true });
  await writeFile(
    "scratch/peer-auth.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(checks).some((v) => !v) || errors.length)
    process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
