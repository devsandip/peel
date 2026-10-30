import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CloudLibraryOwners } from "../../apps/web/src/cloud-library-owners";
import { CloudConflictResolutionError } from "../../apps/web/src/cloud-conflict-resolution";
import { DurableCloudClient } from "../../packages/cloud-protocol/src/durable";
import type { CloudLibraryStateStore } from "../../packages/cloud-protocol/src/library-local";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  CloudMutationService,
  CloudServerError,
  type CloudMutationRequest,
} from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import { applyCloudServerReply } from "../../packages/cloud-protocol/src/client-response";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
  type CloudAction,
} from "../../packages/cloud-protocol/src/index";
import { cloudDraft, cloudScope } from "../fixtures/cloud-durable-contract";

const noteId = "resolution-note";
const action = (body: string): CloudAction => ({
  kind: "upsert",
  snapshot: { ...cloudDraft(body), noteId },
});
async function fixture(
  run: (f: Awaited<ReturnType<typeof create>>) => Promise<void>,
) {
  const f = await create();
  try {
    await run(f);
  } finally {
    await f.cleanup();
  }
}
async function create() {
  const folder = mkdtempSync(join(tmpdir(), "synkies-conflict-resolution-")),
    path = join(folder, "cache.sqlite3"),
    server = new SQLiteCloudServerStore(join(folder, "server.sqlite3")),
    controller = new AbortController(),
    service = new CloudMutationService(server),
    requests: CloudMutationRequest[] = [],
    tasks: Promise<unknown>[] = [],
    releases: (() => void)[] = [];
  let local = new SQLiteCloudStateStore(path);
  const control = {
    read: null as null | (() => Promise<void>),
    commit: null as null | (() => Promise<void>),
    afterSend: null as null | (() => Promise<void>),
    failRead: false,
    failCommit: false,
    lostCommit: false,
    unauthorized: false,
    status: 200,
    badReply: false,
    reads: 0,
    commits: 0,
    closes: 0,
  };
  const store: CloudLibraryStateStore = {
    read: async (...args) => {
      control.reads++;
      const result = await local.read(...args),
        hold = control.read;
      control.read = null;
      if (hold) await hold();
      if (control.failRead) throw Error("private read detail");
      return result;
    },
    commit: async (...args) => {
      control.commits++;
      const hold = control.commit;
      control.commit = null;
      if (hold) await hold();
      if (control.failCommit) throw Error("private commit detail");
      const result = await local.commit(...args);
      if (control.lostCommit) {
        control.lostCommit = false;
        throw Error("private committed acknowledgement");
      }
      return result;
    },
    listLibrary: (...args) => local.listLibrary(...args),
    close: async () => {
      control.closes++;
      await local.close();
    },
  };
  await server.seedAccount({
    ...cloudScope,
    status: "active",
    entitlement: "active",
    revision: 1,
    sequence: 0,
    wall: 0,
  });
  const handler = createCloudMutationHandler(service, async () => {
      if (control.unauthorized) throw new CloudServerError("unauthorized", 401);
      return cloudScope.ownerSubject;
    }),
    send = vi.fn(async (request: CloudMutationRequest, signal: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      requests.push(structuredClone(request));
      if (control.status !== 200)
        return { status: control.status, body: { private: "never display" } };
      const reply = await handler(
        new Request("https://resolution.synthetic/v1/mutations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal,
        }),
      );
      const result = { status: reply.status, body: await reply.json() };
      const hold = control.afterSend;
      control.afterSend = null;
      if (hold) await hold();
      return control.badReply
        ? { status: 200, body: { private: "secret reply" } }
        : result;
    }),
    context = { store, scope: { ...cloudScope } },
    owners = new CloudLibraryOwners(context, send, controller.signal),
    model = owners.conflicts(),
    client = new DurableCloudClient(local, cloudScope);
  try {
    const remote = await startCloudMutation(
      saveCloudDraft(
        createCloudClient(cloudScope.collectionId, noteId),
        action("Observed Cloud branch"),
      ),
      "seed-remote",
    );
    await service.mutate(cloudScope.ownerSubject, {
      version: 1,
      collectionId: cloudScope.collectionId,
      modeGeneration: 1,
      mutation: remote.inFlight!,
    });
    const saved = await client.save(noteId, action("Device branch"), null);
    const prepared = await client.prepare(
      noteId,
      saved.generation,
      "seed-local",
    );
    const request: CloudMutationRequest = {
      version: 1,
      collectionId: cloudScope.collectionId,
      modeGeneration: 1,
      mutation: prepared.inFlight!,
    };
    await applyCloudServerReply(
      client,
      request,
      await service.mutate(cloudScope.ownerSubject, request),
    );
    return {
      folder,
      path,
      store,
      server,
      service,
      controller,
      control,
      send,
      requests,
      context,
      owners,
      model,
      client,
      async remote(body: string, kind: "upsert" | "purge" = "upsert") {
        const head = await service.get(
          cloudScope.ownerSubject,
          cloudScope,
          noteId,
        );
        const state = await startCloudMutation(
          saveCloudDraft(
            createCloudClient(
              cloudScope.collectionId,
              noteId,
              head.kind === "note" ? head.snapshot : null,
            ),
            kind === "upsert"
              ? action(body)
              : { kind: "purge", snapshot: null },
          ),
          crypto.randomUUID(),
        );
        return service.mutate(cloudScope.ownerSubject, {
          version: 1,
          collectionId: cloudScope.collectionId,
          modeGeneration: 1,
          mutation: state.inFlight!,
        });
      },
      async reopen() {
        await local.close();
        local = new SQLiteCloudStateStore(path);
        return new CloudLibraryOwners(
          context,
          send,
          controller.signal,
        ).conflicts();
      },
      async closeOwner(
        upload: Awaited<ReturnType<CloudLibraryOwners["open"]>>,
      ) {
        await upload.session.putAway();
        owners.putAway({
          context: owners.context,
          upload,
          session: upload.session,
        });
      },
      track<T>(task: Promise<T>) {
        tasks.push(task);
        void task.catch(() => {});
        return task;
      },
      hold() {
        let enter!: () => void, release!: () => void;
        const entered = new Promise<void>((r) => {
            enter = r;
          }),
          waiting = new Promise<void>((r) => {
            release = r;
          });
        releases.push(release);
        return {
          entered,
          release,
          wait: async () => {
            enter();
            await waiting;
          },
        };
      },
      async cleanup() {
        controller.abort();
        for (const release of releases) release();
        await Promise.allSettled(tasks);
        await Promise.allSettled(
          owners.retainedOwners().map((u) => u.upload()),
        );
        await local.close();
        await server.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    controller.abort();
    await local.close();
    await server.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

it("constructs lazily and reads frozen actual scoped versions without mutation or network", async () =>
  fixture(async (f) => {
    const before = [f.control.reads, f.control.commits];
    expect(f.owners.conflicts()).toBe(f.model);
    expect([f.control.reads, f.control.commits]).toEqual(before);
    const view = await f.model.read(noteId);
    expect(view.status).toBe("Conflict");
    expect(view.canMerge).toBe(true);
    expect(view.conflict!.local.snapshot!.bodyMarkdown).toBe("Device branch");
    expect(view.conflict!.remote!.bodyMarkdown).toBe("Observed Cloud branch");
    expect(Object.isFrozen(view.conflict!.local.snapshot)).toBe(true);
    expect(f.send).not.toHaveBeenCalled();
    expect((await f.model.read("missing")).generation).toBe(null);
    expect(f.control.closes).toBe(0);
  }));

it.each(["local", "cloud", "merge"] as const)(
  "resolves explicit %s against actual server state",
  async (kind) =>
    fixture(async (f) => {
      const view = await f.model.read(noteId),
        before = f.control.commits;
      const result = await f.model.resolve(
        noteId,
        view.generation!,
        kind === "merge"
          ? { kind, bodyMarkdown: "Combined café 原文" }
          : { kind },
      );
      expect(result.kind).toBe("complete");
      expect(result.view!.status).toBe("Saved in Cloud");
      expect(result.view!.conflict).toBeNull();
      const body =
        kind === "cloud"
          ? "Observed Cloud branch"
          : kind === "local"
            ? "Device branch"
            : "Combined café 原文";
      expect(
        (await f.client.get(noteId))!.current!.snapshot!.bodyMarkdown,
      ).toBe(body);
      const head = await f.service.get(
        cloudScope.ownerSubject,
        cloudScope,
        noteId,
      );
      expect(head.kind).toBe("note");
      if (head.kind === "note") expect(head.snapshot.bodyMarkdown).toBe(body);
      expect(f.requests).toHaveLength(kind === "cloud" ? 0 : 1);
      expect(f.control.commits).toBeGreaterThan(before);
      expect(f.control.closes).toBe(0);
    }),
);

it("keeps a submitted decision Pending until the matching held response is applied", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId),
      h = f.hold();
    f.control.afterSend = h.wait;
    const task = f.track(
      f.model.resolve(noteId, view.generation!, { kind: "local" }),
    );
    await Promise.race([
      h.entered,
      task.then(() => {
        throw Error("Expected held response");
      }),
    ]);
    expect((await f.model.read(noteId)).status).toBe("Pending upload");
    h.release();
    expect((await task).kind).toBe("complete");
  }));

it.each(["local", "merge"] as const)(
  "retains immutable in-flight %s through a lost successful response and restart",
  async (kind) =>
    fixture(async (f) => {
      const view = await f.model.read(noteId);
      f.control.afterSend = async () => {
        throw Error("private lost reply");
      };
      const result = await f.model.resolve(
        noteId,
        view.generation!,
        kind === "merge" ? { kind, bodyMarkdown: "Merged retained" } : { kind },
      );
      expect(result.kind).toBe("paused");
      expect(result.view!.status).toBe("Pending upload");
      const before = (await f.client.get(noteId))!.inFlight!;
      expect(before).not.toBeNull();
      const reopened = await f.reopen(),
        current = await reopened.read(noteId);
      expect((await reopened.retry(noteId, current.generation!)).kind).toBe(
        "complete",
      );
      expect(f.requests).toHaveLength(2);
      expect(f.requests[1]).toEqual(f.requests[0]);
      expect(f.requests[1].mutation.opId).toBe(before.opId);
    }),
);

it.each([401, 503])(
  "retains work on HTTP%s and sends the same operation only on explicit retry",
  async (status) =>
    fixture(async (f) => {
      const view = await f.model.read(noteId);
      if (status === 401) f.control.unauthorized = true;
      else f.control.status = status;
      const result = await f.model.resolve(noteId, view.generation!, {
        kind: "local",
      });
      expect(result.kind).toBe(status === 401 ? "sign-in-required" : "paused");
      expect(result.view!.status).toBe("Pending upload");
      f.control.unauthorized = false;
      f.control.status = 200;
      expect((await f.model.retry(noteId, result.view!.generation!)).kind).toBe(
        "complete",
      );
      expect(f.requests[1]).toEqual(f.requests[0]);
    }),
);

it("keeps a new real409 as a fresh conflict instead of acknowledging the earlier choice", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId);
    await f.remote("A newer Cloud branch");
    const result = await f.model.resolve(noteId, view.generation!, {
      kind: "local",
    });
    expect(result.kind).toBe("conflict");
    expect(result.view!.conflict!.remote!.bodyMarkdown).toBe(
      "A newer Cloud branch",
    );
    expect(result.view!.conflict!.local.snapshot!.bodyMarkdown).toBe(
      "Device branch",
    );
  }));

it("does not mark newer typing Saved when an earlier decision is acknowledged", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId),
      h = f.hold();
    f.control.afterSend = h.wait;
    const task = f.track(
      f.model.resolve(noteId, view.generation!, { kind: "local" }),
    );
    await Promise.race([
      h.entered,
      task.then(() => {
        throw Error("Expected held response");
      }),
    ]);
    const before = (await f.client.get(noteId))!;
    await f.client.save(
      noteId,
      action("Newer retained text"),
      before.generation,
    );
    h.release();
    const result = await task;
    expect(result.kind).toBe("pending");
    expect(result.view!.status).toBe("Pending upload");
    expect((await f.client.get(noteId))!.pending!.snapshot!.bodyMarkdown).toBe(
      "Newer retained text",
    );
    expect(f.requests).toHaveLength(1);
  }));

it("rejects stale generation and concurrent choices without an extra decision or request", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId),
      before = f.control.commits;
    expect(
      (await f.model.resolve(noteId, view.generation! + 1, { kind: "local" }))
        .kind,
    ).toBe("stale");
    expect(f.control.commits).toBe(before);
    expect(f.requests).toHaveLength(0);
    const results = await Promise.all([
      f.model.resolve(noteId, view.generation!, { kind: "local" }),
      f.model.resolve(noteId, view.generation!, { kind: "cloud" }),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["busy", "complete"]);
    expect(f.requests).toHaveLength(1);
  }));

it("uses durable CAS across independent owner sets sharing this explicit cache", async () =>
  fixture(async (f) => {
    const other = new CloudLibraryOwners(
        f.context,
        f.send,
        f.controller.signal,
      ).conflicts(),
      view = await f.model.read(noteId);
    const results = await Promise.all([
      f.model.resolve(noteId, view.generation!, { kind: "local" }),
      other.resolve(noteId, view.generation!, { kind: "cloud" }),
    ]);
    expect(results.filter((r) => r.kind === "complete")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "stale")).toHaveLength(1);
    expect(f.requests.length).toBeLessThanOrEqual(1);
  }));

it("refuses an open editor, preserving its latest retained text", async () =>
  fixture(async (f) => {
    const upload = await f.owners.open({ ...f.owners.context, noteId });
    upload.session.edit("Newest editor text");
    await upload.session.flush();
    const view = await f.model.read(noteId),
      before = f.control.commits;
    expect(
      (await f.model.resolve(noteId, view.generation!, { kind: "cloud" })).kind,
    ).toBe("busy");
    expect(f.control.commits).toBe(before);
    expect(upload.session.snapshot().bodyMarkdown).toBe("Newest editor text");
    expect(
      (await f.client.get(noteId))!.conflict!.local.snapshot!.bodyMarkdown,
    ).toBe("Newest editor text");
  }));

it("blocks same-note opening during a held resolution and keeps competing notes independent", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId),
      h = f.hold();
    f.control.read = h.wait;
    const task = f.track(
      f.model.resolve(noteId, view.generation!, { kind: "cloud" }),
    );
    await Promise.race([
      h.entered,
      task.then(() => {
        throw Error("Expected held read");
      }),
    ]);
    await expect(
      f.owners.open({ ...f.owners.context, noteId }),
    ).rejects.toThrow("Could not open");
    const other = f.owners.create(f.owners.context);
    expect(other.session.snapshot().noteId).not.toBe(noteId);
    h.release();
    expect((await task).kind).toBe("complete");
  }));

it("refuses a note whose owner is opening, before any resolution commit", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId),
      h = f.hold();
    f.control.read = h.wait;
    const opening = f.track(f.owners.open({ ...f.owners.context, noteId }));
    await Promise.race([
      h.entered,
      opening.then(() => {
        throw Error("Expected held opening");
      }),
    ]);
    const before = f.control.commits;
    expect(
      (await f.model.resolve(noteId, view.generation!, { kind: "local" })).kind,
    ).toBe("busy");
    expect(f.control.commits).toBe(before);
    h.release();
    await opening;
  }));

it("retires only the closed durable owner and cancels its queued timer before resolution", async () =>
  fixture(async (f) => {
    const upload = await f.owners.open({ ...f.owners.context, noteId });
    await f.closeOwner(upload);
    vi.useFakeTimers();
    try {
      upload.schedule();
      const view = await f.model.read(noteId);
      expect(
        (await f.model.resolve(noteId, view.generation!, { kind: "local" }))
          .kind,
      ).toBe("complete");
      await vi.advanceTimersByTimeAsync(250);
      expect(f.requests).toHaveLength(1);
      expect(f.owners.retainedOwners()).not.toContain(upload);
    } finally {
      vi.useRealTimers();
    }
  }));

it("does not retire a closed owner while its upload task is still held", async () =>
  fixture(async (f) => {
    const upload = await f.owners.open({ ...f.owners.context, noteId }),
      h = f.hold();
    await f.closeOwner(upload);
    f.control.read = h.wait;
    const uploading = f.track(upload.upload());
    await Promise.race([
      h.entered,
      uploading.then(() => {
        throw Error("Expected held upload");
      }),
    ]);
    const view = await f.model.read(noteId);
    expect(
      (await f.model.resolve(noteId, view.generation!, { kind: "local" })).kind,
    ).toBe("busy");
    expect(f.owners.retainedOwners()).toContain(upload);
    h.release();
    await uploading;
  }));

it.each(["read", "commit", "send"] as const)(
  "withholds a canceled result during held%s and never writes to a later account",
  async (phase) =>
    fixture(async (f) => {
      const view = await f.model.read(noteId),
        h = f.hold();
      if (phase === "read") f.control.read = h.wait;
      else if (phase === "commit") f.control.commit = h.wait;
      else f.control.afterSend = h.wait;
      const task = f.track(
        f.model.resolve(noteId, view.generation!, { kind: "local" }),
      );
      await Promise.race([
        h.entered,
        task.then(() => {
          throw Error("Expected held operation");
        }),
      ]);
      f.controller.abort("private cancellation");
      f.context.scope.ownerSubject = "later-account";
      h.release();
      const result = await task;
      expect(result).toEqual({ kind: "canceled", view: null });
      expect(f.control.closes).toBe(0);
    }),
);

it("retains uncertain local commit outcomes without inventing rollback or automatically sending", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId);
    f.control.lostCommit = true;
    const result = await f.model.resolve(noteId, view.generation!, {
      kind: "local",
    });
    expect(result.kind).toBe("unavailable");
    expect(f.requests).toHaveLength(0);
    const stored = await f.model.read(noteId);
    expect(stored.status).toBe("Pending upload");
    expect((await f.model.retry(noteId, stored.generation!)).kind).toBe(
      "complete",
    );
  }));

it.each(["read", "commit"] as const)(
  "reports fixed private%s failures while preserving both branches",
  async (kind) =>
    fixture(async (f) => {
      const view = await f.model.read(noteId),
        before = await f.client.get(noteId);
      if (kind === "read") f.control.failRead = true;
      else f.control.failCommit = true;
      const result = await f.model.resolve(noteId, view.generation!, {
        kind: "cloud",
      });
      expect(result).toEqual({ kind: "unavailable", view: null });
      expect(JSON.stringify(result)).not.toContain("private");
      expect(await f.client.get(noteId)).toEqual(before);
      expect(f.requests).toHaveLength(0);
    }),
);

it("refuses a bad authenticated reply and retains the original in-flight mutation", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId);
    f.control.badReply = true;
    const result = await f.model.resolve(noteId, view.generation!, {
      kind: "local",
    });
    expect(result.kind).toBe("paused");
    expect(result.view!.status).toBe("Pending upload");
    expect((await f.client.get(noteId))!.inFlight).not.toBeNull();
  }));

it("keeps captured methods and scope despite later caller object changes", async () =>
  fixture(async (f) => {
    f.context.scope.collectionId = "later-library";
    f.store.read = async () => {
      throw Error("replacement must not run");
    };
    expect((await f.model.read(noteId)).status).toBe("Conflict");
    const view = await f.model.read(noteId);
    expect(
      (await f.model.resolve(noteId, view.generation!, { kind: "cloud" })).kind,
    ).toBe("complete");
  }));

it("refuses malformed choices and generation values without storage or network work", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId),
      before = [f.control.reads, f.control.commits];
    for (const selected of [
      { kind: "other" },
      { kind: "local", extra: "private" },
      { kind: "merge", bodyMarkdown: null },
    ])
      expect(
        (await f.model.resolve(noteId, view.generation!, selected as any)).kind,
      ).toBe("unavailable");
    for (const generation of [0, -1, 1.5, NaN, undefined, null])
      expect(
        (await f.model.resolve(noteId, generation as number, { kind: "cloud" }))
          .kind,
      ).toBe("unavailable");
    expect([f.control.reads, f.control.commits]).toEqual(before);
    expect(f.send).not.toHaveBeenCalled();
    f.controller.abort();
    await expect(f.model.read(noteId)).rejects.toMatchObject({
      kind: "canceled",
      message: "Cloud conflict resolution unavailable",
    });
    expect(new CloudConflictResolutionError("busy").message).not.toContain(
      "private",
    );
  }));

it.each(["local", "merge", "cloud"] as const)(
  "handles a permanent purge under explicit%s choice without resurrecting its identity",
  async (kind) =>
    fixture(async (f) => {
      await f.remote("", "purge");
      const initial = await f.model.read(noteId);
      expect(
        (await f.model.resolve(noteId, initial.generation!, { kind: "local" }))
          .kind,
      ).toBe("conflict");
      const purged = await f.model.read(noteId);
      expect(purged.conflict!.remote).toBeNull();
      expect(purged.canMerge).toBe(false);
      const requests = f.requests.length;
      const result = await f.model.resolve(
        noteId,
        purged.generation!,
        kind === "merge"
          ? { kind, bodyMarkdown: "Recoverable text" }
          : { kind },
      );
      expect(result.kind).toBe(
        kind === "cloud" ? "complete" : "new-note-required",
      );
      expect(f.requests).toHaveLength(requests);
      expect(
        (await f.service.get(cloudScope.ownerSubject, cloudScope, noteId)).kind,
      ).toBe("purged");
      if (kind === "cloud")
        expect(result.view!.status).toBe("Deleted in Cloud");
    }),
);

it.each(["archived", "trashed"] as const)(
  "preserves an explicit local%s lifecycle without offering a body merge",
  async (state) =>
    fixture(async (f) => {
      const before = (await f.client.get(noteId))!,
        snapshot = {
          ...cloudDraft("Lifecycle branch"),
          noteId,
          state,
          deletedAt: state === "trashed" ? "2026-10-30T10:00:00.000Z" : null,
          purgeAfter: state === "trashed" ? "2026-11-29T10:00:00.000Z" : null,
        };
      await f.client.save(
        noteId,
        { kind: "upsert", snapshot },
        before.generation,
      );
      const view = await f.model.read(noteId);
      expect(view.canMerge).toBe(false);
      const commits = f.control.commits;
      expect(
        (
          await f.model.resolve(noteId, view.generation!, {
            kind: "merge",
            bodyMarkdown: "Implicit restore must refuse",
          })
        ).kind,
      ).toBe("unavailable");
      expect(f.control.commits).toBe(commits);
      expect(
        (await f.model.resolve(noteId, view.generation!, { kind: "local" }))
          .kind,
      ).toBe("complete");
      expect(f.requests[0].mutation.snapshot!.state).toBe(state);
      expect((await f.client.get(noteId))!.current!.snapshot!.state).toBe(
        state,
      );
    }),
);

it("treats choosing a local purge as explicit deletion rather than a body merge", async () =>
  fixture(async (f) => {
    const before = (await f.client.get(noteId))!;
    await f.client.save(
      noteId,
      { kind: "purge", snapshot: null },
      before.generation,
    );
    const view = await f.model.read(noteId);
    expect(view.canMerge).toBe(false);
    const result = await f.model.resolve(noteId, view.generation!, {
      kind: "local",
    });
    expect(result.kind).toBe("complete");
    expect(result.view!.status).toBe("Deleted in Cloud");
    expect(f.requests[0].mutation.kind).toBe("purge");
  }));

it("rejects a decision invalidated during its held CAS without overwriting newer work", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId),
      h = f.hold();
    f.control.commit = h.wait;
    const task = f.track(
      f.model.resolve(noteId, view.generation!, { kind: "cloud" }),
    );
    await Promise.race([
      h.entered,
      task.then(() => {
        throw Error("Expected held CAS");
      }),
    ]);
    await f.client.save(
      noteId,
      action("Newer text before CAS"),
      view.generation,
    );
    h.release();
    expect((await task).kind).toBe("stale");
    expect(
      (await f.client.get(noteId))!.conflict!.local.snapshot!.bodyMarkdown,
    ).toBe("Newer text before CAS");
    expect(f.requests).toHaveLength(0);
  }));

it("copies a merged choice before async reads and does not resend a completed state", async () =>
  fixture(async (f) => {
    const view = await f.model.read(noteId),
      h = f.hold();
    f.control.read = h.wait;
    const input = {
      kind: "merge" as const,
      bodyMarkdown: "Original explicit choice",
    };
    const task = f.track(f.model.resolve(noteId, view.generation!, input));
    await Promise.race([
      h.entered,
      task.then(() => {
        throw Error("Expected held read");
      }),
    ]);
    input.bodyMarkdown = "Later caller mutation";
    h.release();
    const result = await task;
    expect(result.kind).toBe("complete");
    expect(f.requests[0].mutation.snapshot!.bodyMarkdown).toBe(
      "Original explicit choice",
    );
    expect((await f.model.retry(noteId, result.view!.generation!)).kind).toBe(
      "complete",
    );
    expect(
      (
        await f.model.resolve(noteId, result.view!.generation!, {
          kind: "cloud",
        })
      ).kind,
    ).toBe("stale");
    expect(f.requests).toHaveLength(1);
  }));
