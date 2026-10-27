import { randomUUID } from "node:crypto";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  type TransactWriteItemsCommandInput,
} from "@aws-sdk/client-dynamodb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mutationHash,
  type CloudDraft,
} from "../../packages/cloud-protocol/src/index";
import {
  CLOUD_RECEIPT_MS,
  CLOUD_TRASH_MS,
  CloudMutationService,
  validateCloudHead,
  type CloudAccount,
  type CloudMutationRequest,
} from "../../packages/cloud-protocol/src/server";
import { DynamoDBCloudServerStore } from "../../packages/cloud-protocol/src/server-dynamodb";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";

const endpoint = process.env.PEEL_DYNAMODB_ENDPOINT;
if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))
  throw Error(
    "DynamoDB tests require an explicit loopback PEEL_DYNAMODB_ENDPOINT",
  );
const owner = "synthetic-owner",
  collectionId = "synthetic-library";
const scope = { version: 1 as const, collectionId, modeGeneration: 1 };
const initialAccount = (subject = owner): CloudAccount => ({
  version: 1,
  ownerSubject: subject,
  collectionId,
  modeGeneration: 1,
  status: "active",
  entitlement: "active",
  revision: 1,
  sequence: 0,
  wall: 0,
});
const draft = (
  noteId: string,
  bodyMarkdown = "Synthetic original",
): CloudDraft => ({
  schemaVersion: 1,
  collectionId,
  noteId,
  bodyMarkdown,
  state: "active",
  createdAt: "2026-10-27T03:00:00.000Z",
  updatedAt: "2026-10-27T03:00:00.000Z",
  deletedAt: null,
  purgeAfter: null,
});
async function request(
  opId: string,
  noteId = "synthetic-note",
  baseRevision = 0,
  snapshot: CloudDraft | null = draft(noteId),
): Promise<CloudMutationRequest> {
  const mutation = {
    version: 1 as const,
    opId,
    noteId,
    baseRevision,
    kind: snapshot ? ("upsert" as const) : ("purge" as const),
    snapshot,
  };
  return {
    ...scope,
    mutation: { ...mutation, contentHash: await mutationHash(mutation) },
  };
}
let client: DynamoDBClient,
  table: string,
  store: DynamoDBCloudServerStore,
  service: CloudMutationService;
let now: number,
  beforeWrite: (() => Promise<void>) | undefined,
  afterWrite: (() => void) | undefined;
let lastWrite: TransactWriteItemsCommandInput | undefined;
const putAccount = async (account: CloudAccount) =>
  client.send(
    new PutItemCommand({
      TableName: table,
      Item: {
        PK: { S: `USER#${account.ownerSubject}` },
        SK: { S: "META" },
        revision: { N: String(account.revision) },
        record: { S: JSON.stringify(account) },
      },
    }),
  );
async function rows(subject = owner) {
  const result = await client.send(
    new QueryCommand({
      TableName: table,
      ConsistentRead: true,
      KeyConditionExpression: "PK = :owner",
      ExpressionAttributeValues: { ":owner": { S: `USER#${subject}` } },
    }),
  );
  return result.Items!;
}
beforeEach(async () => {
  client = new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    maxAttempts: 1,
    credentials: {
      accessKeyId: "syntheticlocalkey",
      secretAccessKey: "syntheticlocalkey",
    },
  });
  table = `peel-synthetic-${randomUUID()}`;
  now = 1800000000000;
  beforeWrite = undefined;
  afterWrite = undefined;
  lastWrite = undefined;
  client.middlewareStack.add(
    (next, context) => async (args) => {
      if (context.commandName !== "TransactWriteItemsCommand")
        return next(args);
      lastWrite = structuredClone(args.input as TransactWriteItemsCommandInput);
      await beforeWrite?.();
      const result = await next(args);
      afterWrite?.();
      return result;
    },
    { step: "initialize", name: "syntheticTransactionBoundary" },
  );
  await client.send(
    new CreateTableCommand({
      TableName: table,
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      BillingMode: "PAY_PER_REQUEST",
    }),
  );
  await putAccount(initialAccount());
  store = new DynamoDBCloudServerStore(client, table);
  service = new CloudMutationService(store, () => now);
});
afterEach(async () => {
  beforeWrite = undefined;
  afterWrite = undefined;
  await store?.close();
  try {
    if (table) await client.send(new DeleteTableCommand({ TableName: table }));
  } finally {
    client?.destroy();
  }
});

describe("actual DynamoDB Local conditional mutations, FR-04/14 partial", () => {
  it("returns a private retryable HTTP error for throttling and unknown transaction failures", async () => {
    const handler = createCloudMutationHandler(service, async () => owner);
    for (const failure of [
      { name: "ProvisionedThroughputExceededException" },
      {
        name: "TransactionCanceledException",
        CancellationReasons: [{ Code: "ValidationError" }],
      },
      { name: "SyntheticTransportFailure" },
    ]) {
      let attempts = 0;
      beforeWrite = async () => {
        attempts++;
        throw Object.assign(
          Error("Internal synthetic detail and source must stay private"),
          failure,
        );
      };
      const response = await handler(
        new Request("https://synthetic.example/v1/mutations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(await request("failed-operation")),
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "store-unavailable" });
      expect(attempts).toBe(1);
      expect(await rows()).toHaveLength(1);
    }
    beforeWrite = undefined;
    expect(
      (await service.mutate(owner, await request("failed-operation"))).receipt
        .sequence,
    ).toBe(1);
  });

  it("isolates owners with matching IDs and reopens stable receipts with current heads", async () => {
    await putAccount(initialAccount("other-owner"));
    const op = await request("same-op");
    const first = await service.mutate(owner, op);
    await service.mutate(
      "other-owner",
      await request(
        "same-op",
        "synthetic-note",
        0,
        draft("synthetic-note", "Other owner"),
      ),
    );
    await service.mutate(
      owner,
      await request(
        "new-op",
        "synthetic-note",
        1,
        draft("synthetic-note", "Later synthetic source"),
      ),
    );
    await store.close();
    store = new DynamoDBCloudServerStore(client, table);
    const replay = await new CloudMutationService(store, () => now).mutate(
      owner,
      op,
    );
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    expect(replay.head).toMatchObject({
      revision: 2,
      snapshot: { bodyMarkdown: "Later synthetic source" },
    });
    expect(
      await service.get("other-owner", scope, "synthetic-note"),
    ).toMatchObject({ snapshot: { bodyMarkdown: "Other owner" } });
    await expect(service.mutate("unknown-owner", op)).rejects.toMatchObject({
      code: "account-unavailable",
    });
    const records = await rows();
    const bookkeeping = records.filter((row) =>
      /^(OP|CHANGE)#/.test(row.SK.S!),
    );
    expect(JSON.stringify(bookkeeping)).not.toContain("bodyMarkdown");
    expect(bookkeeping).toHaveLength(4);
    for (const row of bookkeeping) {
      const record = JSON.parse(row.record.S!);
      expect(row.ttl.N).toBe(String(Math.ceil(record.expiresAt / 1000)));
    }
  });
  it("atomically resolves same-note races and advances different-note sequences once", async () => {
    const different = await Promise.all([
      service.mutate(owner, await request("op-a", "note-a")),
      service.mutate(owner, await request("op-b", "note-b")),
    ]);
    expect(different.map((result) => result.receipt.sequence).sort()).toEqual([
      1, 2,
    ]);
    const same = await Promise.all([
      service.mutate(owner, await request("same-a")),
      service.mutate(
        owner,
        await request(
          "same-b",
          "synthetic-note",
          0,
          draft("synthetic-note", "Competing source"),
        ),
      ),
    ]);
    expect(same.map((result) => result.receipt.outcome).sort()).toEqual([
      "applied",
      "conflict",
    ]);
    expect((await store.read(owner, "synthetic-note")).account?.sequence).toBe(
      3,
    );
    const changes = (await rows()).filter((row) =>
      row.SK.S!.startsWith("CHANGE#"),
    );
    expect(changes.map((row) => JSON.parse(row.record.S!).sequence)).toEqual([
      1, 2, 3,
    ]);
    const loser = same.find((result) => result.receipt.outcome === "conflict")!;
    const retry = await service.mutate(
      owner,
      await request(
        loser.receipt.opId,
        "synthetic-note",
        0,
        draft(
          "synthetic-note",
          loser.receipt.opId === "same-a"
            ? "Synthetic original"
            : "Competing source",
        ),
      ),
    );
    expect(retry.replayed).toBe(true);
  });
  it("rejects revocation between the final read and transaction without partial writes", async () => {
    beforeWrite = async () => {
      beforeWrite = undefined;
      // Even a broken administrative writer that omits revision advancement cannot bypass policy.
      await putAccount({ ...initialAccount(), entitlement: "inactive" });
    };
    await expect(
      service.mutate(owner, await request("revoked-op")),
    ).rejects.toMatchObject({ code: "cloud-entitlement-inactive" });
    expect(await rows()).toHaveLength(1);
    await putAccount({ ...initialAccount(), revision: 2 });
    await service.mutate(owner, await request("allowed-op"));
    await putAccount({
      ...initialAccount(),
      revision: 4,
      status: "deleted",
      entitlement: "inactive",
      sequence: 1,
    });
    await expect(
      service.get(owner, scope, "synthetic-note"),
    ).rejects.toMatchObject({ code: "account-deleted" });
  });
  it("recovers a committed write after response loss by retrying its immutable operation", async () => {
    afterWrite = () => {
      afterWrite = undefined;
      throw Error("Synthetic response loss after commit");
    };
    const op = await request("lost-response");
    await expect(service.mutate(owner, op)).rejects.toMatchObject({
      code: "store-unavailable",
      status: 503,
    });
    const retry = await new CloudMutationService(
      new DynamoDBCloudServerStore(client, table),
      () => now,
    ).mutate(owner, op);
    expect(retry.replayed).toBe(true);
    expect(retry.receipt.sequence).toBe(1);
    expect((await store.read(owner, "synthetic-note")).account?.sequence).toBe(
      1,
    );
    await expect(
      service.mutate(owner, await request("lost-response", "another-note")),
    ).rejects.toMatchObject({ code: "operation-id-reused" });
  });
  it("purges text atomically with a permanent marker and blocks stale recreation", async () => {
    const trashed = {
      ...draft("synthetic-note"),
      state: "trashed" as const,
      deletedAt: "2099-01-01T00:00:00.000Z",
      purgeAfter: "2100-01-01T00:00:00.000Z",
    };
    const op = await request("trash-op", "synthetic-note", 0, trashed);
    await service.mutate(owner, op);
    now += CLOUD_TRASH_MS;
    expect(await service.get(owner, scope, "synthetic-note")).toMatchObject({
      kind: "purged",
      revision: 2,
    });
    const records = await rows();
    expect(records.some((row) => row.SK.S === "NOTE#synthetic-note")).toBe(
      false,
    );
    const tomb = records.find((row) => row.SK.S === "TOMB#synthetic-note")!;
    expect(tomb.ttl).toBeUndefined();
    expect(JSON.stringify(records)).not.toContain("bodyMarkdown");
    const replay = await service.mutate(owner, op);
    expect(replay.receipt.revision).toBe(1);
    expect(replay.head.kind).toBe("purged");
    expect(
      (
        await service.mutate(
          owner,
          await request("stale-recreate", "synthetic-note", 2),
        )
      ).receipt.outcome,
    ).toBe("conflict");
  });
  it("expires receipts logically without waiting for TTL and cannot repeat successful writes", async () => {
    const op = await request("expired-op");
    const first = await service.mutate(owner, op);
    now += CLOUD_RECEIPT_MS;
    const retry = await service.mutate(owner, op);
    expect(retry.replayed).toBe(false);
    expect(retry.receipt.outcome).toBe("conflict");
    expect(retry.receipt.createdAt).toBe(first.receipt.expiresAt);
    expect((await store.read(owner, "synthetic-note")).account?.sequence).toBe(
      1,
    );
  });
  it("rejects malformed or foreign stored scopes without overwriting them", async () => {
    const item = {
      PK: { S: `USER#${owner}` },
      SK: { S: "META" },
      revision: { N: "1" },
      record: { S: JSON.stringify(initialAccount("foreign-owner")) },
    };
    await client.send(new PutItemCommand({ TableName: table, Item: item }));
    await expect(
      service.mutate(owner, await request("invalid-account")),
    ).rejects.toMatchObject({ code: "stored-scope-mismatch" });
    expect(await rows()).toEqual([item]);
    await client.send(
      new PutItemCommand({
        TableName: table,
        Item: { ...item, record: { S: "malformed" } },
      }),
    );
    await expect(store.read(owner, "synthetic-note")).rejects.toMatchObject({
      code: "unrecognized-stored-record",
    });
  });
  it("retains retry receipts through the entire subsecond deadline despite eligible physical TTL cleanup", async () => {
    now += 321;
    const op = await request("subsecond-retention");
    const first = await service.mutate(owner, op);
    now = first.receipt.expiresAt - 1;
    // Simulate the earliest cleanup AWS may perform at its whole-second TTL.
    for (const row of await rows()) {
      if (row.ttl?.N && Number(row.ttl.N) <= Math.floor(now / 1000)) {
        await client.send(
          new DeleteItemCommand({
            TableName: table,
            Key: { PK: row.PK, SK: row.SK },
          }),
        );
      }
    }
    const beforeDeadline = await service.mutate(owner, op);
    expect(beforeDeadline.replayed).toBe(true);
    expect(beforeDeadline.receipt).toEqual(first.receipt);
    expect(
      (await rows()).filter((row) => row.SK.S!.startsWith("CHANGE#")),
    ).toHaveLength(1);
    // Logical expiry takes effect immediately even when physical deletion lags.
    now = first.receipt.expiresAt;
    const atDeadline = await service.mutate(owner, op);
    expect(atDeadline.replayed).toBe(false);
    expect(atDeadline.receipt.outcome).toBe("conflict");
    expect((await store.read(owner, "synthetic-note")).account?.sequence).toBe(
      1,
    );
  });
  it("bounds actual encoded item size and submits one action per distinct key", async () => {
    // This head alone fits the service budget. DynamoDB keys and attributes push it over.
    const head = {
      kind: "note" as const,
      noteId: "synthetic-note",
      revision: 1,
      snapshot: {
        ...draft("synthetic-note"),
        bodyMarkdown: "",
        serverRevision: 1,
      },
    };
    const remaining = 400 * 1024 - Buffer.byteLength(JSON.stringify(head));
    head.snapshot.bodyMarkdown = "\u0000".repeat(Math.floor(remaining / 6));
    expect(() => validateCloudHead(head)).not.toThrow();
    const { serverRevision: ignored, ...boundedDraft } = head.snapshot;
    await expect(
      service.mutate(
        owner,
        await request("encoding-boundary", "synthetic-note", 0, boundedDraft),
      ),
    ).rejects.toMatchObject({ code: "serialized-item-too-large" });
    expect(lastWrite).toBeUndefined();
    // A still larger head is also rejected by the earlier service budget.
    await expect(
      service.mutate(
        owner,
        await request(
          "oversized-op",
          "synthetic-note",
          0,
          draft("synthetic-note", "\u0000".repeat(80000)),
        ),
      ),
    ).rejects.toMatchObject({ code: "serialized-item-too-large" });
    expect(await rows()).toHaveLength(1);
    await service.mutate(owner, await request("valid-op"));
    expect(lastWrite?.TransactItems).toHaveLength(5);
    const targets = lastWrite!.TransactItems!.map((action) => {
      const operation = action.Put ?? action.Delete ?? action.ConditionCheck!;
      const item = "Item" in operation ? operation.Item : operation.Key;
      return `${item!.PK.S}/${item!.SK.S}`;
    });
    expect(new Set(targets).size).toBe(targets.length);
    // Replaying the old transaction is rejected by DynamoDB, with no partial mutation.
    const before = await rows();
    await expect(
      client.send(new TransactWriteItemsCommand(lastWrite!)),
    ).rejects.toMatchObject({ name: "TransactionCanceledException" });
    expect(await rows()).toEqual(before);
  });
});
