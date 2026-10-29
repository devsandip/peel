import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEventListeners } from "node:events";
import { expect, it, vi } from "vitest";
import {
  CloudBrowserWorkspaceSession,
  CloudBrowserWorkspaceError,
  type CloudBrowserWorkspaceCacheResolver,
} from "../../apps/web/src/cloud-browser-workspace-session";
import {
  DurableCloudClient,
  type CloudScope,
} from "../../packages/cloud-protocol/src/durable";
import { SQLiteCloudStateStore } from "../../packages/cloud-protocol/src/store-sqlite";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import { CloudMutationService } from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import {
  CloudCursorSigner,
  CloudPullService,
} from "../../packages/cloud-protocol/src/pull";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
} from "../../packages/cloud-protocol/src/index";
import {
  createCloudWebSessionBoundary,
  type CloudWebSession,
} from "../../packages/cloud-protocol/src/web-session";
import { cloudDraft } from "../fixtures/cloud-durable-contract";

const origin = "https://workspace.synthetic",
  scope = (letter = "a"): CloudScope => ({
    version: 1,
    ownerSubject: `owner-${letter}`,
    collectionId: `library-${letter}`,
    modeGeneration: 7,
  });
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
  const folder = mkdtempSync(join(tmpdir(), "synkies-browser-workspace-")),
    remote = new SQLiteCloudServerStore(join(folder, "server.sqlite3")),
    service = new CloudMutationService(remote),
    records = new Map<string, CloudWebSession>(),
    stores = new Map<string, SQLiteCloudStateStore>(),
    models: CloudBrowserWorkspaceSession[] = [],
    controllers: AbortController[] = [],
    tasks = new Set<Promise<unknown>>(),
    releases: (() => void)[] = [],
    requests: Request[] = [],
    control = {
      cookie: "",
      after: null as
        null | ((request: Request, response: Response) => Promise<Response>),
    };
  const accountReads = vi.spyOn(remote, "readAccount"),
    noteReads = vi.spyOn(remote, "read"),
    commits = vi.spyOn(remote, "commit"),
    cacheCloses: ReturnType<typeof vi.spyOn>[] = [];
  const boundary = createCloudWebSessionBoundary(
    { origin, lifetimeMs: 3600000 },
    {
      read: async (key) =>
        records.has(key) ? structuredClone(records.get(key)!) : null,
      insert: async (record) => {
        records.set(record.idHash, structuredClone(record));
        return true;
      },
      revoke: async (key) => {
        const record = records.get(key);
        if (record) record.revoked = true;
      },
    },
    async (request) =>
      request.headers.get("authorization") === "synthetic-b"
        ? "owner-b"
        : "owner-a",
  );
  const key = await crypto.subtle.generateKey(
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    ),
    handler = createCloudMutationHandler(
      service,
      boundary.resolveCaller,
      new CloudPullService(remote, new CloudCursorSigner(key)),
    );
  const fetcher = vi.fn(
    async (url: string | URL | Request, options?: RequestInit) => {
      const request = new Request(url, options);
      request.headers.set("cookie", control.cookie);
      request.headers.set("origin", origin);
      requests.push(request.clone());
      const response = await handler(request);
      return control.after ? control.after(request, response) : response;
    },
  ) as unknown as typeof fetch;
  function cache(input: Readonly<CloudScope>) {
    const id = JSON.stringify(input);
    let store = stores.get(id);
    if (!store) {
      store = new SQLiteCloudStateStore(
        join(folder, `cache-${stores.size}.sqlite3`),
      );
      stores.set(id, store);
      cacheCloses.push(vi.spyOn(store, "close"));
    }
    return store;
  }
  const resolver = vi.fn(
    async (input: Readonly<CloudScope>, _signal: AbortSignal) => cache(input),
  );
  const track = <T>(task: Promise<T>) => {
    tasks.add(task);
    void task.catch(() => {});
    return task;
  };
  try {
    for (const letter of ["a", "b"])
      await remote.seedAccount({
        ...scope(letter),
        status: "active",
        entitlement: "active",
        revision: 1,
        sequence: 0,
        wall: 0,
      });
  } catch (error) {
    await remote.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  return {
    cache,
    resolver,
    cacheCloses,
    remote,
    accountReads,
    noteReads,
    commits,
    fetcher,
    requests,
    control,
    track,
    async issue(letter = "a") {
      const response = await boundary.issue(
        new Request(origin + "/auth/session", {
          method: "POST",
          headers: {
            origin,
            authorization: `synthetic-${letter}`,
            ...(control.cookie ? { cookie: control.cookie } : {}),
          },
        }),
      );
      control.cookie = response.headers.get("set-cookie")!.split(";")[0];
      return { origin, csrfToken: (await response.json()).csrfToken as string };
    },
    model(
      config: { origin: string; csrfToken: string },
      resolve: CloudBrowserWorkspaceCacheResolver = resolver,
      selectedFetch = fetcher,
    ) {
      const controller = new AbortController(),
        model = new CloudBrowserWorkspaceSession(
          config,
          controller.signal,
          resolve,
          selectedFetch,
        );
      controllers.push(controller);
      models.push(model);
      return { model, controller };
    },
    hold() {
      const entered = deferred(),
        release = deferred();
      releases.push(release.resolve);
      return { entered, release };
    },
    async seed(letter: string, body: string) {
      const input = scope(letter),
        state = await startCloudMutation(
          saveCloudDraft(createCloudClient(input.collectionId, "shared-note"), {
            kind: "upsert",
            snapshot: {
              ...cloudDraft(body),
              collectionId: input.collectionId,
              noteId: "shared-note",
            },
          }),
          crypto.randomUUID(),
        );
      await service.mutate(input.ownerSubject, {
        version: 1,
        collectionId: input.collectionId,
        modeGeneration: input.modeGeneration,
        mutation: state.inFlight!,
      });
    },
    async cleanup() {
      for (const controller of controllers) controller.abort();
      for (const release of releases) release();
      await Promise.allSettled([...tasks]);
      const uploads = models.flatMap((model) => [
        ...(model.retained()?.owners.retainedOwners() ?? []),
      ]);
      await Promise.allSettled(uploads.map((upload) => upload.session.flush()));
      await Promise.allSettled(uploads.map((upload) => upload.upload()));
      await Promise.all([...stores.values()].map((store) => store.close()));
      await remote.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

it("prepares one frozen discovered scope/cache with captured inputs and no note transfer", async () =>
  fixture(async (f) => {
    const config = await f.issue(),
      { model, controller } = f.model(config);
    expect(model.snapshot().kind).toBe("idle");
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.resolver).not.toHaveBeenCalled();
    config.origin = "https://later.invalid";
    config.csrfToken = "z".repeat(43);
    const first = f.track(model.prepare()),
      second = model.prepare();
    expect(first).toBe(second);
    const prepared = await first;
    expect(prepared.context.scope).toEqual(scope());
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.context)).toBe(true);
    expect(Object.isFrozen(prepared.context.scope)).toBe(true);
    expect(f.resolver).toHaveBeenCalledExactlyOnceWith(
      prepared.context.scope,
      controller.signal,
    );
    expect(prepared.context.store).toBe(f.cache(scope()));
    expect(prepared.owners.context.scope).toEqual(scope());
    expect(prepared.owners.signal).toBe(controller.signal);
    expect(prepared.download.snapshot().kind).toBe("idle");
    expect(model.current()).toBe(prepared);
    expect(await model.prepare()).toBe(prepared);
    expect(f.requests.map((request) => request.url)).toEqual([
      origin + "/v1/library-context",
    ]);
    expect(f.noteReads).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
    expect(model.snapshot().kind).toBe("ready");
    expect(f.cacheCloses.every((spy) => spy.mock.calls.length === 0)).toBe(
      true,
    );
  }));

it("refuses an old issued binding before cache lookup after cookie rotation, then prepares a new original scope", async () =>
  fixture(async (f) => {
    const old = f.model(await f.issue());
    await f.issue("b");
    await expect(f.track(old.model.prepare())).rejects.toMatchObject({
      kind: "paused",
    });
    expect(f.accountReads).not.toHaveBeenCalled();
    expect(f.resolver).not.toHaveBeenCalled();
    expect(old.model.current()).toBeNull();
    expect(old.model.retained()).toBeNull();
    const next = f.model(await f.issue("b")),
      prepared = await f.track(next.model.prepare());
    expect(prepared.context.scope).toEqual(scope("b"));
    expect(f.resolver).toHaveBeenCalledTimes(1);
    expect(f.accountReads).toHaveBeenCalledExactlyOnceWith("owner-b");
    expect(f.noteReads).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
  }));

it("cancels before dispatch and filters construction failures without cache access", async () =>
  fixture(async (f) => {
    const config = await f.issue(),
      { model, controller } = f.model(config),
      task = f.track(model.prepare());
    controller.abort("synthetic private reason");
    await expect(task).rejects.toMatchObject({
      kind: "canceled",
      message: "Cloud workspace preparation canceled.",
    });
    await expect(model.prepare()).rejects.toBeInstanceOf(
      CloudBrowserWorkspaceError,
    );
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.resolver).not.toHaveBeenCalled();
    expect(() =>
      f.model({
        ...config,
        private: () => "private clone detail",
      } as typeof config),
    ).toThrow("Could not prepare the Cloud workspace.");
  }));

it("settles cancellation before an ignoring cache resolver and never publishes or closes its late resource", async () =>
  fixture(async (f) => {
    const held = f.hold(),
      store = f.cache(scope()),
      resolve = vi.fn(async () => {
        held.entered.resolve();
        await held.release.promise;
        return store;
      }),
      { model, controller } = f.model(await f.issue(), resolve),
      task = f.track(model.prepare());
    await held.entered.promise;
    controller.abort("private lookup detail");
    await expect(task).rejects.toMatchObject({ kind: "canceled" });
    expect(model.current()).toBeNull();
    expect(model.retained()).toBeNull();
    expect(model.snapshot().kind).toBe("canceled");
    held.release.resolve();
    await resolve.mock.results[0].value;
    expect(model.current()).toBeNull();
    expect(model.retained()).toBeNull();
    expect(f.requests).toHaveLength(1);
    expect(f.commits).not.toHaveBeenCalled();
    expect(f.cacheCloses[0]).not.toHaveBeenCalled();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  }));

it("filters private cache failures and retries only after another explicit preparation", async () =>
  fixture(async (f) => {
    let fail = true;
    const resolve = vi.fn(async (input: Readonly<CloudScope>) => {
        if (fail) throw Error("private filesystem token/path");
        return f.cache(input);
      }),
      { model } = f.model(await f.issue(), resolve);
    await expect(f.track(model.prepare())).rejects.toMatchObject({
      kind: "paused",
      message:
        "Could not prepare the Cloud workspace. Your cached notes and drafts remain on this device.",
    });
    expect(model.current()).toBeNull();
    expect(model.retained()).toBeNull();
    expect(model.snapshot().kind).toBe("paused");
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(f.requests).toHaveLength(1);
    fail = false;
    const prepared = await f.track(model.prepare());
    expect(prepared.context.scope).toEqual(scope());
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(f.requests).toHaveLength(2);
  }));

it("withholds an unusable cache without closing a caller-owned object", async () =>
  fixture(async (f) => {
    const close = vi.fn(),
      { model } = f.model(await f.issue(), async () => ({ close }) as any);
    await expect(f.track(model.prepare())).rejects.toMatchObject({
      kind: "paused",
    });
    expect(model.current()).toBeNull();
    expect(model.retained()).toBeNull();
    expect(close).not.toHaveBeenCalled();
  }));

it.each([401, 503])(
  "exposes only fixed preparation state for HTTP%s before resolving a cache",
  async (status) =>
    fixture(async (f) => {
      const { model } = f.model(
        await f.issue(),
        f.resolver,
        vi.fn(async () =>
          Response.json({ private: "private response detail" }, { status }),
        ),
      );
      await expect(f.track(model.prepare())).rejects.toMatchObject({
        kind: status === 401 ? "sign-in-required" : "paused",
      });
      expect(model.snapshot().kind).toBe(
        status === 401 ? "sign-in-required" : "paused",
      );
      expect(f.resolver).not.toHaveBeenCalled();
    }),
);

it("retains original pending recovery after account abort without sending it through a later cookie", async () =>
  fixture(async (f) => {
    const { model, controller } = f.model(await f.issue()),
      prepared = await f.track(model.prepare()),
      upload = prepared.owners.create(prepared.context);
    upload.session.edit("Copyable original-account draft");
    await upload.session.flush();
    const key = model.snapshot().refreshKey;
    controller.abort("private account switch");
    await f.issue("b");
    expect(model.current()).toBeNull();
    expect(model.retained()).toBe(prepared);
    expect(model.snapshot().kind).toBe("canceled");
    expect(prepared.owners.retainedOwners()).toEqual([upload]);
    expect(upload.session.snapshot()).toMatchObject({
      bodyMarkdown: "Copyable original-account draft",
      retained: true,
      status: "Pending upload",
    });
    expect(() => prepared.owners.create(prepared.context)).toThrow();
    await upload.upload();
    expect(f.requests.map((request) => new URL(request.url).pathname)).toEqual([
      "/v1/library-context",
    ]);
    expect(f.commits).not.toHaveBeenCalled();
    expect(model.snapshot().refreshKey).toBeGreaterThan(key);
    expect(f.cacheCloses[0]).not.toHaveBeenCalled();
  }));

it("composes real session-bound upload, Put away and catalog refresh without waiting for a held ACK", async () =>
  fixture(async (f) => {
    const held = f.hold();
    f.control.after = async (request, response) => {
      if (new URL(request.url).pathname === "/v1/mutations") {
        held.entered.resolve();
        await held.release.promise;
      }
      return response;
    };
    const { model } = f.model(await f.issue()),
      prepared = await f.track(model.prepare()),
      before = model.snapshot().refreshKey,
      upload = prepared.owners.create(prepared.context);
    upload.session.edit("Server-confirmed composed draft");
    await upload.session.flush();
    const task = f.track(upload.upload());
    await held.entered.promise;
    expect(upload.session.snapshot().status).toBe("Pending upload");
    await upload.session.putAway();
    prepared.owners.putAway({
      context: prepared.context,
      upload,
      session: upload.session,
    });
    expect(prepared.owners.retainedOwners()).toContain(upload);
    expect(upload.session.snapshot().closed).toBe(true);
    held.release.resolve();
    await task;
    expect(upload.session.snapshot().status).toBe("Saved in Cloud");
    expect(prepared.owners.retainedOwners()).toEqual([]);
    expect(model.snapshot().refreshKey).toBeGreaterThan(before);
    const state = await new DurableCloudClient(
      prepared.context.store,
      prepared.context.scope,
    ).get(upload.session.snapshot().noteId);
    expect(state?.current?.snapshot?.bodyMarkdown).toBe(
      "Server-confirmed composed draft",
    );
    expect(state?.pending).toBeNull();
    expect(f.commits).toHaveBeenCalledTimes(1);
    expect(f.cacheCloses[0]).not.toHaveBeenCalled();
  }));

it("explicitly downloads into only the discovered cache and refuses a later cookie without erasing cached notes", async () =>
  fixture(async (f) => {
    await f.seed("a", "Account A remote source");
    await f.seed("b", "Account B remote source");
    const { model } = f.model(await f.issue()),
      prepared = await f.track(model.prepare()),
      before = model.snapshot().refreshKey;
    expect(f.requests).toHaveLength(1);
    expect((await f.track(prepared.download.download())).kind).toBe("complete");
    const client = new DurableCloudClient(
      prepared.context.store,
      prepared.context.scope,
    );
    expect(
      (await client.get("shared-note"))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Account A remote source");
    expect(model.snapshot().refreshKey).toBeGreaterThan(before);
    const count = f.requests.length;
    await f.issue("b");
    expect(f.requests).toHaveLength(count);
    expect((await f.track(prepared.download.download())).kind).toBe("paused");
    expect(
      (await client.get("shared-note"))?.current?.snapshot?.bodyMarkdown,
    ).toBe("Account A remote source");
    const other = f.model(await f.issue("b")),
      next = await f.track(other.model.prepare());
    expect(next.context.scope).toEqual(scope("b"));
    expect(next.context.store).not.toBe(prepared.context.store);
    expect((await f.track(next.download.download())).kind).toBe("complete");
    expect(
      (
        await new DurableCloudClient(
          next.context.store,
          next.context.scope,
        ).get("shared-note")
      )?.current?.snapshot?.bodyMarkdown,
    ).toBe("Account B remote source");
    expect(f.cacheCloses.every((spy) => spy.mock.calls.length === 0)).toBe(
      true,
    );
  }));

it("withholds readiness when an observer aborts and keeps the original prepared recovery reachable", async () =>
  fixture(async (f) => {
    const { model, controller } = f.model(await f.issue());
    model.subscribe(() => {
      throw Error("private observer error");
    });
    const unsubscribe = model.subscribe(() => {
      if (model.snapshot().kind === "ready")
        controller.abort("observer cancellation");
    });
    await expect(f.track(model.prepare())).rejects.toMatchObject({
      kind: "canceled",
    });
    unsubscribe();
    expect(model.current()).toBeNull();
    expect(model.retained()?.context.scope).toEqual(scope());
    expect(model.snapshot().kind).toBe("canceled");
    expect(f.requests).toHaveLength(1);
    expect(f.commits).not.toHaveBeenCalled();
    expect(f.cacheCloses[0]).not.toHaveBeenCalled();
  }));
