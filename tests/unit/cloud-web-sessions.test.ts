import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  createCloudWebSessionBoundary,
  CLOUD_SESSION_COOKIE,
  type CloudWebSession,
  type CloudWebSessionStore,
} from "../../packages/cloud-protocol/src/web-session";
import {
  CloudServerError,
  CloudMutationService,
} from "../../packages/cloud-protocol/src/server";
import { SQLiteCloudServerStore } from "../../packages/cloud-protocol/src/server-sqlite";
import { createCloudMutationHandler } from "../../packages/cloud-protocol/src/server-http";
import { mutationHash } from "../../packages/cloud-protocol/src/index";
import { cloudDraft } from "../fixtures/cloud-durable-contract";
const origin = "https://peel.example";
const BASE = 1800000000000;
function fixture() {
  const records = new Map<string, CloudWebSession>(),
    now = { value: BASE };
  const store: CloudWebSessionStore = {
    read: vi.fn(async (id) =>
      records.has(id) ? structuredClone(records.get(id)!) : null,
    ),
    insert: vi.fn(async (record) => {
      if (records.has(record.idHash)) return false;
      records.set(record.idHash, structuredClone(record));
      return true;
    }),
    revoke: vi.fn(async (id) => {
      const record = records.get(id);
      if (record) record.revoked = true;
    }),
  };
  const authenticate = vi.fn(async (request: Request) => {
    const header = request.headers.get("authorization");
    if (header !== "synthetic-a" && header !== "synthetic-b")
      throw new CloudServerError("unauthorized", 401);
    return header === "synthetic-a" ? "owner-a" : "owner-b";
  });
  const boundary = createCloudWebSessionBoundary(
    { origin, lifetimeMs: 3600000 },
    store,
    authenticate,
    () => now.value,
  );
  async function issue(as = "synthetic-a", previous?: string) {
    const response = await boundary.issue(
      new Request(`${origin}/auth/session`, {
        method: "POST",
        headers: {
          origin,
          authorization: as,
          ...(previous ? { cookie: previous } : {}),
        },
      }),
    );
    const body = await response.clone().json();
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    return { response, body, cookie };
  }
  const request = (cookie: string, csrf?: string, options: RequestInit = {}) =>
    new Request(`${origin}/v1/mutations`, {
      method: "POST",
      ...options,
      headers: {
        origin,
        cookie,
        ...(csrf ? { "x-peel-csrf": csrf } : {}),
        ...options.headers,
      },
    });
  return { records, now, store, authenticate, boundary, issue, request };
}
it("issues opaque host-only cookies only after authentication and stores digests rather than credentials", async () => {
  const env = fixture();
  await expect(env.issue("unverified")).rejects.toMatchObject({ status: 401 });
  expect(env.store.insert).not.toHaveBeenCalled();
  const { response, body, cookie } = await env.issue();
  const value = cookie.split("=")[1];
  expect(value).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  expect(body.csrfToken).toMatch(/^[a-zA-Z0-9_-]{43}$/);
  expect(body.csrfToken).not.toBe(value);
  expect(Object.keys(body).sort()).toEqual(["csrfToken", "expiresAt"]);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBe(
    `${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
  );
  const serialized = JSON.stringify([...env.records.values()]);
  expect(serialized).not.toContain(value);
  expect(serialized).not.toContain(body.csrfToken);
  expect(serialized).not.toContain("synthetic-a");
  expect(
    await env.boundary.resolveCaller(
      env.request(cookie, body.csrfToken, {
        headers: { authorization: "synthetic-b", "x-peel-subject": "owner-b" },
      }),
    ),
  ).toBe("owner-a");
  expect(
    await env.boundary.resolveCaller(
      env.request(cookie, undefined, { method: "GET" }),
    ),
  ).toBe("owner-a");
});
it("rejects cross-origin and Fetch Metadata violations before looking up a session", async () => {
  const env = fixture(),
    { cookie, body } = await env.issue();
  vi.mocked(env.store.read).mockClear();
  const violations: Record<string, string>[] = [
    { origin: "https://attacker.example" },
    { origin: "null" },
    { origin: `${origin}/` },
    { origin: `${origin}.attacker.example` },
    { origin: `${origin}, ${origin}` },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
  ];
  for (const headers of violations) {
    await expect(
      env.boundary.resolveCaller(
        env.request(cookie, body.csrfToken, { headers }),
      ),
    ).rejects.toMatchObject({ code: "origin-rejected", status: 403 });
  }
  const absent = env.request(cookie, body.csrfToken);
  absent.headers.delete("origin");
  await expect(env.boundary.resolveCaller(absent)).rejects.toMatchObject({
    status: 403,
  });
  const foreign = new Request(`https://attacker.example/v1/mutations`, {
    method: "POST",
    headers: { cookie, origin, "x-peel-csrf": body.csrfToken },
  });
  await expect(env.boundary.resolveCaller(foreign)).rejects.toMatchObject({
    status: 403,
  });
  expect(env.store.read).not.toHaveBeenCalled();
  await expect(
    env.boundary.issue(
      new Request(`${origin}/auth/session`, {
        method: "POST",
        headers: {
          authorization: "synthetic-a",
          origin: "https://attacker.example",
        },
      }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(env.authenticate).toHaveBeenCalledTimes(1);
});
it("rejects malformed and duplicate cookies and missing, foreign or altered CSRF tokens", async () => {
  const env = fixture(),
    a = await env.issue(),
    b = await env.issue("synthetic-b");
  for (const cookie of [
    "",
    `${CLOUD_SESSION_COOKIE}=short`,
    `${a.cookie}; ${a.cookie}`,
    `${a.cookie}, ${a.cookie}`,
    `${CLOUD_SESSION_COOKIE}="${a.cookie.split("=")[1]}"`,
    `other=${a.cookie.split("=")[1]}`,
    `${CLOUD_SESSION_COOKIE}=${"x".repeat(8300)}`,
  ]) {
    await expect(
      env.boundary.resolveCaller(env.request(cookie, a.body.csrfToken)),
    ).rejects.toMatchObject({ status: 401 });
  }
  for (const csrf of [
    undefined,
    "short",
    "a".repeat(43),
    b.body.csrfToken,
    a.body.csrfToken + "a",
  ]) {
    await expect(
      env.boundary.resolveCaller(env.request(a.cookie, csrf)),
    ).rejects.toMatchObject({ code: "csrf-rejected", status: 403 });
  }
  expect(
    await env.boundary.resolveCaller(
      env.request(a.cookie, a.body.csrfToken, {
        headers: { "sec-fetch-site": "same-origin" },
      }),
    ),
  ).toBe("owner-a");
});
it("enforces logical expiry, revocation, clock bounds and strict stored schemas", async () => {
  const env = fixture(),
    issued = await env.issue();
  const original = structuredClone([...env.records.values()][0]),
    id = original.idHash;
  const resolve = () =>
    env.boundary.resolveCaller(
      env.request(issued.cookie, issued.body.csrfToken),
    );
  env.now.value = original.expiresAt;
  await expect(resolve()).rejects.toMatchObject({ status: 401 });
  env.now.value = original.issuedAt - 1;
  await expect(resolve()).rejects.toMatchObject({
    code: "session-clock-unavailable",
    status: 503,
  });
  env.now.value = BASE;
  env.records.set(id, { ...original, revoked: true });
  await expect(resolve()).rejects.toMatchObject({ status: 401 });
  for (const record of [
    { ...original, version: 2 },
    { ...original, subject: "invalid owner" },
    { ...original, idHash: "0".repeat(64) },
    { ...original, expiresAt: original.issuedAt + 25 * 3600000 },
    { ...original, unexpected: true },
  ]) {
    env.records.set(id, record as CloudWebSession);
    await expect(resolve()).rejects.toMatchObject({
      code: "session-unavailable",
      status: 503,
    });
  }
});
it("rotates identity and CSRF together, revokes the previous cookie and logs out only through a protected POST", async () => {
  const env = fixture(),
    a = await env.issue(),
    b = await env.issue("synthetic-b", a.cookie);
  expect(b.cookie).not.toBe(a.cookie);
  expect(b.body.csrfToken).not.toBe(a.body.csrfToken);
  await expect(
    env.boundary.resolveCaller(env.request(a.cookie, a.body.csrfToken)),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    env.boundary.resolveCaller(env.request(b.cookie, a.body.csrfToken)),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    await env.boundary.resolveCaller(env.request(b.cookie, b.body.csrfToken)),
  ).toBe("owner-b");
  await expect(
    env.boundary.logout(
      env.request(b.cookie, b.body.csrfToken, { method: "GET" }),
    ),
  ).rejects.toMatchObject({ status: 405 });
  const logout = await env.boundary.logout(
    env.request(b.cookie, b.body.csrfToken),
  );
  expect(logout.status).toBe(204);
  expect(logout.headers.get("set-cookie")).toBe(
    `${CLOUD_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  await expect(
    env.boundary.resolveCaller(env.request(b.cookie, b.body.csrfToken)),
  ).rejects.toMatchObject({ status: 401 });
});
it("withholds cookies on failed persistence and keeps private storage details out of errors", async () => {
  const env = fixture(),
    a = await env.issue();
  vi.mocked(env.store.insert).mockRejectedValueOnce(
    Error("Private synthetic persistence detail"),
  );
  await expect(env.issue("synthetic-b", a.cookie)).rejects.toMatchObject({
    code: "session-unavailable",
    status: 503,
  });
  expect(
    await env.boundary.resolveCaller(env.request(a.cookie, a.body.csrfToken)),
  ).toBe("owner-a");
  vi.mocked(env.store.revoke).mockRejectedValueOnce(
    Error("Private synthetic revocation detail"),
  );
  await expect(env.issue("synthetic-b", a.cookie)).rejects.toMatchObject({
    message: "Cloud server: session-unavailable",
    status: 503,
  });
  expect(
    await env.boundary.resolveCaller(env.request(a.cookie, a.body.csrfToken)),
  ).toBe("owner-a");
  vi.mocked(env.store.read).mockRejectedValueOnce(
    Error("Private synthetic read detail"),
  );
  await expect(
    env.boundary.resolveCaller(env.request(a.cookie, a.body.csrfToken)),
  ).rejects.toMatchObject({
    message: "Cloud server: session-unavailable",
    status: 503,
  });
});
it("protects actual HTTP mutations before body/note access and preserves two-account and paid-policy isolation", async () => {
  const folder = mkdtempSync(join(tmpdir(), "peel-synthetic-web-session-")),
    server = new SQLiteCloudServerStore(join(folder, "notes.sqlite3"));
  const env = fixture();
  try {
    for (const subject of ["owner-a", "owner-b"])
      await server.seedAccount({
        version: 1,
        ownerSubject: subject,
        collectionId: "synthetic-cloud-library",
        modeGeneration: 1,
        status: "active",
        entitlement: "active",
        revision: 1,
        sequence: 0,
        wall: 0,
      });
    const handler = createCloudMutationHandler(
      new CloudMutationService(server, () => BASE),
      env.boundary.resolveCaller,
    );
    const a = await env.issue(),
      b = await env.issue("synthetic-b");
    const payload = async (text: string) => {
      const mutation = {
        version: 1 as const,
        opId: "same-op",
        noteId: "synthetic-note",
        baseRevision: 0,
        kind: "upsert" as const,
        snapshot: cloudDraft(text),
      };
      return JSON.stringify({
        version: 1,
        collectionId: "synthetic-cloud-library",
        modeGeneration: 1,
        mutation: { ...mutation, contentHash: await mutationHash(mutation) },
      });
    };
    const read = vi.spyOn(server, "read");
    const blocked = env.request(a.cookie, undefined, {
      body: await payload("blocked"),
      headers: { "content-type": "application/json" },
    });
    expect((await handler(blocked)).status).toBe(403);
    expect(blocked.bodyUsed).toBe(false);
    expect(read).not.toHaveBeenCalled();
    for (const [session, text] of [
      [a, "Owner A synthetic note"],
      [b, "Owner B synthetic note"],
    ] as const) {
      const response = await handler(
        env.request(session.cookie, session.body.csrfToken, {
          body: await payload(text),
          headers: {
            "content-type": "application/json",
            "x-peel-subject": "forged-owner",
          },
        }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()).head.snapshot.bodyMarkdown).toBe(text);
    }
    await server.setPolicy("owner-a", "active", "inactive");
    const denied = await handler(
      env.request(a.cookie, a.body.csrfToken, {
        body: await payload("A"),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "cloud-entitlement-inactive",
    });
    const get = new Request(`${origin}/v1/notes/synthetic-note`, {
      headers: {
        cookie: b.cookie,
        "x-peel-collection": "synthetic-cloud-library",
        "x-peel-mode-generation": "1",
      },
    });
    expect((await (await handler(get)).json()).head.snapshot.bodyMarkdown).toBe(
      "Owner B synthetic note",
    );
  } finally {
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it("binds captured safe discovery and note reads to the supplied token before account access", async () => {
  const folder = mkdtempSync(join(tmpdir(), "synkies-safe-session-")),
    server = new SQLiteCloudServerStore(join(folder, "server.sqlite3")),
    env = fixture();
  try {
    for (const letter of ["a", "b"])
      await server.seedAccount({
        version: 1,
        ownerSubject: `owner-${letter}`,
        collectionId: `library-${letter}`,
        modeGeneration: 2,
        status: "active",
        entitlement: "active",
        revision: 1,
        sequence: 0,
        wall: 0,
      });
    const handler = createCloudMutationHandler(
        new CloudMutationService(server, () => BASE),
        env.boundary.resolveCaller,
      ),
      a = await env.issue(),
      b = await env.issue("synthetic-b", a.cookie),
      accountReads = vi.spyOn(server, "readAccount"),
      noteReads = vi.spyOn(server, "read"),
      commits = vi.spyOn(server, "commit");
    const read = (csrf?: string, path = "/v1/library-context") =>
      new Request(origin + path, {
        headers: {
          cookie: b.cookie,
          ...(csrf === undefined ? {} : { "x-peel-csrf": csrf }),
          "x-peel-collection": "library-b",
          "x-peel-mode-generation": "2",
        },
      });
    const stale = await handler(read(a.body.csrfToken));
    expect({ status: stale.status, body: await stale.json() }).toEqual({
      status: 403,
      body: { error: "csrf-rejected" },
    });
    expect(accountReads).not.toHaveBeenCalled();
    expect(
      (await handler(read(a.body.csrfToken, "/v1/notes/synthetic-note")))
        .status,
    ).toBe(403);
    expect(noteReads).not.toHaveBeenCalled();
    const expected = {
      version: 1,
      ownerSubject: "owner-b",
      collectionId: "library-b",
      modeGeneration: 2,
    };
    expect(await (await handler(read(b.body.csrfToken))).json()).toEqual(
      expected,
    );
    expect(await (await handler(read())).json()).toEqual(expected);
    expect(accountReads.mock.calls.map((call) => call[0])).toEqual([
      "owner-b",
      "owner-b",
    ]);
    await server.setPolicy("owner-b", "active", "inactive");
    const unpaid = await handler(read(b.body.csrfToken));
    expect(unpaid.status).toBe(403);
    expect(await unpaid.json()).toEqual({
      error: "cloud-entitlement-inactive",
    });
    expect(commits).not.toHaveBeenCalled();
  } finally {
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

it.each(["GET", "HEAD", "OPTIONS"])(
  "checks supplied session binding on %s while retaining plain safe requests",
  async (method) => {
    const env = fixture(),
      a = await env.issue(),
      b = await env.issue("synthetic-b");
    expect(
      await env.boundary.resolveCaller(
        env.request(a.cookie, undefined, { method }),
      ),
    ).toBe("owner-a");
    expect(
      await env.boundary.resolveCaller(
        env.request(a.cookie, a.body.csrfToken, { method }),
      ),
    ).toBe("owner-a");
    await expect(
      env.boundary.resolveCaller(
        env.request(b.cookie, a.body.csrfToken, { method }),
      ),
    ).rejects.toMatchObject({ status: 403, code: "csrf-rejected" });
    expect(
      await env.boundary.resolveCaller(
        env.request(b.cookie, b.body.csrfToken, { method }),
      ),
    ).toBe("owner-b");
  },
);

it("privately rejects malformed, empty and duplicate supplied tokens on a safe request", async () => {
  const env = fixture(),
    a = await env.issue(),
    csrf = a.body.csrfToken as string,
    wrong = (csrf[0] === "a" ? "b" : "a") + csrf.slice(1);
  for (const value of ["", "short-private-value", "x".repeat(44), wrong]) {
    const request = env.request(a.cookie, undefined, { method: "GET" });
    request.headers.set("x-peel-csrf", value);
    await expect(env.boundary.resolveCaller(request)).rejects.toMatchObject({
      status: 403,
      code: "csrf-rejected",
      message: "Cloud server: csrf-rejected",
    });
  }
  const duplicate = env.request(a.cookie, csrf, { method: "GET" });
  duplicate.headers.append("x-peel-csrf", csrf);
  await expect(env.boundary.resolveCaller(duplicate)).rejects.toMatchObject({
    status: 403,
    code: "csrf-rejected",
  });
});

it("never lets a matching supplied read token override cookie, origin, expiry or revocation gates", async () => {
  const env = fixture(),
    a = await env.issue();
  vi.mocked(env.store.read).mockClear();
  for (const headers of [
    { origin: "https://foreign.invalid" },
    { "sec-fetch-site": "cross-site" },
  ]) {
    const request = env.request(a.cookie, a.body.csrfToken, { method: "GET" });
    for (const [name, value] of Object.entries(headers))
      request.headers.set(name, value!);
    await expect(env.boundary.resolveCaller(request)).rejects.toMatchObject({
      status: 403,
    });
  }
  const missing = env.request(a.cookie, a.body.csrfToken, { method: "GET" });
  missing.headers.delete("cookie");
  await expect(env.boundary.resolveCaller(missing)).rejects.toMatchObject({
    status: 401,
  });
  expect(env.store.read).not.toHaveBeenCalled();
  for (const record of env.records.values()) record.revoked = true;
  await expect(
    env.boundary.resolveCaller(
      env.request(a.cookie, a.body.csrfToken, { method: "GET" }),
    ),
  ).rejects.toMatchObject({ status: 401 });
  for (const record of env.records.values()) record.revoked = false;
  env.now.value += 3600000;
  await expect(
    env.boundary.resolveCaller(
      env.request(a.cookie, a.body.csrfToken, { method: "GET" }),
    ),
  ).rejects.toMatchObject({ status: 401 });
});
