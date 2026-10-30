import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import {
  CloudConnectionTickets,
  MAX_CONNECTION_TICKET_MS,
  validateCloudConnectionTicket,
  type CloudConnectionTicket,
  type CloudConnectionTicketStore,
} from "../../packages/cloud-protocol/src/connection-tickets";
import {
  SQLiteCloudConnectionTicketStore,
  CONNECTION_TICKET_ROWS,
  CONNECTION_TICKETS_PER_SESSION,
  CONNECTION_TICKET_RECLAIM,
} from "../../packages/cloud-protocol/src/connection-tickets-sqlite";
import {
  createCloudWebSessionBoundary,
  type CloudWebSession,
} from "../../packages/cloud-protocol/src/web-session";
import {
  CloudMutationService,
  CloudServerError,
  type CloudAccount,
} from "../../packages/cloud-protocol/src/server";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";

const origin = "https://tickets.synthetic",
  BASE = 1800000000000;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const scope = {
  version: 1 as const,
  ownerSubject: "ticket-owner-a",
  collectionId: "ticket-library-a",
  modeGeneration: 7,
};
function record(
  i = 0,
  session = "session-a",
  issuedAt = BASE,
): CloudConnectionTicket {
  return {
    version: 1,
    idHash: digest("ticket-" + i),
    sessionHash: digest(session),
    scope: { ...scope },
    issuedAt,
    expiresAt: issuedAt + 30000,
  };
}
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
  const folder = mkdtempSync(join(tmpdir(), "synkies-connection-ticket-")),
    ticketPath = join(folder, "tickets.sqlite3"),
    accountPath = join(folder, "accounts.sqlite3"),
    connections: SQLiteCloudConnectionTicketStore[] = [],
    tasks: Promise<unknown>[] = [],
    releases: (() => void)[] = [],
    controllers: AbortController[] = [],
    sessions = new Map<string, CloudWebSession>(),
    now = { value: BASE },
    control = {
      failCommit: false,
      afterInsert: null as null | (() => Promise<void>),
      afterTake: null as null | (() => Promise<void>),
    };
  const accounts = new SQLiteCloudServerStore(accountPath);
  try {
    const tickets = new SQLiteCloudConnectionTicketStore(ticketPath, () => {
      if (control.failCommit) throw Error("synthetic private commit detail");
    });
    connections.push(tickets);
    const library = new CloudMutationService(accounts, () => now.value),
      account = (letter = "a"): CloudAccount => ({
        ...scope,
        ownerSubject: "ticket-owner-" + letter,
        collectionId: "ticket-library-" + letter,
        status: "active",
        entitlement: "active",
        revision: 1,
        sequence: 0,
        wall: 0,
      });
    await accounts.seedAccount(account());
    await accounts.seedAccount(account("b"));
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
        const auth = request.headers.get("authorization");
        if (auth !== "synthetic-a" && auth !== "synthetic-b")
          throw new CloudServerError("unauthorized", 401);
        return "ticket-owner-" + auth.slice(-1);
      },
      () => now.value,
    );
    const store: CloudConnectionTicketStore = {
        insert: vi.fn(async (entry, at) => {
          const result = await tickets.insert(entry, at);
          await control.afterInsert?.();
          return result;
        }),
        take: vi.fn(async (idHash: string, sessionHash: string, at: number) => {
          const result = await tickets.take(idHash, sessionHash, at);
          await control.afterTake?.();
          return result;
        }),
        close: vi.fn(async () => {}),
      },
      resolver = vi.fn(boundary.resolveSession),
      config = { origin, lifetimeMs: 30000 },
      service = new CloudConnectionTickets(
        config,
        resolver,
        library,
        store,
        () => now.value,
      );
    type Identity = { cookie: string; csrf: string };
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
        csrf: (await reply.json()).csrfToken,
      };
    }
    const a = await identity(),
      b = await identity("b");
    function request(
      method: string,
      who = a,
      overrides: RequestInit = {},
      url = origin + "/synthetic-ticket-boundary",
    ) {
      const controller = new AbortController();
      controllers.push(controller);
      return {
        controller,
        input: new Request(url, {
          method,
          signal: controller.signal,
          ...overrides,
          headers: {
            origin,
            cookie: who.cookie,
            "x-peel-csrf": who.csrf,
            ...overrides.headers,
          },
        }),
      };
    }
    const inspect = <T>(read: (db: DatabaseSync) => T, path = ticketPath) => {
      const db = new DatabaseSync(path);
      try {
        return read(db);
      } finally {
        db.close();
      }
    };
    return {
      ticketPath,
      accountPath,
      accounts,
      tickets,
      boundary,
      sessions,
      service,
      resolver,
      store,
      config,
      control,
      now,
      a,
      b,
      account,
      identity,
      request,
      inspect,
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
      reopen() {
        const next = new SQLiteCloudConnectionTicketStore(ticketPath);
        connections.push(next);
        return next;
      },
      async cleanup() {
        for (const controller of controllers) controller.abort();
        for (const release of releases) release();
        await Promise.allSettled(tasks);
        await Promise.allSettled(
          connections.map((connection) => connection.close()),
        );
        await accounts.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await Promise.allSettled(
      connections.map((connection) => connection.close()),
    );
    await accounts.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

it("issues only a random digest-stored original-session/library ticket and consumes it once without touching notes", async () =>
  fixture(async (f) => {
    const issued = await f.service.issue(f.request("POST").input);
    expect(issued.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(issued).sort()).toEqual(["expiresAt", "ticket"]);
    expect(issued.expiresAt).toBe(BASE + 30000);
    expect(Object.isFrozen(issued)).toBe(true);
    const rows = f.inspect((db) =>
      db.prepare("SELECT * FROM m0_cloud_tickets").all(),
    );
    expect(rows).toHaveLength(1);
    const saved = JSON.parse(String(rows[0].state));
    expect(saved).toEqual({
      version: 1,
      idHash: digest(issued.ticket),
      sessionHash: digest(f.a.cookie.split("=")[1]),
      scope,
      issuedAt: BASE,
      expiresAt: BASE + 30000,
    });
    for (const raw of [issued.ticket, f.a.cookie.split("=")[1], f.a.csrf])
      expect(JSON.stringify(rows)).not.toContain(raw);
    const grant = await f.service.consume(
      f.request("GET").input,
      issued.ticket,
    );
    expect(grant).toEqual({
      scope,
      sessionHash: saved.sessionHash,
      expiresAt: issued.expiresAt,
    });
    expect(Object.isFrozen(grant)).toBe(true);
    expect(Object.isFrozen(grant.scope)).toBe(true);
    await expect(
      f.service.consume(f.request("GET").input, issued.ticket),
    ).rejects.toMatchObject({
      code: "connection-ticket-unavailable",
      status: 401,
    });
    expect(f.store.close).not.toHaveBeenCalled();
    expect(
      f.inspect(
        (db) =>
          ["notes", "ops", "changes", "tombstones"].map(
            (name) =>
              db
                .prepare("SELECT count(*) AS n FROM m0_cloud_server_" + name)
                .get()!.n,
          ),
        f.accountPath,
      ),
    ).toEqual([0, 0, 0, 0]);
  }));

it("exposes only cloned frozen validated session metadata to server callers", async () =>
  fixture(async (f) => {
    const session = await f.boundary.resolveSession(f.request("GET").input);
    expect(Object.isFrozen(session)).toBe(true);
    expect(() => {
      (session as any).subject = "replacement";
    }).toThrow();
    expect(
      (await f.boundary.resolveSession(f.request("GET").input)).subject,
    ).toBe(scope.ownerSubject);
  }));

it("captures configuration and request headers before asynchronous authentication", async () =>
  fixture(async (f) => {
    f.config.origin = "https://later.synthetic";
    f.config.lifetimeMs = 60000;
    const { input } = f.request("POST"),
      task = f.track(f.service.issue(input));
    input.headers.set("cookie", f.b.cookie);
    input.headers.set("x-peel-csrf", f.b.csrf);
    const issued = await task;
    expect(issued.expiresAt).toBe(BASE + 30000);
    expect(
      (await f.service.consume(f.request("GET").input, issued.ticket)).scope,
    ).toEqual(scope);
  }));

it("caps expiry at the original authenticated session deadline", async () =>
  fixture(async (f) => {
    f.now.value = BASE + 59999;
    expect((await f.service.issue(f.request("POST").input)).expiresAt).toBe(
      BASE + 60000,
    );
  }));

it.each([
  "cookie",
  "csrf",
  "origin",
  "foreign-origin",
  "body",
  "query",
  "method",
  "aborted",
])(
  "rejects %s issuance before ticket storage or note access",
  async (failure) =>
    fixture(async (f) => {
      const { input, controller } = f.request(
        failure === "method" ? "GET" : "POST",
        f.a,
        failure === "body"
          ? { body: JSON.stringify({ ownerSubject: "other", paid: true }) }
          : {},
        origin +
          "/synthetic-ticket-boundary" +
          (failure === "query" ? "?owner=other" : ""),
      );
      if (failure === "cookie") input.headers.delete("cookie");
      if (failure === "csrf") input.headers.delete("x-peel-csrf");
      if (failure === "origin") input.headers.delete("origin");
      if (failure === "foreign-origin")
        input.headers.set("origin", "https://other.synthetic");
      if (failure === "aborted")
        controller.abort("synthetic private cancellation");
      await expect(f.service.issue(input)).rejects.toMatchObject({
        code: "connection-ticket-unavailable",
      });
      expect(f.store.insert).not.toHaveBeenCalled();
      expect(f.store.take).not.toHaveBeenCalled();
    }),
);

it("a foreign current session cannot burn the original session's ticket", async () =>
  fixture(async (f) => {
    const issued = await f.service.issue(f.request("POST").input);
    await expect(
      f.service.consume(f.request("GET", f.b).input, issued.ticket),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      (await f.service.consume(f.request("GET").input, issued.ticket)).scope,
    ).toEqual(scope);
  }));

it("rejects missing connection Origin and query credentials without burning a valid ticket", async () =>
  fixture(async (f) => {
    const issued = await f.service.issue(f.request("POST").input);
    const missing = f.request("GET").input;
    missing.headers.delete("origin");
    await expect(
      f.service.consume(missing, issued.ticket),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      f.service.consume(
        f.request("GET", f.a, {}, origin + "/connect?ticket=synthetic").input,
        issued.ticket,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.store.take).not.toHaveBeenCalled();
    expect(
      (await f.service.consume(f.request("GET").input, issued.ticket)).scope,
    ).toEqual(scope);
  }));

it("refuses a structurally valid claimed record that extends beyond its authenticated session", async () =>
  fixture(async (f) => {
    const issued = await f.service.issue(f.request("POST").input);
    f.now.value = BASE + 10;
    f.store.take = vi.fn(async (id: string, session: string, at: number) => {
      const saved = await f.tickets.take(id, session, at);
      return saved && { ...saved, issuedAt: BASE + 1, expiresAt: BASE + 60001 };
    });
    await expect(
      f.service.consume(f.request("GET").input, issued.ticket),
    ).rejects.toMatchObject({ status: 503 });
  }));

it("a duplicate digest cannot replace the issued scope or session across reopening", async () =>
  fixture(async (f) => {
    const original = record();
    expect(await f.tickets.insert(original, BASE)).toBe(true);
    expect(
      await f.tickets.insert(
        {
          ...original,
          sessionHash: digest("replacement"),
          scope: { ...scope, modeGeneration: 8 },
        },
        BASE,
      ),
    ).toBe(false);
    expect(
      await f.reopen().take(original.idHash, original.sessionHash, BASE),
    ).toEqual(original);
  }));

it("simultaneous consumers through separate reopened SQLite handles produce only one prerequisite", async () =>
  fixture(async (f) => {
    const issued = await f.service.issue(f.request("POST").input),
      other = f.reopen(),
      second = new CloudConnectionTickets(
        { origin, lifetimeMs: 30000 },
        f.boundary.resolveSession,
        new CloudMutationService(f.accounts, () => f.now.value),
        other,
        () => f.now.value,
      );
    const outcomes = await Promise.allSettled([
      f.service.consume(f.request("GET").input, issued.ticket),
      second.consume(f.request("GET").input, issued.ticket),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      f.inspect(
        (db) =>
          db.prepare("SELECT count(*) AS n FROM m0_cloud_tickets").get()!.n,
      ),
    ).toBe(0);
  }));

it.each([
  "logout",
  "rotation",
  "entitlement",
  "generation",
  "deletion",
  "expiry",
  "abort",
])("withholds and burns a claimed ticket after late %s", async (failure) =>
  fixture(async (f) => {
    const issued = await f.service.issue(f.request("POST").input),
      held = f.hold(),
      { input, controller } = f.request("GET");
    f.control.afterTake = async () => {
      held.entered.resolve();
      await held.release.promise;
    };
    const task = f.track(f.service.consume(input, issued.ticket));
    await Promise.race([
      held.entered.promise,
      task.then(() => {
        throw Error("Expected held claim");
      }),
    ]);
    if (failure === "logout") await f.boundary.logout(f.request("POST").input);
    if (failure === "rotation") await f.identity("a", f.a);
    if (failure === "entitlement" || failure === "deletion")
      await f.accounts.setPolicy(
        scope.ownerSubject,
        failure === "deletion" ? "deleted" : "active",
        failure === "entitlement" ? "inactive" : "active",
      );
    if (failure === "generation") {
      const current = (await f.accounts.readAccount(scope.ownerSubject))!;
      // Explicit administration of this fresh synthetic account database only.
      f.inspect((db) => {
        const next = {
          ...current,
          revision: current.revision + 1,
          modeGeneration: 8,
        };
        expect(
          db
            .prepare(
              "UPDATE m0_cloud_server_accounts SET revision=?,state=? WHERE owner=? AND revision=?",
            )
            .run(
              next.revision,
              JSON.stringify(next),
              scope.ownerSubject,
              current.revision,
            ).changes,
        ).toBe(1);
      }, f.accountPath);
    }
    if (failure === "expiry") f.now.value = issued.expiresAt;
    if (failure === "abort") controller.abort("synthetic private reason");
    held.release.resolve();
    await expect(task).rejects.toMatchObject({
      code: "connection-ticket-unavailable",
    });
    f.control.afterTake = null;
    expect(
      f.inspect(
        (db) =>
          db.prepare("SELECT count(*) AS n FROM m0_cloud_tickets").get()!.n,
      ),
    ).toBe(0);
    expect(f.store.close).not.toHaveBeenCalled();
  }),
);

it("withholds issuance after logout during the persisted insert and never returns raw storage errors", async () =>
  fixture(async (f) => {
    const held = f.hold();
    f.control.afterInsert = async () => {
      held.entered.resolve();
      await held.release.promise;
    };
    const task = f.track(f.service.issue(f.request("POST").input));
    await Promise.race([
      held.entered.promise,
      task.then(() => {
        throw Error("Expected held insert");
      }),
    ]);
    await f.boundary.logout(f.request("POST").input);
    held.release.resolve();
    await expect(task).rejects.toMatchObject({
      code: "connection-ticket-unavailable",
      status: 401,
    });
    f.control.afterInsert = null;
  }));

it("rolls back actual insert/take failures and permits exactly one later explicit claim", async () =>
  fixture(async (f) => {
    f.control.failCommit = true;
    await expect(f.service.issue(f.request("POST").input)).rejects.toThrow(
      "Cloud server: connection-ticket-unavailable",
    );
    expect(
      f.inspect(
        (db) =>
          db.prepare("SELECT count(*) AS n FROM m0_cloud_tickets").get()!.n,
      ),
    ).toBe(0);
    f.control.failCommit = false;
    const issued = await f.service.issue(f.request("POST").input);
    f.control.failCommit = true;
    await expect(
      f.service.consume(f.request("GET").input, issued.ticket),
    ).rejects.toThrow("Cloud server: connection-ticket-unavailable");
    f.control.failCommit = false;
    expect(
      (await f.service.consume(f.request("GET").input, issued.ticket)).scope,
    ).toEqual(scope);
  }));

it("rejects corrupted private stored records and malformed tokens without leaking details", async () =>
  fixture(async (f) => {
    const issued = await f.service.issue(f.request("POST").input);
    f.inspect((db) =>
      db
        .prepare("UPDATE m0_cloud_tickets SET state=?")
        .run(JSON.stringify({ privateCredential: "synthetic private text" })),
    );
    await expect(
      f.service.consume(f.request("GET").input, issued.ticket),
    ).rejects.toThrow("Cloud server: connection-ticket-unavailable");
    const calls = (f.store.take as any).mock.calls.length;
    for (const raw of [null, "short", { ticket: issued.ticket }])
      await expect(
        f.service.consume(f.request("GET").input, raw),
      ).rejects.toMatchObject({ status: 400 });
    expect((f.store.take as any).mock.calls.length).toBe(calls);
  }));

it("persists monotonic time even for missing claims and rejects rollback after reopening", async () =>
  fixture(async (f) => {
    const r = record();
    await f.tickets.insert(r, BASE);
    expect(
      await f.tickets.take(digest("missing"), r.sessionHash, BASE + 500),
    ).toBeNull();
    const reopened = f.reopen();
    await expect(
      reopened.take(r.idHash, r.sessionHash, BASE + 499),
    ).rejects.toThrow("Cloud connection ticket storage unavailable");
    expect(await reopened.take(r.idHash, r.sessionHash, BASE + 500)).toEqual(r);
    expect(
      await f.tickets.take(r.idHash, r.sessionHash, BASE + 500),
    ).toBeNull();
  }));

it("expiry is enforced without TTL and cannot be undone by a restarted clock", async () =>
  fixture(async (f) => {
    const r = record();
    await f.tickets.insert(r, BASE);
    expect(
      await f.tickets.take(r.idHash, r.sessionHash, r.expiresAt),
    ).toBeNull();
    const reopened = f.reopen();
    await expect(
      reopened.take(r.idHash, r.sessionHash, r.expiresAt - 1),
    ).rejects.toThrow();
    expect(
      await reopened.take(r.idHash, r.sessionHash, r.expiresAt),
    ).toBeNull();
  }));

it("bounds session admission without replacing issued digests", async () =>
  fixture(async (f) => {
    const issued = [];
    for (let i = 0; i < CONNECTION_TICKETS_PER_SESSION; i++)
      issued.push(await f.service.issue(f.request("POST").input));
    expect(new Set(issued.map((item) => item.ticket)).size).toBe(
      CONNECTION_TICKETS_PER_SESSION,
    );
    await expect(
      f.service.issue(f.request("POST").input),
    ).rejects.toMatchObject({ status: 429 });
    await f.service.consume(f.request("GET").input, issued[0].ticket);
    expect((await f.service.issue(f.request("POST").input)).ticket).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  }));

it("bounds retained rows and expiry reclamation in actual transactions", async () =>
  fixture(async (f) => {
    f.inspect((db) => {
      db.exec("BEGIN IMMEDIATE");
      const insert = db.prepare("INSERT INTO m0_cloud_tickets VALUES(?,?,?,?)");
      for (let i = 0; i < CONNECTION_TICKET_ROWS; i++) {
        const r = record(i, "session-" + i);
        insert.run(r.idHash, r.sessionHash, r.expiresAt, JSON.stringify(r));
      }
      db.exec("COMMIT");
    });
    expect(
      await f.tickets.insert(record(CONNECTION_TICKET_ROWS + 1, "extra"), BASE),
    ).toBe(false);
    const next = record(CONNECTION_TICKET_ROWS + 1, "extra", BASE + 30000);
    expect(await f.tickets.insert(next, next.issuedAt)).toBe(true);
    expect(
      f.inspect(
        (db) =>
          db.prepare("SELECT count(*) AS n FROM m0_cloud_tickets").get()!.n,
      ),
    ).toBe(CONNECTION_TICKET_ROWS - CONNECTION_TICKET_RECLAIM + 1);
  }));

it("refuses unknown databases without changing their fixture contents", async () =>
  fixture(async (f) => {
    const path = join(f.ticketPath, "..", "unrecognized.sqlite3");
    f.inspect((db) => {
      db.exec("CREATE TABLE unrelated(value TEXT)");
      db.prepare("INSERT INTO unrelated VALUES(?)").run(
        "synthetic retained value",
      );
    }, path);
    expect(() => new SQLiteCloudConnectionTicketStore(path)).toThrow(
      "Cloud connection ticket storage unavailable",
    );
    expect(
      f.inspect(
        (db) => db.prepare("SELECT value FROM unrelated").get()!.value,
        path,
      ),
    ).toBe("synthetic retained value");
  }));

it("validates private extra fields and the technical lifetime cap without granting authority", () => {
  const r = record();
  expect(validateCloudConnectionTicket(r)).toEqual(r);
  for (const raw of [
    { ...r, credential: "synthetic" },
    { ...r, expiresAt: BASE + MAX_CONNECTION_TICKET_MS + 1 },
    { ...r, scope: { ...scope, paid: true } },
  ])
    expect(() =>
      validateCloudConnectionTicket(raw as CloudConnectionTicket),
    ).toThrow("Cloud server: connection-ticket-unavailable");
});
