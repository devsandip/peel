import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEventListeners } from "node:events";
import { expect, it, vi } from "vitest";
import {
  createCloudLibraryContextWebReader,
  CloudLibraryContextReadError,
} from "../../apps/web/src/cloud-library-context-web";
import { CLOUD_WEB_DEADLINE_MS } from "../../apps/web/src/cloud-web-json";
import { CLOUD_PAGE_WIRE_BYTES } from "../../packages/cloud-protocol/src/pull";
import { CloudMutationService } from "../../packages/cloud-protocol/src/server";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import {
  createCloudWebSessionBoundary,
  type CloudWebSession,
} from "../../packages/cloud-protocol/src/web-session";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";

const origin = "https://synthetic.example",
  scope = {
    version: 1,
    ownerSubject: "owner-a",
    collectionId: "library-a",
    modeGeneration: 7,
  },
  config = () => ({ origin, csrfToken: "c".repeat(43) });
const fake = (run: (...args: any[]) => Promise<Response>) =>
  vi.fn(run) as unknown as typeof fetch;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
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
  const folder = mkdtempSync(join(tmpdir(), "synkies-context-reader-")),
    store = new SQLiteCloudServerStore(join(folder, "server.sqlite3")),
    records = new Map<string, CloudWebSession>(),
    controllers = [new AbortController()],
    tasks = new Set<Promise<unknown>>();
  const accountReads = vi.spyOn(store, "readAccount"),
    noteReads = vi.spyOn(store, "read"),
    commits = vi.spyOn(store, "commit"),
    closes = vi.spyOn(store, "close"),
    state = { cookie: "" };
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
  const handler = createCloudMutationHandler(
    new CloudMutationService(store),
    boundary.resolveCaller,
  );
  const fetcher = fake(async (url, options) => {
    const request = new Request(url, options);
    request.headers.set("cookie", state.cookie);
    return handler(request);
  });
  async function issue(letter = "a") {
    const response = await boundary.issue(
      new Request(origin + "/auth/session", {
        method: "POST",
        headers: {
          origin,
          authorization: "synthetic-" + letter,
          ...(state.cookie ? { cookie: state.cookie } : {}),
        },
      }),
    );
    state.cookie = response.headers.get("set-cookie")!.split(";")[0];
    return { origin, csrfToken: (await response.json()).csrfToken as string };
  }
  return {
    store,
    accountReads,
    noteReads,
    commits,
    closes,
    fetcher,
    issue,
    async seed() {
      for (const letter of ["a", "b"])
        await store.seedAccount({
          version: 1,
          ownerSubject: "owner-" + letter,
          collectionId: "library-" + letter,
          modeGeneration: 7,
          status: "active",
          entitlement: "active",
          revision: 1,
          sequence: 0,
          wall: 0,
        });
    },
    reader(input: ReturnType<typeof config>) {
      const controller = new AbortController();
      controllers.push(controller);
      const read = createCloudLibraryContextWebReader(
        input,
        controller.signal,
        fetcher,
      );
      return {
        controller,
        read: () => {
          const task = read();
          tasks.add(task);
          void task.catch(() => {});
          return task;
        },
      };
    },
    async cleanup() {
      for (const controller of controllers) controller.abort();
      await Promise.allSettled([...tasks]);
      await store.close();
      rmSync(folder, { recursive: true, force: true });
    },
  };
}

it("explicitly discovers immutable server-selected scope through actual Fetch/session/SQLite without note effects", async () =>
  fixture(async (f) => {
    await f.seed();
    const input = await f.issue(),
      { read, controller } = f.reader(input);
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.accountReads).not.toHaveBeenCalled();
    input.origin = "https://later-global.invalid";
    input.csrfToken = "z".repeat(43);
    const result = await read();
    expect(result).toEqual(scope);
    expect(Object.isFrozen(result)).toBe(true);
    const again = await read();
    expect(again).toEqual(scope);
    expect(again).not.toBe(result);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.accountReads.mock.calls.map((call) => call[0])).toEqual([
      "owner-a",
      "owner-a",
    ]);
    expect(f.fetcher).toHaveBeenCalledWith(
      origin + "/v1/library-context",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        mode: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      }),
    );
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(f.noteReads).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
    expect(f.closes).not.toHaveBeenCalled();
  }));

it("refuses old captured binding after real cookie rotation before account access, then permits a new explicit lifetime", async () =>
  fixture(async (f) => {
    await f.seed();
    const a = await f.issue(),
      old = f.reader(a);
    expect(await old.read()).toEqual(scope);
    f.accountReads.mockClear();
    const b = await f.issue("b");
    await expect(old.read()).rejects.toMatchObject({
      kind: "paused",
      message: "Could not read the Cloud library context.",
    });
    expect(f.accountReads).not.toHaveBeenCalled();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    const current = f.reader(b);
    expect(await current.read()).toEqual({
      ...scope,
      ownerSubject: "owner-b",
      collectionId: "library-b",
    });
    expect(f.accountReads).toHaveBeenCalledExactlyOnceWith("owner-b");
    expect(f.noteReads).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
    expect(f.closes).not.toHaveBeenCalled();
  }));

it("coalesces held reads and permits only a later explicit request after settlement", async () => {
  const held = deferred(),
    controller = new AbortController(),
    fetcher = fake(async () => {
      await held.promise;
      return Response.json(scope);
    }),
    read = createCloudLibraryContextWebReader(
      config(),
      controller.signal,
      fetcher,
    );
  const first = read(),
    second = read();
  expect(first).toBe(second);
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1);
  held.resolve();
  expect(await first).toEqual(scope);
  expect(await second).toEqual(scope);
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  await read();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

const invalid: [string, unknown][] = [
  ["null", null],
  ["array", [scope]],
  [
    "missing-owner",
    { version: 1, collectionId: "library-a", modeGeneration: 7 },
  ],
  ["version", { ...scope, version: 2 }],
  ["owner", { ...scope, ownerSubject: "bad/owner" }],
  ["library", { ...scope, collectionId: "../library" }],
  ["generation-zero", { ...scope, modeGeneration: 0 }],
  ["generation-fraction", { ...scope, modeGeneration: 1.5 }],
  [
    "generation-unsafe",
    { ...scope, modeGeneration: Number.MAX_SAFE_INTEGER + 1 },
  ],
  ["paid", { ...scope, paid: true }],
  ["message", { ...scope, message: "synthetic private reply" }],
  ["body", { ...scope, bodyMarkdown: "synthetic private body" }],
  ["nested-scope", { scope }],
];
it.each(invalid)(
  "refuses %s scope instead of forwarding server authority or private fields",
  async (_, body) => {
    const fetcher = fake(async () => Response.json(body)),
      read = createCloudLibraryContextWebReader(
        config(),
        new AbortController().signal,
        fetcher,
      ),
      task = read();
    await expect(task).rejects.toBeInstanceOf(CloudLibraryContextReadError);
    await expect(task).rejects.toMatchObject({
      kind: "paused",
      message: "Could not read the Cloud library context.",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it.each([401, 403, 409, 410, 503])(
  "refuses HTTP%s even when the body is a valid scope",
  async (status) => {
    const fetcher = fake(async () => Response.json(scope, { status })),
      read = createCloudLibraryContextWebReader(
        config(),
        new AbortController().signal,
        fetcher,
      );
    await expect(read()).rejects.toMatchObject({
      kind: status === 401 ? "sign-in-required" : "paused",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("privately filters configuration cloning and fetch failures before exposing an error", async () => {
  const signal = new AbortController().signal,
    fetcher = vi.fn();
  for (const input of [
    { ...config(), secret: () => "private config" },
    { ...config(), csrfToken: "private invalid token" },
    { ...config(), origin: "http://remote.invalid" },
  ])
    expect(() =>
      createCloudLibraryContextWebReader(input, signal, fetcher),
    ).toThrow("Could not read the Cloud library context.");
  expect(fetcher).not.toHaveBeenCalled();
  const read = createCloudLibraryContextWebReader(
    config(),
    signal,
    fake(async () => {
      throw Error("private token detail");
    }),
  );
  await expect(read()).rejects.toMatchObject({
    kind: "paused",
    message: "Could not read the Cloud library context.",
  });
});

it.each(["redirect", "content-type", "utf8", "oversize"])(
  "inherits bounded %s response refusal",
  async (failure) => {
    const response =
      failure === "utf8"
        ? new Response(new Uint8Array([255]), {
            headers: { "content-type": "application/json" },
          })
        : Response.json(scope);
    if (failure === "redirect")
      Object.defineProperty(response, "url", {
        value: "https://foreign.invalid/v1/library-context",
      });
    if (failure === "content-type")
      response.headers.set("content-type", "text/html");
    if (failure === "oversize")
      response.headers.set("content-length", String(CLOUD_PAGE_WIRE_BYTES + 1));
    await expect(
      createCloudLibraryContextWebReader(
        config(),
        new AbortController().signal,
        fake(async () => response),
      )(),
    ).rejects.toMatchObject({ kind: "paused" });
  },
);

it("cancels before dispatch without leaking the original abort reason", async () => {
  const controller = new AbortController(),
    fetcher = vi.fn(),
    read = createCloudLibraryContextWebReader(
      config(),
      controller.signal,
      fetcher,
    ),
    task = read();
  controller.abort("synthetic private cancellation");
  await expect(task).rejects.toMatchObject({
    kind: "canceled",
    message: "Cloud library context request canceled.",
  });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(read()).rejects.toMatchObject({ kind: "canceled" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("discards held old headers after cancellation and cancels the late body", async () => {
  const held = deferred(),
    entered = deferred(),
    canceled = vi.fn(),
    controller = new AbortController();
  const late = new Response(new ReadableStream({ cancel: canceled }), {
    headers: { "content-type": "application/json" },
  });
  const fetcher = fake(async () => {
      entered.resolve();
      await held.promise;
      return late;
    }),
    read = createCloudLibraryContextWebReader(
      config(),
      controller.signal,
      fetcher,
    ),
    task = read();
  await entered.promise;
  controller.abort("private old context");
  await expect(task).rejects.toMatchObject({ kind: "canceled" });
  held.resolve();
  await expect.poll(() => canceled.mock.calls.length).toBe(1);
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});

it("discards a pending old body on auth cancellation", async () => {
  const canceled = vi.fn(),
    entered = deferred(),
    controller = new AbortController(),
    response = new Response(
      new ReadableStream(
        {
          pull() {
            entered.resolve();
          },
          cancel: canceled,
        },
        { highWaterMark: 0 },
      ),
      { headers: { "content-type": "application/json" } },
    );
  const read = createCloudLibraryContextWebReader(
      config(),
      controller.signal,
      fake(async () => response),
    ),
    task = read();
  await entered.promise;
  controller.abort("private body reason");
  await expect(task).rejects.toMatchObject({ kind: "canceled" });
  expect(canceled).toHaveBeenCalledTimes(1);
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});

it("includes a held body in the existing deadline and permits a new explicit read afterward", async () => {
  vi.useFakeTimers();
  try {
    const controller = new AbortController(),
      canceled = vi.fn();
    let calls = 0;
    const fetcher = fake(async () =>
        ++calls === 1
          ? new Response(new ReadableStream({ cancel: canceled }), {
              headers: { "content-type": "application/json" },
            })
          : Response.json(scope),
      ),
      read = createCloudLibraryContextWebReader(
        config(),
        controller.signal,
        fetcher,
      ),
      task = read(),
      check = expect(task).rejects.toMatchObject({ kind: "paused" });
    await vi.advanceTimersByTimeAsync(CLOUD_WEB_DEADLINE_MS + 1);
    await check;
    expect(canceled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(await read()).toEqual(scope);
    expect(calls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
