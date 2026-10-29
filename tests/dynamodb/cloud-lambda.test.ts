import { randomUUID } from "node:crypto";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";
import { beforeEach, afterEach, expect, it } from "vitest";
import {
  createCloudLambdaHandler,
  type CloudLambdaConfig,
  type CloudLambdaResponse,
} from "../../packages/cloud-protocol/src/lambda-http";
import { mutationHash } from "../../packages/cloud-protocol/src/index";
import { DynamoDBCloudWebSessionStore } from "../../packages/cloud-protocol/src/web-session-dynamodb";
import { createCloudWebSessionBoundary } from "../../packages/cloud-protocol/src/web-session";
import type { CloudAccount } from "../../packages/cloud-protocol/src/server";
import type {
  CloudPullStart,
  CloudPullPage,
} from "../../packages/cloud-protocol/src/pull";
import {
  syntheticAccessToken,
  syntheticCognito,
  syntheticJwks,
} from "../fixtures/cloud-auth";
import { cloudDraft, cloudScope } from "../fixtures/cloud-durable-contract";

const origin = "https://peel.example";
const scope = {
  version: 1 as const,
  collectionId: cloudScope.collectionId,
  modeGeneration: 1,
};
const endpoint = process.env.PEEL_DYNAMODB_ENDPOINT;
if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))
  throw Error("Lambda tests require an explicit loopback endpoint");
let client: DynamoDBClient, table: string, cursorKey: CryptoKey, now: number;
const owner = (letter: string) => "synthetic-owner-" + letter;
const account = (subject: string): CloudAccount => ({
  version: 1,
  ownerSubject: subject,
  collectionId: scope.collectionId,
  modeGeneration: 1,
  status: "active",
  entitlement: "active",
  revision: 1,
  sequence: 0,
  wall: 0,
});
const seed = async (record: CloudAccount) =>
  client.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        PK: { S: "USER#" + record.ownerSubject },
        SK: { S: "META" },
        revision: { N: String(record.revision) },
        record: { S: JSON.stringify(record) },
      },
    }),
  );
beforeEach(async () => {
  now = Date.now();
  client = new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    maxAttempts: 1,
    credentials: {
      accessKeyId: "syntheticlocalkey",
      secretAccessKey: "syntheticlocalkey",
    },
  });
  table = "peel-synthetic-" + randomUUID();
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
  await seed(account(owner("a")));
  await seed(account(owner("b")));
  cursorKey = await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
});
afterEach(async () => {
  try {
    await client.send(new DeleteTableCommand({ TableName: table }));
  } finally {
    client.destroy();
  }
});
const handler = (
  authentication: CloudLambdaConfig["authentication"] = {
    kind: "bearer",
    cognito: syntheticCognito,
  },
) =>
  createCloudLambdaHandler(
    { origin, tableName: table, authentication },
    { client, cursorKey, clock: () => now, jwksCache: syntheticJwks() },
  );
const native = (letter: string) => ({
  authorization: "Bearer " + syntheticAccessToken(owner(letter)),
});
function event(
  method: string,
  path: string,
  headers = {},
  payload?: unknown,
  base64 = false,
) {
  const mark = path.indexOf("?");
  const body = payload === undefined ? undefined : JSON.stringify(payload);
  return {
    version: "2.0",
    rawPath: mark < 0 ? path : path.slice(0, mark),
    rawQueryString: mark < 0 ? "" : path.slice(mark + 1),
    headers: { "content-type": "application/json", ...headers },
    isBase64Encoded: base64,
    body:
      body === undefined
        ? undefined
        : base64
          ? Buffer.from(body).toString("base64")
          : body,
    requestContext: {
      domainName: "untrusted.example",
      http: { method },
      authorizer: { jwt: { claims: { sub: "forged-owner" } } },
    },
  };
}
async function mutation(
  opId: string,
  noteId: string,
  body: string | null,
  baseRevision = 0,
) {
  const value = {
    version: 1 as const,
    opId,
    noteId,
    baseRevision,
    kind: body === null ? ("purge" as const) : ("upsert" as const),
    snapshot: body === null ? null : { ...cloudDraft(body), noteId },
  };
  return {
    ...scope,
    mutation: { ...value, contentHash: await mutationHash(value) },
  };
}
function data<T>(response: CloudLambdaResponse, status = 200): T {
  expect(response.statusCode).toBe(status);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.isBase64Encoded).toBe(false);
  return JSON.parse(response.body) as T;
}
it("composes RSA identity, Unicode/base64 mutations, conflicts, isolated reads and signed paginated pulls", async () => {
  const run = handler();
  data(
    await run(
      event(
        "POST",
        "/v1/mutations",
        native("a"),
        await mutation("create-a", "a", "Synthetic 笔记 ##work"),
        true,
      ),
    ),
  );
  data(
    await run(
      event(
        "POST",
        "/v1/mutations",
        native("a"),
        await mutation("create-z", "z", "A second note"),
      ),
    ),
  );
  data(
    await run(
      event(
        "POST",
        "/v1/mutations",
        native("b"),
        await mutation("create-b", "a", "Other owner"),
      ),
    ),
  );
  data(
    await run(
      event(
        "POST",
        "/v1/mutations",
        native("a"),
        await mutation("conflicting-a", "a", "Concurrent edit"),
      ),
    ),
    409,
  );
  const readHeaders = {
    "x-peel-collection": scope.collectionId,
    "x-peel-mode-generation": "1",
  };
  const a = await run(
    event("GET", "/v1/notes/a", {
      ...readHeaders,
      ...native("a"),
      "x-peel-subject": owner("b"),
    }),
  );
  expect(
    data<{ head: { snapshot: { bodyMarkdown: string } } }>(a).head.snapshot
      .bodyMarkdown,
  ).toBe("Synthetic 笔记 ##work");
  const b = await run(
    event("GET", "/v1/notes/a", { ...readHeaders, ...native("b") }),
  );
  expect(
    data<{ head: { snapshot: { bodyMarkdown: string } } }>(b).head.snapshot
      .bodyMarkdown,
  ).toBe("Other owner");
  const start = data<CloudPullStart>(
    await run(event("POST", "/v1/sync/bootstrap", native("a"), scope)),
  );
  data(
    await run(
      event(
        "GET",
        "/v1/notes?" + new URLSearchParams({ pageToken: start.next.token }),
        native("b"),
      ),
    ),
    403,
  );
  data(
    await run(
      event(
        "GET",
        "/v1/notes?" +
          new URLSearchParams([
            ["pageToken", start.next.token],
            ["pageToken", start.next.token],
          ]),
        native("a"),
      ),
    ),
    400,
  );
  let next: CloudPullStart["next"] | null = start.next,
    checkpoint: string | null = null;
  const ids: string[] = [];
  for (let count = 0; next && count < 10; count++) {
    const route: string = next.kind === "heads" ? "/v1/notes" : "/v1/sync";
    const page: CloudPullPage = data(
      await run(
        event(
          "GET",
          route +
            "?" +
            new URLSearchParams({ pageToken: next.token, limit: "1" }),
          native("a"),
        ),
      ),
    );
    if (page.kind === "heads")
      ids.push(...page.heads.map((head) => head.noteId));
    next = page.next;
    checkpoint = page.checkpoint;
  }
  expect(next).toBeNull();
  expect(ids).toEqual(["a", "z"]);
  expect(checkpoint).toBeTypeOf("string");
  data(
    await run(
      event(
        "POST",
        "/v1/mutations",
        native("a"),
        await mutation("purge-a", "a", null, 1),
      ),
    ),
  );
  expect(
    data<{ head: { kind: string } }>(
      await run(
        event("GET", "/v1/notes/a", { ...readHeaders, ...native("a") }),
      ),
    ).head.kind,
  ).toBe("purged");
  const round = data<CloudPullStart>(
    await run(
      event(
        "GET",
        "/v1/sync?" + new URLSearchParams({ after: checkpoint! }),
        native("a"),
      ),
    ),
  );
  const changes = data<CloudPullPage>(
    await run(
      event(
        "GET",
        "/v1/sync?" + new URLSearchParams({ pageToken: round.next.token }),
        native("a"),
      ),
    ),
  );
  expect(changes.kind).toBe("changes");
  expect(
    changes.heads.some((head) => head.noteId === "a" && head.kind === "purged"),
  ).toBe(true);
});
it("resolves durable cookies with CSRF and current paid policy without bearer or metadata fallback", async () => {
  const run = handler({ kind: "web-session", lifetimeMs: 60000 });
  const store = new DynamoDBCloudWebSessionStore(client, table);
  const session = createCloudWebSessionBoundary(
    { origin, lifetimeMs: 60000 },
    store,
    async () => owner("a"),
    () => now,
  );
  const issued = await session.issue(
    new Request(origin + "/auth/session", {
      method: "POST",
      headers: { origin },
    }),
  );
  const cookie = issued.headers.get("set-cookie")!.split(";")[0],
    csrf = (await issued.json()).csrfToken;
  const payload = await mutation("web-create", "web", "Cookie note");
  const input = event(
    "POST",
    "/v1/mutations",
    { origin, "x-peel-csrf": csrf, host: "untrusted.example" },
    payload,
  );
  const cookieEvent = { ...input, cookies: [cookie] };
  data(await run({ ...cookieEvent, headers: { origin } }), 403);
  data(
    await run({
      ...cookieEvent,
      headers: { ...input.headers, origin: "https://untrusted.example" },
    }),
    403,
  );
  data(
    await run({
      ...cookieEvent,
      headers: { ...input.headers, ...native("b") },
    }),
    401,
  );
  data(await run({ ...cookieEvent, cookies: [cookie, cookie] }), 401);
  data(await run(cookieEvent));
  await seed({
    ...account(owner("a")),
    revision: 3,
    sequence: 1,
    wall: now,
    entitlement: "inactive",
  });
  data(
    await run(
      event("GET", "/v1/notes/web", {
        cookie,
        "x-peel-collection": scope.collectionId,
        "x-peel-mode-generation": "1",
      }),
    ),
    403,
  );
  now += 60000;
  data(await run({ ...cookieEvent, body: "Not JSON" }), 401);
});

it("discovers caller-selected-by-auth scope through Lambda bearer and durable web-session boundaries", async () => {
  const second = {
    ...account(owner("b")),
    collectionId: "context-server-b",
    modeGeneration: 5,
  };
  await seed(second);
  const api = handler(),
    path = "/v1/library-context";
  expect(
    data(
      await api(
        event("GET", path, {
          ...native("a"),
          "x-peel-subject": owner("b"),
          "x-peel-collection": second.collectionId,
        }),
      ),
    ),
  ).toEqual({ ...scope, ownerSubject: owner("a") });
  expect(data(await api(event("GET", path, native("b"))))).toEqual({
    version: 1,
    ownerSubject: owner("b"),
    collectionId: second.collectionId,
    modeGeneration: 5,
  });
  expect((await api(event("GET", path))).statusCode).toBe(401);
  expect(
    (await api(event("GET", path + "?ownerSubject=" + owner("b"), native("a"))))
      .statusCode,
  ).toBe(400);
  const boundary = createCloudWebSessionBoundary(
    { origin, lifetimeMs: 3600000 },
    new DynamoDBCloudWebSessionStore(client, table),
    async () => owner("b"),
    () => now,
  );
  const issued = await boundary.issue(
    new Request(origin + "/auth/session", {
      method: "POST",
      headers: { origin },
    }),
  );
  const cookie = issued.headers.get("set-cookie")!.split(";")[0],
    web = handler({ kind: "web-session", lifetimeMs: 3600000 });
  expect(data(await web(event("GET", path, { cookie })))).toEqual({
    version: 1,
    ownerSubject: owner("b"),
    collectionId: second.collectionId,
    modeGeneration: 5,
  });
  expect(
    (
      await web(
        event("GET", path, { cookie, origin: "https://foreign.invalid" }),
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await web(event("GET", path, { cookie, ...native("a") }))).statusCode,
  ).toBe(401);
  await seed({ ...second, entitlement: "inactive", revision: 2 });
  expect((await web(event("GET", path, { cookie }))).statusCode).toBe(403);
  now += 3600001;
  expect((await web(event("GET", path, { cookie }))).statusCode).toBe(401);
});

it("binds safe web reads to the supplied token across durable session rotation before data access", async () => {
  let signingOwner = owner("a");
  const boundary = createCloudWebSessionBoundary(
    { origin, lifetimeMs: 3600000 },
    new DynamoDBCloudWebSessionStore(client, table),
    async () => signingOwner,
    () => now,
  );
  const issue = async (previous?: string) => {
    const response = await boundary.issue(
      new Request(origin + "/auth/session", {
        method: "POST",
        headers: { origin, ...(previous ? { cookie: previous } : {}) },
      }),
    );
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      csrf: (await response.json()).csrfToken as string,
    };
  };
  const a = await issue();
  signingOwner = owner("b");
  const b = await issue(a.cookie);
  let dataReads = 0;
  client.middlewareStack.add(
    (next) => async (args) => {
      if ("TransactItems" in (args.input as object)) dataReads++;
      return next(args);
    },
    { step: "initialize", name: "observeSafeReadDataAccess" },
  );
  const web = handler({ kind: "web-session", lifetimeMs: 3600000 }),
    path = "/v1/library-context";
  expect(
    data(
      await web(
        event("GET", path, { cookie: b.cookie, "x-peel-csrf": a.csrf }),
      ),
      403,
    ),
  ).toEqual({ error: "csrf-rejected" });
  expect(
    data(
      await web(
        event("GET", "/v1/notes/synthetic-note", {
          cookie: b.cookie,
          "x-peel-csrf": a.csrf,
          "x-peel-collection": scope.collectionId,
          "x-peel-mode-generation": "1",
        }),
      ),
      403,
    ),
  ).toEqual({ error: "csrf-rejected" });
  expect(dataReads).toBe(0);
  expect(
    data(
      await web(
        event("GET", path, { cookie: b.cookie, "x-peel-csrf": b.csrf }),
      ),
    ),
  ).toEqual({ ...scope, ownerSubject: owner("b") });
  expect(dataReads).toBe(1);
  expect(data(await web(event("GET", path, { cookie: b.cookie })))).toEqual({
    ...scope,
    ownerSubject: owner("b"),
  });
  expect(dataReads).toBe(2);
  expect(
    (await web(event("GET", path, { cookie: a.cookie, "x-peel-csrf": a.csrf })))
      .statusCode,
  ).toBe(401);
  expect(dataReads).toBe(2);
  const bearer = handler();
  expect(
    data(
      await bearer(
        event("GET", path, { ...native("a"), "x-peel-csrf": b.csrf }),
      ),
    ),
  ).toEqual({ ...scope, ownerSubject: owner("a") });
  expect(dataReads).toBe(3);
  expect(
    (
      await bearer(
        event("GET", path, {
          ...native("a"),
          cookie: b.cookie,
          "x-peel-csrf": b.csrf,
        }),
      )
    ).statusCode,
  ).toBe(401);
  expect(dataReads).toBe(3);
  await seed({ ...account(owner("b")), entitlement: "inactive", revision: 2 });
  expect(
    data(
      await web(
        event("GET", path, { cookie: b.cookie, "x-peel-csrf": b.csrf }),
      ),
      403,
    ),
  ).toEqual({ error: "cloud-entitlement-inactive" });
});
