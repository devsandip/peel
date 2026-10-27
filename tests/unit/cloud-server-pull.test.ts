import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import {
  CloudMutationService,
  CLOUD_RECEIPT_MS,
  type CloudServerStore,
} from "../../packages/cloud-protocol/src/server";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { DurableCloudClient } from "../../packages/cloud-protocol/src/durable";
import { DurableCloudPull } from "../../packages/cloud-protocol/src/pull-local";
import {
  CloudCursorSigner,
  CloudPullService,
  CLOUD_PAGE_LIFETIME_MS,
  type CloudPullStart,
  type CloudPullPage,
} from "../../packages/cloud-protocol/src/pull";
import { mutationHash } from "../../packages/cloud-protocol/src/index";
import { cloudDraft, cloudScope } from "../fixtures/cloud-durable-contract";
const BASE = 1800000000000,
  subject = cloudScope.ownerSubject;
const scope = {
  version: 1 as const,
  collectionId: cloudScope.collectionId,
  modeGeneration: 1,
};
const key = () =>
  crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
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
    folder: string;
    path: string;
    store: SQLiteCloudServerStore;
    service: CloudMutationService;
    pull: CloudPullService;
    signer: CloudCursorSigner;
    now: { value: number };
  }) => Promise<void>,
) {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-server-pull-")),
    path = join(folder, "server.sqlite3");
  const store = new SQLiteCloudServerStore(path),
    now = { value: BASE };
  try {
    await store.seedAccount({
      ...scope,
      ownerSubject: subject,
      status: "active",
      entitlement: "active",
      revision: 1,
      sequence: 0,
      wall: 0,
    });
    const signer = new CloudCursorSigner(await key(), () => now.value);
    await run({
      folder,
      path,
      store,
      now,
      signer,
      service: new CloudMutationService(store, () => now.value),
      pull: new CloudPullService(store, signer, () => now.value),
    });
  } finally {
    await store.close();
    rmSync(folder, { recursive: true, force: true });
  }
}
async function pages(
  pull: CloudPullService,
  start: CloudPullStart,
  limit: number,
  use: (page: CloudPullPage) => Promise<void> = async () => {},
) {
  const result: CloudPullPage[] = [];
  let next = start.next;
  for (let count = 0; count < 100; count++) {
    const page = await pull.page(subject, next, limit);
    result.push(page);
    await use(page);
    if (!page.next) return result;
    next = page.next;
  }
  throw Error("Synthetic bootstrap did not complete");
}
it("catches creates, edits and purges during bootstrap and keeps a stable change upper bound", async () =>
  fixture(async ({ folder, service, pull }) => {
    for (const id of ["a", "b", "c"])
      await service.mutate(subject, await mutation(`seed-${id}`, id));
    const store = new SQLiteCloudStateStore(join(folder, "client.sqlite3")),
      local = new DurableCloudPull(store, cloudScope),
      repo = new DurableCloudClient(store, cloudScope);
    try {
      const start = await pull.bootstrap(subject, scope);
      expect(start.fromSequence).toBe(3);
      await local.begin(start, null);
      let changed = false,
        afterUpper = false;
      const downloaded = await pages(pull, start, 1, async (page) => {
        await local.apply(page);
        if (!changed) {
          changed = true;
          await service.mutate(subject, await mutation("new-before-key", "0"));
          await service.mutate(subject, await mutation("new-after-bound", "z"));
          await service.mutate(subject, await mutation("edit-b", "b", 1, "B2"));
          await service.mutate(
            subject,
            await mutation("purge-c", "c", 1, null),
          );
        }
        if (page.kind === "changes" && !afterUpper) {
          afterUpper = true;
          await service.mutate(subject, await mutation("after-upper", "late"));
        }
      });
      expect(
        downloaded
          .filter((p) => p.kind === "changes")
          .every((p) => p.upperSequence === 7),
      ).toBe(true);
      expect((await local.progress())?.throughSequence).toBe(7);
      expect((await repo.get("0"))?.baseRevision).toBe(1);
      expect((await repo.get("z"))?.baseRevision).toBe(1);
      expect((await repo.get("b"))?.current?.snapshot?.bodyMarkdown).toBe("B2");
      expect((await repo.get("c"))?.current?.kind).toBe("purge");
      expect(await repo.get("late")).toBeNull();
      const progress = (await local.progress())!,
        resumed = await pull.resume(subject, progress.checkpoint!);
      await local.begin(resumed, progress.generation);
      await pages(pull, resumed, 1, async (page) => {
        await local.apply(page);
      });
      expect((await repo.get("late"))?.baseRevision).toBe(1);
      expect((await local.progress())?.throughSequence).toBe(8);
    } finally {
      await store.close();
    }
  }));
it("ends pages at the byte budget without skipping head keys or change sequences", async () =>
  fixture(async ({ service, pull }) => {
    for (const id of ["a", "b", "c"])
      await service.mutate(
        subject,
        await mutation(`large-${id}`, id, 0, "x".repeat(200000)),
      );
    const bootstrap = await pages(
      pull,
      await pull.bootstrap(subject, scope),
      32,
    );
    const heads = bootstrap.filter((p) => p.kind === "heads");
    expect(heads[0].heads).toHaveLength(2);
    expect(heads.flatMap((p) => p.heads).map((h) => h.noteId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    for (const id of ["a", "b", "c"])
      await service.mutate(
        subject,
        await mutation(`edit-large-${id}`, id, 1, "y".repeat(200000)),
      );
    const changes = await pages(
      pull,
      await pull.resume(subject, bootstrap.at(-1)!.checkpoint!),
      32,
    );
    expect(changes).toHaveLength(2);
    expect(changes[0].throughSequence).toBe(5);
    expect(changes[1].throughSequence).toBe(6);
    expect(changes.flatMap((p) => p.heads).map((h) => h.noteId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  }));
it("rejects foreign, tampered, wrong-purpose, expired and rotated-key cursors", async () =>
  fixture(async ({ pull, signer, now, store }) => {
    const start = await pull.bootstrap(subject, scope),
      token = start.next.token;
    const altered =
      token.slice(0, 10) + (token[10] === "a" ? "b" : "a") + token.slice(11);
    await expect(
      pull.page(subject, { ...start.next, token: altered }),
    ).rejects.toMatchObject({ code: "invalid-page-token" });
    await expect(
      pull.page("different-owner", start.next),
    ).rejects.toMatchObject({ code: "foreign-page-token" });
    await expect(
      pull.page(subject, { kind: "changes", token }),
    ).rejects.toMatchObject({ code: "wrong-page-token-purpose" });
    await expect(
      new CloudCursorSigner(await key(), () => now.value).read(token, subject),
    ).rejects.toMatchObject({ code: "invalid-page-token" });
    const completed = await pages(pull, start, 1),
      checkpoint = completed.at(-1)!.checkpoint!;
    now.value = BASE - 1;
    await expect(signer.read(token, subject)).rejects.toMatchObject({
      code: "snapshot-required",
    });
    now.value = BASE + CLOUD_PAGE_LIFETIME_MS;
    await expect(pull.page(subject, start.next)).rejects.toMatchObject({
      code: "snapshot-required",
    });
    expect((await pull.resume(subject, checkpoint)).fromSequence).toBe(0);
    now.value = BASE + CLOUD_RECEIPT_MS;
    await expect(pull.resume(subject, checkpoint)).rejects.toMatchObject({
      code: "snapshot-required",
    });
    now.value = BASE;
    await store.setPolicy(subject, "active", "inactive");
    await expect(pull.page(subject, start.next)).rejects.toMatchObject({
      code: "cloud-entitlement-inactive",
    });
  }));
it("detects physical change gaps without advancing across the missing sequence", async () =>
  fixture(async ({ service, pull, path }) => {
    const empty = await pages(pull, await pull.bootstrap(subject, scope), 1),
      checkpoint = empty.at(-1)!.checkpoint!;
    await service.mutate(subject, await mutation("one", "a"));
    await service.mutate(subject, await mutation("two", "b"));
    const round = await pull.resume(subject, checkpoint);
    const raw = new DatabaseSync(path);
    raw.exec("DELETE FROM m0_cloud_server_changes WHERE sequence=1");
    raw.close();
    await expect(pull.page(subject, round.next)).rejects.toMatchObject({
      code: "snapshot-required",
    });
  }));
it("rejects logically expired needed changes even while the checkpoint and physical row remain", async () =>
  fixture(async ({ store, pull, now }) => {
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((done) => (entered = done)),
      gate = new Promise<void>((done) => (release = done));
    const wrapped: CloudServerStore = {
      read: (o, n, op) => store.read(o, n, op),
      close: async () => {},
      commit: async (o, n, tx) => {
        entered();
        await gate;
        return store.commit(o, n, tx);
      },
    };
    const pending = new CloudMutationService(wrapped, () => now.value).mutate(
      subject,
      await mutation("held-first", "a"),
    );
    void pending.catch(() => {});
    await reached;
    now.value = BASE + 100;
    const empty = await pages(pull, await pull.bootstrap(subject, scope), 1),
      checkpoint = empty.at(-1)!.checkpoint!;
    release();
    await pending;
    now.value = BASE + CLOUD_RECEIPT_MS + 50;
    const round = await pull.resume(subject, checkpoint);
    await expect(pull.page(subject, round.next)).rejects.toMatchObject({
      code: "snapshot-required",
    });
    expect((await store.changesPage(subject, 0, 1, 1)).changes).toHaveLength(1);
  }));
it("withholds a new round when entitlement is revoked during HMAC signing", async () =>
  fixture(async ({ pull, store }) => {
    const method = crypto.subtle.sign,
      original = method.bind(crypto.subtle);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((done) => (entered = done)),
      gate = new Promise<void>((done) => (release = done));
    crypto.subtle.sign = async (...args) => {
      entered();
      await gate;
      return original(...args);
    };
    try {
      const pending = pull.bootstrap(subject, scope);
      void pending.catch(() => {});
      await reached;
      await store.setPolicy(subject, "active", "inactive");
      release();
      await expect(pending).rejects.toMatchObject({
        code: "cloud-entitlement-inactive",
      });
    } finally {
      release();
      crypto.subtle.sign = method;
    }
  }));
