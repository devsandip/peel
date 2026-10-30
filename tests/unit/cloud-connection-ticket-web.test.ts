import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  createCloudConnectionTicketWebReader,
  CloudConnectionTicketReadError,
} from "../../apps/web/src/cloud-connection-ticket-web";
import { createCloudWebJSONSender } from "../../apps/web/src/cloud-web-json";
import { CloudConnectionTickets } from "../../packages/cloud-protocol/src/connection-tickets";
import { SQLiteCloudConnectionTicketStore } from "../../packages/cloud-protocol/src/connection-tickets-sqlite";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import {
  CloudMutationService,
  CloudServerError,
} from "../../packages/cloud-protocol/src/server";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import {
  createCloudWebSessionBoundary,
  type CloudWebSession,
} from "../../packages/cloud-protocol/src/web-session";

const origin = "https://ticket-web.synthetic",
  BASE = 1800000000000;
type Identity = { cookie: string; csrfToken: string };
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
  const folder = mkdtempSync(join(tmpdir(), "synkies-ticket-web-")),
    sessions = new Map<string, CloudWebSession>(),
    controllers: AbortController[] = [],
    tasks: Promise<unknown>[] = [],
    releases: (() => void)[] = [],
    control = {
      cookie: "",
      source: origin,
      enabled: true,
      failCommit: false,
      after: null as
        null | ((request: Request, reply: Response) => Promise<Response>),
    };
  let server: SQLiteCloudServerStore | undefined,
    ticketStore: SQLiteCloudConnectionTicketStore | undefined;
  try {
    const accounts = new SQLiteCloudServerStore(
      join(folder, "accounts.sqlite3"),
    );
    server = accounts;
    const stored = new SQLiteCloudConnectionTicketStore(
      join(folder, "tickets.sqlite3"),
      () => {
        if (control.failCommit) throw Error("synthetic private storage path");
      },
    );
    ticketStore = stored;
    for (const letter of ["a", "b"])
      await accounts.seedAccount({
        version: 1,
        ownerSubject: "ticket-web-owner-" + letter,
        collectionId: "ticket-web-library-" + letter,
        modeGeneration: 7,
        revision: 1,
        sequence: 0,
        wall: 0,
        status: "active",
        entitlement: "active",
      });
    const boundary = createCloudWebSessionBoundary(
        { origin, lifetimeMs: 60000 },
        {
          read: async (id) =>
            sessions.has(id) ? structuredClone(sessions.get(id)!) : null,
          insert: async (entry) => {
            if (sessions.has(entry.idHash)) return false;
            sessions.set(entry.idHash, structuredClone(entry));
            return true;
          },
          revoke: async (id) => {
            const entry = sessions.get(id);
            if (entry) entry.revoked = true;
          },
        },
        async (request) => {
          const as = request.headers.get("authorization");
          if (as !== "synthetic-a" && as !== "synthetic-b")
            throw new CloudServerError("unauthorized", 401);
          return "ticket-web-owner-" + as.slice(-1);
        },
        () => BASE,
      ),
      library = new CloudMutationService(accounts, () => BASE),
      tickets = new CloudConnectionTickets(
        { origin, lifetimeMs: 30000 },
        boundary.resolveSession,
        library,
        stored,
        () => BASE,
      ),
      generic = vi.fn(async () => {
        throw Error("synthetic unexpected generic authentication");
      }),
      handler = createCloudMutationHandler(
        library,
        generic,
        undefined,
        tickets,
      ),
      unconfigured = createCloudMutationHandler(library, generic);
    async function identity(
      letter = "a",
      previous?: Identity,
    ): Promise<Identity> {
      const reply = await boundary.issue(
        new Request(origin + "/auth/session", {
          method: "POST",
          headers: {
            origin,
            authorization: "synthetic-" + letter,
            ...(previous ? { cookie: previous.cookie } : {}),
          },
        }),
      );
      return {
        cookie: reply.headers.get("set-cookie")!.split(";")[0],
        csrfToken: (await reply.json()).csrfToken,
      };
    }
    const a = await identity(),
      b = await identity("b");
    control.cookie = a.cookie;
    const fetcher = vi.fn(
      async (input: string | URL | Request, options?: RequestInit) => {
        const request = new Request(input, options);
        // In-process Fetch fixture only: no real browser Secure-cookie/TLS acceptance.
        request.headers.set("cookie", control.cookie);
        request.headers.set("origin", control.source);
        const reply = await (control.enabled ? handler : unconfigured)(request);
        return control.after ? control.after(request, reply) : reply;
      },
    ) as unknown as typeof fetch;
    const config = { origin, csrfToken: a.csrfToken };
    return {
      accounts,
      tickets,
      handler,
      unconfigured,
      generic,
      boundary,
      control,
      fetcher,
      config,
      a,
      b,
      make() {
        const controller = new AbortController();
        controllers.push(controller);
        return {
          controller,
          read: createCloudConnectionTicketWebReader(
            config,
            controller.signal,
            fetcher,
          ),
        };
      },
      request(
        method = "POST",
        options: RequestInit = {},
        path = "/v1/connection-ticket",
      ) {
        return new Request(origin + path, {
          method,
          ...options,
          headers: {
            origin,
            cookie: control.cookie,
            "x-peel-csrf": a.csrfToken,
            ...options.headers,
          },
        });
      },
      redeem(ticket: string, who = a) {
        return tickets.consume(
          new Request(origin + "/synthetic-preupgrade", {
            headers: {
              origin,
              cookie: who.cookie,
              "x-peel-csrf": who.csrfToken,
            },
          }),
          ticket,
        );
      },
      async rotate() {
        const next = await identity("b", a);
        control.cookie = next.cookie;
        return next;
      },
      track<T>(task: Promise<T>) {
        tasks.push(task);
        void task.catch(() => {});
        return task;
      },
      hold() {
        const entered = deferred(),
          release = deferred();
        releases.push(release.resolve);
        return { entered, release };
      },
      async cleanup() {
        for (const controller of controllers) controller.abort();
        for (const release of releases) release();
        await Promise.allSettled(tasks);
        await Promise.allSettled(
          (fetcher as any).mock.results.map((r: any) => r.value),
        );
        await stored.close();
        await accounts.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await ticketStore?.close();
    await server?.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

it("issues a real one-use ticket by bodyless POST, keeps it no-store and consumes it only server-side", async () =>
  fixture(async (f) => {
    const { read } = f.make();
    expect(f.fetcher).not.toHaveBeenCalled();
    const issued = await read();
    expect(Object.keys(issued).sort()).toEqual(["expiresAt", "ticket"]);
    expect(Object.isFrozen(issued)).toBe(true);
    expect(issued.expiresAt).toBe(BASE + 30000);
    const [url, options] = (f.fetcher as any).mock.calls[0];
    expect(url).toBe(origin + "/v1/connection-ticket");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
    expect(Object.hasOwn(options, "body")).toBe(false);
    const response = await f.handler(f.request());
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect((await f.redeem(issued.ticket)).scope).toMatchObject({
      ownerSubject: "ticket-web-owner-a",
      collectionId: "ticket-web-library-a",
      modeGeneration: 7,
    });
    await expect(f.redeem(issued.ticket)).rejects.toMatchObject({
      status: 401,
    });
    expect(f.generic).not.toHaveBeenCalled();
  }));

it("independent concurrent invocations obtain distinct credentials without caching or coalescing", async () =>
  fixture(async (f) => {
    const { read } = f.make(),
      one = read(),
      two = read();
    expect(one).not.toBe(two);
    const values = await Promise.all([one, two]);
    expect(values[0].ticket).not.toBe(values[1].ticket);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    await f.redeem(values[0].ticket);
    await f.redeem(values[1].ticket);
    const third = await read();
    expect(values.map((item) => item.ticket)).not.toContain(third.ticket);
  }));

it("captures configuration but refuses a replacement cookie under the original nonce", async () =>
  fixture(async (f) => {
    const { read } = f.make();
    f.config.origin = "https://later.synthetic";
    f.config.csrfToken = "z".repeat(43);
    const original = await read();
    await f.redeem(original.ticket);
    const next = await f.rotate();
    await expect(read()).rejects.toMatchObject({
      kind: "paused",
      message: "Could not request a Cloud connection ticket.",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    const fresh = createCloudConnectionTicketWebReader(
      { origin, csrfToken: next.csrfToken },
      new AbortController().signal,
      f.fetcher,
    );
    expect(
      (await f.redeem((await fresh()).ticket, next)).scope.ownerSubject,
    ).toBe("ticket-web-owner-b");
  }));

it("keeps an unconfigured route unavailable and exposes no consume HTTP route", async () =>
  fixture(async (f) => {
    expect((await f.unconfigured(f.request())).status).toBe(404);
    expect(
      (
        await f.handler(
          f.request(
            "POST",
            { body: "synthetic" },
            "/v1/connection-ticket/consume",
          ),
        )
      ).status,
    ).toBe(404);
    f.control.enabled = false;
    const { read } = f.make();
    await expect(read()).rejects.toMatchObject({ kind: "paused" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.generic).not.toHaveBeenCalled();
  }));

it.each(["method", "query", "body", "csrf", "origin", "cookie"])(
  "refuses %s without a generic/native authentication fallback",
  async (failure) =>
    fixture(async (f) => {
      const request = f.request(
        failure === "method" ? "GET" : "POST",
        failure === "body"
          ? { body: JSON.stringify({ paid: true, ownerSubject: "other" }) }
          : {},
        "/v1/connection-ticket" + (failure === "query" ? "?owner=other" : ""),
      );
      if (failure === "csrf") request.headers.delete("x-peel-csrf");
      if (failure === "origin")
        request.headers.set("origin", "https://foreign.synthetic");
      if (failure === "cookie") {
        request.headers.delete("cookie");
        request.headers.set("authorization", "Bearer synthetic-a");
      }
      const response = await f.handler(request);
      expect(response.status).toBe(
        failure === "method"
          ? 405
          : failure === "cookie"
            ? 401
            : ["csrf", "origin"].includes(failure)
              ? 403
              : 400,
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(f.generic).not.toHaveBeenCalled();
    }),
);

it("shows sign-in for missing cookies and never retries an entitlement or storage failure", async () =>
  fixture(async (f) => {
    const { read } = f.make();
    f.control.cookie = "";
    await expect(read()).rejects.toMatchObject({
      kind: "sign-in-required",
      message: "Sign in again to connect to Cloud.",
    });
    f.control.cookie = f.a.cookie;
    await f.accounts.setPolicy("ticket-web-owner-a", "active", "inactive");
    await expect(read()).rejects.toMatchObject({ kind: "paused" });
    await Promise.resolve();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    await f.accounts.setPolicy("ticket-web-owner-a", "active", "active");
    f.control.failCommit = true;
    await expect(read()).rejects.toThrow(
      "Could not request a Cloud connection ticket.",
    );
    expect(f.fetcher).toHaveBeenCalledTimes(3);
  }));

it.each(["extra", "token", "expiry", "array"])(
  "refuses %s response corruption with fixed private errors",
  async (failure) =>
    fixture(async (f) => {
      f.control.after = async (_request, reply) => {
        const value = await reply.json();
        return Response.json(
          failure === "array"
            ? [value]
            : {
                ...value,
                ...(failure === "extra"
                  ? { privateCredential: "synthetic private response" }
                  : failure === "token"
                    ? { ticket: "private" }
                    : { expiresAt: "private" }),
              },
        );
      };
      await expect(f.make().read()).rejects.toMatchObject({
        kind: "paused",
        message: "Could not request a Cloud connection ticket.",
      });
    }),
);

it("a fetcher's mutated domain error cannot expose private text", async () =>
  fixture(async (f) => {
    const error = new CloudConnectionTicketReadError("sign-in-required");
    error.message = "synthetic private token/path";
    const read = createCloudConnectionTicketWebReader(
      f.config,
      new AbortController().signal,
      async () => {
        throw error;
      },
    );
    await expect(read()).rejects.toMatchObject({
      kind: "paused",
      message: "Could not request a Cloud connection ticket.",
    });
  }));

it("does not turn the device clock into ticket expiry authority", async () =>
  fixture(async (f) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(BASE + 86400000);
    try {
      expect((await f.make().read()).expiresAt).toBe(BASE + 30000);
    } finally {
      clock.mockRestore();
    }
  }));

it("original abort withholds a held late issued credential and cancels its response", async () =>
  fixture(async (f) => {
    const held = f.hold();
    let reply!: Response;
    f.control.after = async (_request, response) => {
      reply = response;
      held.entered.resolve();
      await held.release.promise;
      return response;
    };
    const { read, controller } = f.make(),
      task = f.track(read());
    await Promise.race([
      held.entered.promise,
      task.then(() => {
        throw Error("Expected held response");
      }),
    ]);
    controller.abort("synthetic private account cancellation");
    await expect(task).rejects.toMatchObject({
      kind: "canceled",
      message: "Cloud connection ticket request canceled.",
    });
    held.release.resolve();
    await Promise.allSettled(
      (f.fetcher as any).mock.results.map((r: any) => r.value),
    );
    await Promise.resolve();
    expect(reply.body?.locked).toBe(false);
    const reader = reply.body!.getReader();
    try {
      expect(await reader.read()).toEqual({ done: true, value: undefined });
    } finally {
      reader.releaseLock();
    }
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  }));

it("rejects an already canceled original lifetime before dispatch", async () =>
  fixture(async (f) => {
    const { read, controller } = f.make();
    controller.abort("synthetic private reason");
    await expect(read()).rejects.toMatchObject({ kind: "canceled" });
    expect(f.fetcher).not.toHaveBeenCalled();
  }));

it.each(["DELETE", "GET"])(
  "the shared sender refuses an unsupported/body-bearing %s override before dispatch",
  async (method) =>
    fixture(async (f) => {
      const send = createCloudWebJSONSender<null>(
        f.config,
        () =>
          ({
            path: "/v1/connection-ticket",
            method,
            ...(method === "GET" ? { body: "{}" } : {}),
          }) as any,
        () => Error("Fixed unavailable"),
        f.fetcher,
      );
      await expect(send(null, new AbortController().signal)).rejects.toThrow(
        "Fixed unavailable",
      );
      expect(f.fetcher).not.toHaveBeenCalled();
    }),
);
