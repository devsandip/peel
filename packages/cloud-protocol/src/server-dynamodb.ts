import {
  DynamoDBClient,
  TransactGetItemsCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import {
  CloudServerError,
  validateCloudAccount,
  validateCloudHead,
  validateCloudReceipt,
  validateServerSubject,
  type CloudServerCommit,
  type CloudServerRead,
  type CloudServerStore,
} from "./server";
import { validateCloudServerTransition } from "./server-transition";

type Item = Record<string, AttributeValue>;
const id = (value: string) => /^[a-zA-Z0-9-]{1,128}$/.test(value);
const key = (owner: string, sort: string): Item => ({
  PK: { S: `USER#${owner}` },
  SK: { S: sort },
});
/** Flat scalars only; numbers use a conservative 38-byte upper bound. */
function encode(owner: string, sort: string, record: object): Item {
  const item: Item = {
    ...key(owner, sort),
    record: { S: JSON.stringify(record) },
  };
  if ("revision" in record) item.revision = { N: String(record.revision) };
  if ("expiresAt" in record) {
    const expiry = record.expiresAt as number;
    item.expiresAt = { N: String(expiry) };
    item.ttl = { N: String(Math.floor(expiry / 1000)) };
  }
  const bytes = Object.entries(item).reduce(
    (sum, [name, value]) =>
      sum +
      Buffer.byteLength(name) +
      (value.S !== undefined ? Buffer.byteLength(value.S) : 38),
    0,
  );
  if (bytes > 400 * 1024)
    throw new CloudServerError("serialized-item-too-large", 400);
  return item;
}
function decode<T extends object>(
  item: Item | undefined,
  owner: string,
  sort: string,
  validate: (value: T) => T,
): T | null {
  if (!item) return null;
  try {
    const record = validate(JSON.parse(item.record.S!));
    const expected = encode(owner, sort, record);
    if (
      Object.keys(item).length !== Object.keys(expected).length ||
      Object.entries(expected).some(
        ([name, value]) => JSON.stringify(item[name]) !== JSON.stringify(value),
      )
    )
      throw Error();
    return record;
  } catch {
    throw new CloudServerError("unrecognized-stored-record", 503);
  }
}
/** Server-only adapter. The caller owns the explicitly supplied client and table. */
export class DynamoDBCloudServerStore implements CloudServerStore {
  constructor(
    private client: DynamoDBClient,
    private tableName: string,
  ) {
    if (!/^[a-zA-Z0-9_.-]{3,255}$/.test(tableName))
      throw Error("Invalid Cloud table name");
  }
  async read(
    owner: string,
    noteId: string,
    opId?: string,
  ): Promise<CloudServerRead> {
    validateServerSubject(owner);
    if (!id(noteId) || (opId !== undefined && !id(opId)))
      throw Error("Invalid Cloud server read key");
    const sorts = [
      "META",
      `NOTE#${noteId}`,
      `TOMB#${noteId}`,
      ...(opId === undefined ? [] : [`OP#${opId}`]),
    ];
    const result = await this.client.send(
      new TransactGetItemsCommand({
        TransactItems: sorts.map((sort) => ({
          Get: { TableName: this.tableName, Key: key(owner, sort) },
        })),
      }),
    );
    if (result.Responses?.length !== sorts.length)
      throw new CloudServerError("incomplete-store-read", 503);
    const account = decode(
      result.Responses[0].Item,
      owner,
      "META",
      validateCloudAccount,
    );
    const note = decode(
      result.Responses[1].Item,
      owner,
      sorts[1],
      validateCloudHead,
    );
    const tomb = decode(
      result.Responses[2].Item,
      owner,
      sorts[2],
      validateCloudHead,
    );
    const receipt =
      opId === undefined
        ? null
        : decode(
            result.Responses[3].Item,
            owner,
            sorts[3],
            validateCloudReceipt,
          );
    if (
      (account && account.ownerSubject !== owner) ||
      (note && tomb) ||
      (note &&
        (note.kind !== "note" ||
          note.noteId !== noteId ||
          !account ||
          note.snapshot.collectionId !== account.collectionId)) ||
      (tomb &&
        (tomb.kind !== "purged" || tomb.noteId !== noteId || !account)) ||
      (receipt && (!account || receipt.opId !== opId))
    )
      throw new CloudServerError("stored-scope-mismatch", 503);
    return {
      account,
      head: note ?? tomb ?? { kind: "missing", noteId, revision: 0 },
      receipt,
    };
  }
  async commit(
    owner: string,
    noteId: string,
    input: CloudServerCommit,
  ): Promise<boolean> {
    const transition = structuredClone(input);
    const read = await this.read(owner, noteId, transition.receipt?.opId);
    if (!validateCloudServerTransition(owner, noteId, transition, read))
      return false;
    const { account, head, receipt, change } = transition;
    const put = (
      sort: string,
      record: object,
      condition: string,
      values?: Item,
    ): TransactWriteItem => ({
      Put: {
        TableName: this.tableName,
        Item: encode(owner, sort, record),
        ConditionExpression: condition,
        ...(values ? { ExpressionAttributeValues: values } : {}),
      },
    });
    const guard = (sort: string, condition: string, values?: Item) => ({
      TableName: this.tableName,
      Key: key(owner, sort),
      ConditionExpression: condition,
      ...(values ? { ExpressionAttributeValues: values } : {}),
    });
    const absent = "attribute_not_exists(PK)";
    const headCondition =
      read.head.kind === "note" ? "revision = :revision" : absent;
    const headValues =
      read.head.kind === "note"
        ? { ":revision": { N: String(read.head.revision) } }
        : undefined;
    const writes: TransactWriteItem[] = [
      // Exact metadata includes status, paid policy, library, generation and sequence.
      put("META", account, "#record = :previous", {
        ":previous": { S: JSON.stringify(read.account) },
      }),
    ];
    writes[0].Put!.ExpressionAttributeNames = { "#record": "record" };
    if (head?.kind === "note") {
      writes.push(put(`NOTE#${noteId}`, head, headCondition, headValues));
      writes.push({ ConditionCheck: guard(`TOMB#${noteId}`, absent) });
    } else if (head?.kind === "purged") {
      writes.push({
        Delete: guard(`NOTE#${noteId}`, headCondition, headValues),
      });
      writes.push(put(`TOMB#${noteId}`, head, absent));
    } else {
      writes.push({
        ConditionCheck: guard(`NOTE#${noteId}`, headCondition, headValues),
      });
      writes.push({
        ConditionCheck: guard(
          `TOMB#${noteId}`,
          read.head.kind === "purged" ? "revision = :revision" : absent,
          read.head.kind === "purged"
            ? { ":revision": { N: String(read.head.revision) } }
            : undefined,
        ),
      });
    }
    if (receipt)
      writes.push(
        put(`OP#${receipt.opId}`, receipt, `${absent} OR expiresAt <= :now`, {
          ":now": { N: String(account.wall) },
        }),
      );
    if (change)
      writes.push(
        put(
          `CHANGE#${String(change.sequence).padStart(16, "0")}`,
          change,
          absent,
        ),
      );
    try {
      await this.client.send(
        new TransactWriteItemsCommand({ TransactItems: writes }),
      );
      return true;
    } catch (error) {
      const failure = error as {
        name?: string;
        CancellationReasons?: { Code?: string }[];
      };
      if (
        failure.name === "TransactionCanceledException" &&
        failure.CancellationReasons?.some(
          (reason) =>
            reason.Code === "ConditionalCheckFailed" ||
            reason.Code === "TransactionConflict",
        ) &&
        failure.CancellationReasons.every(
          (reason) =>
            !reason.Code ||
            ["None", "ConditionalCheckFailed", "TransactionConflict"].includes(
              reason.Code,
            ),
        )
      )
        return false;
      // Throttling, transport and unknown outcomes are not successful writes or note conflicts.
      throw new CloudServerError("store-unavailable", 503);
    }
  }
  async close() {} // Shared client lifetime belongs to the server composition root.
}
