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
import type { CloudConflictResolutionChoice } from "../../apps/web/src/cloud-conflict-resolution";

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

const noteId = "roundtrip-note",
  START = "Shared starting text",
  DEVICE_A = "Session A confirmed text",
  DEVICE_B = "Session B preserved draft";

let server: RoundtripServer;
let sessions: Session[] = [];
/** Every manually created context, registered before navigation or readiness. */
let contexts: BrowserContext[] = [];
let sensitive: string[] = [];
const diagnostics: string[] = [];
const fatal: string[] = [];

test.beforeEach(async ({ baseURL }) => {
  server = await startCloudConflictRoundtripServer(new URL(baseURL!).origin);
  sessions = [];
  contexts = [];
  sensitive = [];
  diagnostics.length = 0;
  fatal.length = 0;
});
/** Owned browser stores: checked, then destroyed by the fixture's own prefix. */
async function verifyAndDestroyStores() {
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
}
/** Attempts every owned close, even after an earlier one fails. */
async function closeOwned() {
  const errors: unknown[] = [];
  for (const context of contexts.splice(0))
    await context.close().catch((error: unknown) => errors.push(error));
  await server.close().catch((error: unknown) => errors.push(error));
  return errors;
}
test.afterEach(async () => {
  let failure: unknown = null;
  try {
    await verifyAndDestroyStores();
  } catch (error) {
    failure = error;
  }
  const cleanup = await closeOwned();
  // The original failure wins; a cleanup error surfaces only on its own.
  if (failure) throw failure;
  if (cleanup.length) throw cleanup[0];
  const { folder, api } = server;
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
  actions = false,
): Promise<Session> {
  const issued = await server.openSession(label, accountIndex);
  sensitive.push(issued.csrfToken, issued.cookie.split("=")[1]);
  // A fresh context per session: nothing is shared with another browser session.
  const context = await browser.newContext({ baseURL });
  contexts.push(context);
  const page = await context.newPage(),
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
    `/@fs${resolve("tests/fixtures/cloud-conflict-roundtrip.html")}?db=${db}${actions ? "&actions=1" : ""}`,
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
const RECOVERY = "Cloud note needs recovery";
const preview = (session: Session) =>
  session.page.getByRole("region", { name: "Cloud conflict preview" });
/** The real Inspect conflict control in the visible collection, then the loaded preview. */
async function inspectConflict(session: Session, title: string) {
  await library(session)
    .getByRole("button", { name: `Inspect conflict for ${title}` })
    .click();
  await expect(preview(session)).toHaveAttribute("aria-busy", "false");
}
const mutations = (label?: string) =>
  server.observations.filter(
    (entry) =>
      entry.path === "/v1/mutations" && (!label || entry.session === label),
  );
const headBody = async (index: number, id = noteId) =>
  (await server.head(index, id)).snapshot?.bodyMarkdown;

/** Two contexts of one account, both holding the same downloaded note. */
async function twoSessions(browser: Browser, baseURL: string, actions = false) {
  sensitive.push(START, DEVICE_A, DEVICE_B);
  await server.seedNote(0, noteId, START);
  const a = await openSession(browser, baseURL, "a", 0, actions),
    b = await openSession(browser, baseURL, "b", 0, actions);
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
    await putAway(a);
  },
  recovery = false,
  actions = false,
) {
  const { a, b } = await twoSessions(browser, baseURL, actions);
  server.setSwitch("b", { offline: true });
  await openEditor(b, START);
  await type(b, DEVICE_B);
  await expect(article(b).getByRole("alert")).toContainText("Could not upload");
  await expect(editorStatus(b)).toHaveText("Pending upload");
  await remote(a);
  server.setSwitch("b", { offline: false });
  await article(b).getByRole("button", { name: "Retry upload" }).click();
  await expect(editorStatus(b)).toHaveText("Conflict");
  await putAway(b);
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
    // Inspection is offered, but the card never opens in the editor.
    await expect(recovery.getByRole("button")).toHaveCount(1);
    await expect(
      recovery.getByRole("button", {
        name: `Inspect conflict for ${RECOVERY}`,
      }),
    ).toBeVisible();
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
type Choice = CloudConflictResolutionChoice;
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
    await inspectConflict(b, DEVICE_B);
    const device = preview(b).getByRole("article", {
        name: "Draft on this device",
      }),
      observed = preview(b).getByRole("article", {
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

  // Formerly the issue 208 defect: a settled note with no upload in flight.
  test("Put away closes a settled note with real owners when no upload is in flight", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await twoSessions(browser, baseURL!);
    await openEditor(b, START);
    await type(b, DEVICE_B);
    await expect(editorStatus(b)).toHaveText("Saved in Cloud");
    const sent = mutations("b").length;
    await putAway(b);
    await expect(b.page.getByRole("alert")).toHaveCount(0);
    await expect(card(b, DEVICE_B)).toContainText("Saved in Cloud");
    // The confirmed owner is retired, and closing sends nothing further.
    await expect
      .poll(() =>
        b.page.evaluate(() =>
          window.cloudConflictRoundtripFixture.retainedNotes(),
        ),
      )
      .toEqual([]);
    expect(mutations("b")).toHaveLength(sent);
    expect(await headBody(0)).toBe(DEVICE_B);
  });
});

test.describe("real controller recovery", () => {
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
    await putAway(b);
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
    await inspectConflict(b, RECOVERY);
    await expect(
      preview(b).getByRole("article", { name: "Draft on this device" }),
    ).toContainText(DEVICE_B);
    await expect(
      preview(b).getByRole("article", { name: "Observed Cloud version" }),
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
    await inspectConflict(b, RECOVERY);
    await expect(
      preview(b).getByRole("article", { name: "Draft on this device" }),
    ).toContainText(DEVICE_B);
    const observed = preview(b).getByRole("article", {
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
  test("Inspect conflict opens the real preview by keyboard and Back to notes restores focus", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const { b } = await realConflict(browser, baseURL!);
    await b.page.setViewportSize({ width: 1280, height: 800 });
    const inspect = library(b).getByRole("button", {
        name: `Inspect conflict for ${DEVICE_B}`,
      }),
      back = b.page.getByRole("button", { name: "Back to notes" }),
      copyDraft = preview(b).getByRole("button", { name: "Copy draft text" }),
      copyObserved = preview(b).getByRole("button", {
        name: "Copy observed Cloud text",
      });
    await expect(inspect).toHaveText("Inspect conflict");
    await inspect.focus();
    await b.page.keyboard.press("Enter");
    await expect(back).toBeFocused();
    // Wait for the loaded preview before moving focus, and leave focus where the app put it.
    await expect(preview(b)).toHaveAttribute("aria-busy", "false");
    await expect(copyDraft).toBeVisible();
    await expect(back).toBeFocused();
    await expect(
      preview(b).getByRole("article", { name: "Draft on this device" }),
    ).toContainText(DEVICE_B);
    await expect(
      preview(b).getByRole("article", { name: "Observed Cloud version" }),
    ).toContainText(DEVICE_A);
    // Read-only: no resolution or save action in the inspection pane.
    await expect(
      preview(b).getByRole("button", { name: /Resolve|Save|Restore|Retry/ }),
    ).toHaveCount(0);
    await b.page.keyboard.press("Tab");
    await expect(copyDraft).toBeFocused();
    await b.page.keyboard.press("Tab");
    await expect(copyObserved).toBeFocused();
    expect(
      await b.page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(1280);
    await b.page.screenshot({
      path: testInfo.outputPath("roundtrip-inspection-desktop.png"),
    });
    await back.focus();
    await b.page.keyboard.press("Enter");
    await expect(preview(b)).toHaveCount(0);
    await expect(inspect).toBeFocused();
    // Mobile sheet at 390x844, reached the same way.
    await b.page.setViewportSize({ width: 390, height: 844 });
    await b.page.keyboard.press("Enter");
    await expect(back).toBeFocused();
    await expect(preview(b)).toHaveAttribute("aria-busy", "false");
    await expect(copyDraft).toBeVisible();
    await expect(back).toBeFocused();
    expect(
      await b.page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await b.page.screenshot({
      path: testInfo.outputPath("roundtrip-inspection-mobile.png"),
    });
    await b.page.keyboard.press("Enter");
    await expect(preview(b)).toHaveCount(0);
    await expect(inspect).toBeFocused();
    // Inspection wrote nothing: the conflict and both branches are unchanged.
    const state = await durable(b);
    expect(state!.conflict!.local.snapshot!.bodyMarkdown).toBe(DEVICE_B);
    expect(state!.conflict!.remote!.bodyMarkdown).toBe(DEVICE_A);
    expect((await read(b)).status).toBe("Conflict");
  });
});

test.describe("workspace conflict actions", () => {
  test("changing the optional actions binding preserves an active editor and its retained upload", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await twoSessions(browser, baseURL!, true);
    await openEditor(b, START);
    server.setSwitch("b", { hold: true });
    await type(b, DEVICE_B);
    await expect.poll(() => server.held("b")).toBe(1);
    await expect(editorStatus(b)).toHaveText("Pending upload");
    const textbox = article(b).getByRole("textbox", { name: "Note text" });
    const original = await textbox.elementHandle();
    expect(original).not.toBeNull();
    const retained = await durable(b),
      count = mutations("b").length;
    expect(retained?.inFlight).not.toBeNull();
    await textbox.focus();
    for (const enabled of [false, true]) {
      await b.page.evaluate(
        (value) =>
          window.cloudConflictRoundtripFixture.setConflictActions(value),
        enabled,
      );
      expect(await original!.evaluate((element) => element.isConnected)).toBe(
        true,
      );
      await expect(textbox).toHaveValue(DEVICE_B);
      await expect(textbox).toBeFocused();
      expect((await durable(b))?.inFlight?.opId).toBe(retained?.inFlight?.opId);
      expect(mutations("b")).toHaveLength(count);
    }
    await putAway(b);
    await expect(card(b, DEVICE_B)).toContainText("Pending upload");
    expect(await headBody(0)).toBe(DEVICE_B);
    server.release("b");
    await expect(card(b, DEVICE_B)).toContainText("Saved in Cloud");
    expect(mutations("b")).toHaveLength(count);
    await original!.dispose();
  });

  const actionsPanel = (session: Session) =>
    session.page.getByRole("region", {
      name: "Cloud conflict resolution",
      exact: true,
    });
  const inspectActions = async (session: Session) => {
    await library(session)
      .getByRole("button", { name: `Inspect conflict for ${DEVICE_B}` })
      .click();
    await expect(actionsPanel(session)).toHaveAttribute("aria-busy", "false");
    await expect(
      session.page.getByRole("button", { name: "Back to notes" }),
    ).toBeFocused();
  };

  test("combines real concurrent drafts through the workspace and stays Pending while its ACK is held", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const { b } = await realConflict(browser, baseURL!, undefined, false, true);
    await inspectActions(b);
    const panel = actionsPanel(b),
      combined =
        "Session A confirmed text\nSession B preserved draft\nCombined in workspace ##review";
    sensitive.push(combined);
    await panel
      .getByRole("button", { name: "Combine text", exact: true })
      .click();
    await panel
      .getByLabel("Combined note text", { exact: true })
      .fill(combined);
    const before = mutations("b").length;
    server.setSwitch("b", { hold: true });
    await panel
      .getByRole("button", { name: "Confirm resolution", exact: true })
      .click();
    await expect.poll(() => server.held("b")).toBe(1);
    await expect(
      panel.getByRole("status", { name: "Resolution status", exact: true }),
    ).toHaveText("Pending upload — Saving to Cloud...");
    await expect(panel).not.toContainText("Saved in Cloud");
    expect(mutations("b")).toHaveLength(before + 1);
    // This server holds the reply after committing. The device still lacks
    // the matching acknowledgement and must remain Pending.
    expect(await headBody(0)).toBe(combined);
    const pending = await durable(b);
    expect(pending?.inFlight).not.toBeNull();
    await b.page.setViewportSize({ width: 1280, height: 800 });
    await b.page.screenshot({
      path: testInfo.outputPath("workspace-resolution-pending-desktop.png"),
    });
    server.release("b");
    await expect(
      panel.getByRole("status", { name: "Resolution status", exact: true }),
    ).toHaveText("Saved in Cloud");
    expect(await headBody(0)).toBe(combined);
    const saved = await durable(b);
    expect(saved?.conflict).toBeNull();
    expect(saved?.pending).toBeNull();
    expect(saved?.inFlight).toBeNull();
    expect(saved?.base?.bodyMarkdown).toBe(combined);
  });

  test("adopts the observed Cloud version through the workspace without sending a mutation", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await realConflict(browser, baseURL!, undefined, false, true);
    await inspectActions(b);
    const panel = actionsPanel(b),
      before = mutations("b").length;
    await panel
      .getByRole("button", { name: "Use observed Cloud version", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Confirm resolution", exact: true })
      .click();
    await expect(
      panel.getByRole("status", { name: "Resolution notice", exact: true }),
    ).toContainText("without a new Cloud request");
    expect(mutations("b")).toHaveLength(before);
    const state = await durable(b);
    expect(state?.conflict).toBeNull();
    expect(state?.base?.bodyMarkdown).toBe(DEVICE_A);
    expect(await headBody(0)).toBe(DEVICE_A);
    await expect(panel).not.toContainText("Latest");
    await expect(panel).not.toContainText("Live");
  });

  test("retries a lost workspace resolution reply through the same durable operation", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await realConflict(browser, baseURL!, undefined, false, true);
    await inspectActions(b);
    const panel = actionsPanel(b);
    server.setSwitch("b", { lose: 1 });
    await panel
      .getByRole("button", { name: "Keep device version", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Confirm resolution", exact: true })
      .click();
    const retryButton = panel.getByRole("button", {
      name: "Retry upload",
      exact: true,
    });
    await expect(retryButton).toBeEnabled();
    await expect(
      panel.getByRole("status", { name: "Resolution status", exact: true }),
    ).toHaveText("Pending upload");
    const retained = await durable(b);
    expect(retained?.inFlight).not.toBeNull();
    const sent = mutations("b").at(-1);
    expect(sent?.opId).toBeTruthy();
    expect(await headBody(0)).toBe(DEVICE_B);
    await retryButton.click();
    await expect(
      panel.getByRole("status", { name: "Resolution status", exact: true }),
    ).toHaveText("Saved in Cloud");
    expect(mutations("b").at(-1)?.opId).toBe(sent?.opId);
    expect(mutations("b").at(-1)?.replayed).toBe(true);
    const saved = await durable(b);
    expect(saved?.inFlight).toBeNull();
    expect(saved?.base?.bodyMarkdown).toBe(DEVICE_B);
  });

  test("hides the old account when its workspace resolution reply arrives after replacement", async ({
    browser,
    baseURL,
  }) => {
    const { b } = await realConflict(browser, baseURL!, undefined, false, true);
    await inspectActions(b);
    const panel = actionsPanel(b);
    server.setSwitch("b", { hold: true });
    await panel
      .getByRole("button", { name: "Keep device version", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Confirm resolution", exact: true })
      .click();
    await expect.poll(() => server.held("b")).toBe(1);
    const replacementText = "Replacement account isolated note";
    sensitive.push(replacementText);
    await server.seedNote(1, noteId, replacementText);
    const issued = await server.openSession("workspace-replacement", 1);
    sensitive.push(issued.csrfToken, issued.cookie.split("=")[1]);
    b.proxyLabel.current = "workspace-replacement";
    await b.page.evaluate(
      (token) => window.cloudConflictRoundtripFixture.select(token),
      issued.csrfToken,
    );
    await prepare(b);
    await download(b);
    await expect(card(b, replacementText)).toContainText("Saved in Cloud");
    await expect(panel).toHaveCount(0);
    await expect(b.page.locator("body")).not.toContainText(DEVICE_B);
    await expect(b.page.locator("body")).not.toContainText(DEVICE_A);
    server.release("b");
    await b.page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(card(b, replacementText)).toBeVisible();
    await expect(b.page.locator("body")).not.toContainText(DEVICE_B);
    await expect(b.page.locator("body")).not.toContainText(
      "Resolution confirmed",
    );
    expect((await durable(b))?.base?.bodyMarkdown).toBe(replacementText);
    expect(await headBody(1)).toBe(replacementText);
  });

  test("keeps narrow-screen containment and restores focus after a real conflict decision", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const { b } = await realConflict(browser, baseURL!, undefined, false, true);
    await b.page.setViewportSize({ width: 390, height: 844 });
    await inspectActions(b);
    const panel = actionsPanel(b),
      back = b.page.getByRole("button", { name: "Back to notes", exact: true });
    await expect(b.page.locator(".cloud-workspace-library")).toHaveAttribute(
      "inert",
      "",
    );
    expect(
      await b.page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await b.page.screenshot({
      path: testInfo.outputPath("workspace-resolution-mobile.png"),
    });
    await panel
      .getByRole("button", { name: "Use observed Cloud version", exact: true })
      .click();
    await panel
      .getByRole("button", { name: "Confirm resolution", exact: true })
      .click();
    await expect(
      panel.getByRole("status", { name: "Resolution notice", exact: true }),
    ).toContainText("without a new Cloud request");
    await back.click();
    await expect(panel).toHaveCount(0);
    await expect(
      b.page.locator(".cloud-workspace-library"),
    ).not.toHaveAttribute("inert", "");
    await expect(
      library(b).getByRole("button", { name: "New note", exact: true }),
    ).toBeFocused();
  });
});
