import {
  GetItemCommand,
  QueryCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { CLOUD_PAGE_ITEMS, type CloudPullServerStore } from "./pull";
import {
  CloudServerError,
  validateCloudAccount,
  validateCloudChange,
  validateServerSubject,
} from "./server";
import {
  DynamoDBCloudServerStore,
  cloudDynamoKey,
  decodeCloudDynamoRecord,
} from "./server-dynamodb";

type Item = Record<string, AttributeValue>;
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(value);
const changeKey = (sequence: number) =>
  `CHANGE#${String(sequence).padStart(16, "0")}`;
const unavailable = (): never => {
  throw new CloudServerError("store-unavailable", 503);
};
function limitCheck(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CLOUD_PAGE_ITEMS)
    throw Error("Invalid Cloud page limit");
}
/** Query adapter for the existing signed bootstrap/change service. No Scan or secondary index. */
export class DynamoDBCloudPullStore
  extends DynamoDBCloudServerStore
  implements CloudPullServerStore
{
  private async account(owner: string) {
    validateServerSubject(owner);
    const result = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: cloudDynamoKey(owner, "META"),
        ConsistentRead: true,
      }),
    );
    const account = decodeCloudDynamoRecord(
      result.Item,
      owner,
      "META",
      validateCloudAccount,
    );
    if (account && account.ownerSubject !== owner) return unavailable();
    return account;
  }
  private async range(
    owner: string,
    lower: string,
    upper: string,
    count: number,
    keysOnly: boolean,
    descending = false,
    after?: string,
  ) {
    const items: Item[] = [];
    let previous: string | undefined;
    let start = after === undefined ? undefined : cloudDynamoKey(owner, after);
    for (let calls = 0; calls < 64; calls++) {
      const page = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          ConsistentRead: true,
          KeyConditionExpression:
            "PK = :owner AND SK BETWEEN :lower AND :upper",
          ExpressionAttributeValues: {
            ":owner": { S: `USER#${owner}` },
            ":lower": { S: lower },
            ":upper": { S: upper },
          },
          ...(keysOnly ? { ProjectionExpression: "PK, SK" } : {}),
          ScanIndexForward: !descending,
          Limit: count - items.length,
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      for (const item of page.Items ?? []) {
        const sort = item.SK?.S;
        if (
          item.PK?.S !== `USER#${owner}` ||
          !sort ||
          sort < lower ||
          sort > upper ||
          (previous !== undefined &&
            (descending ? sort >= previous : sort <= previous)) ||
          (after !== undefined && sort <= after)
        )
          return unavailable();
        previous = sort;
        items.push(item);
      }
      if (items.length > count) return unavailable();
      const last = page.LastEvaluatedKey;
      if (!last || !Object.keys(last).length || items.length === count)
        return items;
      const lastSort = last.SK?.S;
      if (
        last.PK?.S !== `USER#${owner}` ||
        !lastSort ||
        lastSort < lower ||
        lastSort > upper ||
        (start &&
          (descending ? lastSort >= start.SK.S! : lastSort <= start.SK.S!)) ||
        (previous !== undefined &&
          (descending ? lastSort > previous : lastSort < previous))
      )
        return unavailable();
      start = last;
    }
    return unavailable();
  }
  async pullMetadata(owner: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = await this.account(owner);
      if (!before)
        return { account: null, noteUpperId: null, tombUpperId: null };
      const notes = await this.range(owner, "NOTE#", "NOTE#~", 1, true, true);
      const tombs = await this.range(owner, "TOMB#", "TOMB#~", 1, true, true);
      const after = await this.account(owner);
      if (JSON.stringify(before) !== JSON.stringify(after)) continue;
      const upper = (items: Item[]) => {
        const value = items[0]?.SK.S?.slice(5) ?? null;
        if (value !== null && !identifier(value)) return unavailable();
        return value;
      };
      return {
        account: after,
        noteUpperId: upper(notes),
        tombUpperId: upper(tombs),
      };
    }
    throw new CloudServerError("store-busy", 503);
  }
  async headKeys(
    owner: string,
    phase: "notes" | "tombstones",
    after: string | null,
    upper: string | null,
    limit: number,
  ) {
    validateServerSubject(owner);
    limitCheck(limit);
    if (
      !["notes", "tombstones"].includes(phase) ||
      [after, upper].some((value) => value !== null && !identifier(value))
    )
      throw Error("Invalid Cloud head bounds");
    const prefix = phase === "notes" ? "NOTE#" : "TOMB#";
    const items =
      upper === null || (after !== null && after >= upper)
        ? []
        : await this.range(
            owner,
            prefix,
            prefix + upper,
            limit + 1,
            true,
            false,
            after === null ? undefined : prefix + after,
          );
    const keys = items.slice(0, limit).map((item) => {
      const id = item.SK.S!.slice(prefix.length);
      if (!identifier(id)) return unavailable();
      return id;
    });
    return {
      account: await this.account(owner),
      keys,
      hasMore: items.length > limit,
    };
  }
  async changesPage(
    owner: string,
    after: number,
    upper: number,
    limit: number,
  ) {
    validateServerSubject(owner);
    limitCheck(limit);
    if (
      ![after, upper].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      after > upper
    )
      throw Error("Invalid Cloud change bounds");
    const items =
      after === upper
        ? []
        : await this.range(
            owner,
            changeKey(after),
            changeKey(upper),
            limit + 1,
            false,
            false,
            changeKey(after),
          );
    const changes = items.slice(0, limit).map((item) => {
      const change = decodeCloudDynamoRecord(
        item,
        owner,
        item.SK.S!,
        validateCloudChange,
      );
      if (!change || item.SK.S !== changeKey(change.sequence))
        return unavailable();
      return change;
    });
    return {
      account: await this.account(owner),
      changes,
      hasMore: items.length > limit,
    };
  }
}
