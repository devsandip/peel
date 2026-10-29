import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { expect, it, vi } from "vitest";
import {
  CloudMutationService,
  CloudServerError,
  requireCloudAccount,
  type CloudAccount,
  type CloudServerStore,
} from "../../packages/cloud-protocol/src/server";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  DynamoDBCloudServerStore,
  cloudDynamoKey,
} from "../../packages/cloud-protocol/src/server-dynamodb";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";

const now = 1800000000000,
  subject = "synthetic-context-a",
  table = "synthetic-context-table";
const account = (ownerSubject = subject): CloudAccount => ({
  version: 1,
  ownerSubject,
  collectionId: "server-library-a",
  modeGeneration: 7,
  status: "active",
  entitlement: "active",
  revision: 1,
  sequence: 0,
  wall: 0,
});
const projection = (value = account()) => ({
  version: 1,
  ownerSubject: value.ownerSubject,
  collectionId: value.collectionId,
  modeGeneration: value.modeGeneration,
});
const item = (value = account()) => ({
  PK: { S: `USER#${subject}` },
  SK: { S: "META" },
  record: { S: JSON.stringify(value) },
  revision: { N: String(value.revision) },
});
async function fixture(
  run: (f: Awaited<ReturnType<typeof create>>) => Promise<void>,
) {
  const f = await create();
  try {
    await f.store.seedAccount(account());
    await run(f);
  } finally {
    await f.store.close();
    rmSync(f.folder, { recursive: true, force: true });
  }
}
async function create() {
  const folder = mkdtempSync(join(tmpdir(), "synkies-context-")),
    path = join(folder, "server.sqlite3"),
    store = new SQLiteCloudServerStore(path);
  const service = new CloudMutationService(store, () => now),
    reads = vi.spyOn(store, "readAccount"),
    noteReads = vi.spyOn(store, "read"),
    commits = vi.spyOn(store, "commit");
  const handler = createCloudMutationHandler(service, async (request) => {
    const owner = request.headers.get("authorization");
    if (owner !== subject && owner !== "synthetic-context-b")
      throw new CloudServerError("unauthorized", 401);
    return owner;
  });
  const request = (
    suffix = "",
    headers: Record<string, string> = {},
    method = "GET",
  ) =>
    new Request("https://synthetic.invalid/v1/library-context" + suffix, {
      method,
      headers: { authorization: subject, ...headers },
    });
  return {
    folder,
    path,
    store,
    service,
    reads,
    noteReads,
    commits,
    handler,
    request,
  };
}

it("discovers only server-selected scope with a metadata-only SQLite read and no mutation", async () =>
  fixture(async (f) => {
    const response = await f.handler(
      f.request("", {
        "x-peel-subject": "synthetic-context-b",
        "x-peel-collection": "forged-library",
        "x-peel-mode-generation": "99",
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(projection());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.reads).toHaveBeenCalledExactlyOnceWith(subject);
    expect(f.noteReads).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
    expect(await f.store.readAccount(subject)).toEqual(account());
    const b = {
      ...account("synthetic-context-b"),
      collectionId: "server-library-b",
      modeGeneration: 2,
    };
    await f.store.seedAccount(b);
    expect(
      await (
        await f.handler(f.request("", { authorization: b.ownerSubject }))
      ).json(),
    ).toEqual(projection(b));
    expect(await f.service.libraryContext(subject)).toEqual(projection());
  }));

it("authenticates before any account read or body inspection and refuses caller selectors", async () =>
  fixture(async (f) => {
    const denied = await f.handler(
      f.request("", { authorization: "forged", "content-length": "10" }),
    );
    expect(denied.status).toBe(401);
    expect(f.reads).not.toHaveBeenCalled();
    for (const query of [
      "?ownerSubject=synthetic-context-b",
      "?collectionId=forged",
      "?modeGeneration=2",
      "?paid=true",
      "?token=private",
    ])
      expect((await f.handler(f.request(query))).status).toBe(400);
    for (const method of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"])
      expect((await f.handler(f.request("", {}, method))).status).toBe(405);
    const bodyHeaders: Record<string, string>[] = [
      { "content-length": "1" },
      { "content-length": "invalid" },
      { "transfer-encoding": "chunked" },
    ];
    for (const headers of bodyHeaders)
      expect((await f.handler(f.request("", headers))).status).toBe(400);
    const body = f.request();
    Object.defineProperty(body, "body", { value: new ReadableStream() });
    expect((await f.handler(body)).status).toBe(400);
    expect(body.bodyUsed).toBe(false);
    expect(f.reads).not.toHaveBeenCalled();
    expect(
      (await f.handler(f.request("", { "content-length": "0" }))).status,
    ).toBe(200);
  }));

it.each([
  ["missing", 401],
  ["unpaid", 403],
  ["deleted", 410],
  ["clock", 503],
  ["corrupt", 503],
  ["foreign", 503],
] as const)(
  "refuses actual SQLite %s account context without returning metadata",
  async (kind, status) =>
    fixture(async (f) => {
      if (kind === "unpaid")
        await f.store.setPolicy(subject, "active", "inactive");
      if (kind === "deleted")
        await f.store.setPolicy(subject, "deleted", "inactive");
      const admin = new DatabaseSync(f.path);
      try {
        if (kind === "missing")
          admin
            .prepare("DELETE FROM m0_cloud_server_accounts WHERE owner=?")
            .run(subject);
        if (["corrupt", "foreign", "clock"].includes(kind)) {
          const next =
            kind === "corrupt"
              ? { ...account(), private: "never-display-storage-payload" }
              : kind === "foreign"
                ? account("synthetic-other")
                : { ...account(), wall: now + 1 };
          admin
            .prepare(
              "UPDATE m0_cloud_server_accounts SET state=? WHERE owner=?",
            )
            .run(JSON.stringify(next), subject);
        }
      } finally {
        admin.close();
      }
      const response = await f.handler(f.request());
      expect(response.status).toBe(status);
      const raw = await response.text();
      expect(Object.keys(JSON.parse(raw))).toEqual(["error"]);
      for (const secret of [
        subject,
        "server-library-a",
        "never-display",
        "sequence",
        "revision",
      ])
        expect(raw).not.toContain(secret);
      expect(f.commits).not.toHaveBeenCalled();
      expect(f.noteReads).not.toHaveBeenCalled();
    }),
);

it("hides account-read failure and keeps existing scope-before-clock error ordering", async () =>
  fixture(async (f) => {
    f.reads.mockRejectedValueOnce(Error("synthetic private disk path"));
    const response = await f.handler(f.request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service-unavailable" });
    expect(() =>
      requireCloudAccount(
        account(),
        subject,
        { version: 1, collectionId: "wrong-library", modeGeneration: 1 },
        -1,
      ),
    ).toThrow("collection-generation-mismatch");
    const bad: CloudServerStore = {
      readAccount: async () => account("foreign"),
      read: async () => {
        throw Error("No note probe");
      },
      commit: async () => {
        throw Error("No write");
      },
      close: async () => {},
    };
    await expect(
      new CloudMutationService(bad, () => now).libraryContext(subject),
    ).rejects.toMatchObject({ status: 401 });
    const read = vi.spyOn(bad, "readAccount");
    await expect(
      new CloudMutationService(bad).libraryContext("bad/subject"),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  }));

function sdkFixture() {
  const control = {
      reply: { Responses: [{ Item: item() }] } as unknown,
      fail: false,
    },
    requests: { body: string; headers: Record<string, string> }[] = [];
  const client = new DynamoDBClient({
    endpoint: "http://127.0.0.1:1",
    region: "us-east-1",
    maxAttempts: 1,
    credentials: {
      accessKeyId: "syntheticlocalkey",
      secretAccessKey: "syntheticlocalkey",
    },
    requestHandler: {
      async handle(request: any) {
        requests.push({ body: request.body, headers: request.headers });
        if (control.fail) throw Error("synthetic private SDK detail");
        return {
          response: {
            statusCode: 200,
            headers: { "content-type": "application/x-amz-json-1.0" },
            body: Buffer.from(JSON.stringify(control.reply)),
          },
        };
      },
    },
  });
  return {
    control,
    requests,
    client,
    store: new DynamoDBCloudServerStore(client, table),
  };
}
it("uses the pinned SDK serializer/signing stack for exactly one caller META read", async () => {
  const f = sdkFixture();
  try {
    expect(await f.store.readAccount(subject)).toEqual(account());
    expect(f.requests).toHaveLength(1);
    expect(JSON.parse(f.requests[0].body)).toEqual({
      TransactItems: [
        { Get: { TableName: table, Key: cloudDynamoKey(subject, "META") } },
      ],
    });
    expect(f.requests[0].headers["x-amz-target"]).toBe(
      "DynamoDB_20120810.TransactGetItems",
    );
    await expect(f.store.readAccount("bad/subject")).rejects.toThrow();
    expect(f.requests).toHaveLength(1);
    f.control.reply = { Responses: [{}] };
    expect(await f.store.readAccount(subject)).toBeNull();
  } finally {
    f.client.destroy();
  }
});

it.each([
  "missing-response",
  "empty-response",
  "extra-response",
  "null-entry",
  "foreign-key",
  "foreign-record",
  "revision",
  "extra-field",
  "sdk-failure",
])("privately refuses SDK %s without a note read or grant", async (kind) => {
  const f = sdkFixture();
  try {
    const wrong = item();
    if (kind === "foreign-key") wrong.PK.S = "USER#foreign";
    if (kind === "foreign-record")
      wrong.record.S = JSON.stringify(account("foreign"));
    if (kind === "revision") wrong.revision.N = "99";
    if (kind === "extra-field")
      Object.assign(wrong, { secret: { S: "private payload" } });
    f.control.reply =
      kind === "missing-response"
        ? {}
        : {
            Responses:
              kind === "empty-response"
                ? []
                : kind === "extra-response"
                  ? [{}, {}]
                  : kind === "null-entry"
                    ? [null]
                    : [{ Item: wrong }],
          };
    f.control.fail = kind === "sdk-failure";
    const handler = createCloudMutationHandler(
        new CloudMutationService(f.store, () => now),
        async () => subject,
      ),
      result = await handler(
        new Request("https://synthetic.invalid/v1/library-context"),
      );
    expect(result.status).toBe(503);
    const body = await result.text();
    expect(Object.keys(JSON.parse(body))).toEqual(["error"]);
    expect(body).not.toMatch(/private|payload|foreign|USER#|server-library-a/);
    expect(f.requests).toHaveLength(1);
  } finally {
    f.client.destroy();
  }
});

it("discovery never authorizes a later data read after entitlement or mode changes", async () =>
  fixture(async (f) => {
    const discovered = await f.service.libraryContext(subject),
      scope = {
        version: discovered.version,
        collectionId: discovered.collectionId,
        modeGeneration: discovered.modeGeneration,
      };
    await f.store.setPolicy(subject, "active", "inactive");
    await expect(
      f.service.get(subject, scope, "test-note"),
    ).rejects.toMatchObject({ status: 403 });
    await f.store.setPolicy(subject, "active", "active");
    const current = (await f.store.readAccount(subject))!,
      admin = new DatabaseSync(f.path);
    try {
      admin
        .prepare("UPDATE m0_cloud_server_accounts SET state=? WHERE owner=?")
        .run(
          JSON.stringify({
            ...current,
            modeGeneration: current.modeGeneration + 1,
          }),
          subject,
        );
    } finally {
      admin.close();
    }
    await expect(
      f.service.get(subject, scope, "test-note"),
    ).rejects.toMatchObject({ status: 409 });
    expect(await f.service.libraryContext(subject)).toEqual({
      ...discovered,
      modeGeneration: discovered.modeGeneration + 1,
    });
  }));
