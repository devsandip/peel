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
import responseGolden from "./cloud-stack-create-response-golden.json" with { type: "json" };
import {
  createCloudStackCreateResponseObservation,
  readCloudStackCreateResponseObservation,
} from "../../infra/cloud/stack-create-response.ts";
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
    output,
    requests = 0,
    destroys = 0;
  const stackId = `arn:aws:cloudformation:${handle.projection.binding.identity.region}:${handle.projection.binding.identity.accountId}:stack/${handle.projection.input.StackName}/${responseGolden.stackUuid}`;
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
            headers: {
              "content-type": "text/xml",
              "x-amzn-requestid": responseGolden.requestId,
            },
            body: Buffer.from(
              `<CreateStackResponse xmlns="http://cloudformation.amazonaws.com/doc/2010-05-15/"><CreateStackResult><StackId>${stackId}</StackId>${scenario === "response-optional" ? "" : `<OperationId>${responseGolden.operationId}</OperationId>`}</CreateStackResult><ResponseMetadata><RequestId>${responseGolden.requestId}</RequestId></ResponseMetadata></CreateStackResponse>`,
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
    output = await client.send(
      new CreateStackCommand(cloudStackCreateRequestInput(handle)),
    );
    assert.ok(output.StackId === stackId);
    assert.ok(output.$metadata.attempts === 1 && requests === 1);
  } finally {
    client.destroy();
  }
  assert.ok(destroys === 1);
  return { f, handle, view, output };
}

function responseInput(c) {
  return {
    request: {
      json: c.handle.json,
      expected: {
        original: c.f.original,
        intent: c.f.intent,
        pin: c.handle.pin,
      },
    },
    observedAt: responseGolden.observedAt,
    response: c.output,
  };
}
function responseRefused(work) {
  let caught;
  try {
    work();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "Expected private response refusal");
  assert.ok(
    caught.message === "Original Cloud stack response observation unavailable",
  );
  assert.ok(
    caught.cause === undefined &&
      Object.keys(caught).length === 0 &&
      Object.isFrozen(caught),
  );
}
function responseScenario(all) {
  const input = responseInput(all[3]),
    make = createCloudStackCreateResponseObservation,
    read = readCloudStackCreateResponseObservation,
    hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
  if (scenario === "response-positive") {
    for (const c of all) {
      const i = responseInput(c),
        r = make(i),
        g = responseGolden.cases[c.handle.projection.stackKind];
      assert.ok(
        r.sha256 === g.sha256 && Buffer.byteLength(r.json) === g.utf8Bytes,
      );
      assert.ok(
        read(r.json, { request: i.request, sha256: r.sha256 }).json === r.json,
      );
      frozen(r);
      assert.ok(
        !r.json.includes(key) &&
          !/TemplateBody|ParameterValue|authorization|synthetic-not-a-real-secret/.test(
            r.json,
          ),
      );
      assert.ok(
        r.observation.providerObservation === "unproven" &&
          r.observation.ownership === "unproven",
      );
      assert.ok(
        r.observation.operationSettlement === "unproven" &&
          r.observation.runAuthority === "unproven",
      );
      assert.ok(
        r.observation.resourceWrites === 0 && Buffer.byteLength(r.json) <= 2048,
      );
      refused(r, c.view);
    }
  } else if (scenario === "response-optional") {
    for (const c of all) {
      const i = responseInput(c),
        r = make(i);
      assert.ok(
        c.output.OperationId === undefined &&
          r.observation.operationId === null,
      );
      const copy = {
        ...i,
        response: { ...i.response, OperationId: undefined },
      };
      assert.ok(make(copy).json === r.json);
      assert.ok(
        read(r.json, { request: i.request, sha256: r.sha256 }).json === r.json,
      );
    }
  } else if (scenario === "response-binding") {
    for (const changed of [
      input.response.StackId.replace(":111122223333:", ":999988887777:"),
      input.response.StackId.replace(":us-east-1:", ":us-west-2:"),
      input.response.StackId.replace(":stack/", ":stack/foreign-"),
      input.response.StackId + "\n",
      input.response.StackId.replace(/.$/, "X"),
      input.response.StackId.replace("arn:aws:", "arn:aws-cn:"),
    ])
      responseRefused(() =>
        make({ ...input, response: { ...input.response, StackId: changed } }),
      );
    responseRefused(() =>
      make({ ...input, request: responseInput(all[0]).request }),
    );
    const copy = structuredClone(input);
    copy.request.expected.pin.sha256 = "f".repeat(64);
    responseRefused(() => make(copy));
  } else if (scenario === "response-metadata") {
    for (const id of ["0", "a._:-b", "x".repeat(128)]) {
      const r = make({
        ...input,
        response: {
          ...input.response,
          OperationId: id,
          $metadata: { ...input.response.$metadata, requestId: id },
        },
      });
      assert.ok(
        r.observation.operationId === id && r.observation.requestId === id,
      );
    }
    const otherUuidVersion = make({
      ...input,
      response: {
        ...input.response,
        StackId:
          input.response.StackId.slice(0, -36) +
          responseGolden.stackUuid.replace("-4000-", "-1000-"),
      },
    });
    assert.ok(otherUuidVersion.observation.ownership === "unproven");
    for (const [field, values] of Object.entries({
      httpStatusCode: [201, 400, "200", undefined],
      attempts: [0, 2, "1", undefined],
      totalRetryDelay: [1, "0", undefined],
      requestId: ["", null, undefined, key, "x\n", "x".repeat(129)],
      extendedRequestId: ["unexpected", null],
      cfId: ["unexpected", null],
    }))
      for (const v of values)
        responseRefused(() =>
          make({
            ...input,
            response: {
              ...input.response,
              $metadata: { ...input.response.$metadata, [field]: v },
            },
          }),
        );
    for (const OperationId of [null, "", key, "x\n", "界", "x".repeat(129), 1])
      responseRefused(() =>
        make({ ...input, response: { ...input.response, OperationId } }),
      );
    for (const response of [
      { ...input.response, name: "AlreadyExists" },
      { ...input.response, Message: "private failure" },
      {
        ...input.response,
        $metadata: { ...input.response.$metadata, raw: "private" },
      },
      { $metadata: input.response.$metadata },
      null,
    ])
      responseRefused(() => make({ ...input, response }));
  } else if (scenario === "response-time") {
    for (const observedAt of [
      "2026-10-27T11:59:59.999Z",
      "2026-10-27T12:01:00Z",
      "2026-10-27T12:01:00.000+00:00",
      "2026-02-30T12:01:00.000Z",
      1,
      undefined,
    ])
      responseRefused(() => make({ ...input, observedAt }));
    Date.now = () => {
      throw Error("No current clock");
    };
    for (const observedAt of [
      "2026-10-27T12:00:00.000Z",
      "2026-10-30T12:00:00.000Z",
    ]) {
      const r = make({ ...input, observedAt });
      assert.ok(
        read(r.json, { request: input.request, sha256: r.sha256 }).observation
          .runAuthority === "unproven",
      );
    }
  } else if (scenario === "response-canonical") {
    const r = make(input);
    for (const field of [
      "format",
      "kind",
      "runId",
      "stackKind",
      "requestSha256",
      "unsignedSha256",
      "httpStatusCode",
      "attempts",
      "totalRetryDelay",
      "providerObservation",
      "ownership",
      "operationSettlement",
      "runAuthority",
      "resourceWrites",
    ]) {
      const o = JSON.parse(r.json);
      o[field] = "changed";
      const json = JSON.stringify(o);
      responseRefused(() =>
        read(json, { request: input.request, sha256: hash(json) }),
      );
    }
    for (const json of [
      r.json + " ",
      JSON.stringify(JSON.parse(r.json), null, 2),
      r.json.replace('"format":1', '"format":1.0'),
      '{"format":1,' + r.json.slice(1),
      JSON.stringify({ ...r.observation, raw: "private" }),
    ])
      responseRefused(() =>
        read(json, { request: input.request, sha256: hash(json) }),
      );
    responseRefused(() =>
      read(r.json, { request: input.request, sha256: "f".repeat(64) }),
    );
    responseRefused(() =>
      read(r.json, {
        request: responseInput(all[0]).request,
        sha256: r.sha256,
      }),
    );
    responseRefused(() =>
      read("x".repeat(2049), {
        request: input.request,
        sha256: hash("x".repeat(2049)),
      }),
    );
    responseRefused(() =>
      read("\ud800", { request: input.request, sha256: hash("\ud800") }),
    );
  } else if (scenario === "response-shape") {
    let getters = 0;
    for (const response of [
      Object.assign(Object.create({}), input.response),
      [],
      Object.defineProperty({ ...input.response }, "OperationId", {
        get() {
          getters++;
          return "private";
        },
      }),
      { ...input.response, [Symbol("private")]: "private" },
    ])
      responseRefused(() => make({ ...input, response }));
    const metaGetter = Object.defineProperty(
      { ...input.response.$metadata },
      "requestId",
      {
        get() {
          getters++;
          return "private";
        },
      },
    );
    responseRefused(() =>
      make({
        ...input,
        response: { ...input.response, $metadata: metaGetter },
      }),
    );
    for (const i of [
      null,
      { ...input, approved: true },
      Object.assign(Object.create({}), input),
      { ...input, response: { ...input.response, Parameters: key } },
      Object.defineProperty({ ...input }, "response", {
        get() {
          getters++;
          return input.response;
        },
      }),
    ])
      responseRefused(() => make(i));
    assert.ok(getters === 0);
  } else if (scenario === "response-recovery") {
    const copy = structuredClone(input),
      r = make(copy);
    copy.response.OperationId = "different-operation";
    assert.ok(make(input).json === r.json);
    discardCloudStackCreateRequest(all[3].handle);
    const recovered = read(r.json, {
      request: input.request,
      sha256: r.sha256,
    });
    assert.ok(
      recovered.json === r.json &&
        recovered.observation.providerObservation === "unproven",
    );
    refused(recovered, all[3].view);
    refused(JSON.parse(JSON.stringify(recovered)), all[3].view);
    const coherent = JSON.parse(r.json);
    coherent.operationId = "different-operation";
    const json = JSON.stringify(coherent),
      changed = read(json, { request: input.request, sha256: hash(json) });
    assert.ok(changed.observation.providerObservation === "unproven");
    frozen(recovered);
    frozen(changed);
  } else throw Error("Unknown response scenario");
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
  } else if (scenario.startsWith("response-")) responseScenario(all);
  else throw Error("Unknown offline scenario");
  assert.ok(
    effects.network === 0 && effects.privateRead === 0 && effects.random === 0,
  );
  for (const { handle } of all) discardCloudStackCreateRequest(handle);
  process.stdout.write(`offline-query:${scenario}:ok\n`);
} catch {
  process.stderr.write(`offline-query:${scenario}:failed\n`);
  process.exitCode = 1;
}
