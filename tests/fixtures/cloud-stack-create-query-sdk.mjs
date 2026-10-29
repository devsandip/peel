// Child-only offline SDK contract. Never print requests, credentials or assertion values.
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import {
  CloudFormationClient,
  CreateStackCommand,
} from "@aws-sdk/client-cloudformation";
import { cloudJournalInput } from "./cloud-journal-input.ts";
import golden from "./cloud-stack-create-request-golden.json" with { type: "json" };
import { createCloudStackCreateIntent } from "../../infra/cloud/stack-create-intent.ts";
import {
  createCloudStackCreateRequest,
  readCloudStackCreateRequestProjection,
  cloudStackCreateRequestInput,
  checkCloudStackCreateQuery,
  discardCloudStackCreateRequest,
} from "../../infra/cloud/stack-create-request.ts";

const scenario = process.argv[2],
  directory = process.argv[3],
  allowed = new Set([
    join(directory, "config"),
    join(directory, "credentials"),
  ]),
  effects = { network: 0, privateRead: 0, random: 0 },
  key = Buffer.alloc(32).toString("base64"),
  kinds = ["artifacts", "guard", "sentinel", "data"];
const denied = () => {
  effects.network++;
  throw Error("Offline network unavailable");
};
net.connect =
  net.createConnection =
  tls.connect =
  http.request =
  http.get =
  https.request =
  https.get =
  dns.lookup =
  dns.resolve =
    denied;
globalThis.fetch = denied;
for (const name of ["readFile", "readFileSync", "open", "openSync"]) {
  const original = fs[name];
  fs[name] = function (path, ...args) {
    if (!allowed.has(path)) {
      effects.privateRead++;
      throw Error("Offline file unavailable");
    }
    return original.call(this, path, ...args);
  };
}
for (const name of ["readFile", "open"]) {
  const original = fs.promises[name];
  fs.promises[name] = async function (path, ...args) {
    if (!allowed.has(path)) {
      effects.privateRead++;
      throw Error("Offline file unavailable");
    }
    return original.call(this, path, ...args);
  };
}
syncBuiltinESMExports();

function original(kind) {
  const f = cloudJournalInput("/synthetic/workspace"),
    source = {
      contextJson: f.context.json,
      contextSha256: f.context.sha256,
      manifest: { json: f.manifest.json, pin: f.manifest.pin },
    },
    intent = createCloudStackCreateIntent({
      original: source,
      stackKind: kind,
      clientRequestToken: `peel-${f.manifest.pin.runId}-${kind}-10000000-0000-4000-8000-000000000001`,
    });
  return {
    original: source,
    intent: { json: intent.json, pin: intent.pin },
    cursorKey: kind === "data" ? key : null,
  };
}
function refused(handle, view) {
  let caught;
  try {
    checkCloudStackCreateQuery(handle, view);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "Expected private refusal");
  assert.ok(caught.message === "Original Cloud stack request unavailable");
  assert.ok(caught.cause === undefined && Object.keys(caught).length === 0);
  assert.ok(Object.isFrozen(caught));
}
function frozen(v) {
  if (v && typeof v === "object") {
    assert.ok(Object.isFrozen(v));
    Object.values(v).forEach(frozen);
  }
}
function edit(view, change) {
  const params = new URLSearchParams(view.body);
  change(params);
  return { ...view, body: params.toString() };
}
async function capture(kind) {
  const f = original(kind),
    handle = createCloudStackCreateRequest(f);
  assert.ok(handle.pin.sha256 === golden[kind].sha256);
  assert.ok(handle.pin.unsignedSha256 === golden[kind].unsignedSha256);
  let view,
    requests = 0,
    destroys = 0;
  const client = new CloudFormationClient({
    region: "us-east-1",
    endpoint: "https://cloudformation.us-east-1.amazonaws.com",
    maxAttempts: 1,
    defaultsMode: "standard",
    useFipsEndpoint: false,
    useDualstackEndpoint: false,
    ignoreConfiguredEndpointUrls: true,
    credentials: {
      accessKeyId: "SYNTHETIC",
      secretAccessKey: "synthetic-not-a-real-secret",
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    requestHandler: {
      async handle(request) {
        requests++;
        // Capture own data fields from the actual SDK HttpRequest, never invoke a getter.
        const d = Object.getOwnPropertyDescriptors(request),
          get = (k) => {
            assert.ok(d[k] && "value" in d[k], "Missing SDK data field");
            return d[k].value;
          };
        view = {
          method: get("method"),
          protocol: get("protocol"),
          hostname: get("hostname"),
          port: d.port?.value ?? null,
          path: get("path"),
          query: get("query"),
          body: get("body"),
        };
        assert.ok(
          typeof get("headers").authorization === "string",
          "Expected fake SDK signing",
        );
        const result = checkCloudStackCreateQuery(handle, view);
        assert.ok(
          result.fieldCount ===
            (kind === "data" ? 19 : kind === "guard" ? 17 : 16),
        );
        assert.ok(result.bodyBytes === Buffer.byteLength(view.body));
        return {
          response: {
            statusCode: 200,
            headers: { "content-type": "text/xml" },
            body: Buffer.from(
              '<CreateStackResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/"><CreateStackResult><StackId>synthetic-id</StackId></CreateStackResult><ResponseMetadata><RequestId>synthetic-request</RequestId></ResponseMetadata></CreateStackResponse>',
            ),
          },
        };
      },
      destroy() {
        destroys++;
      },
    },
  });
  try {
    const output = await client.send(
      new CreateStackCommand(cloudStackCreateRequestInput(handle)),
    );
    assert.ok(output.StackId === "synthetic-id");
    assert.ok(output.$metadata.attempts === 1 && requests === 1);
  } finally {
    client.destroy();
  }
  assert.ok(destroys === 1);
  return { f, handle, view };
}

try {
  // The actual pinned SDK is the positive serialization oracle for every scenario/kind.
  const all = await Promise.all(kinds.map(capture)),
    { f, handle, view } = all[3];
  crypto.randomBytes = crypto.randomUUID = () => {
    effects.random++;
    throw Error("Checker randomness unavailable");
  };
  syncBuiltinESMExports();
  if (scenario === "positive") {
    for (const { handle, view } of all) {
      const result = checkCloudStackCreateQuery(handle, view);
      assert.ok(result.requestSha256 === handle.pin.sha256);
      assert.ok(result.unsignedSha256 === handle.pin.unsignedSha256);
      assert.ok(result.unsignedConsistency === "matches-original");
      assert.ok(
        result.ownership === "unproven" && result.runAuthority === "unproven",
      );
      assert.ok(
        result.currentAuthority === "unproven" &&
          result.transportAuthority === "unproven",
      );
      assert.ok(result.resourceWrites === 0);
      frozen(result);
      const json = JSON.stringify(result);
      assert.ok(
        !json.includes(key) && !json.includes("synthetic-not-a-real-secret"),
      );
      assert.ok(
        !/TemplateBody|ParameterValue|authorization|StackId|synthetic-workspace/.test(
          json,
        ),
      );
      assert.ok(json.length < 1024);
    }
  } else if (scenario === "encoding") {
    for (const { handle, view } of all) {
      const reversed = view.body.split("&").reverse().join("&"),
        equivalent = reversed
          .replace(/%[A-F0-9]{2}/g, (s) => s.toLowerCase())
          .replace(/%20/g, "+");
      assert.ok(
        checkCloudStackCreateQuery(handle, { ...view, body: equivalent })
          .unsignedSha256 === handle.pin.unsignedSha256,
      );
      assert.ok(
        checkCloudStackCreateQuery(handle, { ...view, port: 443 })
          .resourceWrites === 0,
      );
    }
  } else if (scenario === "each-field") {
    for (const { handle, view } of all) {
      for (const name of new URLSearchParams(view.body).keys()) {
        refused(
          handle,
          edit(view, (p) => p.set(name, p.get(name) + "x")),
        );
        refused(
          handle,
          edit(view, (p) => p.delete(name)),
        );
      }
    }
  } else if (scenario === "absent-fields") {
    for (const name of [
      "TemplateURL",
      "RoleARN",
      "DisableRollback",
      "DisableValidation",
      "DeploymentConfig.DisableRollback",
      "NotificationARNs.member.1",
      "ResourceTypes.member.1",
      "RollbackConfiguration.MonitoringTimeInMinutes",
      "StackPolicyBody",
      "StackPolicyURL",
      "Parameters.member.1.UsePreviousValue",
      "Parameters.member.1.ResolvedValue",
    ])
      refused(
        handle,
        edit(view, (p) => p.set(name, "false")),
      );
    for (const { handle, view } of all.slice(0, 3))
      refused(
        handle,
        edit(view, (p) => p.set("Parameters.member.1.ParameterValue", key)),
      );
  } else if (scenario === "duplicates") {
    for (const name of [
      "Action",
      "TemplateBody",
      "Parameters.member.1.ParameterValue",
    ])
      refused(handle, {
        ...view,
        body:
          view.body +
          `&${encodeURIComponent(name)}=${encodeURIComponent(new URLSearchParams(view.body).get(name))}`,
      });
    refused(handle, { ...view, body: view.body + "&%41ction=CreateStack" });
    refused(
      handle,
      edit(view, (p) => p.set("__proto__", "x")),
    );
  } else if (scenario === "indexes") {
    for (const name of [
      "Tags.member.0.Key",
      "Tags.member.4.Key",
      "Tags.member.01.Key",
      "Capabilities.member.2",
      "Parameters.member.2.ParameterKey",
      "Tags.1.Key",
    ])
      refused(
        handle,
        edit(view, (p) => p.set(name, "synthetic")),
      );
  } else if (scenario === "endpoint") {
    for (const [name, values] of Object.entries({
      method: ["GET", "post"],
      protocol: ["http:", "https"],
      hostname: [
        "cloudformation.us-west-2.amazonaws.com",
        "cloudformation.us-east-1.amazonaws.com.evil",
        "CLOUDFORMATION.us-east-1.amazonaws.com",
      ],
      port: [80, "443", undefined],
      path: ["/?Action=CreateStack", "/other", "//"],
      query: [{ Action: "CreateStack" }, [], null],
    }))
      for (const value of values) refused(handle, { ...view, [name]: value });
  } else if (scenario === "encoding-refusal") {
    for (const suffix of [
      "&",
      "&&a=b",
      "&=x",
      "&a",
      "&Action=%",
      "&Action=%GG",
      "&Action=%ff",
      "&Action=%C0%AF",
      "&Action=\ud800",
      "&Action=界",
      "&Action=\n",
      "&Action=%00",
    ])
      refused(handle, { ...view, body: view.body + suffix });
    for (const body of [
      "",
      " ",
      Buffer.from(view.body),
      new URLSearchParams(view.body),
      undefined,
      "x".repeat(256 * 1024 + 1),
      Array(130).fill("a=b").join("&"),
    ])
      refused(handle, { ...view, body });
  } else if (scenario === "data-shape") {
    let getter = 0;
    for (const value of [
      null,
      { ...view, approved: true },
      { ...view, headers: {} },
      Object.assign(Object.create({}), view),
      Object.defineProperty({ ...view }, "body", {
        get() {
          getter++;
          return view.body;
        },
      }),
    ])
      refused(handle, value);
    refused(handle, { ...view, query: Object.create({}) });
    assert.ok(getter === 0);
  } else if (scenario === "handles") {
    const recovered = readCloudStackCreateRequestProjection(handle.json, {
      original: f.original,
      intent: f.intent,
      pin: handle.pin,
    });
    for (const other of [
      null,
      {},
      { ...handle },
      JSON.parse(JSON.stringify(handle)),
      recovered,
      all[0].handle,
    ])
      refused(other, view);
    const result = checkCloudStackCreateQuery(handle, view);
    refused(result, view);
    discardCloudStackCreateRequest(handle);
    refused(handle, view);
  } else if (scenario === "different-material") {
    const other = createCloudStackCreateRequest({
      ...f,
      cursorKey: Buffer.alloc(32, 1).toString("base64"),
    });
    assert.ok(other.pin.unsignedSha256 !== handle.pin.unsignedSha256);
    refused(other, view);
    const swapped = edit(view, (p) =>
      p.set(
        "Parameters.member.1.ParameterValue",
        Buffer.alloc(32, 1).toString("base64"),
      ),
    );
    refused(handle, swapped);
    assert.ok(
      checkCloudStackCreateQuery(other, swapped).unsignedSha256 ===
        other.pin.unsignedSha256,
    );
    discardCloudStackCreateRequest(other);
  } else if (scenario === "detachment") {
    const prior = checkCloudStackCreateQuery(handle, view),
      copy = { ...view };
    copy.body = edit(view, (p) =>
      p.set("DeploymentConfig.Mode", "EXPRESS"),
    ).body;
    refused(handle, copy);
    assert.ok(
      JSON.stringify(prior) ===
        JSON.stringify(checkCloudStackCreateQuery(handle, view)),
    );
    const material = cloudStackCreateRequestInput(handle);
    frozen(material);
    assert.ok(Object.isFrozen(handle));
  } else throw Error("Unknown offline scenario");
  assert.ok(
    effects.network === 0 && effects.privateRead === 0 && effects.random === 0,
  );
  for (const { handle } of all) discardCloudStackCreateRequest(handle);
  process.stdout.write(`offline-query:${scenario}:ok\n`);
} catch {
  process.stderr.write(`offline-query:${scenario}:failed\n`);
  process.exitCode = 1;
}
