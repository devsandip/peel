import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  type QueryCommandInput,
  type QueryCommandOutput,
} from "@aws-sdk/client-dynamodb";
import { expect, it } from "vitest";
import { mutationHash } from "../../packages/cloud-protocol/src/index";
import {
  CloudMutationService,
  CLOUD_RECEIPT_MS,
  type CloudAccount,
} from "../../packages/cloud-protocol/src/server";
import {
  CloudCursorSigner,
  CloudPullService,
  type CloudPullStart,
  type CloudPullPage,
} from "../../packages/cloud-protocol/src/pull";
import { DynamoDBCloudPullStore } from "../../packages/cloud-protocol/src/pull-dynamodb";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { DurableCloudPull } from "../../packages/cloud-protocol/src/pull-local";
import { DurableCloudClient } from "../../packages/cloud-protocol/src/durable";
import { cloudDraft, cloudScope } from "../fixtures/cloud-durable-contract";
const subject = cloudScope.ownerSubject;
const scope = {
  version: 1 as const,
  collectionId: cloudScope.collectionId,
  modeGeneration: 1,
};
const BASE = 1800000000000;
const mutation = async (
  opId: string,
  noteId: string,
  baseRevision = 0,
  text: string | null = noteId,
) => {
  const payload = {
    version: 1 as const,
    opId,
    noteId,
    baseRevision,
    kind: text === null ? ("purge" as const) : ("upsert" as const),
    snapshot: text === null ? null : { ...cloudDraft(text), noteId },
  };
  return {
    ...scope,
    mutation: { ...payload, contentHash: await mutationHash(payload) },
  };
};
async function fixture(
  run: (env: {
    client: DynamoDBClient;
    table: string;
    folder: string;
    store: DynamoDBCloudPullStore;
    service: CloudMutationService;
    pull: CloudPullService;
    signer: CloudCursorSigner;
    now: { value: number };
    queries: QueryCommandInput[];
    hooks: {
      beforeQuery?: (input: QueryCommandInput) => void;
      afterQuery?: (
        input: QueryCommandInput,
        output: QueryCommandOutput,
      ) => Promise<void>;
    };
    putAccount: (account: CloudAccount) => Promise<void>;
    account: CloudAccount;
  }) => Promise<void>,
) {
  const endpoint = process.env.PEEL_DYNAMODB_ENDPOINT;
  if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint))
    throw Error("DynamoDB tests require an explicit loopback endpoint");
  const client = new DynamoDBClient({
    endpoint,
    region: "us-east-1",
    maxAttempts: 1,
    credentials: {
      accessKeyId: "syntheticlocalkey",
      secretAccessKey: "syntheticlocalkey",
    },
  });
  const table = `peel-synthetic-${randomUUID()}`,
    folder = await mkdtemp(join(tmpdir(), "peel-synthetic-pull-"));
  const queries: QueryCommandInput[] = [],
    hooks: {
      beforeQuery?: (input: QueryCommandInput) => void;
      afterQuery?: (
        input: QueryCommandInput,
        output: QueryCommandOutput,
      ) => Promise<void>;
    } = {};
  client.middlewareStack.add(
    (next, context) => async (args) => {
      if (context.commandName !== "QueryCommand") return next(args);
      const input = args.input as QueryCommandInput;
      queries.push(structuredClone(input));
      hooks.beforeQuery?.(input);
      const result = await next(args);
      await hooks.afterQuery?.(input, result.output as QueryCommandOutput);
      return result;
    },
    { step: "initialize", name: "syntheticQueryBoundary" },
  );
  const putAccount = async (account: CloudAccount) => {
    await client.send(
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
  };
  const account: CloudAccount = {
    version: 1,
    ownerSubject: subject,
    collectionId: scope.collectionId,
    modeGeneration: 1,
    status: "active",
    entitlement: "active",
    revision: 1,
    sequence: 0,
    wall: 0,
  };
  const now = { value: BASE };
  const store = new DynamoDBCloudPullStore(client, table),
    service = new CloudMutationService(store, () => now.value);
  try {
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
    await putAccount(account);
    const signer = new CloudCursorSigner(
      await crypto.subtle.generateKey(
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      ),
      () => now.value,
    );
    await run({
      client,
      table,
      folder,
      store,
      service,
      pull: new CloudPullService(store, signer, () => now.value),
      signer,
      now,
      queries,
      hooks,
      putAccount,
      account,
    });
  } finally {
    hooks.afterQuery = undefined;
    hooks.beforeQuery = undefined;
    try {
      await client.send(new DeleteTableCommand({ TableName: table }));
    } finally {
      client.destroy();
      await rm(folder, { recursive: true, force: true });
    }
  }
}
async function pages(
  pull: CloudPullService,
  start: CloudPullStart,
  use: (page: CloudPullPage) => Promise<void> = async () => {},
  limit = 32,
) {
  let next = start.next;
  const result: CloudPullPage[] = [];
  for (let count = 0; count < 100; count++) {
    const page = await pull.page(subject, next, limit);
    result.push(page);
    await use(page);
    if (!page.next) return result;
    next = page.next;
  }
  throw Error("Synthetic pull did not terminate");
}
it("follows actual engine byte-limited continuation and public byte limits without losing notes", async () =>
  fixture(async ({ service, store, pull, queries, hooks }) => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    for (const id of ids)
      await service.mutate(
        subject,
        await mutation(`large-${id}`, id, 0, "x".repeat(200000)),
      );
    queries.length = 0;
    // Unresolved: Local did not return a byte-limited page for this fixture.
    // This projection-removal attempt also fails the continuation assertion below.
    hooks.beforeQuery = (input) => {
      delete input.ProjectionExpression;
    };
    expect(
      (await store.headKeys(subject, "notes", null, "f", 32)).keys,
    ).toEqual(ids);
    expect(queries.some((query) => query.ExclusiveStartKey)).toBe(true);
    expect(
      queries.every(
        (query) =>
          query.ConsistentRead && query.ProjectionExpression === "PK, SK",
      ),
    ).toBe(true);
    hooks.beforeQuery = undefined;
    const download = await pages(pull, await pull.bootstrap(subject, scope));
    const heads = download
      .filter((page) => page.kind === "heads")
      .flatMap((page) => page.heads);
    expect(heads.map((head) => head.noteId)).toEqual(ids);
    expect(
      download.filter((page) => page.kind === "heads")[0].heads,
    ).toHaveLength(2);
    expect(download.at(-1)?.throughSequence).toBe(6);
  }));
it("reconciles edits, out-of-bound creates and purges into durable local pages, then resumes after offline edits", async () =>
  fixture(
    async ({ client, table, folder, store, service, pull, signer, now }) => {
      for (const id of ["a", "b", "c"])
        await service.mutate(subject, await mutation(`seed-${id}`, id));
      const localStore = new SQLiteCloudStateStore(
        join(folder, "client.sqlite3"),
      );
      const local = new DurableCloudPull(localStore, cloudScope),
        repo = new DurableCloudClient(localStore, cloudScope);
      try {
        const start = await pull.bootstrap(subject, scope);
        await local.begin(start, null);
        let changed = false,
          changedAfterUpper = false;
        const downloaded = await pages(
          pull,
          start,
          async (page) => {
            await local.apply(page);
            if (!changed) {
              changed = true;
              await service.mutate(subject, await mutation("new-before", "0"));
              await service.mutate(subject, await mutation("new-after", "z"));
              await service.mutate(
                subject,
                await mutation("edit-b", "b", 1, "B2"),
              );
              await service.mutate(
                subject,
                await mutation("purge-c", "c", 1, null),
              );
            }
            if (page.kind === "changes" && !changedAfterUpper) {
              changedAfterUpper = true;
              await service.mutate(subject, await mutation("late-op", "late"));
            }
          },
          1,
        );
        expect(
          downloaded
            .filter((page) => page.kind === "changes")
            .every((page) => page.upperSequence === 7),
        ).toBe(true);
        expect((await repo.get("0"))?.baseRevision).toBe(1);
        expect((await repo.get("z"))?.baseRevision).toBe(1);
        expect((await repo.get("b"))?.current?.snapshot?.bodyMarkdown).toBe(
          "B2",
        );
        expect((await repo.get("c"))?.current?.kind).toBe("purge");
        expect(await repo.get("late")).toBeNull();
        const progress = (await local.progress())!;
        const reopened = new CloudPullService(
          new DynamoDBCloudPullStore(client, table),
          signer,
          () => now.value,
        );
        const round = await reopened.resume(subject, progress.checkpoint!);
        await local.begin(round, progress.generation);
        await pages(
          reopened,
          round,
          async (page) => {
            await local.apply(page);
          },
          1,
        );
        expect((await repo.get("late"))?.baseRevision).toBe(1);
        expect((await local.progress())?.throughSequence).toBe(8);
      } finally {
        await localStore.close();
      }
    },
  ));
it("retries changed metadata bounds and stops after bounded continuous contention", async () =>
  fixture(async ({ store, service, hooks }) => {
    await service.mutate(subject, await mutation("seed-a", "a"));
    hooks.afterQuery = async () => {
      hooks.afterQuery = undefined;
      await service.mutate(subject, await mutation("new-z", "z"));
    };
    expect(await store.pullMetadata(subject)).toMatchObject({
      account: { sequence: 2 },
      noteUpperId: "z",
      tombUpperId: null,
    });
    let writes = 0;
    hooks.afterQuery = async (input) => {
      if (input.ExpressionAttributeValues?.[":lower"].S !== "NOTE#") return;
      await service.mutate(
        subject,
        await mutation(`contention-${++writes}`, `new-${writes}`),
      );
    };
    await expect(store.pullMetadata(subject)).rejects.toMatchObject({
      code: "store-busy",
    });
    expect(writes).toBe(8);
  }));
it("rejects foreign and tampered cursors and policy revocation while a head query is in flight", async () =>
  fixture(async ({ pull, service, hooks, putAccount, account }) => {
    await service.mutate(subject, await mutation("seed-a", "a"));
    const start = await pull.bootstrap(subject, scope);
    await expect(pull.page("other-subject", start.next)).rejects.toMatchObject({
      code: "foreign-page-token",
    });
    await expect(
      pull.page(subject, { ...start.next, token: start.next.token + "a" }),
    ).rejects.toMatchObject({ code: "invalid-page-token" });
    hooks.afterQuery = async (input) => {
      if (input.ScanIndexForward === false) return;
      hooks.afterQuery = undefined;
      await putAccount({
        ...account,
        revision: 3,
        sequence: 1,
        entitlement: "inactive",
        wall: BASE,
      });
    };
    await expect(pull.page(subject, start.next)).rejects.toMatchObject({
      code: "cloud-entitlement-inactive",
    });
  }));
it("requires a new snapshot on missing changes and on an expired checkpoint", async () =>
  fixture(async ({ client, table, pull, service, now }) => {
    const empty = await pages(pull, await pull.bootstrap(subject, scope));
    const checkpoint = empty.at(-1)!.checkpoint!;
    await service.mutate(subject, await mutation("seed-a", "a"));
    const round = await pull.resume(subject, checkpoint);
    await client.send(
      new DeleteItemCommand({
        TableName: table,
        Key: {
          PK: { S: `USER#${subject}` },
          SK: { S: "CHANGE#0000000000000001" },
        },
      }),
    );
    await expect(pull.page(subject, round.next)).rejects.toMatchObject({
      code: "snapshot-required",
    });
    now.value += CLOUD_RECEIPT_MS;
    await expect(pull.resume(subject, checkpoint)).rejects.toMatchObject({
      code: "snapshot-required",
    });
  }));
it("continues an injected empty SDK page and rejects a non-progressing continuation", async () =>
  fixture(async ({ store, service, hooks }) => {
    await service.mutate(subject, await mutation("seed-a", "a"));
    await service.mutate(subject, await mutation("seed-b", "b"));
    const empty = async (
      _input: QueryCommandInput,
      output: QueryCommandOutput,
    ) => {
      output.Items = [];
      output.LastEvaluatedKey = {
        PK: { S: `USER#${subject}` },
        SK: { S: "NOTE#0" },
      };
    };
    hooks.afterQuery = async (input, output) => {
      hooks.afterQuery = undefined;
      await empty(input, output);
    };
    expect(
      (await store.headKeys(subject, "notes", null, "b", 32)).keys,
    ).toEqual(["a", "b"]);
    hooks.afterQuery = empty;
    await expect(
      store.headKeys(subject, "notes", null, "b", 32),
    ).rejects.toMatchObject({ code: "store-unavailable" });
  }));
