import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import {
  CloudConnectionRegistry,
  MAX_CONNECTION_LEASE_MS,
  validateCloudConnectionRecord,
  type CloudConnectionRecord,
  type CloudConnectionRegistryStore,
} from "../../packages/cloud-protocol/src/connection-registry";
import {
  SQLiteCloudConnectionRegistryStore,
  CONNECTION_REGISTRY_ROWS,
  CONNECTIONS_PER_SESSION,
  CONNECTION_REGISTRY_RECLAIM,
} from "../../packages/cloud-protocol/src/connection-registry-sqlite";
import { CloudConnectionTickets } from "../../packages/cloud-protocol/src/connection-tickets";
import { SQLiteCloudConnectionTicketStore } from "../../packages/cloud-protocol/src/connection-tickets-sqlite";
import { createCloudWebSocketAuthorizer } from "../../packages/cloud-protocol/src/websocket-authorizer";
import { cloudWebSocketProtocols } from "../../packages/cloud-protocol/src/websocket-handshake";
import {
  createCloudWebSessionBoundary,
  type CloudWebSession,
  type CloudWebSessionStore,
} from "../../packages/cloud-protocol/src/web-session";
import { CloudMutationService } from "../../packages/cloud-protocol/src/server";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
const BASE = 1800000000000,
  origin = "https://registry.synthetic",
  domain = "gateway.synthetic",
  arn = "arn:aws:execute-api:ap-south-1:000000000000:syntheticapi/dev/$connect",
  scope = {
    version: 1 as const,
    ownerSubject: "registry-owner-a",
    collectionId: "registry-library-a",
    modeGeneration: 7,
  };
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function entry(i = 0, at = BASE, session = "session-a"): CloudConnectionRecord {
  return {
    version: 1,
    registrationId: digest("registration-" + i),
    connectArn: arn,
    gatewayDomain: domain,
    connectionId: "connection-" + i,
    sessionHash: digest(session),
    sessionIssuedAt: BASE,
    sessionExpiresAt: BASE + 3600000,
    scope: { ...scope },
    registeredAt: at,
    expiresAt: at + 60000,
  };
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
  const folder = mkdtempSync(join(tmpdir(), "synkies-connection-registry-")),
    path = join(folder, "registry.sqlite3"),
    handles: SQLiteCloudConnectionRegistryStore[] = [],
    sessions = new Map<string, CloudWebSession>(),
    now = { value: BASE },
    tasks: Promise<unknown>[] = [],
    releases: (() => void)[] = [],
    controllers: AbortController[] = [],
    control = {
      fault: false,
      afterInsert: null as null | (() => Promise<void>),
      afterRead: null as null | (() => Promise<void>),
      afterLibrary: null as null | (() => Promise<void>),
    };
  const accounts = new SQLiteCloudServerStore(join(folder, "accounts.sqlite3"));
  const ticketsStore = new SQLiteCloudConnectionTicketStore(
    join(folder, "tickets.sqlite3"),
  );
  const raw = new SQLiteCloudConnectionRegistryStore(path, () => {
    if (control.fault) throw Error("synthetic private commit");
  });
  handles.push(raw);
  try {
    for (const letter of ["a", "b"])
      await accounts.seedAccount({
        ...scope,
        ownerSubject: "registry-owner-" + letter,
        collectionId: "registry-library-" + letter,
        status: "active",
        entitlement: "active",
        revision: 1,
        sequence: 0,
        wall: 0,
      });
    const sessionStore: CloudWebSessionStore = {
      read: vi.fn(async (hash) =>
        sessions.has(hash) ? structuredClone(sessions.get(hash)!) : null,
      ),
      insert: async (record) => {
        if (sessions.has(record.idHash)) return false;
        sessions.set(record.idHash, structuredClone(record));
        return true;
      },
      revoke: async (hash) => {
        const record = sessions.get(hash);
        if (record) record.revoked = true;
      },
    };
    const boundary = createCloudWebSessionBoundary(
        { origin, lifetimeMs: 3600000 },
        sessionStore,
        async () => scope.ownerSubject,
        () => now.value,
      ),
      library = new CloudMutationService(accounts, () => now.value),
      authority = {
        libraryContext: vi.fn(async (subject: string) => {
          const result = await library.libraryContext(subject);
          await control.afterLibrary?.();
          return result;
        }),
      },
      tickets = new CloudConnectionTickets(
        { origin, lifetimeMs: 30000 },
        boundary.resolveSession,
        library,
        ticketsStore,
        () => now.value,
      ),
      consume = vi.fn(tickets.consume.bind(tickets)),
      authorize = createCloudWebSocketAuthorizer(
        { origin, connectArn: arn, gatewayDomain: domain },
        { consume },
      ),
      config = { connectArn: arn, gatewayDomain: domain, leaseMs: 120000 },
      store: CloudConnectionRegistryStore = {
        insert: vi.fn(async (record, at) => {
          const result = await raw.insert(record, at);
          await control.afterInsert?.();
          return result;
        }),
        read: vi.fn(async (target, host, id, at) => {
          const result = await raw.read(target, host, id, at);
          await control.afterRead?.();
          return result;
        }),
        remove: vi.fn((record, at) => raw.remove(record, at)),
        close: vi.fn(async () => {}),
      },
      registry = new CloudConnectionRegistry(
        config,
        sessionStore,
        authority,
        store,
        () => now.value,
      );
    function controller() {
      const c = new AbortController();
      controllers.push(c);
      return c;
    }
    async function identity(previous?: string) {
      const reply = await boundary.issue(
        new Request(origin + "/auth/session", {
          method: "POST",
          headers: { origin, ...(previous ? { cookie: previous } : {}) },
        }),
      );
      return {
        cookie: reply.headers.get("set-cookie")!.split(";")[0],
        csrf: (await reply.json()).csrfToken as string,
      };
    }
    const who = await identity();
    function request(method: string) {
      return new Request(origin + "/internal", {
        method,
        headers: { origin, cookie: who.cookie, "x-peel-csrf": who.csrf },
      });
    }
    async function admit(connectionId = "original-connection") {
      const ticket = await tickets.issue(request("POST")),
        signal = controller().signal;
      const policy = await authorize(
        {
          type: "REQUEST",
          methodArn: arn,
          requestContext: {
            routeKey: "$connect",
            eventType: "CONNECT",
            apiId: "syntheticapi",
            stage: "dev",
            domainName: domain,
            connectionId,
          },
          headers: {
            origin,
            cookie: who.cookie,
            "x-peel-csrf": who.csrf,
            "sec-websocket-protocol": cloudWebSocketProtocols(
              ticket.ticket,
            ).join(", "),
          },
        },
        signal,
      );
      expect(policy.policyDocument.Statement[0].Effect).toBe("Allow");
      return { admission: policy.context, signal, ticket };
    }
    function inspect<T>(operation: (db: DatabaseSync) => T) {
      const db = new DatabaseSync(path);
      try {
        return operation(db);
      } finally {
        db.close();
      }
    }
    return {
      folder,
      path,
      raw,
      accounts,
      sessionStore,
      sessions,
      library,
      authority,
      boundary,
      registry,
      store,
      config,
      control,
      now,
      who,
      identity,
      request,
      controller,
      admit,
      consume,
      inspect,
      async policy(change: string) {
        if (change !== "generation")
          return accounts.setPolicy(
            scope.ownerSubject,
            change === "deletion" ? "deleted" : "active",
            change === "entitlement" ? "inactive" : "active",
          );
        const current = (await accounts.readAccount(scope.ownerSubject))!;
        const db = new DatabaseSync(join(folder, "accounts.sqlite3"));
        try {
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
        } finally {
          db.close();
        }
      },
      reopen() {
        const next = new SQLiteCloudConnectionRegistryStore(path);
        handles.push(next);
        return next;
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
        return { entered, enter, release, waiting };
      },
      async cleanup() {
        for (const c of controllers) c.abort();
        for (const release of releases) release();
        await Promise.allSettled(tasks);
        await Promise.allSettled(handles.map((h) => h.close()));
        await ticketsStore.close();
        await accounts.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await raw.close();
    await ticketsStore.close();
    await accounts.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

it("retains real one-use admission metadata and resolves beyond ticket expiry without consuming again", async () =>
  fixture(async (f) => {
    const a = await f.admit(),
      record = await f.registry.register(
        a.admission,
        "original-connection",
        a.signal,
      );
    expect(record.scope).toEqual(scope);
    expect(record.expiresAt).toBe(BASE + 120000);
    expect(record.sessionExpiresAt).toBe(BASE + 3600000);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.scope)).toBe(true);
    expect(f.consume).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(
      f.inspect((db) => db.prepare("SELECT * FROM m0_cloud_connections").all()),
    );
    for (const secret of [
      a.ticket.ticket,
      f.who.cookie.split("=")[1],
      f.who.csrf,
    ])
      expect(serialized).not.toContain(secret);
    f.now.value = BASE + 30001;
    expect(
      await f.registry.resolve("original-connection", scope, a.signal),
    ).toEqual(record);
    expect(f.consume).toHaveBeenCalledTimes(1);
    expect(f.store.close).not.toHaveBeenCalled();
    expect(
      f.inspect((db) =>
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),
      ),
    ).toHaveLength(2);
  }));

it.each([
  ["connectionId", "different"],
  ["connectionId", "original-connection\n"],
  ["protocol", "wrong"],
  ["scopeVersion", "01"],
  ["sessionHash", "a".repeat(64) + "\n"],
  ["modeGeneration", "7\n"],
  ["modeGeneration", "07"],
  ["modeGeneration", "0"],
  ["ticketExpiresAt", String(BASE + 30000) + "\n"],
  ["ticketExpiresAt", String(BASE)],
  ["ticketExpiresAt", String(BASE + 60001)],
  ["collectionId", "bad space"],
  ["ownerSubject", "bad space"],
  ["cookie", "secret"],
])("refuses invalid admission %s=%s before persistence", async (key, value) =>
  fixture(async (f) => {
    const a = await f.admit();
    const before = vi.mocked(f.sessionStore.read).mock.calls.length;
    await expect(
      f.registry.register(
        { ...a.admission, [key]: value },
        "original-connection",
        a.signal,
      ),
    ).rejects.toThrow("connection-registry-unavailable");
    expect(f.store.insert).not.toHaveBeenCalled();
    expect(vi.mocked(f.sessionStore.read).mock.calls.length).toBe(before);
  }),
);

it("captures config and admission before awaits and returns independent frozen snapshots", async () =>
  fixture(async (f) => {
    const a = await f.admit(),
      mutable = { ...a.admission };
    f.config.connectArn = "changed";
    f.config.leaseMs = 1;
    const h = f.hold();
    f.control.afterLibrary = async () => {
      h.enter();
      await h.waiting;
    };
    const pending = f.track(
      f.registry.register(mutable, "original-connection", a.signal),
    );
    await Promise.race([
      h.entered,
      pending.then(() => {
        throw Error("Expected held operation");
      }),
    ]);
    mutable.ownerSubject = "registry-owner-b";
    h.release();
    const record = await pending;
    expect(record.connectArn).toBe(arn);
    expect(record.scope).toEqual(scope);
    expect(record.expiresAt).toBe(BASE + 120000);
  }));

it.each([
  "logout",
  "rotation",
  "entitlement",
  "generation",
  "deletion",
  "abort",
  "ticket-expiry",
])(
  "withholds registration and exactly cleans up after late %s",
  async (change) =>
    fixture(async (f) => {
      const a = await f.admit(),
        c = f.controller(),
        h = f.hold();
      f.control.afterInsert = async () => {
        h.enter();
        await h.waiting;
      };
      const pending = f.track(
        f.registry.register(a.admission, "original-connection", c.signal),
      );
      await Promise.race([
        h.entered,
        pending.then(() => {
          throw Error("Expected held operation");
        }),
      ]);
      if (change === "logout") await f.boundary.logout(f.request("POST"));
      if (change === "rotation") await f.identity(f.who.cookie);
      if (["entitlement", "generation", "deletion"].includes(change))
        await f.policy(change);
      if (change === "abort") c.abort("synthetic secret abort");
      if (change === "ticket-expiry") f.now.value = BASE + 30000;
      h.release();
      await expect(pending).rejects.toThrow("connection-registry-unavailable");
      expect(f.store.remove).toHaveBeenCalledTimes(1);
      expect(
        f.inspect(
          (db) =>
            db.prepare("SELECT count(*) AS n FROM m0_cloud_connections").get()!
              .n,
        ),
      ).toBe(0);
    }),
);

it("bounds leases by original session expiry and denies exact lease expiry", async () =>
  fixture(async (f) => {
    f.now.value = BASE + 3590000;
    const a = await f.admit(),
      record = await f.registry.register(
        a.admission,
        "original-connection",
        a.signal,
      );
    expect(record.expiresAt).toBe(BASE + 3600000);
    f.now.value = record.expiresAt;
    await expect(
      f.registry.resolve(record.connectionId, scope, a.signal),
    ).rejects.toThrow("connection-registry-unavailable");
    expect(await f.registry.remove(record, a.signal)).toBe(true);
  }));

it.each(["logout", "entitlement", "generation", "scope", "lease", "abort"])(
  "refuses resolution under current %s",
  async (change) =>
    fixture(async (f) => {
      const a = await f.admit(),
        record = await f.registry.register(
          a.admission,
          "original-connection",
          a.signal,
        ),
        c = f.controller();
      if (change === "logout") await f.boundary.logout(f.request("POST"));
      if (change === "entitlement" || change === "generation")
        await f.policy(change);
      if (change === "lease") f.now.value = record.expiresAt;
      if (change === "abort") c.abort("private abort detail");
      await expect(
        f.registry.resolve(
          record.connectionId,
          change === "scope"
            ? { ...scope, ownerSubject: "registry-owner-b" }
            : scope,
          c.signal,
        ),
      ).rejects.toThrow("connection-registry-unavailable");
    }),
);

it("refuses a stored registration deleted while its policy lookup is held", async () =>
  fixture(async (f) => {
    const a = await f.admit(),
      record = await f.registry.register(
        a.admission,
        "original-connection",
        a.signal,
      ),
      h = f.hold();
    f.control.afterLibrary = async () => {
      h.enter();
      await h.waiting;
    };
    const pending = f.track(
      f.registry.resolve(record.connectionId, scope, a.signal),
    );
    await Promise.race([
      h.entered,
      pending.then(() => {
        throw Error("Expected held operation");
      }),
    ]);
    expect(await f.reopen().remove(record, f.now.value)).toBe(true);
    h.release();
    await expect(pending).rejects.toThrow("connection-registry-unavailable");
  }));

it("rechecks session after a held library observation before returning a connection", async () =>
  fixture(async (f) => {
    const a = await f.admit(),
      record = await f.registry.register(
        a.admission,
        "original-connection",
        a.signal,
      ),
      h = f.hold();
    f.control.afterLibrary = async () => {
      h.enter();
      await h.waiting;
    };
    const pending = f.track(
      f.registry.resolve(record.connectionId, scope, a.signal),
    );
    await Promise.race([
      h.entered,
      pending.then(() => {
        throw Error("Expected held operation");
      }),
    ]);
    await f.boundary.logout(f.request("POST"));
    h.release();
    await expect(pending).rejects.toThrow("connection-registry-unavailable");
  }));

it("keeps failures private and withholds success even when post-insert cleanup fails", async () =>
  fixture(async (f) => {
    const a = await f.admit();
    f.control.afterInsert = async () => {
      f.control.fault = true;
      await f.boundary.logout(f.request("POST"));
    };
    await expect(
      f.registry.register(a.admission, "original-connection", a.signal),
    ).rejects.toMatchObject({
      message: "Cloud server: connection-registry-unavailable",
      code: "connection-registry-unavailable",
    });
    expect(f.store.remove).toHaveBeenCalledTimes(1);
    f.control.fault = false;
    await expect(
      f.registry.resolve("original-connection", scope, a.signal),
    ).rejects.toThrow("connection-registry-unavailable");
  }));

it("durably refuses duplicates and concurrent handles, survives reopening and conditionally removes exact records", async () =>
  fixture(async (f) => {
    const other = f.reopen(),
      record = entry();
    expect(
      await Promise.all([
        f.raw.insert(record, BASE),
        other.insert({ ...record, registrationId: digest("different") }, BASE),
      ]),
    ).toEqual([true, false]);
    expect(await other.read(arn, domain, record.connectionId, BASE)).toEqual(
      record,
    );
    expect(
      await other.remove(
        { ...record, registrationId: digest("different") },
        BASE,
      ),
    ).toBe(false);
    expect(await other.remove(record, BASE)).toBe(true);
    expect(await f.raw.remove(record, BASE)).toBe(false);
    const replacement = {
      ...record,
      registrationId: digest("replacement"),
      registeredAt: BASE + 60000,
      expiresAt: BASE + 120000,
    };
    expect(await other.insert(replacement, BASE + 60000)).toBe(true);
    expect(await f.raw.remove(record, BASE + 60000)).toBe(false);
    expect(
      await other.read(arn, domain, record.connectionId, BASE + 60000),
    ).toEqual(replacement);
  }));

it("conditionally refuses stale cleanup after expiry reclamation reuses the same original ID", async () =>
  fixture(async (f) => {
    const old = entry();
    await f.raw.insert(old, BASE);
    const next = {
      ...old,
      registrationId: digest("new"),
      registeredAt: old.expiresAt,
      expiresAt: old.expiresAt + 60000,
    };
    expect(await f.reopen().insert(next, old.expiresAt)).toBe(true);
    expect(await f.raw.remove(old, old.expiresAt)).toBe(false);
    expect(
      await f.raw.read(arn, domain, old.connectionId, old.expiresAt),
    ).toEqual(next);
  }));

it("persists accepted time for misses and removals across reopening", async () =>
  fixture(async (f) => {
    expect(await f.raw.read(arn, domain, "missing", BASE + 1)).toBe(null);
    await expect(f.reopen().insert(entry(), BASE)).rejects.toThrow(
      "Cloud connection registry storage unavailable",
    );
    expect(await f.raw.remove(entry(), BASE + 2)).toBe(false);
    await expect(
      f.reopen().read(arn, domain, "missing", BASE + 1),
    ).rejects.toThrow("Cloud connection registry storage unavailable");
  }));

it("rolls back commit faults for inserts reads and removals without leaking private errors", async () =>
  fixture(async (f) => {
    f.control.fault = true;
    await expect(f.raw.insert(entry(), BASE)).rejects.toThrow(
      /^Cloud connection registry storage unavailable$/,
    );
    f.control.fault = false;
    expect(await f.raw.insert(entry(), BASE)).toBe(true);
    f.control.fault = true;
    await expect(f.raw.remove(entry(), BASE + 10)).rejects.toThrow(
      /^Cloud connection registry storage unavailable$/,
    );
    await expect(
      f.raw.read(arn, domain, entry().connectionId, BASE + 10),
    ).rejects.toThrow(/^Cloud connection registry storage unavailable$/);
    f.control.fault = false;
    expect(await f.raw.read(arn, domain, entry().connectionId, BASE)).toEqual(
      entry(),
    );
  }));

it("enforces per-session and global retained bounds and reclaims at most32 expired rows", async () =>
  fixture(async (f) => {
    for (let i = 0; i < CONNECTIONS_PER_SESSION; i++)
      expect(await f.raw.insert(entry(i), BASE)).toBe(true);
    expect(await f.raw.insert(entry(4), BASE)).toBe(false);
    for (let i = CONNECTIONS_PER_SESSION; i < CONNECTION_REGISTRY_ROWS; i++)
      expect(await f.raw.insert(entry(i, BASE, "session-" + i), BASE)).toBe(
        true,
      );
    expect(await f.raw.insert(entry(2000, BASE, "overflow"), BASE)).toBe(false);
    expect(
      await f.raw.insert(entry(2001, BASE + 60000, "next"), BASE + 60000),
    ).toBe(true);
    expect(
      f.inspect(
        (db) =>
          db.prepare("SELECT count(*) AS n FROM m0_cloud_connections").get()!.n,
      ),
    ).toBe(CONNECTION_REGISTRY_ROWS - CONNECTION_REGISTRY_RECLAIM + 1);
  }));

it.each(["state", "session", "expiry"])(
  "refuses corrupt durable %s bindings without deletion",
  async (kind) =>
    fixture(async (f) => {
      await f.raw.insert(entry(), BASE);
      f.inspect((db) =>
        db.exec(
          kind === "state"
            ? "UPDATE m0_cloud_connections SET state='private bad JSON'"
            : kind === "session"
              ? "UPDATE m0_cloud_connections SET session_hash='bad'"
              : "UPDATE m0_cloud_connections SET expires_at=1",
        ),
      );
      await expect(
        f.raw.read(arn, domain, entry().connectionId, BASE),
      ).rejects.toThrow(/^Cloud connection registry storage unavailable$/);
      expect(
        f.inspect(
          (db) =>
            db.prepare("SELECT count(*) AS n FROM m0_cloud_connections").get()!
              .n,
        ),
      ).toBe(1);
    }),
);

it.each(["version", "index", "trigger", "table"])(
  "refuses unknown %s schema before repair",
  async (kind) =>
    fixture(async (f) => {
      f.inspect((db) =>
        db.exec(
          kind === "version"
            ? "UPDATE m0_cloud_connection_meta SET version=2"
            : kind === "index"
              ? "DROP INDEX m0_cloud_connection_expiry"
              : kind === "trigger"
                ? "CREATE TRIGGER unknown_trigger AFTER DELETE ON m0_cloud_connections BEGIN SELECT 1; END"
                : "CREATE TABLE unknown_table (body TEXT)",
        ),
      );
      const before = f.inspect((db) =>
        db
          .prepare("SELECT name,type,sql FROM sqlite_master ORDER BY name")
          .all(),
      );
      expect(() => f.reopen()).toThrow(
        /^Cloud connection registry storage unavailable$/,
      );
      expect(
        f.inspect((db) =>
          db
            .prepare("SELECT name,type,sql FROM sqlite_master ORDER BY name")
            .all(),
        ),
      ).toEqual(before);
    }),
);

it("rejects malformed records, target substitutions and implicit paths", async () =>
  fixture(async (f) => {
    for (const patch of [
      { expiresAt: BASE + MAX_CONNECTION_LEASE_MS + 1 },
      { sessionHash: "a".repeat(64) + "\n" },
      { connectionId: "bad\n" },
      { registrationId: "bad" },
      { connectArn: arn + "\n" },
      { gatewayDomain: domain + "\n" },
      { extra: "private" },
    ])
      expect(() =>
        validateCloudConnectionRecord({ ...entry(), ...patch }),
      ).toThrow("connection-registry-unavailable");
    for (const path of ["", ":memory:", "relative.sqlite3"])
      expect(() => new SQLiteCloudConnectionRegistryStore(path)).toThrow(
        /^Cloud connection registry storage unavailable$/,
      );
    const a = await f.admit();
    await expect(
      f.registry.remove(
        { ...entry(), connectArn: arn.replace("/dev/", "/other/") },
        a.signal,
      ),
    ).rejects.toThrow("connection-registry-unavailable");
    expect(f.store.remove).not.toHaveBeenCalled();
  }));

it("refuses changed stored identity and a late original abort during the retained read", async () =>
  fixture(async (f) => {
    const a = await f.admit(),
      record = await f.registry.register(
        a.admission,
        "original-connection",
        a.signal,
      );
    const c = f.controller();
    f.control.afterRead = async () => {
      c.abort("synthetic private reason");
    };
    await expect(
      f.registry.resolve(record.connectionId, scope, c.signal),
    ).rejects.toMatchObject({
      code: "connection-registry-unavailable",
      status: 409,
    });
    f.control.afterRead = null;
    vi.mocked(f.store.read).mockResolvedValue({
      ...record,
      connectArn: arn.replace("/dev/", "/other/"),
    });
    await expect(
      f.registry.resolve(record.connectionId, scope, a.signal),
    ).rejects.toThrow("connection-registry-unavailable");
  }));

it("uses the original session reader and refuses malformed current-session records", async () =>
  fixture(async (f) => {
    const a = await f.admit(),
      record = await f.registry.register(
        a.admission,
        "original-connection",
        a.signal,
      );
    const saved = f.sessionStore.read;
    f.sessionStore.read = async () => {
      throw Error("replacement must not run");
    };
    expect(
      await f.registry.resolve(record.connectionId, scope, a.signal),
    ).toEqual(record);
    vi.mocked(saved).mockResolvedValue({
      ...f.sessions.get(record.sessionHash)!,
      subject: "registry-owner-b",
    });
    await expect(
      f.registry.resolve(record.connectionId, scope, a.signal),
    ).rejects.toThrow("connection-registry-unavailable");
  }));

it("rejects clock rollback before new persistence and keeps exact removal independent of auth", async () =>
  fixture(async (f) => {
    const a = await f.admit(),
      record = await f.registry.register(
        a.admission,
        "original-connection",
        a.signal,
      );
    f.now.value = BASE + 1;
    expect(
      await f.registry.resolve(record.connectionId, scope, a.signal),
    ).toEqual(record);
    const reads = vi.mocked(f.store.read).mock.calls.length;
    f.now.value = BASE;
    await expect(
      f.registry.resolve(record.connectionId, scope, a.signal),
    ).rejects.toThrow("connection-registry-unavailable");
    expect(vi.mocked(f.store.read).mock.calls.length).toBe(reads);
    f.now.value = BASE + 120000;
    await f.boundary.logout(f.request("POST"));
    const reordered = Object.fromEntries(
      Object.entries(record).reverse(),
    ) as unknown as CloudConnectionRecord;
    reordered.scope = Object.fromEntries(
      Object.entries(record.scope).reverse(),
    ) as unknown as typeof scope;
    expect(await f.registry.remove(reordered, a.signal)).toBe(true);
  }));

it("rejects invalid configuration without opening or calling supplied stores", async () =>
  fixture(async (f) => {
    for (const change of [
      { leaseMs: 0 },
      { leaseMs: MAX_CONNECTION_LEASE_MS + 1 },
      { connectArn: arn + "\n" },
      { gatewayDomain: domain + "/" },
      { extra: "private" },
    ]) {
      expect(
        () =>
          new CloudConnectionRegistry(
            { ...f.config, ...change },
            f.sessionStore,
            f.authority,
            f.store,
          ),
      ).toThrow(/^Invalid Cloud connection registry configuration$/);
    }
    expect(f.store.insert).not.toHaveBeenCalled();
    expect(f.store.read).not.toHaveBeenCalled();
    expect(f.store.close).not.toHaveBeenCalled();
  }));

it("refuses absent exact admission keys and symbols before session reads", async () =>
  fixture(async (f) => {
    const a = await f.admit(),
      missing = { ...a.admission };
    delete missing.protocol;
    const before = vi.mocked(f.sessionStore.read).mock.calls.length;
    for (const input of [
      missing,
      { ...a.admission, [Symbol("private")]: true },
    ])
      await expect(
        f.registry.register(input, "original-connection", a.signal),
      ).rejects.toThrow("connection-registry-unavailable");
    expect(vi.mocked(f.sessionStore.read).mock.calls.length).toBe(before);
    expect(f.store.insert).not.toHaveBeenCalled();
  }));

it("refuses schema drift on an already open handle before deleting any record", async () =>
  fixture(async (f) => {
    await f.raw.insert(entry(), BASE);
    f.inspect((db) =>
      db.exec(
        "CREATE TRIGGER new_unknown AFTER DELETE ON m0_cloud_connections BEGIN DELETE FROM m0_cloud_connections; END",
      ),
    );
    await expect(f.raw.remove(entry(), BASE)).rejects.toThrow(
      /^Cloud connection registry storage unavailable$/,
    );
    expect(
      f.inspect(
        (db) =>
          db.prepare("SELECT count(*) AS n FROM m0_cloud_connections").get()!.n,
      ),
    ).toBe(1);
  }));

it("cleans up only its attempted registration when insert commits but its acknowledgement fails", async () =>
  fixture(async (f) => {
    const a = await f.admit();
    f.control.afterInsert = async () => {
      throw Error("private lost storage acknowledgement");
    };
    await expect(
      f.registry.register(a.admission, "original-connection", a.signal),
    ).rejects.toMatchObject({
      code: "connection-registry-unavailable",
      status: 503,
    });
    expect(f.store.remove).toHaveBeenCalledTimes(1);
    expect(
      f.inspect(
        (db) =>
          db.prepare("SELECT count(*) AS n FROM m0_cloud_connections").get()!.n,
      ),
    ).toBe(0);
  }));

it("does not erase a valid original registration when duplicate admission is refused", async () =>
  fixture(async (f) => {
    const a = await f.admit(),
      record = await f.registry.register(
        a.admission,
        "original-connection",
        a.signal,
      );
    await expect(
      f.registry.register(a.admission, "original-connection", a.signal),
    ).rejects.toMatchObject({
      code: "connection-registry-unavailable",
      status: 429,
    });
    expect(
      await f.registry.resolve(record.connectionId, scope, a.signal),
    ).toEqual(record);
    expect(f.store.remove).toHaveBeenCalledTimes(1);
    expect(f.consume).toHaveBeenCalledTimes(1);
  }));
