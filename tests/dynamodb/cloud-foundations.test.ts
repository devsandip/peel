import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { beforeEach, afterEach, expect, it } from "vitest";
import {
  createCloudLambdaHandler,
  type CloudLambdaConfig,
  type CloudLambdaResponse,
} from "../../packages/cloud-protocol/src/lambda-http";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import { DurableCloudPull } from "../../packages/cloud-protocol/src/pull-local";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { applyCloudServerReply } from "../../packages/cloud-protocol/src/client-response";
import { cloudStatus } from "../../packages/cloud-protocol/src/index";
import type {
  CloudAccount,
  CloudMutationRequest,
  CloudServerResult,
} from "../../packages/cloud-protocol/src/server";
import type {
  CloudPullStart,
  CloudPullPage,
} from "../../packages/cloud-protocol/src/pull";
import { createCloudWebSessionBoundary } from "../../packages/cloud-protocol/src/web-session";
import { DynamoDBCloudWebSessionStore } from "../../packages/cloud-protocol/src/web-session-dynamodb";
import {
  syntheticAccessToken,
  syntheticCognito,
  syntheticJwks,
} from "../fixtures/cloud-auth";
import { cloudDraft, cloudScope } from "../fixtures/cloud-durable-contract";

const origin = "https://peel.example",
  A = "synthetic-owner-a",
  B = "synthetic-owner-b";
const scope = (ownerSubject = A): CloudScope => ({
  ...cloudScope,
  ownerSubject,
});
const wireScope = {
  version: 1 as const,
  collectionId: cloudScope.collectionId,
  modeGeneration: 1,
};
const endpoint = process.env.PEEL_DYNAMODB_ENDPOINT;
if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))
  throw Error("Foundation tests require explicit loopback storage");
const sdk = () =>
  new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    maxAttempts: 1,
    credentials: {
      accessKeyId: "syntheticlocalkey",
      secretAccessKey: "syntheticlocalkey",
    },
  });
let db: DynamoDBClient,
  table: string,
  folder: string,
  key: CryptoKey,
  now: number;
let run: ReturnType<typeof createCloudLambdaHandler>;
let failSessionRead = false;
const stores = new Set<SQLiteCloudStateStore>();
const action = (noteId: string, text: string) => ({
  kind: "upsert" as const,
  snapshot: { ...cloudDraft(text), noteId },
});
function local(label: string, owner = A, beforeCommit?: () => void) {
  const store = new SQLiteCloudStateStore(
    join(folder, label + ".sqlite3"),
    beforeCommit,
  );
  stores.add(store);
  return {
    label,
    owner,
    store,
    repo: new DurableCloudClient(store, scope(owner)),
    pull: new DurableCloudPull(store, scope(owner)),
  };
}
type Local = ReturnType<typeof local>;
async function reopen(client: Local) {
  await client.store.close();
  stores.delete(client.store);
  return local(client.label, client.owner);
}
const handler = (
  authentication: CloudLambdaConfig["authentication"] = {
    kind: "bearer",
    cognito: syntheticCognito,
  },
) =>
  createCloudLambdaHandler(
    { origin, tableName: table, authentication },
    {
      client: db,
      cursorKey: key,
      clock: () => now,
      jwksCache: syntheticJwks(),
    },
  );
function event(
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const cut = path.indexOf("?");
  return {
    version: "2.0",
    rawPath: cut < 0 ? path : path.slice(0, cut),
    rawQueryString: cut < 0 ? "" : path.slice(cut + 1),
    isBase64Encoded: false,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      http: { method },
      authorizer: { jwt: { claims: { sub: "forged-owner", paid: true } } },
    },
  };
}
const auth = (owner = A) => ({
  authorization: "Bearer " + syntheticAccessToken(owner),
});
const json = <T>(response: CloudLambdaResponse, status = 200): T => {
  expect(response.statusCode).toBe(status);
  expect(response.headers["cache-control"]).toBe("no-store");
  return JSON.parse(response.body) as T;
};
const get = (noteId: string, owner = A) =>
  run(
    event("GET", "/v1/notes/" + noteId, {
      ...auth(owner),
      "x-peel-collection": wireScope.collectionId,
      "x-peel-mode-generation": "1",
    }),
  );
async function send(
  client: Local,
  noteId: string,
  headers: Record<string, string> = auth(client.owner),
) {
  const request: CloudMutationRequest = {
    ...wireScope,
    mutation: await client.repo.retry(noteId),
  };
  return {
    request,
    response: await run(event("POST", "/v1/mutations", headers, request)),
  };
}
async function commit(
  client: Local,
  noteId: string,
  text: string,
  opId: string,
) {
  const old = await client.repo.get(noteId);
  const saved = await client.repo.save(
    noteId,
    action(noteId, text),
    old?.generation ?? null,
  );
  await client.repo.prepare(noteId, saved.generation, opId);
  const result = await send(client, noteId);
  await applyCloudServerReply(
    client.repo,
    result.request,
    json<CloudServerResult>(result.response),
  );
}
async function start(client: Local) {
  const old = await client.pull.progress();
  const response =
    old?.checkpoint && old.next === null
      ? await run(
          event(
            "GET",
            "/v1/sync?" + new URLSearchParams({ after: old.checkpoint }),
            auth(client.owner),
          ),
        )
      : await run(
          event("POST", "/v1/sync/bootstrap", auth(client.owner), wireScope),
        );
  await client.pull.begin(
    json<CloudPullStart>(response),
    old?.generation ?? null,
  );
}
async function nextPage(client: Local) {
  const next = (await client.pull.progress())!.next!;
  const path = next.kind === "heads" ? "/v1/notes?" : "/v1/sync?";
  return json<CloudPullPage>(
    await run(
      event(
        "GET",
        path + new URLSearchParams({ pageToken: next.token, limit: "1" }),
        auth(client.owner),
      ),
    ),
  );
}
async function finish(client: Local) {
  for (
    let count = 0;
    (await client.pull.progress())?.next && count < 30;
    count++
  )
    await client.pull.apply(await nextPage(client));
  expect((await client.pull.progress())?.next).toBeNull();
}
async function policy(owner: string, entitlement: CloudAccount["entitlement"]) {
  const item = (
    await db.send(
      new GetItemCommand({
        TableName: table,
        Key: { PK: { S: "USER#" + owner }, SK: { S: "META" } },
        ConsistentRead: true,
      }),
    )
  ).Item!;
  const account = JSON.parse(item.record.S!) as CloudAccount;
  account.entitlement = entitlement;
  account.revision++;
  await db.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        ...item,
        revision: { N: String(account.revision) },
        record: { S: JSON.stringify(account) },
      },
    }),
  );
}
beforeEach(async () => {
  now = Date.now();
  failSessionRead = false;
  db = sdk();
  db.middlewareStack.add(
    (next, context) => async (args) => {
      if (failSessionRead && context.commandName === "GetItemCommand") {
        failSessionRead = false;
        throw Error("Private synthetic storage failure");
      }
      return next(args);
    },
    { step: "initialize", name: "syntheticFoundationFault" },
  );
  table = "peel-synthetic-" + randomUUID();
  folder = await mkdtemp(join(tmpdir(), "peel-synthetic-foundations-"));
  await db.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
    }),
  );
  for (const owner of [A, B]) {
    const account: CloudAccount = {
      ...scope(owner),
      version: 1,
      status: "active",
      entitlement: "active",
      revision: 1,
      sequence: 0,
      wall: 0,
    };
    await db.send(
      new PutItemCommand({
        TableName: table,
        Item: {
          PK: { S: "USER#" + owner },
          SK: { S: "META" },
          revision: { N: "1" },
          record: { S: JSON.stringify(account) },
        },
      }),
    );
  }
  key = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  run = handler();
});
afterEach(async () => {
  failSessionRead = false;
  for (const store of stores) await store.close();
  stores.clear();
  try {
    await db.send(new DeleteTableCommand({ TableName: table }));
  } finally {
    db.destroy();
    await rm(folder, { recursive: true, force: true });
  }
});

it("completes interrupted durable downloads without cross-account restore or cursor advancement after failed commits", async () => {
  const writer = local("writer"),
    other = local("other", B);
  for (const id of ["a", "b", "c", "d", "shared"])
    await commit(writer, id, "A " + id, "seed-" + id);
  await commit(other, "shared", "B shared", "seed-shared");
  expect(
    json<{ head: { snapshot: { bodyMarkdown: string } } }>(
      await get("shared", B),
    ).head.snapshot.bodyMarkdown,
  ).toBe("B shared");
  expect(json<{ head: { kind: string } }>(await get("a", B)).head.kind).toBe(
    "missing",
  );
  json(await run(event("POST", "/v1/live", auth(B), { owner: A })), 404);
  let fail = false,
    mirror = local("mirror", A, () => {
      if (fail) throw Error("Synthetic page commit failure");
    });
  await mirror.repo.save(
    "unsent",
    action("unsent", "Unsent Cloud draft"),
    null,
  );
  await start(mirror);
  const first = await nextPage(mirror),
    foreign = local("foreign", B);
  await expect(foreign.pull.apply(first)).rejects.toThrow("another account");
  json(
    await run(
      event(
        "GET",
        "/v1/notes?" + new URLSearchParams({ pageToken: first.from }),
        auth(B),
      ),
    ),
    403,
  );
  await mirror.pull.apply(first);
  const before = await mirror.pull.progress(),
    second = await nextPage(mirror);
  fail = true;
  await expect(mirror.pull.apply(second)).rejects.toThrow(
    "Synthetic page commit failure",
  );
  expect(await mirror.pull.progress()).toEqual(before);
  expect(await mirror.repo.get(second.heads[0].noteId)).toBeNull();
  fail = false;
  mirror = await reopen(mirror);
  db.destroy();
  db = sdk();
  run = handler(); // Fresh SDK/handler; persisted records and injected cursor key survive.
  expect(await mirror.pull.progress()).toEqual(before);
  expect((await mirror.pull.apply(first)).kind).toBe("already-applied");
  await finish(mirror);
  for (const id of ["a", "b", "c", "d", "shared"])
    expect((await mirror.repo.get(id))?.current?.snapshot?.bodyMarkdown).toBe(
      "A " + id,
    );
  expect(
    (await mirror.repo.get("unsent"))?.pending?.snapshot?.bodyMarkdown,
  ).toBe("Unsent Cloud draft");
  expect((await mirror.pull.progress())?.throughSequence).toBe(5);
  expect((await mirror.pull.progress())?.checkpoint).toBeTypeOf("string");
  await expect(
    new DurableCloudClient(mirror.store, scope(B)).get("shared"),
  ).rejects.toThrow("another account");
  expect(await foreign.repo.get("shared")).toBeNull();
});

it("retries lost replies after reopen, preserves later drafts through conflict and cannot revive a month-old purged ID", async () => {
  let author = local("author");
  const saved = await author.repo.save(
    "shared",
    action("shared", "First send"),
    null,
  );
  const prepared = await author.repo.prepare(
    "shared",
    saved.generation,
    "lost-reply",
  );
  await author.repo.save(
    "shared",
    action("shared", "Later local draft"),
    prepared.generation,
  );
  const first = await send(author, "shared");
  json(first.response); // Deliberately lose the successful reply.
  const original = await author.repo.retry("shared");
  author = await reopen(author);
  expect(await author.repo.retry("shared")).toEqual(original);
  const concurrent = local("concurrent");
  await start(concurrent);
  await finish(concurrent);
  await commit(concurrent, "shared", "Remote edit", "remote-edit");
  const replay = await send(author, "shared");
  expect(json<CloudServerResult>(replay.response).replayed).toBe(true);
  await applyCloudServerReply(
    author.repo,
    replay.request,
    json<CloudServerResult>(replay.response),
  );
  author = await reopen(author);
  const conflict = (await author.repo.get("shared"))!;
  expect(conflict.conflict?.local.snapshot?.bodyMarkdown).toBe(
    "Later local draft",
  );
  expect(conflict.conflict?.remote?.bodyMarkdown).toBe("Remote edit");
  const resolved = await author.repo.resolve(
    "shared",
    conflict.generation,
    action("shared", "Combined result"),
  );
  await author.repo.prepare("shared", resolved.generation, "resolved-op");
  const combined = await send(author, "shared");
  await applyCloudServerReply(
    author.repo,
    combined.request,
    json<CloudServerResult>(combined.response),
  );
  expect(cloudStatus((await author.repo.get("shared"))!)).toBe("synced");
  const stale = local("stale");
  await start(stale);
  await finish(stale);
  await stale.repo.save(
    "shared",
    action("shared", "Offline recovery text"),
    (await stale.repo.get("shared"))!.generation,
  );
  await start(concurrent);
  await finish(concurrent);
  const purge = await concurrent.repo.save(
    "shared",
    { kind: "purge", snapshot: null },
    (await concurrent.repo.get("shared"))!.generation,
  );
  await concurrent.repo.prepare("shared", purge.generation, "purge-op");
  const deleted = await send(concurrent, "shared");
  await applyCloudServerReply(
    concurrent.repo,
    deleted.request,
    json<CloudServerResult>(deleted.response),
  );
  now += 31 * 24 * 60 * 60 * 1000;
  await stale.repo.prepare(
    "shared",
    (await stale.repo.get("shared"))!.generation,
    "stale-edit",
  );
  const rejected = await send(stale, "shared");
  await applyCloudServerReply(
    stale.repo,
    rejected.request,
    json<CloudServerResult>(rejected.response, 409),
  );
  const retained = (await stale.repo.get("shared"))!;
  expect(retained.conflict?.remote).toBeNull();
  expect(retained.conflict?.local.snapshot?.bodyMarkdown).toBe(
    "Offline recovery text",
  );
  await expect(
    stale.repo.resolve(
      "shared",
      retained.generation,
      action("shared", "Try to revive"),
    ),
  ).rejects.toThrow("new note ID");
  await commit(stale, "recovered", "Offline recovery text", "recovery-op");
  expect(json<{ head: { kind: string } }>(await get("shared")).head.kind).toBe(
    "purged",
  );
  expect(
    json<{ head: { snapshot: { bodyMarkdown: string } } }>(
      await get("recovered"),
    ).head.snapshot.bodyMarkdown,
  ).toBe("Offline recovery text");
});

it("retains durable pending work across expired/revoked sessions, paid-policy rejection and private storage failure", async () => {
  run = handler({ kind: "web-session", lifetimeMs: 60000 });
  const sessions = new DynamoDBCloudWebSessionStore(db, table);
  const issuer = createCloudWebSessionBoundary(
    { origin, lifetimeMs: 60000 },
    sessions,
    async () => A,
    () => now,
  );
  async function login() {
    const response = await issuer.issue(
      new Request(origin + "/auth/session", {
        method: "POST",
        headers: { origin },
      }),
    );
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    return {
      origin,
      cookie,
      "x-peel-csrf": (await response.json()).csrfToken as string,
    };
  }
  let client = local("waiting");
  const saved = await client.repo.save(
    "waiting",
    action("waiting", "Prepared text"),
    null,
  );
  const prepared = await client.repo.prepare(
    "waiting",
    saved.generation,
    "waiting-op",
  );
  await client.repo.save(
    "waiting",
    action("waiting", "Newer saved text"),
    prepared.generation,
  );
  const before = await client.repo.get("waiting");
  async function denied(headers: Record<string, string>, status: number) {
    const result = await send(client, "waiting", headers);
    const error = json<CloudServerResult>(result.response, status);
    expect(result.response.body).not.toContain("Private");
    await expect(
      applyCloudServerReply(client.repo, result.request, error),
    ).rejects.toThrow("Invalid Cloud server reply");
    client = await reopen(client);
    expect(await client.repo.get("waiting")).toEqual(before);
  }
  let headers = await login();
  now += 60000;
  await denied(headers, 401);
  headers = await login();
  await sessions.revoke(
    createHash("sha256").update(headers.cookie.split("=")[1]).digest("hex"),
  );
  await denied(headers, 401);
  headers = await login();
  failSessionRead = true;
  await denied(headers, 503);
  await policy(A, "inactive");
  await denied(headers, 403);
  await policy(A, "active");
  const accepted = await send(client, "waiting", headers);
  await applyCloudServerReply(
    client.repo,
    accepted.request,
    json<CloudServerResult>(accepted.response),
  );
  const later = (await client.repo.get("waiting"))!;
  expect(later.pending?.snapshot?.bodyMarkdown).toBe("Newer saved text");
  expect(later.base?.bodyMarkdown).toBe("Prepared text");
  await client.repo.prepare("waiting", later.generation, "newer-op");
  const final = await send(client, "waiting", headers);
  await applyCloudServerReply(
    client.repo,
    final.request,
    json<CloudServerResult>(final.response),
  );
  client = await reopen(client);
  expect(
    (await client.repo.get("waiting"))?.current?.snapshot?.bodyMarkdown,
  ).toBe("Newer saved text");
  expect(cloudStatus((await client.repo.get("waiting"))!)).toBe("synced");
});
