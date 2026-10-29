import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CloudNoteUpload } from "../../apps/web/src/cloud-note-upload";
import {
  DurableCloudClient,
  type CloudStateStore,
} from "../../packages/cloud-protocol/src/durable";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  CloudMutationService,
  CloudServerError,
  type CloudMutationRequest,
} from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
  asCloudDraft,
} from "../../packages/cloud-protocol/src/index";
import { cloudScope, cloudDraft } from "../fixtures/cloud-durable-contract";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
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
  const parent = mkdtempSync(join(tmpdir(), "synkies-upload-")),
    server = new SQLiteCloudServerStore(join(parent, "server.sqlite3")),
    service = new CloudMutationService(server),
    controller = new AbortController(),
    requests: CloudMutationRequest[] = [],
    releases: (() => void)[] = [];
  let local = new SQLiteCloudStateStore(join(parent, "client.sqlite3"));
  const control = {
    unauthorized: false,
    afterServer: null as
      | null
      | ((reply: {
          status: number;
          body: any;
        }) => Promise<{ status: number; body: unknown }>),
    read: null as null | (() => Promise<void>),
    commit: null as null | (() => Promise<void>),
  };
  const store: CloudStateStore = {
    async read(...args) {
      const result = await local.read(...args),
        held = control.read;
      control.read = null;
      if (held) await held();
      return result;
    },
    async commit(...args) {
      const held = control.commit;
      control.commit = null;
      if (held) await held();
      return local.commit(...args);
    },
    close: () => local.close(),
  };
  const handler = createCloudMutationHandler(service, async () => {
    if (control.unauthorized) throw new CloudServerError("unauthorized", 401);
    return cloudScope.ownerSubject;
  });
  const send = async (request: CloudMutationRequest) => {
    requests.push(structuredClone(request));
    const response = await handler(
      new Request("https://synthetic.invalid/v1/mutations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      }),
    );
    const reply = { status: response.status, body: await response.json() };
    return control.afterServer ? control.afterServer(reply) : reply;
  };
  await server.seedAccount({
    ...cloudScope,
    status: "active",
    entitlement: "active",
    revision: 1,
    sequence: 0,
    wall: 0,
  });
  const upload = CloudNoteUpload.capture(
    store,
    cloudScope,
    send,
    controller.signal,
  );
  return {
    upload,
    store,
    controller,
    control,
    requests,
    service,
    send,
    client: new DurableCloudClient(store, cloudScope),
    async reopen() {
      await local.close();
      local = new SQLiteCloudStateStore(join(parent, "client.sqlite3"));
      return CloudNoteUpload.open(
        store,
        cloudScope,
        upload.session.snapshot().noteId,
        send,
        controller.signal,
      );
    },
    hold() {
      const entered = deferred(),
        release = deferred();
      releases.push(release.resolve);
      return { entered, release };
    },
    async cleanup() {
      controller.abort();
      for (const release of releases) release();
      await upload.upload();
      await local.close();
      await server.close();
      rmSync(parent, { recursive: true, force: true });
    },
  };
}

it("keeps text pending until a real HTTP service commit is durably acknowledged", async () =>
  fixture(async (f) => {
    const held = f.hold(),
      noteId = f.upload.session.snapshot().noteId;
    f.control.afterServer = async (reply) => {
      held.entered.resolve();
      await held.release.promise;
      return reply;
    };
    f.upload.session.edit("Actual server upload 原文");
    const pending = f.upload.upload();
    await held.entered.promise;
    expect(f.upload.snapshot().kind).toBe("uploading");
    expect(f.upload.session.snapshot().status).toBe("Pending upload");
    const remote = await f.service.get(
      cloudScope.ownerSubject,
      {
        version: 1,
        collectionId: cloudScope.collectionId,
        modeGeneration: cloudScope.modeGeneration,
      },
      noteId,
    );
    expect(remote.kind).toBe("note");
    if (remote.kind === "note")
      expect(remote.snapshot.bodyMarkdown).toBe("Actual server upload 原文");
    held.release.resolve();
    expect((await pending).kind).toBe("idle");
    expect(f.upload.session.snapshot().status).toBe("Saved in Cloud");
    expect((await f.client.get(noteId))!.inFlight).toBeNull();
    expect(f.requests).toHaveLength(1);
  }));

it("coalesces later typing without letting the older receipt save it", async () =>
  fixture(async (f) => {
    const first = f.hold(),
      second = f.hold();
    let calls = 0;
    f.control.afterServer = async (reply) => {
      const held = ++calls === 1 ? first : second;
      held.entered.resolve();
      await held.release.promise;
      return reply;
    };
    f.upload.session.edit("First version");
    const firstUpload = f.upload.upload();
    await first.entered.promise;
    f.upload.session.edit("Newest version");
    await f.upload.session.flush();
    void f.upload.upload();
    first.release.resolve();
    await firstUpload;
    await second.entered.promise;
    expect(f.upload.session.snapshot()).toMatchObject({
      bodyMarkdown: "Newest version",
      status: "Pending upload",
    });
    second.release.resolve();
    await f.upload.upload();
    expect(f.upload.session.snapshot().status).toBe("Saved in Cloud");
    expect(f.requests.map((r) => r.mutation.snapshot!.bodyMarkdown)).toEqual([
      "First version",
      "Newest version",
    ]);
  }));

it("reopens and retries an immutable operation after losing an actual successful response", async () =>
  fixture(async (f) => {
    f.control.afterServer = async () => {
      throw Error("synthetic private lost reply");
    };
    f.upload.session.edit("Recover after successful server commit");
    expect((await f.upload.upload()).kind).toBe("paused");
    expect(f.upload.snapshot().message).not.toContain("synthetic private");
    f.control.afterServer = null;
    const reopened = await f.reopen();
    expect(reopened.session.snapshot().status).toBe("Pending upload");
    await reopened.upload();
    expect(f.requests[1]).toEqual(f.requests[0]);
    expect(reopened.session.snapshot().status).toBe("Saved in Cloud");
  }));

it("preserves the original operation after real authentication failure and retries after access returns", async () =>
  fixture(async (f) => {
    f.control.unauthorized = true;
    f.upload.session.edit("Keep through expired authentication");
    expect((await f.upload.upload()).kind).toBe("sign-in-required");
    const before = await f.client.get(f.upload.session.snapshot().noteId);
    expect(before!.inFlight).not.toBeNull();
    expect(f.upload.session.snapshot().status).toBe("Pending upload");
    f.control.unauthorized = false;
    await f.upload.upload();
    expect(f.requests[1]).toEqual(f.requests[0]);
    expect(f.upload.session.snapshot().status).toBe("Saved in Cloud");
  }));

it("preserves both versions on an actual server revision conflict", async () =>
  fixture(async (f) => {
    const noteId = f.upload.session.snapshot().noteId;
    f.upload.session.edit("Local branch");
    await f.upload.session.flush();
    const remote = await startCloudMutation(
      saveCloudDraft(createCloudClient(cloudScope.collectionId, noteId), {
        kind: "upsert",
        snapshot: { ...cloudDraft("Remote branch"), noteId },
      }),
      "synthetic-remote-op",
    );
    await f.service.mutate(cloudScope.ownerSubject, {
      version: 1,
      collectionId: cloudScope.collectionId,
      modeGeneration: cloudScope.modeGeneration,
      mutation: remote.inFlight!,
    });
    expect((await f.upload.upload()).kind).toBe("conflict");
    const state = (await f.client.get(noteId))!;
    expect(state.conflict).not.toBeNull();
    expect(f.upload.session.snapshot()).toMatchObject({
      bodyMarkdown: "Local branch",
      status: "Conflict",
    });
    const calls = f.requests.length;
    await f.upload.upload();
    expect(f.requests).toHaveLength(calls);
  }));

it.each(["late-response", "ack-read"] as const)(
  "cancellation blocks %s acknowledgement without losing the retained draft",
  async (stage) =>
    fixture(async (f) => {
      const held = f.hold(),
        noteId = f.upload.session.snapshot().noteId;
      f.control.afterServer = async (reply) => {
        if (stage === "late-response") {
          held.entered.resolve();
          await held.release.promise;
        } else
          f.control.read = async () => {
            held.entered.resolve();
            await held.release.promise;
          };
        return reply;
      };
      f.upload.session.edit("Original account pending draft");
      const pending = f.upload.upload();
      await held.entered.promise;
      f.controller.abort();
      held.release.resolve();
      expect((await pending).kind).toBe("canceled");
      const state = (await f.client.get(noteId))!;
      expect(state.inFlight).not.toBeNull();
      expect(state.baseRevision).toBe(0);
      expect(state.current!.snapshot!.bodyMarkdown).toBe(
        "Original account pending draft",
      );
      const calls = f.requests.length;
      await f.upload.upload();
      expect(f.requests).toHaveLength(calls);
    }),
);

it.each(["identity", "status"] as const)(
  "rejects a mismatched %s response without acknowledging the operation",
  async (kind) =>
    fixture(async (f) => {
      f.control.afterServer = async (reply) =>
        kind === "identity"
          ? {
              ...reply,
              body: {
                ...reply.body,
                receipt: { ...reply.body.receipt, opId: "foreign-operation" },
              },
            }
          : { ...reply, status: 409 };
      f.upload.session.edit("Preserve after untrusted response");
      expect((await f.upload.upload()).kind).toBe("paused");
      const state = (await f.client.get(f.upload.session.snapshot().noteId))!;
      expect(state.baseRevision).toBe(0);
      expect(state.inFlight).not.toBeNull();
      expect(f.upload.session.snapshot().status).toBe("Pending upload");
      f.control.afterServer = null;
      await f.upload.upload();
      expect(f.requests[1]).toEqual(f.requests[0]);
      expect(f.upload.session.snapshot().status).toBe("Saved in Cloud");
    }),
);

it("captures the initiating scope before a caller mutates it", async () =>
  fixture(async (f) => {
    const input = { ...cloudScope },
      upload = CloudNoteUpload.capture(
        f.store,
        input,
        f.send,
        f.controller.signal,
      );
    input.ownerSubject = "another-synthetic-owner";
    input.collectionId = "another-synthetic-library";
    input.modeGeneration++;
    upload.session.edit("Initiating account only");
    await upload.upload();
    expect(f.requests[0].collectionId).toBe(cloudScope.collectionId);
    expect(f.requests[0].modeGeneration).toBe(cloudScope.modeGeneration);
    expect(upload.session.snapshot().status).toBe("Saved in Cloud");
  }));

it("does not send when an observer cancels the account context at upload start", async () =>
  fixture(async (f) => {
    const unsubscribe = f.upload.subscribe(() => {
      if (f.upload.snapshot().kind === "uploading") f.controller.abort();
    });
    f.upload.session.edit("Retain without sending after cancellation");
    expect((await f.upload.upload()).kind).toBe("canceled");
    expect(f.requests).toHaveLength(0);
    expect(
      (await f.client.get(f.upload.session.snapshot().noteId))!.inFlight,
    ).not.toBeNull();
    unsubscribe();
  }));

it("pauses instead of marking old editor text Saved when an accepted retry reveals a newer remote head", async () =>
  fixture(async (f) => {
    f.upload.session.edit("Original editor source");
    f.control.afterServer = async () => {
      throw Error("Synthetic lost first response");
    };
    await f.upload.upload();
    const noteId = f.upload.session.snapshot().noteId,
      head = await f.service.get(
        cloudScope.ownerSubject,
        {
          version: 1,
          collectionId: cloudScope.collectionId,
          modeGeneration: cloudScope.modeGeneration,
        },
        noteId,
      );
    if (head.kind !== "note") throw Error("Expected owned note fixture");
    const remote = await startCloudMutation(
      saveCloudDraft(
        createCloudClient(cloudScope.collectionId, noteId, head.snapshot),
        {
          kind: "upsert",
          snapshot: {
            ...asCloudDraft(head.snapshot),
            bodyMarkdown: "Newer remote head",
            updatedAt: new Date().toISOString(),
          },
        },
      ),
      "newer-remote-operation",
    );
    await f.service.mutate(cloudScope.ownerSubject, {
      version: 1,
      collectionId: cloudScope.collectionId,
      modeGeneration: cloudScope.modeGeneration,
      mutation: remote.inFlight!,
    });
    f.control.afterServer = null;
    const reopened = await f.reopen();
    expect((await reopened.upload()).kind).toBe("paused");
    expect(reopened.session.snapshot()).toMatchObject({
      bodyMarkdown: "Original editor source",
      status: "Could not retain draft",
    });
    expect((await f.client.get(noteId))!.current!.snapshot!.bodyMarkdown).toBe(
      "Newer remote head",
    );
  }));

it("batches additions/deletions in a fixed 200ms window without starving continuous typing", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await fixture(async (f) => {
      f.upload.session.edit("First addition");
      await f.upload.session.flush();
      f.upload.schedule();
      await vi.advanceTimersByTimeAsync(100);
      f.upload.session.edit("Second addition");
      await f.upload.session.flush();
      f.upload.schedule();
      await vi.advanceTimersByTimeAsync(99);
      f.upload.session.edit("Second");
      await f.upload.session.flush();
      f.upload.schedule();
      expect(f.requests).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await f.upload.upload();
      expect(f.requests).toHaveLength(1);
      expect(f.requests[0].mutation.snapshot!.bodyMarkdown).toBe("Second");
      expect(f.upload.session.snapshot().status).toBe("Saved in Cloud");
    });
  } finally {
    vi.useRealTimers();
  }
});

it("cancels a scheduled upload when its account context ends", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await fixture(async (f) => {
      f.upload.session.edit("Retained while the account context ends");
      await f.upload.session.flush();
      f.upload.schedule();
      f.controller.abort();
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.requests).toHaveLength(0);
      expect(
        (await f.client.get(f.upload.session.snapshot().noteId))!.pending,
      ).not.toBeNull();
    });
  } finally {
    vi.useRealTimers();
  }
});

it("does not automatically retry failed authentication when later typing is retained", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await fixture(async (f) => {
      f.control.unauthorized = true;
      f.upload.session.edit("Before authentication expires");
      await f.upload.upload();
      f.upload.session.edit("Later retained typing");
      await f.upload.session.flush();
      f.upload.schedule();
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.requests).toHaveLength(1);
      expect(f.upload.snapshot().kind).toBe("sign-in-required");
      expect(f.upload.session.snapshot().bodyMarkdown).toBe(
        "Later retained typing",
      );
    });
  } finally {
    vi.useRealTimers();
  }
});

it("automatically prepares newer typing after a real local generation race", async () =>
  fixture(async (f) => {
    f.upload.session.edit("First retained version");
    await f.upload.session.flush();
    const held = f.hold(),
      sent = deferred();
    f.control.commit = async () => {
      held.entered.resolve();
      await held.release.promise;
    };
    f.control.afterServer = async (reply) => {
      sent.resolve();
      return reply;
    };
    const first = f.upload.upload();
    await held.entered.promise;
    f.upload.session.edit("Newer typing during asynchronous preparation");
    await f.upload.session.flush();
    held.release.resolve();
    expect((await first).kind).toBe("idle");
    await sent.promise;
    await f.upload.upload();
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].mutation.snapshot!.bodyMarkdown).toBe(
      "Newer typing during asynchronous preparation",
    );
    expect(f.upload.session.snapshot().status).toBe("Saved in Cloud");
  }));
