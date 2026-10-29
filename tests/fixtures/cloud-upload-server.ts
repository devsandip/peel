import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  CloudMutationService,
  CloudServerError,
} from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import { cloudScope } from "./cloud-durable-contract";

/** Test-only loopback service. No default DB, actual credentials or provider. */
export async function startCloudUploadServer(browserOrigin: string) {
  const parent = mkdtempSync(join(tmpdir(), "synkies-browser-upload-")),
    store = new SQLiteCloudServerStore(join(parent, "server.sqlite3")),
    token = randomBytes(32).toString("hex"),
    control = { hold: false, unauthorized: false, committed: 0 },
    releases: (() => void)[] = [];
  await store.seedAccount({
    ...cloudScope,
    status: "active",
    entitlement: "active",
    revision: 1,
    sequence: 0,
    wall: 0,
  });
  const handler = createCloudMutationHandler(
    new CloudMutationService(store),
    async (request) => {
      if (
        control.unauthorized ||
        request.headers.get("x-synthetic-fixture") !== token
      )
        throw new CloudServerError("unauthorized", 401);
      return cloudScope.ownerSubject;
    },
  );
  let api = "";
  const server = createServer(async (incoming, outgoing) => {
    const origin = incoming.headers.origin;
    if (origin && origin !== browserOrigin) {
      outgoing.writeHead(403).end();
      return;
    }
    outgoing.setHeader("Access-Control-Allow-Origin", browserOrigin);
    outgoing.setHeader(
      "Access-Control-Allow-Headers",
      "content-type,x-synthetic-fixture,x-peel-collection,x-peel-mode-generation",
    );
    outgoing.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
    outgoing.setHeader("Cache-Control", "no-store");
    if (incoming.method === "OPTIONS") {
      outgoing.writeHead(204).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 65536) throw Error("Fixture body bound");
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (typeof value === "string") headers.set(name, value);
      const response = await handler(
        new Request(api + incoming.url, {
          method: incoming.method,
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        }),
      );
      if (incoming.method === "POST" && response.status === 200) {
        control.committed++;
        if (control.hold)
          await new Promise<void>((resolve) => releases.push(resolve));
      }
      if (!outgoing.destroyed) {
        outgoing.writeHead(response.status, {
          "Content-Type": "application/json",
        });
        outgoing.end(await response.text());
      }
    } catch {
      if (!outgoing.destroyed)
        outgoing.writeHead(503).end('{"error":"fixture-unavailable"}');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Fixture listener unavailable");
  api = `http://127.0.0.1:${address.port}`;
  const release = () => {
    control.hold = false;
    for (const done of releases.splice(0)) done();
  };
  return {
    api,
    token,
    scope: cloudScope,
    control,
    release,
    async close() {
      release();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await store.close();
      rmSync(parent, { recursive: true, force: true });
    },
  };
}
