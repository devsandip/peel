import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  TransactWriteItemsCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { CloudServerError } from "./server";
import { cloudDynamoKey } from "./server-dynamodb";
import {
  validateCloudWebSession,
  type CloudWebSession,
  type CloudWebSessionStore,
} from "./web-session";

type Item = Record<string, AttributeValue>;
const unavailable = (): never => {
  throw new CloudServerError("session-unavailable", 503);
};
function lookupKey(idHash: string): Item {
  if (typeof idHash !== "string" || !/^[a-f0-9]{64}$/.test(idHash))
    return unavailable();
  return { PK: { S: `SESSION#${idHash}` }, SK: { S: "META" } };
}
function lookup(record: CloudWebSession): Item {
  return {
    ...lookupKey(record.idHash),
    record: { S: JSON.stringify(record) },
    ttl: { N: String(Math.ceil(record.expiresAt / 1000)) },
  };
}
function decoded(
  item: Item | undefined,
  idHash: string,
): CloudWebSession | null {
  if (!item) return null;
  try {
    const record = validateCloudWebSession(JSON.parse(item.record.S!));
    const expected = lookup(record);
    if (
      record.idHash !== idHash ||
      Object.keys(item).length !== Object.keys(expected).length ||
      Object.entries(expected).some(
        ([key, value]) => JSON.stringify(item[key]) !== JSON.stringify(value),
      )
    )
      return unavailable();
    return record;
  } catch {
    return unavailable();
  }
}
/** Server-only store. The caller owns table provisioning and the shared client's lifetime. */
export class DynamoDBCloudWebSessionStore implements CloudWebSessionStore {
  constructor(
    private client: DynamoDBClient,
    private tableName: string,
  ) {
    if (!/^[a-zA-Z0-9_.-]{3,255}$/.test(tableName))
      throw Error("Invalid session table name");
  }
  async read(idHash: string): Promise<CloudWebSession | null> {
    const key = lookupKey(idHash);
    try {
      const result = await this.client.send(
        new GetItemCommand({
          TableName: this.tableName,
          Key: key,
          ConsistentRead: true,
        }),
      );
      return decoded(result.Item, idHash);
    } catch {
      return unavailable();
    }
  }
  async insert(input: CloudWebSession): Promise<boolean> {
    let record: CloudWebSession;
    try {
      record = validateCloudWebSession(input);
      if (record.revoked) return unavailable();
    } catch {
      return unavailable();
    }
    const entry = lookup(record);
    const directory = {
      ...cloudDynamoKey(record.subject, `WEBSESSION#${record.idHash}`),
      idHash: { S: record.idHash },
      ttl: entry.ttl,
    };
    try {
      await this.client.send(
        new TransactWriteItemsCommand({
          TransactItems: [entry, directory].map((Item) => ({
            Put: {
              TableName: this.tableName,
              Item,
              ConditionExpression: "attribute_not_exists(PK)",
            },
          })),
        }),
      );
      return true;
    } catch (error) {
      const failure = error as {
        name?: string;
        CancellationReasons?: { Code?: string }[];
      };
      if (
        failure?.name === "TransactionCanceledException" &&
        failure.CancellationReasons?.some(
          (reason) => reason.Code === "ConditionalCheckFailed",
        ) &&
        failure.CancellationReasons.every(
          (reason) =>
            !reason.Code ||
            ["None", "ConditionalCheckFailed"].includes(reason.Code),
        )
      )
        return false;
      return unavailable();
    }
  }
  async revoke(idHash: string): Promise<void> {
    const key = lookupKey(idHash);
    for (let attempt = 0; attempt < 8; attempt++) {
      const previous = await this.read(idHash);
      if (!previous || previous.revoked) return;
      try {
        await this.client.send(
          new PutItemCommand({
            TableName: this.tableName,
            Item: lookup({ ...previous, revoked: true }),
            ConditionExpression: "#record = :previous",
            ExpressionAttributeNames: { "#record": "record" },
            ExpressionAttributeValues: {
              ":previous": { S: JSON.stringify(previous) },
            },
          }),
        );
        return;
      } catch (error) {
        if (
          (error as { name?: string })?.name ===
          "ConditionalCheckFailedException"
        )
          continue;
        return unavailable();
      }
    }
    return unavailable();
  }
}
