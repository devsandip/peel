// Run only inside the unpacked synthetic artifact directory, with a sanitized environment.
const assert = require("node:assert/strict");
assert.equal(process.permission.has("fs.read", "/"), false);
assert.equal(process.permission.has("fs.write", process.cwd()), false);
const net = require("node:net"),
  tls = require("node:tls"),
  http = require("node:http"),
  https = require("node:https"),
  http2 = require("node:http2"),
  dns = require("node:dns");
let networkAttempts = 0;
const forbidNetwork = () => {
  networkAttempts++;
  throw Error("Synthetic smoke forbids networking");
};
net.Socket.prototype.connect = forbidNetwork;
net.connect =
  net.createConnection =
  tls.connect =
  http2.connect =
    forbidNetwork;
http.request = http.get = https.request = https.get = forbidNetwork;
dns.lookup = dns.resolve = forbidNetwork;
dns.promises.lookup = dns.promises.resolve = forbidNetwork;
globalThis.fetch = forbidNetwork;

let now = Date.parse("2026-10-27T12:00:00.000Z");
Date.now = () => now;
const mode = process.argv[2];
if (mode !== "missing") {
  Object.assign(process.env, {
    PEEL_CLOUD_DEV_ENABLED: "1",
    AWS_REGION: "us-east-1",
    PEEL_CLOUD_ORIGIN: "https://cloud.peel.example",
    PEEL_CLOUD_SCOPE: "peel-dev/sync",
    PEEL_CLOUD_TABLE: "peel-cloud-dev-synthetic-fixture",
    PEEL_CLOUD_USER_POOL: "us-east-1_synthetic",
    PEEL_CLOUD_CLIENT_ID: "syntheticclient",
    PEEL_CLOUD_CURSOR_KEY: Buffer.alloc(32, 7).toString("base64"),
    PEEL_CLOUD_LEASE_STARTED_AT: new Date(now).toISOString(),
    PEEL_CLOUD_LEASE_EXPIRES_AT: new Date(now + 60000).toISOString(),
  });
  if (mode === "invalid") process.env.PEEL_CLOUD_ORIGIN += "/";
}
const bundle = require("./handler.cjs");
assert.deepEqual(Object.keys(bundle), ["handler"]);
async function main() {
  const malformed = await bundle.handler({});
  assert.equal(malformed.statusCode, mode === "valid" ? 400 : 503);
  const event = {
    version: "2.0",
    rawPath: "/v1/notes/synthetic-note",
    rawQueryString: "",
    requestContext: { http: { method: "GET" } },
    headers: {},
    isBase64Encoded: false,
  };
  const response = await bundle.handler(event);
  assert.equal(response.statusCode, mode === "valid" ? 401 : 503);
  assert.equal(response.headers["cache-control"], "no-store");
  now += 60000;
  const expired = await bundle.handler(event);
  assert.equal(expired.statusCode, 503);
  assert.equal(expired.body, '{"error":"service-unavailable"}');
  assert.equal(networkAttempts, 0);
  process.stdout.write("packaged-" + mode + "-passed\n");
}
main().catch(() => {
  process.stderr.write("Packaged Cloud smoke failed\n");
  process.exitCode = 1;
});
