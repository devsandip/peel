import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
// @ts-expect-error Owned untyped .mjs fixture; RoundtripServer states what this spec uses.
import { startCloudConflictRoundtripServer } from "../fixtures/cloud-conflict-roundtrip-server.mjs";
import type {} from "../fixtures/cloud-conflict-roundtrip";

type Head = {
  kind: string;
  revision: number;
  snapshot?: { bodyMarkdown: string };
};
type Observation = {
  session: string;
  method: string;
  path: string;
  status?: number;
  disposition?: string;
  opId?: string | null;
  contentHash?: string;
  replayed?: boolean | null;
};
type RoundtripServer = {
  api: string;
  folder: string;
  accounts: readonly { ownerSubject: string; collectionId: string }[];
  observations: Observation[];
  openSession(
    label: string,
    index: number,
  ): Promise<{ csrfToken: string; cookie: string; issued: string }>;
  cookie(label: string): string;
  setSwitch(
    label: string,
    values: { offline?: boolean; hold?: boolean; lose?: number },
  ): void;
  release(label?: string): void;
  held(label: string): number;
  revokeSession(label: string): void;
  seedNote(index: number, noteId: string, body: string): Promise<unknown>;
  trashNote(index: number, noteId: string, body: string): Promise<unknown>;
  purgeNote(index: number, noteId: string): Promise<unknown>;
  head(index: number, noteId: string): Promise<Head>;
  libraryContext(index: number): Promise<unknown>;
  foreignGet(
    label: string,
    index: number,
    noteId: string,
  ): Promise<{ status: number; text: string }>;
  resourcesRemoved(): boolean;
  close(): Promise<void>;
};
type Session = {
  label: string;
  context: BrowserContext;
  page: Page;
  db: string;
  /** The synthetic cookie this context's proxy currently attaches. */
  proxyLabel: { current: string };
  csrfToken: string;
};

const controllerMerged = existsSync(
    resolve("apps/web/src/cloud-conflict-resolution.ts"),
  ),
  CONTROLLER_BLOCKED =
    "Blocked on issue 204: the real controller has not merged. Unmet acceptance, not a pass.",
  INSPECTION_BLOCKED =
    "Blocked on issue 205: the real inspection control has not merged. Unmet acceptance, not a pass.";
/**
 * Temporary switch, removed at final Ready: true once the merged PR 209 wrapper
 * acknowledges Put away before starting its upload flush (issue 208).
 */
const putAwayFixed =
  /await onPutAway\(session\);\s*\/\/[^\n]*\n\s*void upload\.upload\(\)/.test(
    readFileSync(
      resolve("apps/web/src/cloud-uploading-note-editor.tsx"),
      "utf8",
    ),
  );
const noteId = "roundtrip-note",
  START = "Shared starting text",
  DEVICE_A = "Session A confirmed text",
  DEVICE_B = "Session B preserved draft";

let server: RoundtripServer;
let sessions: Session[] = [];
let sensitive: string[] = [];
const diagnostics: string[] = [];
const fatal: string[] = [];

test.beforeEach(async ({ baseURL }) => {
  server = await startCloudConflictRoundtripServer(new URL(baseURL!).origin);
  sessions = [];
  sensitive = [];
  diagnostics.length = 0;
  fatal.length = 0;
});
test.afterEach(async () => {
  server.release();
  for (const session of sessions) {
    if (session.page.isClosed()) continue;
    const loaded = await session.page.evaluate(
      () => !!window.cloudConflictRoundtripFixture,
    );
    if (!loaded) continue;
    const { names, keys, closes } = await session.page.evaluate(async () => ({
      names: await window.cloudConflictRoundtripFixture.databases(),
      keys: window.cloudConflictRoundtripFixture.storageKeys(),
      closes: window.cloudConflictRoundtripFixture.closeCounts(),
    }));
    // No default database, storage-mode key or caller-owned store closure.
    expect(names.every((name) => name?.startsWith(`${session.db}-`))).toBe(
      true,
    );
    expect(keys).toEqual([]);
    expect(closes.every((count) => count === 0)).toBe(true);
    await session.page.evaluate(() =>
      window.cloudConflictRoundtripFixture.destroy(),
    );
    expect(await session.page.evaluate(() => indexedDB.databases())).toEqual(
      [],
    );
  }
  for (const session of sessions) await session.context.close();
  const { folder, api } = server;
  await server.close();
  expect(server.resourcesRemoved()).toBe(true);
  expect(existsSync(folder)).toBe(false);
  await expect(fetch(`${api}/v1/library-context`)).rejects.toThrow();
  expect(fatal).toEqual([]);
  // No note text or credential reaches a browser error, console line or log.
  const logged = JSON.stringify([diagnostics, server.observations]);
  for (const secret of sensitive) expect(logged).not.toContain(secret);
});

async function openSession(
  browser: Browser,
  baseURL: string,
  label: string,
  accountIndex: number,
): Promise<Session> {
  const issued = await server.openSession(label, accountIndex);
  sensitive.push(issued.csrfToken, issued.cookie.split("=")[1]);
  // A fresh context per session: nothing is shared with another browser session.
  const context = await browser.newContext({ baseURL }),
    page = await context.newPage(),
    db = `peel-m0-cloud-conflict-roundtrip-${randomUUID()}`,
    proxyLabel = { current: label };
  page.on("pageerror", () => fatal.push("Unexpected browser exception"));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning")
      diagnostics.push(message.text());
  });
  await page.addInitScript(
    (csrfToken) =>
      Reflect.set(window, "syntheticConflictRoundtripConfig", { csrfToken }),
    issued.csrfToken,
  );
  await context.route("**/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    expect(url.origin).toBe(new URL(baseURL).origin);
    try {
      const response = await route.fetch({
        url: server.api + url.pathname + url.search,
        // Explicit synthetic proxy cookie, never browser-managed authentication.
        headers: {
          ...request.headers(),
          cookie: server.cookie(proxyLabel.current),
        },
        maxRedirects: 0,
      });
      await route.fulfill({ response });
    } catch {
      // The connection dropped or the page already gave up. Fail it like a network loss.
      await route.abort("connectionreset").catch(() => {});
    }
  });
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-conflict-roundtrip.html")}?db=${db}`,
  );
  await page.waitForFunction(() => !!window.cloudConflictRoundtripFixture);
  const session = {
    label,
    context,
    page,
    db,
    proxyLabel,
    csrfToken: issued.csrfToken,
  };
  sessions.push(session);
  return session;
}
const prepare = (session: Session) =>
  session.page.evaluate(() => window.cloudConflictRoundtripFixture.prepare());
const download = async (session: Session) => {
  const result = await session.page.evaluate(() =>
    window.cloudConflictRoundtripFixture.download(),
  );
  expect(result.kind).toBe("complete");
};
const library = (session: Session) =>
  session.page.getByRole("region", { name: "Cached Cloud library" });
const card = (session: Session, title: string) =>
  library(session).getByRole("button", { name: `Open ${title}` });
const article = (session: Session) =>
  session.page.getByRole("article", { name: "Cloud note editor" });
const editorStatus = (session: Session) => article(session).getByRole("status");
async function openEditor(session: Session, title: string) {
  await card(session, title).click();
  await expect(article(session)).toBeVisible();
}
const type = (session: Session, body: string) =>
  article(session).getByRole("textbox", { name: "Note text" }).fill(body);
async function putAway(session: Session) {
  await article(session).getByRole("button", { name: "Put away note" }).click();
  await expect(article(session)).toHaveCount(0);
}
/**
 * Real Put away once issue 208's fix is on this base. Before that, Put away
 * cannot complete with real owners when no upload is in flight, so the editor
 * is left by reload: a real durable recovery path that does not prove Put away.
 */
async function leaveEditor(session: Session) {
  if (putAwayFixed) {
    await putAway(session);
    return;
  }
  await session.page.reload();
  await session.page.waitForFunction(
    () => !!window.cloudConflictRoundtripFixture,
  );
  await prepare(session);
  await expect(library(session)).toBeVisible();
}
const mutations = (label?: string) =>
  server.observations.filter(
    (entry) =>
      entry.path === "/v1/mutations" && (!label || entry.session === label),
  );
const headBody = async (index: number, id = noteId) =>
  (await server.head(index, id)).snapshot?.bodyMarkdown;

/** Two contexts of one account, both holding the same downloaded note. */
async function twoSessions(browser: Browser, baseURL: string) {
  sensitive.push(START, DEVICE_A, DEVICE_B);
  await server.seedNote(0, noteId, START);
  const a = await openSession(browser, baseURL, "a", 0),
    b = await openSession(browser, baseURL, "b", 0);
  for (const session of [a, b]) {
    await prepare(session);
    await download(session);
    await expect(card(session, START)).toContainText("Saved in Cloud");
  }
  return { a, b };
}
/** Real editors in both sessions: A reaches the server while B is offline, then B gets a real 409. */
async function realConflict(
  browser: Browser,
  baseURL: string,
  remote: (a: Session) => Promise<void> = async (a) => {
    await openEditor(a, START);
    await type(a, DEVICE_A);
    await expect(editorStatus(a)).toHaveText("Saved in Cloud");
    await leaveEditor(a);
  },
  recovery = false,
) {
  const { a, b } = await twoSessions(browser, baseURL);
  server.setSwitch("b", { offline: true });
  await openEditor(b, START);
  await type(b, DEVICE_B);
  await expect(article(b).getByRole("alert")).toContainText("Could not upload");
  await expect(editorStatus(b)).toHaveText("Pending upload");
  await remote(a);
  server.setSwitch("b", { offline: false });
  await article(b).getByRole("button", { name: "Retry upload" }).click();
  await expect(editorStatus(b)).toHaveText("Conflict");
  await leaveEditor(b);
  if (recovery) {
    // A purged or trashed remote is listed as untitled recovery, never as an openable note.
    await expect(card(b, DEVICE_B)).toHaveCount(0);
    await library(b)
      .getByRole("button", { name: "Needs attention", exact: true })
      .click();
    const recovery = library(b).getByRole("listitem");
    await expect(recovery).toContainText("Cloud note needs recovery");
    await expect(recovery).toContainText("Local recovery required");
    await expect(recovery).toContainText("Conflict");
    await expect(recovery.getByRole("button")).toHaveCount(0);
  } else await expect(card(b, DEVICE_B)).toContainText("Conflict");
  await expect
    .poll(() =>
      b.page.evaluate(
        (id) => window.cloudConflictRoundtripFixture.ownerQuiet(id),
        noteId,
      ),
    )
    .toBe(true);
  return { a, b };
}
const read = (session: Session, index?: number) =>
  session.page.evaluate(
    ([id, at]) =>
      window.cloudConflictRoundtripFixture.conflictRead(
        id as string,
        at as number | undefined,
      ),
    [noteId, index] as const,
  );
const durable = (session: Session, index?: number) =>
  session.page.evaluate(
    ([id, at]) =>
      window.cloudConflictRoundtripFixture.state(
        id as string,
        at as number | undefined,
      ),
    [noteId, index] as const,
  );
type Choice =
  { kind: "local" | "cloud" } | { kind: "merge"; bodyMarkdown: string };
const resolveChoice = (
  session: Session,
  generation: number,
  choice: Choice,
  index?: number,
) =>
  session.page.evaluate(
    ([id, at, selected, target]) =>
      window.cloudConflictRoundtripFixture.conflictResolve(
        id as string,
        at as number,
        selected as Choice,
        target as number | undefined,
      ),
    [noteId, generation, choice, index] as const,
  );
const retry = (session: Session, generation: number) =>
  session.page.evaluate(
    ([id, at]) =>
      window.cloudConflictRoundtripFixture.conflictRetry(
        id as string,
        at as number,
      ),
    [noteId, generation] as const,
  );

test.describe("infrastructure on merged components", () => {
  test("two fresh contexts use separate named caches and nothing runs before explicit preparation", async ({
    browser,
    baseURL,
  }) => {
    await server.seedNote(0, noteId, START);
    const a = await openSession(browser, baseURL!, "a", 0),
      b = await openSession(browser, baseURL!, "b", 0);
    expect(a.db).not.toBe(b.db);
    expect(a.context).not.toBe(b.context);
    // Loading the page authenticates nothing and opens no store.
    expect(server.observations).toEqual([]);
    for (const session of [a, b])
      expect(
        await session.page.evaluate(() =>
          window.cloudConflictRoundtripFixture.databases(),
        ),
      ).toEqual([]);
    await prepare(a);
    expect(server.observations).toEqual([
      expect.objectContaining({
        session: "a",
        path: "/v1/library-context",
        status: 200,
      }),
    ]);
    // Preparing A touches neither B's storage nor any default database.
    const names = await a.page.evaluate(() =>
      window.cloudConflictRoundtripFixture.databases(),
    );
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^peel-m0-cloud-conflict-roundtrip-/);
    expect(names).not.toContain("peel-local-v1");
    expect(
      await b.page.evaluate(() =>
        window.cloudConflictRoundtripFixture.databases(),
      ),
    ).toEqual([]);
    await download(a);
    await expect(card(a, START)).toContainText("Saved in Cloud");
    // A downloaded note does not appear in the other, unprepared context.
    await expect(library(b)).toHaveCount(0);
    expect(mutations()).toEqual([]);
  });

  test("the default app does not import this harness or the conflict controller", () => {
    const entry = readFileSync(resolve("apps/web/src/main.tsx"), "utf8");
    expect(entry).not.toMatch(/cloud-conflict|cloud-library-owners/);
  });

  test("a second account shares nothing, even under the same note ID", async ({
    browser,
    baseURL,
  }) => {
    const OTHER = "Second account private text";
    sensitive.push(START, OTHER);
    await server.seedNote(0, noteId, START);
    await server.seedNote(1, noteId, OTHER);
    const one = await openSession(browser, baseURL!, "one", 0),
      two = await openSession(browser, baseURL!, "two", 1);
    for (const session of [one, two]) {
      await prepare(session);
      await download(session);
    }
    await expect(card(one, START)).toBeVisible();
    await expect(card(two, OTHER)).toBeVisible();
    await expect(library(one)).not.toContainText(OTHER);
    await expect(library(two)).not.toContainText(START);
    const scopes = await Promise.all(
      [one, two].map((session) =>
        session.page.evaluate(() =>
          window.cloudConflictRoundtripFixture.scope(),
        ),
      ),
    );
    expect(scopes[0].ownerSubject).toBe(server.accounts[0].ownerSubject);
    expect(scopes[1].ownerSubject).toBe(server.accounts[1].ownerSubject);
    // Edits in one account leave the other's service record untouched.
    await openEditor(two, OTHER);
    await type(two, "Second account edit");
    await expect(editorStatus(two)).toHaveText("Saved in Cloud");
    expect(await headBody(0)).toBe(START);
    expect(await headBody(1)).toBe("Second account edit");
    // A session cannot read another account's library by naming its scope.
    const foreign = await server.foreignGet("two", 0, noteId);
    expect(foreign.status).not.toBe(200);
    expect(foreign.text).not.toContain(START);
  });

  test("real editors in two sessions preserve both versions in the real preview", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await realConflict(browser, baseURL!);
    // Both versions exist: the server holds A, and B keeps its own draft.
    expect(await headBody(0)).toBe(DEVICE_A);
    const state = await durable(b);
    expect(state!.conflict!.local.snapshot!.bodyMarkdown).toBe(DEVICE_B);
    expect(state!.conflict!.remote!.bodyMarkdown).toBe(DEVICE_A);
    await b.page.evaluate(
      (id) => window.cloudConflictRoundtripFixture.inspect(id),
      noteId,
    );
    const device = b.page.getByRole("article", {
        name: "Draft on this device",
      }),
      observed = b.page.getByRole("article", {
        name: "Observed Cloud version",
      });
    await expect(device).toContainText(DEVICE_B);
    await expect(observed).toContainText(DEVICE_A);
    // The refused upload sent one operation: offline first, then the real 409.
    const sent = mutations("b");
    expect(sent.map((entry) => entry.disposition)).toEqual([
      "offline",
      "delivered",
    ]);
    expect(sent[1].status).toBe(409);
    expect(sent[1].opId).toBe(sent[0].opId);
  });

  test("a held reply stays Pending, and only the matching reply shows Saved", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await twoSessions(browser, baseURL!);
    await openEditor(b, START);
    server.setSwitch("b", { hold: true });
    await type(b, DEVICE_B);
    await expect.poll(() => server.held("b")).toBe(1);
    // The service has committed, but the device has no matching reply yet.
    expect(await headBody(0)).toBe(DEVICE_B);
    await expect(editorStatus(b)).toHaveText("Pending upload");
    server.release("b");
    await expect(editorStatus(b)).toHaveText("Saved in Cloud");
  });

  test("a lost reply stays Pending and an explicit retry replays the exact operation", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await twoSessions(browser, baseURL!);
    await openEditor(b, START);
    server.setSwitch("b", { lose: 1 });
    await type(b, DEVICE_B);
    await expect(article(b).getByRole("alert")).toContainText(
      "Could not upload",
    );
    expect(await headBody(0)).toBe(DEVICE_B);
    await expect(editorStatus(b)).toHaveText("Pending upload");
    await article(b).getByRole("button", { name: "Retry upload" }).click();
    await expect(editorStatus(b)).toHaveText("Saved in Cloud");
    const sent = mutations("b");
    expect(sent).toHaveLength(2);
    expect(sent[0].disposition).toBe("lost");
    expect(sent[1].opId).toBe(sent[0].opId);
    expect(sent[1].contentHash).toBe(sent[0].contentHash);
    expect(sent[1].replayed).toBe(true);
  });

  // Expected failure until issue 208's fix is on this base, then a required pass.
  test("Put away closes a note with real owners when no upload is in flight", async ({
    browser,
    baseURL,
  }) => {
    test.fail(
      !putAwayFixed,
      "Known defect, issue 208: owners.putAway refuses during a clean flush",
    );
    const { b } = await twoSessions(browser, baseURL!);
    await openEditor(b, START);
    await type(b, DEVICE_B);
    await expect(editorStatus(b)).toHaveText("Saved in Cloud");
    await putAway(b);
  });
});

test.describe("real controller recovery", () => {
  test.skip(!controllerMerged, CONTROLLER_BLOCKED);

  test("device choice stays Pending through a held reply and reaches the second session after explicit refresh", async ({
    browser,
    baseURL,
  }) => {
    const { a, b } = await realConflict(browser, baseURL!);
    const view = await read(b);
    expect(view.status).toBe("Conflict");
    expect(view.canMerge).toBe(true);
    server.setSwitch("b", { hold: true });
    const task = resolveChoice(b, view.generation!, { kind: "local" });
    await expect.poll(() => server.held("b")).toBe(1);
    // Committed in the service, but still Pending here without its reply.
    expect(await headBody(0)).toBe(DEVICE_B);
    expect((await read(b)).status).toBe("Pending upload");
    await expect(card(b, DEVICE_B)).not.toContainText("Saved in Cloud");
    server.release("b");
    const result = await task;
    expect(result.kind).toBe("complete");
    expect(result.view!.status).toBe("Saved in Cloud");
    await expect(card(b, DEVICE_B)).toContainText("Saved in Cloud");
    // No live delivery: A stays on its own text until it explicitly refreshes.
    await expect(card(a, DEVICE_A)).toBeVisible();
    await download(a);
    await expect(card(a, DEVICE_B)).toContainText("Saved in Cloud");
    await expect(card(a, DEVICE_A)).toHaveCount(0);
    expect(mutations("a").filter((entry) => entry.status === 409)).toEqual([]);
  });

  test("combined text survives a lost reply and reload, and retry sends the exact operation", async ({
    browser,
    baseURL,
  }) => {
    const COMBINED = "Combined text from both sessions";
    sensitive.push(COMBINED);
    const { a, b } = await realConflict(browser, baseURL!);
    const view = await read(b),
      before = mutations("b").length;
    server.setSwitch("b", { lose: 1 });
    const result = await resolveChoice(b, view.generation!, {
      kind: "merge",
      bodyMarkdown: COMBINED,
    });
    expect(result.kind).toBe("paused");
    expect(result.view!.status).toBe("Pending upload");
    // The server has it, but the device must not say so without a matching reply.
    expect(await headBody(0)).toBe(COMBINED);
    await expect(card(b, COMBINED)).toContainText("Pending upload");
    const retained = (await durable(b))!.inFlight!;
    await b.page.reload();
    await b.page.waitForFunction(() => !!window.cloudConflictRoundtripFixture);
    await prepare(b);
    await expect(card(b, COMBINED)).toContainText("Pending upload");
    const reloaded = await read(b);
    expect(reloaded.status).toBe("Pending upload");
    const recovered = await retry(b, reloaded.generation!);
    expect(recovered.kind).toBe("complete");
    expect(recovered.view!.status).toBe("Saved in Cloud");
    await expect(card(b, COMBINED)).toContainText("Saved in Cloud");
    const sent = mutations("b").slice(before);
    expect(sent).toHaveLength(2);
    expect(sent[0].disposition).toBe("lost");
    expect(sent[0].opId).toBe(retained.opId);
    expect(sent[1].opId).toBe(retained.opId);
    expect(sent[1].contentHash).toBe(retained.contentHash);
    expect(sent[1].replayed).toBe(true);
    await download(a);
    await expect(card(a, COMBINED)).toContainText("Saved in Cloud");
  });

  test("observed Cloud choice sends nothing and adopts the confirmed version", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await realConflict(browser, baseURL!);
    const view = await read(b),
      before = mutations("b").length,
      revision = (await server.head(0, noteId)).revision;
    const result = await resolveChoice(b, view.generation!, { kind: "cloud" });
    expect(result.kind).toBe("complete");
    expect(result.view!.status).toBe("Saved in Cloud");
    expect(mutations("b")).toHaveLength(before);
    expect((await server.head(0, noteId)).revision).toBe(revision);
    await expect(card(b, DEVICE_A)).toContainText("Saved in Cloud");
  });

  test("a stale selection and a newer edit are refused without a send or lost text", async ({
    browser,
    baseURL,
  }) => {
    const NEWER = "Newer session B text";
    sensitive.push(NEWER);
    const { b } = await realConflict(browser, baseURL!);
    const stale = await read(b),
      before = mutations("b").length;
    await openEditor(b, DEVICE_B);
    // An open editor refuses resolution outright.
    expect(
      (await resolveChoice(b, stale.generation!, { kind: "cloud" })).kind,
    ).toBe("busy");
    await type(b, NEWER);
    await expect
      .poll(
        async () => (await durable(b))!.conflict!.local.snapshot!.bodyMarkdown,
      )
      .toBe(NEWER);
    await leaveEditor(b);
    const refused = await resolveChoice(b, stale.generation!, {
      kind: "cloud",
    });
    expect(refused.kind).toBe("stale");
    const current = await read(b);
    expect(current.conflict!.local.snapshot!.bodyMarkdown).toBe(NEWER);
    expect(current.conflict!.remote!.bodyMarkdown).toBe(DEVICE_A);
    expect(mutations("b")).toHaveLength(before);
    expect(
      (await resolveChoice(b, current.generation!, { kind: "local" })).kind,
    ).toBe("complete");
    expect(await headBody(0)).toBe(NEWER);
  });

  test("a newer remote write produces 409 again and a fresh conflict", async ({
    browser,
    baseURL,
  }) => {
    const THIRD = "Third writer reached the server";
    sensitive.push(THIRD);
    const { b } = await realConflict(browser, baseURL!);
    const view = await read(b);
    await server.seedNote(0, noteId, THIRD);
    const result = await resolveChoice(b, view.generation!, { kind: "local" });
    expect(result.kind).toBe("conflict");
    expect(result.view!.conflict!.remote!.bodyMarkdown).toBe(THIRD);
    expect(result.view!.conflict!.local.snapshot!.bodyMarkdown).toBe(DEVICE_B);
    expect(mutations("b").at(-1)!.status).toBe(409);
    expect(await headBody(0)).toBe(THIRD);
    await expect(card(b, DEVICE_B)).toContainText("Conflict");
    const final = await resolveChoice(b, result.view!.generation!, {
      kind: "cloud",
    });
    expect(final.kind).toBe("complete");
    expect(await headBody(0)).toBe(THIRD);
  });

  test("an old session aborts on account switch, withholds its late result and recovers later", async ({
    browser,
    baseURL,
  }) => {
    const OTHER = "Second account private text";
    sensitive.push(OTHER);
    await server.seedNote(1, noteId, OTHER);
    const { b } = await realConflict(browser, baseURL!);
    const view = await read(b);
    server.setSwitch("b", { hold: true });
    const task = resolveChoice(b, view.generation!, { kind: "local" });
    await expect.poll(() => server.held("b")).toBe(1);
    // Switch this page to the second account while the first reply is held.
    const second = await server.openSession("b-two", 1);
    sensitive.push(second.csrfToken, second.cookie.split("=")[1]);
    b.proxyLabel.current = "b-two";
    await b.page.evaluate(
      (token) => window.cloudConflictRoundtripFixture.select(token),
      second.csrfToken,
    );
    expect(await task).toEqual({ kind: "canceled", view: null });
    server.release("b");
    await prepare(b);
    await download(b);
    await expect(card(b, OTHER)).toBeVisible();
    await expect(library(b)).not.toContainText(DEVICE_B);
    expect(
      (
        await b.page.evaluate(
          (id) => window.cloudConflictRoundtripFixture.state(id),
          noteId,
        )
      )?.current?.snapshot?.bodyMarkdown,
    ).toBe(OTHER);
    // The aborted controller stays canceled and leaks nothing through its error.
    const canceled = await b.page.evaluate(
      (id) => window.cloudConflictRoundtripFixture.conflictReadError(id, 0),
      noteId,
    );
    expect(canceled).toMatchObject({
      kind: "canceled",
      message: "Cloud conflict resolution unavailable",
    });
    expect(mutations("b-two")).toEqual([]);
    expect(await headBody(1)).toBe(OTHER);
    // The first account's retained operation recovers in a later session of that account.
    const retained = (await durable(b, 0))!.inFlight!;
    const again = await server.openSession("b-again", 0);
    sensitive.push(again.csrfToken, again.cookie.split("=")[1]);
    b.proxyLabel.current = "b-again";
    await b.page.evaluate(
      (token) => window.cloudConflictRoundtripFixture.select(token),
      again.csrfToken,
    );
    await prepare(b);
    const recovered = await read(b);
    expect(recovered.status).toBe("Pending upload");
    expect((await retry(b, recovered.generation!)).kind).toBe("complete");
    const replay = mutations("b-again");
    expect(replay).toHaveLength(1);
    expect(replay[0].opId).toBe(retained.opId);
    expect(replay[0].replayed).toBe(true);
    expect(await headBody(0)).toBe(DEVICE_B);
    expect(await headBody(1)).toBe(OTHER);
  });

  test("an expired session stays Pending and a new session retries the exact operation", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await realConflict(browser, baseURL!);
    const view = await read(b);
    const before = mutations("b").length;
    server.revokeSession("b");
    const result = await resolveChoice(b, view.generation!, { kind: "local" });
    expect(result.kind).toBe("sign-in-required");
    expect(result.view!.status).toBe("Pending upload");
    expect(JSON.stringify(result)).not.toContain(b.csrfToken);
    const refused = mutations("b").slice(before);
    expect(refused).toHaveLength(1);
    expect(refused[0].status).toBe(401);
    // The service refused it, so nothing reached the account.
    expect(await headBody(0)).toBe(DEVICE_A);
    const fresh = await server.openSession("b-fresh", 0);
    sensitive.push(fresh.csrfToken, fresh.cookie.split("=")[1]);
    b.proxyLabel.current = "b-fresh";
    await b.page.evaluate(
      (token) => window.cloudConflictRoundtripFixture.select(token),
      fresh.csrfToken,
    );
    await prepare(b);
    const reread = await read(b);
    expect(reread.status).toBe("Pending upload");
    expect((await retry(b, reread.generation!)).kind).toBe("complete");
    const sent = mutations("b-fresh");
    expect(sent).toHaveLength(1);
    expect(sent[0].opId).toBe(refused[0].opId);
    expect(sent[0].replayed).toBe(false);
    expect(await headBody(0)).toBe(DEVICE_B);
  });

  test("a remote permanent purge refuses device and combined choices and never recreates the old ID", async ({
    browser,
    baseURL,
  }) => {
    const { a, b } = await realConflict(
      browser,
      baseURL!,
      async () => {
        await server.purgeNote(0, noteId);
      },
      true,
    );
    const view = await read(b);
    expect(view.conflict!.remote).toBeNull();
    expect(view.canMerge).toBe(false);
    // The draft stays readable until an explicit decision.
    expect(view.conflict!.local.snapshot!.bodyMarkdown).toBe(DEVICE_B);
    await b.page.evaluate(
      (id) => window.cloudConflictRoundtripFixture.inspect(id),
      noteId,
    );
    await expect(
      b.page.getByRole("article", { name: "Draft on this device" }),
    ).toContainText(DEVICE_B);
    await expect(
      b.page.getByRole("article", { name: "Observed Cloud version" }),
    ).toContainText("Permanently purged in Cloud");
    const before = mutations("b").length,
      revision = (await server.head(0, noteId)).revision;
    for (const choice of [
      { kind: "local" },
      { kind: "merge", bodyMarkdown: "Attempted resurrection" },
    ] as Choice[])
      expect((await resolveChoice(b, view.generation!, choice)).kind).toBe(
        "new-note-required",
      );
    expect(mutations("b")).toHaveLength(before);
    expect((await read(b)).conflict!.local.snapshot!.bodyMarkdown).toBe(
      DEVICE_B,
    );
    const accepted = await resolveChoice(b, view.generation!, {
      kind: "cloud",
    });
    expect(accepted.kind).toBe("complete");
    expect(accepted.view!.status).toBe("Deleted in Cloud");
    expect(mutations("b")).toHaveLength(before);
    const head = await server.head(0, noteId);
    expect(head.kind).toBe("purged");
    expect(head.revision).toBe(revision);
    // The old ID cannot be reopened in either session.
    await expect(library(b).getByRole("listitem")).toHaveCount(0);
    expect(
      await b.page.evaluate(
        (id) => window.cloudConflictRoundtripFixture.open(id),
        noteId,
      ),
    ).toBe("Could not open this Cloud note");
    await download(a);
    await expect(
      library(a).getByRole("button", { name: /^Open / }),
    ).toHaveCount(0);
    expect(
      await a.page.evaluate(
        (id) => window.cloudConflictRoundtripFixture.open(id),
        noteId,
      ),
    ).toBe("Could not open this Cloud note");
    expect((await server.head(0, noteId)).kind).toBe("purged");
  });

  test("combined text is refused over a note trashed in Cloud, and both durable branches survive", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await realConflict(
      browser,
      baseURL!,
      async () => {
        await server.trashNote(0, noteId, START);
      },
      true,
    );
    const before = await durable(b),
      view = await read(b),
      head = await server.head(0, noteId);
    expect(head.kind).toBe("note");
    expect(view.status).toBe("Conflict");
    expect(view.canMerge).toBe(false);
    expect(view.conflict!.local.snapshot!.bodyMarkdown).toBe(DEVICE_B);
    expect(before!.conflict!.remote!.state).toBe("trashed");
    expect(before!.conflict!.local.snapshot!.state).toBe("active");
    await b.page.evaluate(
      (id) => window.cloudConflictRoundtripFixture.inspect(id),
      noteId,
    );
    await expect(
      b.page.getByRole("article", { name: "Draft on this device" }),
    ).toContainText(DEVICE_B);
    const observed = b.page.getByRole("article", {
      name: "Observed Cloud version",
    });
    await expect(observed).toContainText(START);
    await expect(observed).toContainText("In Trash");
    const sent = mutations("b").length;
    const refused = await resolveChoice(b, view.generation!, {
      kind: "merge",
      bodyMarkdown: "Combined over Trash must refuse",
    });
    expect(refused).toEqual({ kind: "unavailable", view: null });
    // Nothing moved: both branches, the generation and the server revision are intact.
    expect(await durable(b)).toEqual(before);
    expect(mutations("b")).toHaveLength(sent);
    expect(await server.head(0, noteId)).toEqual(head);
    await library(b)
      .getByRole("button", { name: "Needs attention", exact: true })
      .click();
    const listed = library(b).getByRole("listitem");
    await expect(listed).toContainText("Conflict");
    await expect(listed).not.toContainText("Saved in Cloud");
    // The explicit observed choice keeps the Cloud lifecycle and sends nothing.
    const accepted = await resolveChoice(b, view.generation!, {
      kind: "cloud",
    });
    expect(accepted.kind).toBe("complete");
    expect(accepted.view!.conflict).toBeNull();
    expect(mutations("b")).toHaveLength(sent);
    expect(await server.head(0, noteId)).toEqual(head);
    const after = await durable(b);
    expect(after!.current!.snapshot!.state).toBe("trashed");
    expect(after!.current!.snapshot!.bodyMarkdown).toBe(START);
    await library(b)
      .getByRole("button", { name: "Trash", exact: true })
      .click();
    await expect(library(b).getByRole("listitem")).toContainText(START);
    await library(b)
      .getByRole("button", { name: "Notes", exact: true })
      .click();
    await expect(library(b).getByRole("listitem")).toHaveCount(0);
  });

  test("failures expose fixed kinds and messages, and no storage mode activates", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await realConflict(browser, baseURL!);
    const context = await server.libraryContext(0);
    const view = await read(b);
    for (const malformed of [
      { kind: "other" },
      { kind: "merge", bodyMarkdown: null },
    ])
      expect(
        await resolveChoice(b, view.generation!, malformed as Choice),
      ).toEqual({ kind: "unavailable", view: null });
    expect(
      await b.page.evaluate(() =>
        window.cloudConflictRoundtripFixture.conflictReadError("bad id!"),
      ),
    ).toEqual({
      name: "CloudConflictResolutionError",
      message: "Cloud conflict resolution unavailable",
      kind: "unavailable",
    });
    // Nothing above changed the account, its generation or any note.
    expect(await server.libraryContext(0)).toEqual(context);
    expect(await headBody(0)).toBe(DEVICE_A);
    expect((await read(b)).status).toBe("Conflict");
  });
});

test.describe("real workspace inspection", () => {
  test.fixme(true, INSPECTION_BLOCKED);
  test("the real inspection control opens the preserved conflict from the library", () => {});
});
