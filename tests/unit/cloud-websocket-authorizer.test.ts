import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createCloudWebSocketAuthorizer } from "../../packages/cloud-protocol/src/websocket-authorizer";
import {
  cloudWebSocketProtocols,
  cloudWebSocketTicket,
  CLOUD_WEBSOCKET_PROTOCOL,
} from "../../packages/cloud-protocol/src/websocket-handshake";
import {
  CloudConnectionTickets,
  type CloudConnectionTicketStore,
} from "../../packages/cloud-protocol/src/connection-tickets";
import { SQLiteCloudConnectionTicketStore } from "../../packages/cloud-protocol/src/connection-tickets-sqlite";
import {
  CloudMutationService,
  CloudServerError,
} from "../../packages/cloud-protocol/src/server";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import {
  createCloudWebSessionBoundary,
  type CloudWebSession,
} from "../../packages/cloud-protocol/src/web-session";
import { createCloudConnectionTicketWebReader } from "../../apps/web/src/cloud-connection-ticket-web";

const origin = "https://socket-auth.synthetic",
  domain = "gateway.synthetic",
  BASE = 1800000000000,
  arn = "arn:aws:execute-api:ap-south-1:000000000000:syntheticapi/dev/$connect";
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
  const folder = mkdtempSync(join(tmpdir(), "synkies-ws-authorizer-")),
    sessions = new Map<string, CloudWebSession>(),
    controllers: AbortController[] = [],
    tasks: Promise<unknown>[] = [],
    releases: (() => void)[] = [],
    now = { value: BASE },
    control = {
      afterTake: null as null | (() => Promise<void>),
      failTake: false,
    };
  let server: SQLiteCloudServerStore | undefined,
    rawStore: SQLiteCloudConnectionTicketStore | undefined;
  try {
    const accounts = new SQLiteCloudServerStore(
      join(folder, "accounts.sqlite3"),
    );
    server = accounts;
    const raw = new SQLiteCloudConnectionTicketStore(
      join(folder, "tickets.sqlite3"),
    );
    rawStore = raw;
    for (const letter of ["a", "b"])
      await accounts.seedAccount({
        version: 1,
        ownerSubject: "socket-owner-" + letter,
        collectionId: "socket-library-" + letter,
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
          const auth = request.headers.get("authorization");
          if (auth !== "synthetic-a" && auth !== "synthetic-b")
            throw new CloudServerError("unauthorized", 401);
          return "socket-owner-" + auth.slice(-1);
        },
        () => now.value,
      ),
      store: CloudConnectionTicketStore = {
        insert: (...args) => raw.insert(...args),
        take: async (...args) => {
          if (control.failTake)
            throw Error("synthetic private ticket database");
          const result = await raw.take(...args);
          await control.afterTake?.();
          return result;
        },
        close: vi.fn(async () => {}),
      },
      library = new CloudMutationService(accounts, () => now.value),
      tickets = new CloudConnectionTickets(
        { origin, lifetimeMs: 30000 },
        boundary.resolveSession,
        library,
        store,
        () => now.value,
      ),
      handler = createCloudMutationHandler(
        library,
        boundary.resolveCaller,
        undefined,
        tickets,
      ),
      consume = vi.fn(tickets.consume.bind(tickets)),
      consumer: Pick<CloudConnectionTickets, "consume"> = { consume },
      config = { origin, connectArn: arn, gatewayDomain: domain },
      authorize = createCloudWebSocketAuthorizer(config, consumer);
    async function identity(letter = "a"): Promise<Identity> {
      const reply = await boundary.issue(
        new Request(origin + "/auth/session", {
          method: "POST",
          headers: { origin, authorization: "synthetic-" + letter },
        }),
      );
      return {
        cookie: reply.headers.get("set-cookie")!.split(";")[0],
        csrfToken: (await reply.json()).csrfToken,
      };
    }
    const a = await identity(),
      b = await identity("b");
    function controller() {
      const c = new AbortController();
      controllers.push(c);
      return c;
    }
    return {
      accounts,
      boundary,
      store,
      tickets,
      consume,
      consumer,
      config,
      authorize,
      now,
      control,
      a,
      b,
      controller,
      async issue(who = a) {
        // Actual in-process HTTP/session/ticket handlers; Cookie/Origin injection is synthetic.
        const read = createCloudConnectionTicketWebReader(
          { origin, csrfToken: who.csrfToken },
          controller().signal,
          async (input, options) => {
            const request = new Request(input, options);
            request.headers.set("origin", origin);
            request.headers.set("cookie", who.cookie);
            return handler(request);
          },
        );
        return read();
      },
      event(ticket: string, who = a): Record<string, any> {
        const headers = {
          origin,
          cookie: who.cookie,
          host: domain,
          "sec-websocket-protocol": cloudWebSocketProtocols(ticket).join(", "),
        };
        return {
          type: "REQUEST",
          methodArn: arn,
          headers,
          multiValueHeaders: Object.fromEntries(
            Object.entries(headers).map(([key, value]) => [key, [value]]),
          ),
          queryStringParameters: null,
          multiValueQueryStringParameters: null,
          pathParameters: null,
          requestContext: {
            apiId: "syntheticapi",
            stage: "dev",
            domainName: domain,
            routeKey: "$connect",
            eventType: "CONNECT",
            connectionId: "connection-a",
          },
        };
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
      async logout(who = a) {
        return boundary.logout(
          new Request(origin + "/logout", {
            method: "POST",
            headers: {
              origin,
              cookie: who.cookie,
              "x-peel-csrf": who.csrfToken,
            },
          }),
        );
      },
      async cleanup() {
        for (const c of controllers) c.abort();
        for (const release of releases) release();
        await Promise.allSettled(tasks);
        await raw.close();
        await accounts.close();
        rmSync(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rawStore?.close();
    await server?.close();
    rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}
const effect = (
  policy: Awaited<
    ReturnType<ReturnType<typeof createCloudWebSocketAuthorizer>>
  >,
) => policy.policyDocument.Statement[0].Effect;
function header(packet: Record<string, any>, key: string, value: string) {
  packet.headers[key] = value;
  packet.multiValueHeaders[key] = [value];
}

it("pure offers are immutable and strict but supply no authority", () => {
  const ticket = "a".repeat(43),
    offers = cloudWebSocketProtocols(ticket);
  expect(Object.isFrozen(offers)).toBe(true);
  expect(cloudWebSocketTicket(offers.join(", "))).toBe(ticket);
  expect(cloudWebSocketTicket(offers.slice().reverse().join(" ,\t"))).toBe(
    ticket,
  );
  for (const raw of [null, "private", "a".repeat(44)])
    expect(() => cloudWebSocketProtocols(raw)).toThrow(
      "Cloud connection handshake unavailable",
    );
  for (const raw of [
    null,
    "private",
    offers[0],
    offers.join(",") + ",other",
    offers[1] + "," + offers[1],
    "\u00a0" + offers.join(","),
    "x".repeat(257),
  ])
    expect(() => cloudWebSocketTicket(raw)).toThrow(
      "Cloud connection handshake unavailable",
    );
});

it("actual HTTP issuance admits only one exact, frozen, credential-free connection policy", async () =>
  fixture(async (f) => {
    const issued = await f.issue(),
      packet = f.event(issued.ticket);
    expect(f.consume).not.toHaveBeenCalled();
    const policy = await f.authorize(packet, f.controller().signal);
    expect(policy.principalId).toBe("socket-owner-a");
    expect(policy.policyDocument).toEqual({
      Version: "2012-10-17",
      Statement: [
        { Action: "execute-api:Invoke", Effect: "Allow", Resource: arn },
      ],
    });
    expect(policy.context).toMatchObject({
      scopeVersion: "1",
      ownerSubject: "socket-owner-a",
      collectionId: "socket-library-a",
      modeGeneration: "7",
      connectionId: "connection-a",
      ticketExpiresAt: String(BASE + 30000),
      protocol: CLOUD_WEBSOCKET_PROTOCOL,
    });
    expect(policy.context.sessionHash).toMatch(/^[a-f0-9]{64}$/);
    for (const raw of [issued.ticket, f.a.cookie.split("=")[1], f.a.csrfToken])
      expect(JSON.stringify(policy)).not.toContain(raw);
    for (const value of [
      policy,
      policy.context,
      policy.policyDocument,
      policy.policyDocument.Statement,
      policy.policyDocument.Statement[0],
    ])
      expect(Object.isFrozen(value)).toBe(true);
    expect(effect(await f.authorize(packet, f.controller().signal))).toBe(
      "Deny",
    );
    expect(f.store.close).not.toHaveBeenCalled();
  }));

it.each(["single", "multi"])(
  "accepts valid %s-only header representation without inventing a credential",
  async (representation) =>
    fixture(async (f) => {
      const packet = f.event((await f.issue()).ticket);
      delete packet[
        representation === "single" ? "multiValueHeaders" : "headers"
      ];
      expect(effect(await f.authorize(packet, f.controller().signal))).toBe(
        "Allow",
      );
    }),
);

it.each([
  "target",
  "api",
  "domain",
  "route",
  "disconnect",
  "query",
  "raw-query",
  "body",
  "origin",
  "host",
  "missing-cookie",
  "version",
  "extra-offer",
  "case-duplicate",
  "multiple",
  "conflict",
  "oversized",
  "header-name",
  "combined-count",
  "byte-budget",
  "control",
  "reflection",
  "cookie-reflection",
  "csrf-reflection",
])(
  "rejects %s before consumption and leaves the original ticket usable",
  async (failure) =>
    fixture(async (f) => {
      const issued = await f.issue(),
        packet = f.event(issued.ticket);
      if (failure === "target")
        packet.methodArn = arn.replace("000000000000", "111111111111");
      if (failure === "api") packet.requestContext.apiId = "foreignapi";
      if (failure === "domain")
        packet.requestContext.domainName = "foreign.synthetic";
      if (failure === "route") packet.requestContext.routeKey = "$default";
      if (failure === "disconnect")
        packet.requestContext.eventType = "DISCONNECT";
      if (failure === "query")
        packet.queryStringParameters = { ticket: issued.ticket };
      if (failure === "raw-query") packet.rawQueryString = "ticket=synthetic";
      if (failure === "body")
        packet.body = JSON.stringify({ paid: true, ownerSubject: "other" });
      if (failure === "origin")
        header(packet, "origin", "https://foreign.synthetic");
      if (failure === "host") header(packet, "host", "foreign.synthetic");
      if (failure === "missing-cookie") {
        delete packet.headers.cookie;
        delete packet.multiValueHeaders.cookie;
      }
      if (failure === "version")
        header(
          packet,
          "sec-websocket-protocol",
          packet.headers["sec-websocket-protocol"].replace(
            "synkies.v1",
            "synkies.v2",
          ),
        );
      if (failure === "extra-offer")
        header(
          packet,
          "sec-websocket-protocol",
          packet.headers["sec-websocket-protocol"] + ",other",
        );
      if (failure === "case-duplicate") packet.headers.Origin = origin;
      if (failure === "multiple")
        packet.multiValueHeaders.cookie = [f.a.cookie, f.b.cookie];
      if (failure === "conflict")
        packet.multiValueHeaders.cookie = [f.b.cookie];
      if (failure === "oversized") packet.headers["x-large"] = "a".repeat(8193);
      if (failure === "header-name") packet.headers["x".repeat(129)] = "value";
      if (failure === "combined-count") {
        for (let i = 0; i < 31; i++) {
          packet.headers["x-single-" + i] = "value";
          packet.multiValueHeaders["x-multi-" + i] = ["value"];
        }
      }
      if (failure === "byte-budget")
        for (let i = 0; i < 3; i++)
          packet.headers["x-budget-" + i] = "a".repeat(6000);
      if (failure === "control") packet.headers["x-private"] = "private\nvalue";
      if (failure === "reflection")
        packet.requestContext.connectionId = issued.ticket;
      if (failure === "cookie-reflection")
        packet.requestContext.connectionId = f.a.cookie.split("=")[1];
      if (failure === "csrf-reflection") {
        header(packet, "x-peel-csrf", f.a.csrfToken);
        packet.requestContext.connectionId = f.a.csrfToken;
      }
      const denied = await f.authorize(packet, f.controller().signal);
      expect(effect(denied)).toBe("Deny");
      expect(denied.principalId).toBe("unavailable");
      expect(denied.context).toEqual({});
      expect(f.consume).not.toHaveBeenCalled();
      expect(JSON.stringify(denied)).not.toContain(issued.ticket);
      expect(
        effect(
          await f.authorize(f.event(issued.ticket), f.controller().signal),
        ),
      ).toBe("Allow");
    }),
);

it("client authority claims cannot choose scope and another session cannot burn a ticket", async () =>
  fixture(async (f) => {
    const issued = await f.issue(),
      foreign = f.event(issued.ticket, f.b);
    expect(effect(await f.authorize(foreign, f.controller().signal))).toBe(
      "Deny",
    );
    const valid = f.event(issued.ticket);
    valid.requestContext.authorizer = {
      principalId: "client-admin",
      collectionId: "foreign",
    };
    header(valid, "x-peel-owner", "client-admin");
    expect((await f.authorize(valid, f.controller().signal)).principalId).toBe(
      "socket-owner-a",
    );
    const b = await f.issue(f.b);
    expect(
      (await f.authorize(f.event(b.ticket, f.b), f.controller().signal)).context
        .collectionId,
    ).toBe("socket-library-b");
  }));

it("captures constructor configuration and the original consumer without I/O", async () =>
  fixture(async (f) => {
    const issued = await f.issue(),
      packet = f.event(issued.ticket);
    f.config.origin = "https://later.synthetic";
    f.config.connectArn = arn.replace("/dev/", "/later/");
    f.config.gatewayDomain = "later.synthetic";
    const replacement = vi.fn(async () => {
      throw Error("replacement consumer");
    });
    f.consumer.consume = replacement;
    expect(effect(await f.authorize(packet, f.controller().signal))).toBe(
      "Allow",
    );
    expect(f.consume).toHaveBeenCalledTimes(1);
    expect(replacement).not.toHaveBeenCalled();
  }));

it("held consumption cannot retarget a captured event or connection ID", async () =>
  fixture(async (f) => {
    const issued = await f.issue(),
      packet = f.event(issued.ticket),
      held = f.hold();
    f.control.afterTake = async () => {
      held.entered.resolve();
      await held.release.promise;
    };
    const task = f.track(f.authorize(packet, f.controller().signal));
    await Promise.race([
      held.entered.promise,
      task.then(() => {
        throw Error("Expected held consumption");
      }),
    ]);
    const b = await f.issue(f.b);
    Object.assign(packet, f.event(b.ticket, f.b));
    packet.requestContext.connectionId = "later-connection";
    held.release.resolve();
    expect((await task).context).toMatchObject({
      ownerSubject: "socket-owner-a",
      connectionId: "connection-a",
    });
  }));

it.each(["abort", "logout", "entitlement", "expiry"])(
  "withholds Allow after late %s on an actually claimed ticket",
  async (failure) =>
    fixture(async (f) => {
      const issued = await f.issue(),
        packet = f.event(issued.ticket),
        held = f.hold(),
        controller = f.controller();
      f.control.afterTake = async () => {
        held.entered.resolve();
        await held.release.promise;
      };
      const task = f.track(f.authorize(packet, controller.signal));
      await Promise.race([
        held.entered.promise,
        task.then(() => {
          throw Error("Expected held consumption");
        }),
      ]);
      if (failure === "abort")
        controller.abort("synthetic private cancellation");
      if (failure === "logout") await f.logout();
      if (failure === "entitlement")
        await f.accounts.setPolicy("socket-owner-a", "active", "inactive");
      if (failure === "expiry") f.now.value = BASE + 30000;
      held.release.resolve();
      const denied = await task;
      expect(effect(denied)).toBe("Deny");
      expect(denied.context).toEqual({});
      expect(JSON.stringify(denied)).not.toContain(issued.ticket);
      expect(f.store.close).not.toHaveBeenCalled();
    }),
);

it("already aborted invocations do no credential I/O and do not consume the ticket", async () =>
  fixture(async (f) => {
    const issued = await f.issue(),
      packet = f.event(issued.ticket),
      stopped = f.controller();
    stopped.abort("private cancellation");
    expect(effect(await f.authorize(packet, stopped.signal))).toBe("Deny");
    expect(f.consume).not.toHaveBeenCalled();
    expect(effect(await f.authorize(packet, f.controller().signal))).toBe(
      "Allow",
    );
  }));

it("private metadata getters and persistence failures return the same credential-free denial", async () =>
  fixture(async (f) => {
    const issued = await f.issue(),
      packet = f.event(issued.ticket);
    Object.defineProperty(packet, "requestContext", {
      get() {
        throw Error("synthetic private event/token");
      },
    });
    const bad = await f.authorize(packet, f.controller().signal);
    expect(f.consume).not.toHaveBeenCalled();
    f.control.failTake = true;
    const failed = await f.authorize(
      f.event(issued.ticket),
      f.controller().signal,
    );
    expect(failed).toEqual(bad);
    expect(JSON.stringify(failed)).not.toContain("private");
    f.control.failTake = false;
    expect(
      effect(await f.authorize(f.event(issued.ticket), f.controller().signal)),
    ).toBe("Allow");
  }));

it("preserves supplied safe-read nonce and fetch-site binding instead of bypassing the session boundary", async () =>
  fixture(async (f) => {
    const issued = await f.issue(),
      packet = f.event(issued.ticket);
    header(packet, "x-peel-csrf", f.b.csrfToken);
    expect(effect(await f.authorize(packet, f.controller().signal))).toBe(
      "Deny",
    );
    delete packet.headers["x-peel-csrf"];
    delete packet.multiValueHeaders["x-peel-csrf"];
    header(packet, "sec-fetch-site", "cross-site");
    expect(effect(await f.authorize(packet, f.controller().signal))).toBe(
      "Deny",
    );
    header(packet, "sec-fetch-site", "same-origin");
    expect(effect(await f.authorize(packet, f.controller().signal))).toBe(
      "Allow",
    );
  }));

it("rejects wildcard/foreign configuration without selecting resources or leaking raw values", () => {
  const consume = vi.fn();
  for (const cfg of [
    { origin, connectArn: arn.replace("$connect", "*"), gatewayDomain: domain },
    {
      origin: "http://private.synthetic",
      connectArn: arn,
      gatewayDomain: domain,
    },
    {
      origin,
      connectArn: arn,
      gatewayDomain: "user:private@gateway.synthetic",
    },
  ])
    expect(() => createCloudWebSocketAuthorizer(cfg, { consume })).toThrow(
      "Invalid Cloud connection authorizer configuration",
    );
  expect(consume).not.toHaveBeenCalled();
});
