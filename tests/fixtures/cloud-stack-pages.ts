import { vi } from "vitest";
import { cloudDataIdentityTemplate } from "../../infra/cloud/data-identity.ts";
import {
  cloudCleanupGuardTemplate,
  cloudCleanupSentinelTemplate,
} from "../../infra/cloud/cleanup.ts";
import {
  cloudArtifactBootstrapTemplate,
  cloudPrivateHostingTemplate,
} from "../../infra/cloud/private-hosting.ts";
import { createHash } from "node:crypto";
import {
  cloudExpectedInventory,
  type CloudInventoryInput,
} from "../../infra/cloud/expected-inventory.ts";
import {
  collectCloudInspectionIdentity,
  type CloudInspectionCommand,
} from "../../infra/cloud/inspection-identity.ts";
import type { CloudStackCommand } from "../../infra/cloud/stack-metadata.ts";

// Synthetic metadata only. These IDs do not establish managed provider shape/ownership acceptance.
export function cloudStackFixture() {
  const accountId = "111122223333",
    runId = "00000000-0000-4000-8000-000000000001",
    inventory: CloudInventoryInput = {
      accountId,
      region: "us-east-1",
      runId,
      artifact: { sha256: "a".repeat(64), bytes: 1024 },
      lease: {
        startedAt: "2026-10-27T12:00:00.000Z",
        expiresAt: "2026-10-27T13:30:00.000Z",
      },
      templatesSha256: "",
    },
    templates = JSON.stringify({
      "data-identity": cloudDataIdentityTemplate(runId),
      "artifact-bootstrap": cloudArtifactBootstrapTemplate(runId),
      "cleanup-guard": cloudCleanupGuardTemplate(inventory),
      "cleanup-sentinel": cloudCleanupSentinelTemplate(runId),
      "private-hosting": cloudPrivateHostingTemplate(inventory),
    });
  inventory.templatesSha256 = createHash("sha256")
    .update(templates)
    .digest("hex");
  const input = { profile: "synthetic-dev", inventory, templates },
    expected = cloudExpectedInventory(inventory, templates),
    caller = {
      Account: accountId,
      Arn: `arn:aws:sts::${accountId}:assumed-role/AWSReservedSSO_Synthetic_0123456789abcdef/private-session`,
    },
    summaries = expected.stacks.map((stack, i) => ({
      StackId: `arn:aws:cloudformation:us-east-1:${accountId}:stack/${stack.name}/10000000-0000-0000-0000-00000000000${i}`,
      StackName: stack.name,
      Status: "CREATE_COMPLETE",
    }));
  const stackPages = [
    { NextToken: "next", Count: 50, Stacks: summaries.slice(0, 2) },
    { NextToken: null, Count: 2, Stacks: summaries.slice(2) },
  ];
  const tags: Record<string, any> = {},
    resources: Record<string, any[]> = {};
  for (const [i, stack] of expected.stacks.entries()) {
    const id = summaries[i].StackId;
    tags[id] = {
      PaginationToken: "",
      Mappings: [
        {
          Arn: id,
          Tags: [
            { Key: "PeelProject", Value: "peel" },
            { Key: "PeelEnvironment", Value: "synthetic-cloud-dev" },
            { Key: "PeelRun", Value: runId },
          ],
        },
      ],
    };
    const rows = stack.resources.map((r) => ({
      LogicalId: r.logicalId,
      Type: r.type,
      PhysicalId:
        r.identity.kind === "provider"
          ? "synthetic-" + r.logicalId
          : (r.identity.name?.value ?? "synthetic-" + r.logicalId),
      Status: "CREATE_COMPLETE",
    }));
    if (stack.kind === "artifacts") rows[1].PhysicalId = rows[0].PhysicalId;
    resources[id] =
      rows.length > 5
        ? [
            { NextToken: "next", Resources: rows.slice(0, 4) },
            { NextToken: null, Resources: rows.slice(4) },
          ]
        : [{ NextToken: null, Resources: rows }];
  }
  const config: Record<string, string> = {
    "history-setting": "disabled\n",
    "configured-account": accountId + "\n",
    "configured-role": "Synthetic\n",
    "credential-process": "",
    "assume-role": "",
    "web-identity": "",
  };
  const read = vi.fn(
    async (
      command: CloudStackCommand | { kind: CloudInspectionCommand },
      _signal: AbortSignal,
    ): Promise<string> => {
      if (command.kind === "caller-identity") return JSON.stringify(caller);
      if (command.kind === "stacks")
        return JSON.stringify(stackPages[command.nextToken === null ? 0 : 1]);
      if (command.kind === "tags") return JSON.stringify(tags[command.stackId]);
      if (command.kind === "resources")
        return JSON.stringify(
          resources[command.stackId][command.nextToken === null ? 0 : 1],
        );
      return config[command.kind];
    },
  );
  return {
    input,
    expected,
    caller,
    summaries,
    stackPages,
    tags,
    resources,
    config,
    read,
    clock: () => Date.parse("2026-10-28T01:00:00.000Z"),
    identity: (...args: Parameters<typeof collectCloudInspectionIdentity>) =>
      collectCloudInspectionIdentity(args[0], {
        read: (kind, signal) => read({ kind }, signal),
        clock: () => Date.parse("2026-10-28T01:00:00.000Z"),
        signal: args[1]?.signal,
      }),
  };
}
