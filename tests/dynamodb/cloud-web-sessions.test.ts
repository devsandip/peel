import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { beforeEach, afterEach, expect, it } from "vitest";
import { DynamoDBCloudWebSessionStore } from "../../packages/cloud-protocol/src/web-session-dynamodb";
import {
  createCloudWebSessionBoundary,
  type CloudWebSession,
} from "../../packages/cloud-protocol/src/web-session";

const endpoint = process.env.PEEL_DYNAMODB_ENDPOINT;
if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))
  throw Error("Session tests require an explicit loopback endpoint");
const config = {
  endpoint,
  region: "us-east-1",
  maxAttempts: 1,
  credentials: {
    accessKeyId: "syntheticlocalkey",
    secretAccessKey: "syntheticlocalkey",
  },
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const key = (idHash: string) => ({
  PK: { S: `SESSION#${idHash}` },
  SK: { S: "META" },
});
const origin = "https://peel.example",
  BASE = 1800000000321;
let client: DynamoDBClient, table: string, store: DynamoDBCloudWebSessionStore;
let beforePut: (() => Promise<void>) | undefined,
  afterInsert: (() => void) | undefined;
const record = (subject = "synthetic-owner-a"): CloudWebSession => ({
  version: 1,
  idHash: digest(randomBytes(32).toString("base64url")),
  subject,
  csrfHash: digest(randomBytes(32).toString("base64url")),
  issuedAt: BASE,
  expiresAt: BASE + 3600000,
  revoked: false,
});
const raw = async (idHash: string) =>
  (
    await client.send(
      new GetItemCommand({
        TableName: table,
        Key: key(idHash),
        ConsistentRead: true,
      }),
    )
  ).Item;
const directory = async (subject: string) =>
  (
    await client.send(
      new QueryCommand({
        TableName: table,
        ConsistentRead: true,
        KeyConditionExpression: "PK = :owner AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: {
          ":owner": { S: `USER#${subject}` },
          ":prefix": { S: "WEBSESSION#" },
        },
      }),
    )
  ).Items!;
beforeEach(async () => {
  client = new DynamoDBClient(config);
  table = `peel-synthetic-${randomUUID()}`;
  beforePut = undefined;
  afterInsert = undefined;
  client.middlewareStack.add(
    (next, context) => async (args) => {
      if (context.commandName === "PutItemCommand") await beforePut?.();
      const result = await next(args);
      if (context.commandName === "TransactWriteItemsCommand") afterInsert?.();
      return result;
    },
    { step: "initialize", name: "syntheticSessionBoundaries" },
  );
  await client.send(
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
  store = new DynamoDBCloudWebSessionStore(client, table);
});
afterEach(async () => {
  beforePut = undefined;
  afterInsert = undefined;
  try {
    await client.send(new DeleteTableCommand({ TableName: table }));
  } finally {
    client.destroy();
  }
});
function boundary(
  subject = "synthetic-owner-a",
  now = () => BASE,
  adapter = store,
) {
  return createCloudWebSessionBoundary(
    { origin, lifetimeMs: 3600000 },
    adapter,
    async () => subject,
    now,
  );
}
async function issue(subject = "synthetic-owner-a") {
  const response = await boundary(subject).issue(
    new Request(`${origin}/auth/session`, {
      method: "POST",
      headers: { origin },
    }),
  );
  const cookie = response.headers.get("set-cookie")!.split(";")[0],
    body = await response.json();
  return {
    cookie,
    csrf: body.csrfToken as string,
    idHash: digest(cookie.split("=")[1]),
  };
}
const request = (session: { cookie: string; csrf: string }) =>
  new Request(`${origin}/v1/mutations`, {
    method: "POST",
    headers: { origin, cookie: session.cookie, "x-peel-csrf": session.csrf },
  });
it("persists digest-only session authority and owner references across fresh clients and a fresh Node process", async () => {
  const session = await issue();
  const freshClient = new DynamoDBClient(config),
    reopened = new DynamoDBCloudWebSessionStore(freshClient, table);
  try {
    expect(
      await boundary("unused", () => BASE, reopened).resolveCaller(
        request(session),
      ),
    ).toBe("synthetic-owner-a");
    const rows = [
      await raw(session.idHash),
      ...(await directory("synthetic-owner-a")),
    ];
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(session.cookie.split("=")[1]);
    expect(JSON.stringify(rows)).not.toContain(session.csrf);
    expect(rows[1]).not.toHaveProperty("record");
    expect(rows[1]?.idHash.S).toBe(session.idHash);
    const program = `import {readFileSync} from 'node:fs';
      import {DynamoDBClient,GetItemCommand} from '@aws-sdk/client-dynamodb';
      const input=JSON.parse(readFileSync(0,'utf8')); const db=new DynamoDBClient(input.config);
      try { const out=await db.send(new GetItemCommand({TableName:input.table,Key:input.key,ConsistentRead:true}));
        const record=JSON.parse(out.Item.record.S); console.log(JSON.stringify({subject:record.subject,revoked:record.revoked}));
      } finally {db.destroy();}`;
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", program],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        input: JSON.stringify({ config, table, key: key(session.idHash) }),
        timeout: 10000,
      },
    );
    expect(child.status).toBe(0);
    expect(JSON.parse(child.stdout)).toEqual({
      subject: "synthetic-owner-a",
      revoked: false,
    });
  } finally {
    freshClient.destroy();
  }
});
it("keeps owner collisions and partial directory collisions atomic without overwriting authority", async () => {
  const original = record();
  expect(await store.insert(original)).toBe(true);
  expect(
    await store.insert({ ...original, subject: "synthetic-owner-b" }),
  ).toBe(false);
  expect(await store.read(original.idHash)).toEqual(original);
  expect(await directory("synthetic-owner-b")).toEqual([]);
  const blocked = record();
  await client.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        PK: { S: `USER#${blocked.subject}` },
        SK: { S: `WEBSESSION#${blocked.idHash}` },
        idHash: { S: blocked.idHash },
        ttl: { N: String(Math.ceil(blocked.expiresAt / 1000)) },
      },
    }),
  );
  expect(await store.insert(blocked)).toBe(false);
  expect(await raw(blocked.idHash)).toBeUndefined();
});
it("reopens durable logout, preserves another owner and never reactivates a revoked ID", async () => {
  const a = await issue(),
    b = await issue("synthetic-owner-b");
  const logout = await boundary().logout(request(a));
  expect(logout.status).toBe(204);
  const freshClient = new DynamoDBClient(config),
    reopened = new DynamoDBCloudWebSessionStore(freshClient, table);
  try {
    await expect(
      boundary("unused", () => BASE, reopened).resolveCaller(request(a)),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await boundary("unused", () => BASE, reopened).resolveCaller(request(b)),
    ).toBe("synthetic-owner-b");
    const old = (await reopened.read(a.idHash))!;
    expect(old.revoked).toBe(true);
    expect(await reopened.insert({ ...old, revoked: false })).toBe(false);
    await reopened.revoke(a.idHash);
    expect((await reopened.read(a.idHash))?.revoked).toBe(true);
  } finally {
    freshClient.destroy();
  }
});
it("serializes competing revocations and never resurrects a physically removed lookup", async () => {
  const first = record();
  await store.insert(first);
  beforePut = async () => {
    beforePut = undefined;
    await new DynamoDBCloudWebSessionStore(client, table).revoke(first.idHash);
  };
  await store.revoke(first.idHash);
  expect((await store.read(first.idHash))?.revoked).toBe(true);
  const removed = record();
  await store.insert(removed);
  beforePut = async () => {
    beforePut = undefined;
    await client.send(
      new DeleteItemCommand({ TableName: table, Key: key(removed.idHash) }),
    );
  };
  await store.revoke(removed.idHash);
  expect(await store.read(removed.idHash)).toBeNull();
  await store.revoke(removed.idHash);
  expect(await raw(removed.idHash)).toBeUndefined();
});
it("enforces logical expiry before physical cleanup and fails closed on malformed stored authority", async () => {
  const session = await issue(),
    old = (await store.read(session.idHash))!;
  const item = (await raw(session.idHash))!;
  expect(Number(item.ttl.N) * 1000).toBeGreaterThanOrEqual(old.expiresAt);
  await expect(
    boundary("unused", () => old.expiresAt).resolveCaller(request(session)),
  ).rejects.toMatchObject({ status: 401 });
  expect(await raw(session.idHash)).toBeDefined();
  for (const changed of [
    { ...old, version: 2 },
    { ...old, idHash: "0".repeat(64) },
    { ...old, extra: true },
  ]) {
    const malformed = { ...item, record: { S: JSON.stringify(changed) } };
    await client.send(
      new PutItemCommand({ TableName: table, Item: malformed }),
    );
    await expect(store.read(session.idHash)).rejects.toMatchObject({
      code: "session-unavailable",
      status: 503,
    });
    await expect(store.revoke(session.idHash)).rejects.toMatchObject({
      code: "session-unavailable",
      status: 503,
    });
    expect(await raw(session.idHash)).toEqual(malformed);
  }
});
it("withholds cookies on ambiguous insert outcomes and privately rejects storage failures", async () => {
  afterInsert = () => {
    afterInsert = undefined;
    throw Error("Private synthetic response loss");
  };
  await expect(issue()).rejects.toMatchObject({
    message: "Cloud server: session-unavailable",
    status: 503,
  });
  // The committed orphan has only digests; no response exposed a usable raw ID.
  const refs = await directory("synthetic-owner-a");
  expect(refs).toHaveLength(1);
  expect(await raw(refs[0].idHash.S!)).toBeDefined();
  const valid = record();
  await store.insert(valid);
  beforePut = async () => {
    throw Object.assign(Error("Private synthetic throttle"), {
      name: "ProvisionedThroughputExceededException",
    });
  };
  await expect(store.revoke(valid.idHash)).rejects.toMatchObject({
    message: "Cloud server: session-unavailable",
    status: 503,
  });
  expect((await store.read(valid.idHash))?.revoked).toBe(false);
  await expect(store.read("bad-reference")).rejects.toMatchObject({
    status: 503,
  });
});
