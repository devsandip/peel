import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { projectCloudCachedNote as view } from "../../apps/web/src/cloud-note-cache";
import {
  createCloudClient,
  mutationHash,
  type CloudClientState,
} from "../../packages/cloud-protocol/src/index";
import { DurableCloudClient } from "../../packages/cloud-protocol/src/durable";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  CloudMutationService,
  type CloudMutationRequest,
} from "../../packages/cloud-protocol/src/server";
import { applyCloudServerReply } from "../../packages/cloud-protocol/src/client-response";
import { cloudScope, cloudDraft } from "../fixtures/cloud-durable-contract";

const id = "synthetic-note",
  scope = {
    version: 1 as const,
    collectionId: cloudScope.collectionId,
    modeGeneration: 1,
  },
  action = (body: string) => ({
    kind: "upsert" as const,
    snapshot: cloudDraft(body),
  });
async function fixture(
  run: (f: {
    client: DurableCloudClient;
    fail: { value: boolean };
    reopen(): Promise<void>;
    prepare(opId: string): Promise<CloudMutationRequest>;
    service: CloudMutationService;
    read(): Promise<ReturnType<typeof view>>;
  }) => Promise<void>,
) {
  const parent = mkdtempSync(join(tmpdir(), "synkies-cloud-cache-view-")),
    fail = { value: false },
    server = new SQLiteCloudServerStore(join(parent, "server.sqlite3"));
  let local = new SQLiteCloudStateStore(join(parent, "client.sqlite3"), () => {
    if (fail.value) throw Error("synthetic acknowledgement commit failure");
  });
  const f = {
    client: new DurableCloudClient(local, cloudScope),
    fail,
    async reopen() {
      await local.close();
      local = new SQLiteCloudStateStore(join(parent, "client.sqlite3"));
      f.client = new DurableCloudClient(local, cloudScope);
    },
    async prepare(opId: string) {
      const previous = await f.client.get(id);
      if (!previous) throw Error("synthetic draft missing");
      await f.client.prepare(id, previous.generation, opId);
      return { ...scope, mutation: await f.client.retry(id) };
    },
    service: new CloudMutationService(server, () => 1800000000000),
    async read() {
      return view(cloudScope, id, await f.client.get(id));
    },
  };
  try {
    await server.seedAccount({
      ...cloudScope,
      status: "active",
      entitlement: "active",
      revision: 1,
      sequence: 0,
      wall: 0,
    });
    await run(f);
  } finally {
    await local.close();
    await server.close();
    rmSync(parent, { recursive: true, force: true });
  }
}

it("never calls missing or untouched initial cache state Saved and refuses wrong bindings/schema", () => {
  for (const state of [null, createCloudClient(cloudScope.collectionId, id)]) {
    expect(view(cloudScope, id, state)).toEqual({
      status: "No cached Cloud note",
      title: null,
      bodyMarkdown: null,
    });
    expect(Object.isFrozen(view(cloudScope, id, state))).toBe(true);
  }
  const initial = createCloudClient(cloudScope.collectionId, id);
  expect(() => view(cloudScope, "other-note", initial)).toThrow("another note");
  expect(() =>
    view({ ...cloudScope, collectionId: "other-library" }, id, initial),
  ).toThrow("another note");
  expect(() =>
    view(cloudScope, id, {
      ...initial,
      version: 3,
    } as unknown as CloudClientState),
  ).toThrow();
  expect(() =>
    view({ ...cloudScope, modeGeneration: 0 }, id, initial),
  ).toThrow();
});

it("requires both actual server commit and durable matching local acknowledgement before Saved", async () =>
  fixture(async (f) => {
    await f.client.save(
      id,
      action("# Original confirmed note\nUnicode 原文"),
      null,
    );
    expect((await f.read()).status).toBe("Pending upload");
    const request = await f.prepare("cache-view-original");
    expect((await f.read()).status).toBe("Pending upload");
    const reply = await f.service.mutate(cloudScope.ownerSubject, request);
    expect(reply.receipt.outcome).toBe("applied");
    expect((await f.read()).status).toBe("Pending upload");
    await expect(
      applyCloudServerReply(f.client, request, {
        ...reply,
        receipt: { ...reply.receipt, opId: "foreign-operation" },
      }),
    ).rejects.toThrow();
    expect((await f.read()).status).toBe("Pending upload");
    await applyCloudServerReply(f.client, request, reply);
    expect(await f.read()).toEqual({
      status: "Saved in Cloud",
      title: "Original confirmed note",
      bodyMarkdown: "# Original confirmed note\nUnicode 原文",
    });
    await f.reopen();
    expect((await f.read()).status).toBe("Saved in Cloud");
  }));

it("keeps newer typing pending after an older actual receipt and preserves local conflict text", async () =>
  fixture(async (f) => {
    await f.client.save(id, action("First source"), null);
    const first = await f.prepare("cache-view-first");
    const olderReply = await f.service.mutate(cloudScope.ownerSubject, first);
    const sending = await f.client.get(id);
    await f.client.save(id, action("Newer local text"), sending!.generation);
    await applyCloudServerReply(f.client, first, olderReply);
    expect(await f.read()).toMatchObject({
      status: "Pending upload",
      bodyMarkdown: "Newer local text",
    });
    const mutation = {
      version: 1 as const,
      opId: "cache-view-other-client",
      noteId: id,
      baseRevision: 1,
      kind: "upsert" as const,
      snapshot: cloudDraft("Other device text"),
    };
    await f.service.mutate(cloudScope.ownerSubject, {
      ...scope,
      mutation: { ...mutation, contentHash: await mutationHash(mutation) },
    });
    const second = await f.prepare("cache-view-conflicting");
    const conflict = await f.service.mutate(cloudScope.ownerSubject, second);
    expect(conflict.receipt.outcome).toBe("conflict");
    await applyCloudServerReply(f.client, second, conflict);
    expect(await f.read()).toMatchObject({
      status: "Conflict",
      bodyMarkdown: "Newer local text",
    });
  }));

it("does not show Saved after local ACK failure and recovers only after replay is durably applied", async () =>
  fixture(async (f) => {
    await f.client.save(id, action("Retained pending source"), null);
    const request = await f.prepare("cache-view-lost-ack"),
      reply = await f.service.mutate(cloudScope.ownerSubject, request);
    f.fail.value = true;
    await expect(
      applyCloudServerReply(f.client, request, reply),
    ).rejects.toThrow("synthetic");
    expect((await f.read()).status).toBe("Pending upload");
    f.fail.value = false;
    await f.reopen();
    expect((await f.read()).status).toBe("Pending upload");
    const retry = { ...scope, mutation: await f.client.retry(id) };
    expect(retry).toEqual(request);
    const replay = await f.service.mutate(cloudScope.ownerSubject, retry);
    expect(replay.replayed).toBe(true);
    await applyCloudServerReply(f.client, retry, replay);
    expect((await f.read()).status).toBe("Saved in Cloud");
  }));

it("never renders a retained pre-purge body and distinguishes pending from confirmed deletion", async () =>
  fixture(async (f) => {
    await f.client.save(id, action("Body must disappear from the view"), null);
    const first = await f.prepare("cache-view-before-purge");
    await applyCloudServerReply(
      f.client,
      first,
      await f.service.mutate(cloudScope.ownerSubject, first),
    );
    const old = await f.client.get(id);
    await f.client.save(id, { kind: "purge", snapshot: null }, old!.generation);
    expect(await f.read()).toEqual({
      status: "Pending upload",
      title: null,
      bodyMarkdown: null,
    });
    const purge = await f.prepare("cache-view-purge");
    await applyCloudServerReply(
      f.client,
      purge,
      await f.service.mutate(cloudScope.ownerSubject, purge),
    );
    await f.reopen();
    expect(await f.read()).toEqual({
      status: "Deleted in Cloud",
      title: null,
      bodyMarkdown: null,
    });
  }));
