import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  test,
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
// @ts-expect-error Owned untyped .mjs fixture; RoundtripServer types what this spec uses.
import { startCloudConflictRoundtripServer } from "../fixtures/cloud-conflict-roundtrip-server.mjs";
import type {} from "../fixtures/cloud-conflict-resolution-panel";

type Head = {
  kind: string;
  revision: number;
  snapshot?: {
    bodyMarkdown: string;
    state: "active" | "archived" | "trashed";
    serverRevision: number;
    collectionId: string;
    noteId: string;
    schemaVersion: 1;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    purgeAfter: string | null;
  };
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
  resourcesRemoved(): boolean;
  close(): Promise<void>;
};

type HarnessPage = {
  context: BrowserContext;
  page: Page;
  db: string;
  proxyLabel: { current: string };
};

const UNAVAILABLE_COPY =
  "Cloud conflict resolution unavailable. This view is inactive and cannot submit further changes.";

let server: RoundtripServer;
let harnesses: HarnessPage[] = [];
let contexts: BrowserContext[] = [];
let sensitive: string[] = [];
const diagnostics: string[] = [];
const fatal: string[] = [];

test.beforeEach(async ({ baseURL }) => {
  server = await startCloudConflictRoundtripServer(new URL(baseURL!).origin);
  harnesses = [];
  contexts = [];
  sensitive = [];
  diagnostics.length = 0;
  fatal.length = 0;
});

async function verifyAndDestroyStores() {
  server.release();
  for (const harness of harnesses) {
    if (harness.page.isClosed()) continue;
    const loaded = await harness.page.evaluate(() =>
      Boolean(window.cloudConflictResolutionPanelFixture),
    );
    if (!loaded) continue;
    const { names, keys, closes } = await harness.page.evaluate(async () => ({
      names: await window.cloudConflictResolutionPanelFixture.databases(),
      keys: window.cloudConflictResolutionPanelFixture.storageKeys(),
      closes: window.cloudConflictResolutionPanelFixture.closeCounts(),
    }));
    expect(names.includes("peel-local-v1")).toBe(false);
    expect(names.every((name) => name?.startsWith(`${harness.db}-`))).toBe(
      true,
    );
    expect(keys).toEqual([]);
    expect(closes.every((count) => count === 0)).toBe(true);
    await harness.page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.destroy(),
    );
    expect(await harness.page.evaluate(() => indexedDB.databases())).toEqual(
      [],
    );
  }
}

async function closeOwned() {
  const errors: unknown[] = [];
  for (const context of contexts.splice(0)) {
    await context.close().catch((error: unknown) => errors.push(error));
  }
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
  if (failure) throw failure;
  if (cleanup.length) throw cleanup[0];
  const { folder, api } = server;
  expect(server.resourcesRemoved()).toBe(true);
  expect(existsSync(folder)).toBe(false);
  await expect(fetch(`${api}/v1/library-context`)).rejects.toThrow();
  expect(fatal).toEqual([]);
  const logged = JSON.stringify([diagnostics, server.observations]);
  for (const secret of sensitive) {
    expect(logged).not.toContain(secret);
  }
});

async function openHarness(
  browser: Browser,
  baseURL: string,
  initialLabel: string,
  accountIndex = 0,
): Promise<{
  harness: HarnessPage;
  csrfToken: string;
  sessionIndex: number;
}> {
  const issued = await server.openSession(initialLabel, accountIndex);
  sensitive.push(issued.csrfToken, issued.cookie.split("=")[1]);
  const context = await browser.newContext({ baseURL });
  contexts.push(context);
  const page = await context.newPage(),
    db = `peel-m0-cloud-resolution-panel-${randomUUID()}`,
    proxyLabel = { current: initialLabel };

  page.on("pageerror", () => fatal.push("Unexpected browser exception"));
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      diagnostics.push(message.text());
    }
  });

  await context.route("**/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    expect(url.origin).toBe(new URL(baseURL).origin);
    try {
      const response = await route.fetch({
        url: server.api + url.pathname + url.search,
        headers: {
          ...request.headers(),
          cookie: server.cookie(proxyLabel.current),
        },
        maxRedirects: 0,
      });
      await route.fulfill({ response });
    } catch {
      await route.abort("connectionreset").catch(() => {});
    }
  });

  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-conflict-resolution-panel.html")}?db=${db}`,
  );
  await page.waitForFunction(() =>
    Boolean(window.cloudConflictResolutionPanelFixture),
  );
  const sessionIndex = await page.evaluate(
    (token) =>
      window.cloudConflictResolutionPanelFixture.createAndPrepare(token, true),
    issued.csrfToken,
  );
  const harness: HarnessPage = { context, page, db, proxyLabel };
  harnesses.push(harness);
  return { harness, csrfToken: issued.csrfToken, sessionIndex };
}

function trackSecretText(...items: string[]) {
  for (const item of items) {
    if (item.length > 0) sensitive.push(item);
  }
}

function mutations(label?: string) {
  return server.observations.filter(
    (entry) =>
      entry.path === "/v1/mutations" && (!label || entry.session === label),
  );
}

const panelRegion = (page: Page) =>
  page.getByRole("region", { name: "Cloud conflict resolution" });

async function seedActiveConflict(
  page: Page,
  accountIndex: number,
  noteId: string,
  localBody: string,
  remoteBody: string,
) {
  trackSecretText(localBody, remoteBody);
  await server.seedNote(accountIndex, noteId, `# Base for ${noteId}`);
  const downloaded = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.download(),
  );
  expect(downloaded.kind).toBe("complete");
  await server.seedNote(accountIndex, noteId, remoteBody);
  const status = await page.evaluate(
    (args) =>
      window.cloudConflictResolutionPanelFixture.submitDirectMutation({
        noteId: args.noteId,
        kind: "upsert",
        bodyMarkdown: args.localBody,
        state: "active",
      }),
    { noteId, localBody },
  );
  expect(status).toBe(409);
  await page.evaluate(
    (id) => window.cloudConflictResolutionPanelFixture.setNote(id),
    noteId,
  );
}

test("resolves conflicts via explicit UI confirmation for Keep device version, Use observed Cloud version and Combine text", async ({
  browser,
  baseURL,
}, testInfo) => {
  const label = "primary-decisions",
    { harness } = await openHarness(browser, baseURL!, label, 0),
    { page } = harness,
    region = panelRegion(page);

  // 1. Keep device version with held ACK ("Pending upload — Saving to Cloud...") and double-click latch.
  const localKeep = "# Shopping list\n- Local oat milk 原文 ##home",
    remoteKeep = "# Shopping list\n- Observed almond milk ##home";
  await seedActiveConflict(page, 0, "note-keep-local", localKeep, remoteKeep);

  const localCard = region.getByRole("article", {
      name: "Draft on this device",
    }),
    remoteCard = region.getByRole("article", {
      name: "Observed Cloud version",
    });
  await expect(localCard).toContainText("Local state: Active");
  await expect(localCard.locator(".cloud-conflict-resolution-body")).toHaveText(
    localKeep,
  );
  await expect(remoteCard).toContainText("Observed Cloud state: Active");
  await expect(remoteCard).toContainText(
    "Observed Cloud revision 2 (cached on this device)",
  );
  await expect(
    remoteCard.locator(".cloud-conflict-resolution-body"),
  ).toHaveText(remoteKeep);

  await expect(page.locator("body")).not.toContainText("All notes synced");
  await expect(page.locator("body")).not.toContainText("Up to date");
  await expect(page.locator("body")).not.toContainText("Latest");
  await expect(page.locator("body")).not.toContainText("Live");

  await page.setViewportSize({ width: 1280, height: 800 });
  const countBeforeProposal = mutations(label).length;
  await region.getByRole("button", { name: "Keep device version" }).click();
  const confirmBox = region.getByRole("region", {
    name: "Confirm chosen version",
  });
  await expect(confirmBox).toBeVisible();
  expect(mutations(label).length).toBe(countBeforeProposal);
  await page.screenshot({
    path: testInfo.outputPath("conflict-resolution-choices-desktop.png"),
    fullPage: true,
  });

  server.setSwitch(label, { hold: true });
  const confirmButton = confirmBox.getByRole("button", {
    name: "Confirm resolution",
  });
  await confirmButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect.poll(() => server.held(label)).toBe(1);
  expect(mutations(label).length).toBe(countBeforeProposal + 1);
  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Pending upload — Saving to Cloud...");
  await expect(region).not.toContainText("Saved in Cloud");

  server.release(label);
  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Saved in Cloud");
  await expect(
    region.getByRole("status", { name: "Resolution notice" }),
  ).toHaveText("Resolution confirmed and saved in Cloud.");

  const serverAfterKeep = await server.head(0, "note-keep-local");
  expect(serverAfterKeep.revision).toBe(3);
  expect(serverAfterKeep.snapshot?.bodyMarkdown).toBe(localKeep);
  const durableAfterKeep = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readDurableState(
      "note-keep-local",
    ),
  );
  expect(durableAfterKeep?.conflict).toBeNull();
  expect(durableAfterKeep?.pending).toBeNull();
  expect(durableAfterKeep?.inFlight).toBeNull();
  expect(durableAfterKeep?.baseRevision).toBe(3);

  // 2. Use observed Cloud version adopts cached observation with zero network mutations or Live/Latest claims.
  const localDiscard = "# Travel plan\n- Unuploaded local hotel",
    remoteObserved = "# Travel plan\n- Cached observed flight";
  await seedActiveConflict(
    page,
    0,
    "note-use-cloud",
    localDiscard,
    remoteObserved,
  );
  // Advance server to rev 3 behind the client's back to prove adoption uses cached rev 2 without network.
  const unseenRev3 = "# Travel plan\n- Newer unseen server rev 3";
  trackSecretText(unseenRev3);
  await server.seedNote(0, "note-use-cloud", unseenRev3);

  const countBeforeCloudChoice = mutations(label).length;
  await region
    .getByRole("button", { name: "Use observed Cloud version" })
    .click();
  await region
    .getByRole("region", { name: "Confirm chosen version" })
    .getByRole("button", { name: "Confirm resolution" })
    .click();

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Saved in Cloud");
  await expect(
    region.getByRole("status", { name: "Resolution notice" }),
  ).toHaveText(
    "Adopted cached observed Cloud revision 2 on this device without a new Cloud request. Cached observation only; Cloud may have newer changes.",
  );
  expect(mutations(label).length).toBe(countBeforeCloudChoice);
  await expect(page.locator("body")).not.toContainText("Latest");
  await expect(page.locator("body")).not.toContainText("Live");

  const durableAfterCloud = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readDurableState(
      "note-use-cloud",
    ),
  );
  expect(durableAfterCloud?.conflict).toBeNull();
  expect(durableAfterCloud?.baseRevision).toBe(2);
  expect(durableAfterCloud?.base?.bodyMarkdown).toBe(remoteObserved);
  expect((await server.head(0, "note-use-cloud")).revision).toBe(3);

  // 3. Combine text captures labelled editable textarea, enforces 256 KiB limit and commits combined Active body.
  const localCombine = "# Sprint notes\n- Local action item",
    remoteCombine = "# Sprint notes\n- Observed remote item",
    combinedBody =
      "# Sprint notes\n- Local action item\n- Observed remote item ##work";
  trackSecretText(combinedBody);
  await seedActiveConflict(
    page,
    0,
    "note-combine",
    localCombine,
    remoteCombine,
  );

  await region.getByRole("button", { name: "Combine text" }).click();
  const textarea = region.getByLabel("Combined note text");
  await expect(textarea).toHaveValue(localCombine);

  await textarea.fill("x".repeat(256 * 1024 + 8));
  await expect(region.getByRole("alert")).toHaveText(
    "This note has reached its 256 KiB limit. Copy the extra text into a new note.",
  );
  await expect(
    region.getByRole("button", { name: "Confirm resolution" }),
  ).toBeDisabled();

  await textarea.fill(combinedBody);
  await region.getByRole("button", { name: "Confirm resolution" }).click();

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Saved in Cloud");
  const serverAfterCombine = await server.head(0, "note-combine");
  expect(serverAfterCombine.revision).toBe(3);
  expect(serverAfterCombine.snapshot?.bodyMarkdown).toBe(combinedBody);
  const durableAfterCombine = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readDurableState("note-combine"),
  );
  expect(durableAfterCombine?.conflict).toBeNull();
  expect(durableAfterCombine?.baseRevision).toBe(3);
  expect(durableAfterCombine?.base?.bodyMarkdown).toBe(combinedBody);
});

test("refuses stale generation changes and busy open-note locks while confirming, preserving manual combined text until a fresh explicit choice", async ({
  browser,
  baseURL,
}) => {
  const label = "stale-and-busy",
    { harness } = await openHarness(browser, baseURL!, label, 0),
    { page } = harness,
    region = panelRegion(page);

  const manualMerged = "# Valuable hand-merged recovery text ##keep",
    updatedLocal1 = "# Updated local draft during confirmation",
    updatedLocal2 = "# Unrefreshed concurrent local draft";
  trackSecretText(manualMerged, updatedLocal1, updatedLocal2);

  await seedActiveConflict(
    page,
    0,
    "note-stale",
    "# Initial local conflict draft",
    "# Observed remote draft",
  );

  await region.getByRole("button", { name: "Combine text" }).click();
  const textarea = region.getByLabel("Combined note text");
  await textarea.fill(manualMerged);
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toBeVisible();

  // Background refresh advances generation while inline confirmation is open -> retires stale confirmation.
  const countBeforeStale = mutations(label).length;
  await page.evaluate(
    (body) =>
      window.cloudConflictResolutionPanelFixture.advanceLocalGeneration(
        "note-stale",
        body,
        true,
      ),
    updatedLocal1,
  );

  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toHaveCount(0);
  await expect(
    region.getByRole("alert", { name: "Resolution notice" }),
  ).toContainText("This note changed on this device before confirmation");
  await expect(textarea).toHaveValue(manualMerged);
  await expect(
    region
      .getByRole("article", { name: "Draft on this device" })
      .locator(".cloud-conflict-resolution-body"),
  ).toHaveText(updatedLocal1);

  // User makes a fresh explicit choice, then store generation advances BEFORE UI refresh -> CAS refuses stale generation.
  await region.getByRole("button", { name: "Combine text" }).click();
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toBeVisible();
  await page.evaluate(
    (body) =>
      window.cloudConflictResolutionPanelFixture.advanceLocalGeneration(
        "note-stale",
        body,
        false,
      ),
    updatedLocal2,
  );

  await region.getByRole("button", { name: "Confirm resolution" }).click();
  await expect(
    region.getByRole("alert", { name: "Resolution notice" }),
  ).toContainText("This note changed on this device before confirmation");
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toHaveCount(0);
  expect(mutations(label).length).toBe(countBeforeStale);
  await expect(textarea).toHaveValue(manualMerged);
  await expect(
    region
      .getByRole("article", { name: "Draft on this device" })
      .locator(".cloud-conflict-resolution-body"),
  ).toHaveText(updatedLocal2);

  // Open note in CloudLibraryOwners -> resolving returns busy, preserves manual text, then succeeds after putAway.
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.openNoteOwner("note-stale"),
  );
  await region.getByRole("button", { name: "Combine text" }).click();
  await region.getByRole("button", { name: "Confirm resolution" }).click();

  await expect(
    region.getByRole("alert", { name: "Resolution notice" }),
  ).toHaveText(
    "This note is currently open or busy in another Cloud view. Put away the open note first; any manual combined text was preserved.",
  );
  expect(mutations(label).length).toBe(countBeforeStale);
  await expect(textarea).toHaveValue(manualMerged);

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.putAwayNoteOwner("note-stale"),
  );
  await region.getByRole("button", { name: "Combine text" }).click();
  await expect(textarea).toHaveValue(manualMerged);
  await region.getByRole("button", { name: "Confirm resolution" }).click();

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Saved in Cloud");
  expect((await server.head(0, "note-stale")).snapshot?.bodyMarkdown).toBe(
    manualMerged,
  );
});

test("recovers lost replies, 401 session revocation and new 409 conflicts via explicit bounded Retry upload", async ({
  browser,
  baseURL,
}) => {
  const label = "retry-and-recovery",
    { harness } = await openHarness(browser, baseURL!, label, 0),
    { page, proxyLabel } = harness,
    region = panelRegion(page);

  // 1. Lost reply preserves Pending upload and replays identical opId/contentHash on explicit Retry upload click.
  const localLost = "# Lost ACK local choice",
    remoteLost = "# Lost ACK observed remote";
  await seedActiveConflict(page, 0, "note-lost-ack", localLost, remoteLost);

  server.setSwitch(label, { lose: 1 });
  await region.getByRole("button", { name: "Keep device version" }).click();
  await region.getByRole("button", { name: "Confirm resolution" }).click();

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Pending upload");
  await expect(
    region.getByRole("alert", { name: "Resolution notice" }),
  ).toContainText("Cloud upload paused before confirmation");
  await expect(region).not.toContainText("Saved in Cloud");

  const durablePending = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readDurableState(
      "note-lost-ack",
    ),
  );
  expect(durablePending?.inFlight).not.toBeNull();
  const retainedOpId = durablePending!.inFlight!.opId,
    retainedHash = durablePending!.inFlight!.contentHash,
    sentAfterLost = mutations(label);
  const firstAttempt = sentAfterLost.at(-1)!;
  expect(firstAttempt.opId).toBe(retainedOpId);
  expect(firstAttempt.contentHash).toBe(retainedHash);

  // No automatic background retry loop occurs before clicking Retry upload.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(mutations(label).length).toBe(sentAfterLost.length);

  server.setSwitch(label, { hold: true });
  const retryButton = region.getByRole("button", { name: "Retry upload" });
  await retryButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => server.held(label)).toBe(1);
  expect(mutations(label).length).toBe(sentAfterLost.length + 1);
  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Pending upload — Saving to Cloud...");

  server.release(label);
  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Saved in Cloud");
  const replayedAttempt = mutations(label).at(-1)!;
  expect(replayedAttempt.opId).toBe(retainedOpId);
  expect(replayedAttempt.contentHash).toBe(retainedHash);
  expect(replayedAttempt.replayed).toBe(true);

  // 2. 401 session revocation -> sign-in-required -> fresh authenticated session retries retained Pending upload.
  const local401 = "# Retained across 401 reauth",
    remote401 = "# Remote before 401";
  await seedActiveConflict(page, 0, "note-401", local401, remote401);

  server.revokeSession(label);
  await region.getByRole("button", { name: "Keep device version" }).click();
  await region.getByRole("button", { name: "Confirm resolution" }).click();

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Pending upload");
  await expect(
    region.getByRole("alert", { name: "Resolution notice" }),
  ).toHaveText(
    "Sign in again to upload this retained Cloud resolution. Your chosen version remains Pending upload on this device.",
  );

  const pending401 = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readDurableState("note-401"),
  );
  const opId401 = pending401!.inFlight!.opId,
    hash401 = pending401!.inFlight!.contentHash;

  const reauthLabel = "reauthenticated-session",
    reissued = await server.openSession(reauthLabel, 0);
  sensitive.push(reissued.csrfToken, reissued.cookie.split("=")[1]);
  proxyLabel.current = reauthLabel;
  await page.evaluate(
    (token) =>
      window.cloudConflictResolutionPanelFixture.createAndPrepare(token, true),
    reissued.csrfToken,
  );
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNote("note-401"),
  );

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Pending upload");
  await region.getByRole("button", { name: "Retry upload" }).click();
  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Saved in Cloud");

  const reauthSent = mutations(reauthLabel).at(-1)!;
  expect(reauthSent.opId).toBe(opId401);
  expect(reauthSent.contentHash).toBe(hash401);
  expect((await server.head(0, "note-401")).snapshot?.bodyMarkdown).toBe(
    local401,
  );

  // 3. Newer third-writer 409 during resolve keeps status as Conflict with newly observed revision 3.
  const local409 = "# Device resolution candidate",
    remote409Rev2 = "# Remote revision 2",
    remote409Rev3 = "# Third writer revision 3";
  trackSecretText(remote409Rev3);
  await seedActiveConflict(page, 0, "note-new-409", local409, remote409Rev2);
  await server.seedNote(0, "note-new-409", remote409Rev3);

  await region.getByRole("button", { name: "Keep device version" }).click();
  await region.getByRole("button", { name: "Confirm resolution" }).click();

  await expect(
    region.getByRole("alert", { name: "Resolution notice" }),
  ).toContainText("Cloud reported a newer conflicting revision");
  await expect(
    region.getByRole("article", { name: "Observed Cloud version" }),
  ).toContainText("Observed Cloud revision 3 (cached on this device)");
  await expect(
    region
      .getByRole("article", { name: "Observed Cloud version" })
      .locator(".cloud-conflict-resolution-body"),
  ).toHaveText(remote409Rev3);
});

test("enforces lifecycle restoration acknowledgements, destructive local purge confirmation and remote permanent purge refusal", async ({
  browser,
  baseURL,
}) => {
  const label = "lifecycle-and-purge",
    { harness } = await openHarness(browser, baseURL!, label, 0),
    { page } = harness,
    region = panelRegion(page);

  // 1. Device choice restoring an observed In Trash version requires explicit acknowledgement and omits Combine text.
  const trashLocal = "# Active local draft restoring trashed note",
    trashRemote = "# Moved to Trash on phone";
  trackSecretText(trashLocal, trashRemote);
  await server.seedNote(0, "note-trash-restore", "# Base before trash");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.download(),
  );
  await server.trashNote(0, "note-trash-restore", trashRemote);
  expect(
    await page.evaluate(
      (body) =>
        window.cloudConflictResolutionPanelFixture.submitDirectMutation({
          noteId: "note-trash-restore",
          kind: "upsert",
          bodyMarkdown: body,
          state: "active",
        }),
      trashLocal,
    ),
  ).toBe(409);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNote("note-trash-restore"),
  );

  await expect(
    region.getByRole("article", { name: "Observed Cloud version" }),
  ).toContainText("Observed Cloud state: In Trash");
  await expect(
    region.getByRole("button", { name: "Combine text" }),
  ).toHaveCount(0);

  await region.getByRole("button", { name: "Keep device version" }).click();
  const confirmTrash = region.getByRole("button", {
    name: "Confirm resolution",
  });
  await expect(confirmTrash).toBeDisabled();
  await region
    .getByRole("checkbox", {
      name: "I understand this restores a note that was moved to Trash in the observed Cloud version.",
    })
    .check();
  await expect(confirmTrash).toBeEnabled();
  await confirmTrash.click();

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Saved in Cloud");
  const restoredFromTrash = await server.head(0, "note-trash-restore");
  expect(restoredFromTrash.revision).toBe(3);
  expect(restoredFromTrash.snapshot?.state).toBe("active");

  // 2. Device choice restoring an observed Archived version requires explicit acknowledgement and omits Combine text.
  const archiveLocal = "# Active local draft restoring archived note",
    archiveRemote = "# Archived on tablet";
  trackSecretText(archiveLocal, archiveRemote);
  await server.seedNote(0, "note-archive-restore", "# Base before archive");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.download(),
  );
  const rev1Head = await server.head(0, "note-archive-restore");
  await page.evaluate(
    (args) =>
      window.cloudConflictResolutionPanelFixture.writeRemoteRevision({
        noteId: "note-archive-restore",
        baseSnapshot: args.baseSnapshot,
        bodyMarkdown: args.bodyMarkdown,
        state: "archived",
      }),
    {
      baseSnapshot: rev1Head.snapshot!,
      bodyMarkdown: archiveRemote,
    },
  );
  expect(
    await page.evaluate(
      (body) =>
        window.cloudConflictResolutionPanelFixture.submitDirectMutation({
          noteId: "note-archive-restore",
          kind: "upsert",
          bodyMarkdown: body,
          state: "active",
        }),
      archiveLocal,
    ),
  ).toBe(409);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNote("note-archive-restore"),
  );

  await expect(
    region.getByRole("article", { name: "Observed Cloud version" }),
  ).toContainText("Observed Cloud state: Archived");
  await expect(
    region.getByRole("button", { name: "Combine text" }),
  ).toHaveCount(0);

  await region.getByRole("button", { name: "Keep device version" }).click();
  const confirmArchive = region.getByRole("button", {
    name: "Confirm resolution",
  });
  await expect(confirmArchive).toBeDisabled();
  await region
    .getByRole("checkbox", {
      name: "I understand this restores a note that was archived in the observed Cloud version.",
    })
    .check();
  await expect(confirmArchive).toBeEnabled();
  await confirmArchive.click();

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Saved in Cloud");
  expect((await server.head(0, "note-archive-restore")).snapshot?.state).toBe(
    "active",
  );

  // 3. Queued local permanent purge requires destructive confirmation and deletes in Cloud.
  const remoteAlive = "# Kept alive on another client";
  trackSecretText(remoteAlive);
  await server.seedNote(0, "note-local-purge", "# Base before local purge");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.download(),
  );
  await server.seedNote(0, "note-local-purge", remoteAlive);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.submitDirectMutation({
        noteId: "note-local-purge",
        kind: "purge",
      }),
    ),
  ).toBe(409);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNote("note-local-purge"),
  );

  await expect(
    region.getByRole("article", { name: "Draft on this device" }),
  ).toContainText("Local state: Permanent purge queued");
  await expect(
    region.getByRole("button", { name: "Combine text" }),
  ).toHaveCount(0);
  await region.getByRole("button", { name: "Keep device version" }).click();
  const destructiveBox = region.getByRole("region", {
    name: "Confirm chosen version",
  });
  await expect(destructiveBox).toHaveAttribute("data-destructive", "true");
  await expect(destructiveBox).toContainText("Destructive action:");
  await destructiveBox
    .getByRole("button", { name: "Confirm resolution" })
    .click();

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Deleted in Cloud");
  expect((await server.head(0, "note-local-purge")).kind).toBe("purged");

  // 4. Purged remote identity refuses old-ID resurrection, preserves recoverable text + fake clipboard copy, and accepts deletion cleanly.
  const recoverableDraft = "# Recoverable local draft after remote purge";
  trackSecretText(recoverableDraft);
  await server.seedNote(0, "note-remote-purge", "# Base before remote purge");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.download(),
  );
  await server.purgeNote(0, "note-remote-purge");
  expect(
    await page.evaluate(
      (body) =>
        window.cloudConflictResolutionPanelFixture.submitDirectMutation({
          noteId: "note-remote-purge",
          kind: "upsert",
          bodyMarkdown: body,
          state: "active",
        }),
      recoverableDraft,
    ),
  ).toBe(409);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNote("note-remote-purge"),
  );

  await expect(
    region.getByRole("article", { name: "Observed Cloud version" }),
  ).toContainText("Observed Cloud state: Permanently purged in Cloud");
  await expect(
    region
      .getByRole("article", { name: "Draft on this device" })
      .locator(".cloud-conflict-resolution-body"),
  ).toHaveText(recoverableDraft);
  await expect(
    region.getByRole("button", { name: "Keep device version" }),
  ).toHaveCount(0);
  await expect(
    region.getByRole("button", { name: "Combine text" }),
  ).toHaveCount(0);
  await expect(region).toContainText(
    "cannot be resurrected or combined under the old ID",
  );

  await region.getByRole("button", { name: "Copy draft text" }).click();
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.copiedCalls(),
    ),
  ).toEqual([recoverableDraft]);

  const countBeforeAcceptPurge = mutations(label).length;
  await region
    .getByRole("button", { name: "Use observed Cloud version" })
    .click();
  const acceptPurgeBox = region.getByRole("region", {
    name: "Confirm chosen version",
  });
  await expect(acceptPurgeBox).toHaveAttribute("data-destructive", "true");
  await acceptPurgeBox
    .getByRole("button", { name: "Confirm resolution" })
    .click();

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Deleted in Cloud");
  expect(mutations(label).length).toBe(countBeforeAcceptPurge);
  expect((await server.head(0, "note-remote-purge")).kind).toBe("purged");
});

test("refuses malformed bindings and getters with zero owner or store calls, hides old content immediately across identity or abort transitions and preserves caller-owned stores", async ({
  browser,
  baseURL,
}) => {
  const labelA = "account-a-session",
    labelB = "account-b-session",
    { harness } = await openHarness(browser, baseURL!, labelA, 0),
    { page, proxyLabel } = harness,
    region = panelRegion(page);

  const accountALocal = "# Account A private conflict draft",
    accountARemote = "# Account A observed remote",
    accountBLocal = "# Account B isolated conflict draft",
    accountBRemote = "# Account B observed remote";

  await seedActiveConflict(
    page,
    0,
    "shared-note-id",
    accountALocal,
    accountARemote,
  );
  await expect(region).toContainText(accountALocal);

  // Prepare Account B (session index 1) in the same harness so we can test cross-account switching and foreign-owners rejection.
  const issuedB = await server.openSession(labelB, 1);
  sensitive.push(issuedB.csrfToken, issuedB.cookie.split("=")[1]);
  proxyLabel.current = labelB;
  const indexB = await page.evaluate(
    (token) =>
      window.cloudConflictResolutionPanelFixture.createAndPrepare(token, false),
    issuedB.csrfToken,
  );
  expect(indexB).toBe(1);

  trackSecretText(accountBLocal, accountBRemote);
  await server.seedNote(1, "shared-note-id", "# Account B base");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.download(1),
  );
  await server.seedNote(1, "shared-note-id", accountBRemote);
  expect(
    await page.evaluate(
      (body) =>
        window.cloudConflictResolutionPanelFixture.submitDirectMutation({
          noteId: "shared-note-id",
          kind: "upsert",
          bodyMarkdown: body,
          state: "active",
          index: 1,
        }),
      accountBLocal,
    ),
  ).toBe(409);

  proxyLabel.current = labelA;
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.selectSession(
      0,
      "shared-note-id",
    ),
  );
  await expect(region).toContainText(accountALocal);

  const presets = [
    "null-context",
    "null-owners",
    "plain-fake-owners",
    "foreign-owners",
    "mismatched-store",
    "mismatched-scope-owner",
    "mismatched-scope-collection",
    "mismatched-scope-generation",
    "mismatched-signal",
    "pre-aborted-signal",
    "invalid-note-id",
    "newline-note-id",
    "props-getter",
    "context-getter",
    "scope-getter",
    "owners-getter",
  ] as const;

  for (const preset of presets) {
    await page.evaluate(() => {
      window.cloudConflictResolutionPanelFixture.setMalformedPreset(null);
      window.cloudConflictResolutionPanelFixture.setRefreshKeyOverride(null);
    });
    await expect(region).toContainText(accountALocal);

    const before = await page.evaluate(() => ({
      reads0: window.cloudConflictResolutionPanelFixture.readCount(0),
      reads1: window.cloudConflictResolutionPanelFixture.readCount(1),
      conflicts0: window.cloudConflictResolutionPanelFixture.conflictsCount(0),
      conflicts1: window.cloudConflictResolutionPanelFixture.conflictsCount(1),
      subs0: window.cloudConflictResolutionPanelFixture.subscribeCount(0),
      subs1: window.cloudConflictResolutionPanelFixture.subscribeCount(1),
    }));

    await page.evaluate(
      (kind) =>
        window.cloudConflictResolutionPanelFixture.setMalformedPreset(kind),
      preset,
    );

    await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
    await expect(region.getByRole("article")).toHaveCount(0);
    await expect(region.getByRole("button")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(accountALocal);

    const after = await page.evaluate(() => ({
      reads0: window.cloudConflictResolutionPanelFixture.readCount(0),
      reads1: window.cloudConflictResolutionPanelFixture.readCount(1),
      conflicts0: window.cloudConflictResolutionPanelFixture.conflictsCount(0),
      conflicts1: window.cloudConflictResolutionPanelFixture.conflictsCount(1),
      subs0: window.cloudConflictResolutionPanelFixture.subscribeCount(0),
      subs1: window.cloudConflictResolutionPanelFixture.subscribeCount(1),
    }));
    expect(after).toEqual(before);
    expect(
      await page.evaluate(() =>
        window.cloudConflictResolutionPanelFixture.getterCalls(),
      ),
      preset,
    ).toBe(0);
  }

  for (const invalidRefresh of [-1, 1.5]) {
    await page.evaluate(() => {
      window.cloudConflictResolutionPanelFixture.setMalformedPreset(null);
      window.cloudConflictResolutionPanelFixture.setRefreshKeyOverride(null);
    });
    await expect(region).toContainText(accountALocal);
    const readsBefore = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readCount(0),
    );
    await page.evaluate(
      (bad) =>
        window.cloudConflictResolutionPanelFixture.setRefreshKeyOverride(bad),
      invalidRefresh,
    );
    await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
    expect(
      await page.evaluate(() =>
        window.cloudConflictResolutionPanelFixture.readCount(0),
      ),
    ).toBe(readsBefore);
  }

  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.getterCalls(),
    ),
  ).toBe(0);

  // In-place scope mutation immediately invalidates identity and hides old content.
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.setRefreshKeyOverride(null);
    window.cloudConflictResolutionPanelFixture.selectSession(
      0,
      "shared-note-id",
    );
  });
  await expect(region).toContainText(accountALocal);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.mutateDisplayedScopeInPlace({
      ownerSubject: "mutated-in-place-subject",
    }),
  );
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(page.locator("body")).not.toContainText(accountALocal);

  // Immediate synchronous hiding on account switch while new account read is held, and late old-account read refusal.
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.selectSession(
      0,
      "shared-note-id",
    ),
  );
  await expect(region).toContainText(accountALocal);

  const switchedSnapshot = await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.holdReads(1);
    window.cloudConflictResolutionPanelFixture.selectSession(
      1,
      "shared-note-id",
    );
    const section = document.querySelector(".cloud-conflict-resolution-panel")!;
    return {
      text: section.textContent ?? "",
      busy: section.getAttribute("aria-busy"),
      articles: section.querySelectorAll("article").length,
    };
  });
  expect(switchedSnapshot.text).not.toContain(accountALocal);
  expect(switchedSnapshot.text).toContain(
    "Loading Cloud conflict resolution...",
  );
  expect(switchedSnapshot.busy).toBe("true");
  expect(switchedSnapshot.articles).toBe(0);

  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldReadCount() === 1,
  );
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseReads(false),
  );
  await expect(region).toContainText(accountBLocal);
  await expect(region).not.toContainText(accountALocal);

  // Hold Account B read, switch back to Account A, release Account B read with failure -> Account A stays intact.
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.holdReads(1);
    window.cloudConflictResolutionPanelFixture.refresh();
  });
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldReadCount() === 1,
  );
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.selectSession(
      0,
      "shared-note-id",
    ),
  );
  await expect(region).toContainText(accountALocal);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseReads(true),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region).toContainText(accountALocal);
  await expect(region.getByRole("alert")).toHaveCount(0);

  // Account replacement during a held resolve network send hides old account immediately and ignores late reply.
  proxyLabel.current = labelB;
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.selectSession(
      1,
      "shared-note-id",
    ),
  );
  await expect(region).toContainText(accountBLocal);
  server.setSwitch(labelB, { hold: true });
  await region.getByRole("button", { name: "Keep device version" }).click();
  await region.getByRole("button", { name: "Confirm resolution" }).click();
  await expect.poll(() => server.held(labelB)).toBe(1);
  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Pending upload — Saving to Cloud...");

  proxyLabel.current = labelA;
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.selectSession(
      0,
      "shared-note-id",
    ),
  );
  await expect(region).toContainText(accountALocal);
  await expect(region).not.toContainText(accountBLocal);
  server.release(labelB);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region).toContainText(accountALocal);
  await expect(region).not.toContainText("Resolution confirmed");

  // Abort during a held resolve network send immediately hides content without promising rollback or closing caller stores.
  proxyLabel.current = labelA;
  server.setSwitch(labelA, { hold: true });
  await region.getByRole("button", { name: "Keep device version" }).click();
  await region.getByRole("button", { name: "Confirm resolution" }).click();
  await expect.poll(() => server.held(labelA)).toBe(1);

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.abortSession(0),
  );
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("alert")).not.toContainText("were not changed");
  await expect(page.locator("body")).not.toContainText(accountALocal);
  server.release(labelA);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.closeCounts(),
    ),
  ).toEqual([0, 0]);

  // Read failure on Account B renders fixed unavailable alert without leaking internal error text.
  proxyLabel.current = labelB;
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.selectSession(
      1,
      "shared-note-id",
    );
    window.cloudConflictResolutionPanelFixture.failReads(1);
    window.cloudConflictResolutionPanelFixture.refresh();
  });
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(page.locator("body")).not.toContainText("synthetic-private");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failReads(null),
  );
});

test("preserves Back-to-notes focus across mount and refreshes, renders untrusted HTML literally and supports keyboard and responsive 1280x800 and 390x844 layouts", async ({
  browser,
  baseURL,
}, testInfo) => {
  const label = "a11y-and-layout",
    { harness } = await openHarness(browser, baseURL!, label, 0),
    { page } = harness,
    region = panelRegion(page);

  await page.setViewportSize({ width: 1280, height: 800 });

  const untrustedLocal =
      '<script>window.__pwnedResolutionLocal = true</script>\n<img src=x onerror="window.__pwnedResolutionImg=1">\n**Literal** `markdown` 原文',
    untrustedRemote =
      '<svg onload="window.__pwnedResolutionRemote = true"></svg>\n# Heading stays literal\n' +
      "LONGTOKEN_".repeat(22);

  await seedActiveConflict(
    page,
    0,
    "note-layout",
    untrustedLocal,
    untrustedRemote,
  );

  // Focus Back to notes and verify background refreshes and remounts never steal focus.
  const backButton = page.getByRole("button", { name: "Back to notes" });
  await backButton.focus();
  await expect(backButton).toBeFocused();
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.refresh(),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(backButton).toBeFocused();
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.unmountPanel();
    window.cloudConflictResolutionPanelFixture.remountPanel();
  });
  await expect(
    region.getByRole("article", { name: "Draft on this device" }),
  ).toBeVisible();
  await expect(backButton).toBeFocused();

  // Literal HTML/Markdown safety check.
  const localCard = region.getByRole("article", {
      name: "Draft on this device",
    }),
    remoteCard = region.getByRole("article", {
      name: "Observed Cloud version",
    });
  await expect(
    localCard.locator("pre.cloud-conflict-resolution-body"),
  ).toHaveText(untrustedLocal);
  await expect(
    remoteCard.locator("pre.cloud-conflict-resolution-body"),
  ).toHaveText(untrustedRemote);
  expect(await region.locator("img, svg, script").count()).toBe(0);
  expect(
    await page.evaluate(() => ({
      local: Reflect.get(window, "__pwnedResolutionLocal"),
      img: Reflect.get(window, "__pwnedResolutionImg"),
      remote: Reflect.get(window, "__pwnedResolutionRemote"),
    })),
  ).toEqual({
    local: undefined,
    img: undefined,
    remote: undefined,
  });

  // Desktop 1280x800 geometry, target sizes and standalone screenshot.
  await region.getByRole("button", { name: "Keep device version" }).click();
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toBeVisible();

  const localBoxDesktop = await localCard.boundingBox(),
    remoteBoxDesktop = await remoteCard.boundingBox(),
    keepBtnDesktop = await region
      .getByRole("button", { name: "Keep device version" })
      .boundingBox(),
    confirmBtnDesktop = await region
      .getByRole("button", { name: "Confirm resolution" })
      .boundingBox();
  expect(localBoxDesktop).not.toBeNull();
  expect(remoteBoxDesktop).not.toBeNull();
  expect(remoteBoxDesktop!.x).toBeGreaterThanOrEqual(
    localBoxDesktop!.x + localBoxDesktop!.width - 1,
  );
  expect(keepBtnDesktop!.width).toBeGreaterThanOrEqual(24);
  expect(keepBtnDesktop!.height).toBeGreaterThanOrEqual(36);
  expect(confirmBtnDesktop!.width).toBeGreaterThanOrEqual(24);
  expect(confirmBtnDesktop!.height).toBeGreaterThanOrEqual(36);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);

  await page.screenshot({
    path: testInfo.outputPath("conflict-resolution-panel-desktop.png"),
    fullPage: true,
  });

  // Narrow 390x844 geometry, >= 40px touch target heights, dark mode parity and standalone screenshot.
  await page.setViewportSize({ width: 390, height: 844 });
  const localBoxMobile = await localCard.boundingBox(),
    remoteBoxMobile = await remoteCard.boundingBox(),
    keepBtnMobile = await region
      .getByRole("button", { name: "Keep device version" })
      .boundingBox(),
    confirmBtnMobile = await region
      .getByRole("button", { name: "Confirm resolution" })
      .boundingBox();
  expect(remoteBoxMobile!.y).toBeGreaterThanOrEqual(
    localBoxMobile!.y + localBoxMobile!.height - 1,
  );
  expect(keepBtnMobile!.width).toBeGreaterThanOrEqual(24);
  expect(keepBtnMobile!.height).toBeGreaterThanOrEqual(40);
  expect(confirmBtnMobile!.width).toBeGreaterThanOrEqual(24);
  expect(confirmBtnMobile!.height).toBeGreaterThanOrEqual(40);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: testInfo.outputPath("conflict-resolution-panel-mobile.png"),
    fullPage: true,
  });

  await page.emulateMedia({ colorScheme: "dark" });
  const darkSurface = await region.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(darkSurface).not.toBe("rgb(255, 254, 250)");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  // Full keyboard-only cancel and resolution flow.
  const cancelBtn = region.getByRole("button", { name: "Cancel choice" });
  await cancelBtn.focus();
  await page.keyboard.press("Enter");
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toHaveCount(0);

  const keepBtn = region.getByRole("button", { name: "Keep device version" });
  await keepBtn.focus();
  await page.keyboard.press("Space");
  const confirmBtn = region.getByRole("button", { name: "Confirm resolution" });
  await confirmBtn.focus();
  await page.keyboard.press("Enter");

  await expect(
    region.getByRole("status", { name: "Resolution status" }),
  ).toHaveText("Saved in Cloud");
});

test("clears an earlier success notice when a newer generation becomes Pending", async ({
  browser,
  baseURL,
}) => {
  const label = "newer-generation-notice",
    { harness } = await openHarness(browser, baseURL!, label, 0),
    { page } = harness,
    region = panelRegion(page);
  for (const choice of ["Keep device version", "Use observed Cloud version"]) {
    const id =
      choice === "Keep device version"
        ? "newer-after-device"
        : "newer-after-cloud";
    const local = "Earlier device version",
      remote = "Earlier observed version",
      newer = "Newer locally retained text";
    trackSecretText(local, remote, newer);
    await seedActiveConflict(page, 0, id, local, remote);
    await region.getByRole("button", { name: choice, exact: true }).click();
    await region
      .getByRole("button", { name: "Confirm resolution", exact: true })
      .click();
    await expect(
      region.getByRole("status", { name: "Resolution status", exact: true }),
    ).toHaveText("Saved in Cloud");
    await expect(
      region.getByRole("status", { name: "Resolution notice", exact: true }),
    ).toBeVisible();
    const before = mutations(label).length,
      serverBefore = await server.head(0, id);
    await page.evaluate(
      ([noteId, body]) =>
        window.cloudConflictResolutionPanelFixture.advanceLocalGeneration(
          noteId,
          body,
          true,
        ),
      [id, newer],
    );
    await expect(
      region.getByRole("status", { name: "Resolution status", exact: true }),
    ).toHaveText("Pending upload");
    await expect(
      region.getByRole("status", { name: "Resolution notice", exact: true }),
    ).toHaveCount(0);
    const durable = await page.evaluate(
      (noteId) =>
        window.cloudConflictResolutionPanelFixture.readDurableState(noteId),
      id,
    );
    expect(durable?.pending?.kind).toBe("upsert");
    expect(durable?.inFlight).toBeNull();
    expect(await server.head(0, id)).toEqual(serverBefore);
    expect(mutations(label)).toHaveLength(before);
  }
});

test("preserves manual combined text including empty text across read and pre-commit write failures and restores conflict view on explicit Retry loading conflict", async ({
  browser,
  baseURL,
}) => {
  const label = "manual-unavailable-recovery",
    { harness } = await openHarness(browser, baseURL!, label, 0),
    { page } = harness,
    region = panelRegion(page);

  // 1. Store read failure during Confirm resolution preserves novel manual text, fake clipboard copy and original durable branches.
  const localRead = "# Architecture draft\n- Local offline notes",
    remoteRead = "# Architecture draft\n- Observed remote notes",
    novelManual =
      "# Architecture draft\n- Hand-combined novel recovery text ##keep";
  trackSecretText(localRead, remoteRead, novelManual);
  await seedActiveConflict(
    page,
    0,
    "manual-read-recovery",
    localRead,
    remoteRead,
  );

  const durableBeforeReadFail = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readDurableState(
        "manual-read-recovery",
      ),
    ),
    serverBeforeReadFail = await server.head(0, "manual-read-recovery"),
    mutationsBeforeReadFail = mutations(label).length;

  await region
    .getByRole("button", { name: "Combine text", exact: true })
    .click();
  await region
    .getByLabel("Combined note text", { exact: true })
    .fill(novelManual);

  const readsBeforeConfirm = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readCount(0),
  );
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failReads(0),
  );
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();

  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(page.locator("body")).not.toContainText("synthetic-private");
  await expect(region).not.toContainText("Saved in Cloud");
  await expect(region).not.toContainText("were not changed");
  await expect(region.getByRole("article")).toHaveCount(0);
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toHaveCount(0);

  const preservedTextbox = region.getByRole("textbox", {
    name: "Preserved manual combined text",
    exact: true,
  });
  await expect(preservedTextbox).toHaveValue(novelManual);
  await expect(preservedTextbox).toHaveAttribute("readonly", "");

  // Confirm uses the controller and its owner-release notification. Establish
  // the settled failure boundary before measuring the explicit one-read retry.
  const readsAfterConfirm = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readCount(0),
  );
  expect(readsAfterConfirm).toBeGreaterThan(readsBeforeConfirm);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readCount(0),
    ),
  ).toBe(readsAfterConfirm);
  expect(mutations(label)).toHaveLength(mutationsBeforeReadFail);

  // Guarded fake clipboard lifecycle (held/denied then succeeded) while unavailable.
  const copyCombinedBtn = region.getByRole("button", {
    name: "Copy combined text",
    exact: true,
  });
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.holdClipboard(true),
  );
  await copyCombinedBtn.click();
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldClipboardCount() === 1,
  );
  await expect(copyCombinedBtn).toBeDisabled();
  await expect(copyCombinedBtn).toHaveAttribute("data-busy", "true");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseAllClipboard(true),
  );
  await expect(
    region.locator(".cloud-conflict-resolution-copy-error"),
  ).toHaveText(
    "Could not copy combined text. Select the text below to copy it manually.",
  );
  await expect(preservedTextbox).toHaveValue(novelManual);

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.clearCopiedCalls(),
  );
  await copyCombinedBtn.click();
  await expect(
    region.getByRole("status", {
      name: "Combined text copy status",
      exact: true,
    }),
  ).toHaveText("Combined text copied to clipboard.");
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.copiedCalls(),
    ),
  ).toEqual([novelManual]);
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);

  // Repeated load failure performs strictly one cache read, sends zero mutations and keeps manual recovery available.
  const retryLoadBtn = region.getByRole("button", {
    name: "Retry loading conflict",
    exact: true,
  });
  await retryLoadBtn.click();
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(preservedTextbox).toHaveValue(novelManual);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readCount(0),
    ),
  ).toBe(readsAfterConfirm + 1);
  expect(mutations(label)).toHaveLength(mutationsBeforeReadFail);

  // Clearing store read failure does not auto-reload or auto-resolve; original durable branches remain intact.
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failReads(null),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(preservedTextbox).toHaveValue(novelManual);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readCount(0),
    ),
  ).toBe(readsAfterConfirm + 1);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readDurableState(
        "manual-read-recovery",
      ),
    ),
  ).toEqual(durableBeforeReadFail);
  expect(await server.head(0, "manual-read-recovery")).toEqual(
    serverBeforeReadFail,
  );

  // The independent durable-state assertion above also reads the store.
  // Measure the explicit retry from its own immediate boundary.
  const readsBeforeSuccessfulReload = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readCount(0),
  );
  // Explicit Retry loading conflict performs one cache read, restores current view + manual text, clears old proposal and requires fresh choice.
  await retryLoadBtn.click();
  await expect(
    region
      .getByRole("article", { name: "Draft on this device" })
      .locator(".cloud-conflict-resolution-body"),
  ).toHaveText(localRead);
  await expect(
    region
      .getByRole("article", { name: "Observed Cloud version" })
      .locator(".cloud-conflict-resolution-body"),
  ).toHaveText(remoteRead);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readCount(0),
    ),
  ).toBe(readsBeforeSuccessfulReload + 1);
  await expect(preservedTextbox).toHaveCount(0);
  await expect(
    region.getByLabel("Combined note text", { exact: true }),
  ).toHaveValue(novelManual);
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toHaveCount(0);
  await expect(
    region.getByRole("button", { name: "Confirm resolution", exact: true }),
  ).toHaveCount(0);
  await expect(
    region.getByRole("button", { name: "Combine text", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(mutations(label)).toHaveLength(mutationsBeforeReadFail);

  await region
    .getByRole("button", { name: "Combine text", exact: true })
    .click();
  await expect(
    region.getByLabel("Combined note text", { exact: true }),
  ).toHaveValue(novelManual);
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    region.getByRole("status", { name: "Resolution status", exact: true }),
  ).toHaveText("Saved in Cloud");
  expect(
    (await server.head(0, "manual-read-recovery")).snapshot?.bodyMarkdown,
  ).toBe(novelManual);

  // 2. Pre-commit store write failure with empty user-entered combined text preserves empty text + Copy combined text and leaves durable branches unchanged.
  const localCommit = "# Scratchpad\n- Non-empty local text",
    remoteCommit = "# Scratchpad\n- Non-empty remote text";
  trackSecretText(localCommit, remoteCommit);
  await seedActiveConflict(
    page,
    0,
    "manual-commit-empty",
    localCommit,
    remoteCommit,
  );
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.clearCopiedCalls(),
  );

  const durableBeforeCommitFail = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readDurableState(
        "manual-commit-empty",
      ),
    ),
    serverBeforeCommitFail = await server.head(0, "manual-commit-empty"),
    mutationsBeforeCommitFail = mutations(label).length;

  await region
    .getByRole("button", { name: "Combine text", exact: true })
    .click();
  const editableCombine = region.getByLabel("Combined note text", {
    exact: true,
  });
  await editableCombine.fill("");
  await expect(editableCombine).toHaveValue("");

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failCommits(0),
  );
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();

  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(page.locator("body")).not.toContainText("synthetic-private");
  await expect(region).not.toContainText("Saved in Cloud");
  await expect(region).not.toContainText("were not changed");
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);

  await expect(preservedTextbox).toHaveValue("");
  await expect(preservedTextbox).toHaveAttribute("readonly", "");
  await region
    .getByRole("button", { name: "Copy combined text", exact: true })
    .click();
  await expect(
    region.getByRole("status", {
      name: "Combined text copy status",
      exact: true,
    }),
  ).toHaveText("Combined text copied to clipboard.");
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.copiedCalls(),
    ),
  ).toEqual([""]);

  expect(mutations(label)).toHaveLength(mutationsBeforeCommitFail);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readDurableState(
        "manual-commit-empty",
      ),
    ),
  ).toEqual(durableBeforeCommitFail);
  expect(await server.head(0, "manual-commit-empty")).toEqual(
    serverBeforeCommitFail,
  );

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failCommits(null),
  );
  const readsBeforeCommitReload = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readCount(0),
  );
  await region
    .getByRole("button", { name: "Retry loading conflict", exact: true })
    .click();
  await expect(
    region.getByLabel("Combined note text", { exact: true }),
  ).toHaveValue("");
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readCount(0),
    ),
  ).toBe(readsBeforeCommitReload + 1);
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toHaveCount(0);
  await expect(
    region.getByRole("button", { name: "Combine text", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(mutations(label)).toHaveLength(mutationsBeforeCommitFail);

  await region
    .getByRole("button", { name: "Combine text", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    region.getByRole("status", { name: "Resolution status", exact: true }),
  ).toHaveText("Saved in Cloud");
  expect(
    (await server.head(0, "manual-commit-empty")).snapshot?.bodyMarkdown,
  ).toBe("");
});

test("hides preserved manual recovery text immediately and suppresses late copy or reload completions across note, account, malformed-binding and abort transitions", async ({
  browser,
  baseURL,
}) => {
  const labelA = "recovery-isolation-a",
    labelB = "recovery-isolation-b",
    { harness } = await openHarness(browser, baseURL!, labelA, 0),
    { page, proxyLabel } = harness,
    region = panelRegion(page);

  const note1LocalA = "# Account A note 1 local",
    note1RemoteA = "# Account A note 1 remote",
    note2LocalA = "# Account A note 2 local",
    note2RemoteA = "# Account A note 2 remote",
    note1LocalB = "# Account B note 1 local",
    note1RemoteB = "# Account B note 1 remote",
    manualNote1Secret = "Account A note 1 preserved manual secret",
    manualAccountSecret = "Account A cross-account preserved manual secret",
    manualAbortSecret = "Account A abort preserved manual secret";
  trackSecretText(
    note1LocalA,
    note1RemoteA,
    note2LocalA,
    note2RemoteA,
    note1LocalB,
    note1RemoteB,
    manualNote1Secret,
    manualAccountSecret,
    manualAbortSecret,
  );

  await seedActiveConflict(
    page,
    0,
    "recovery-note-1",
    note1LocalA,
    note1RemoteA,
  );
  await seedActiveConflict(
    page,
    0,
    "recovery-note-2",
    note2LocalA,
    note2RemoteA,
  );

  const issuedB = await server.openSession(labelB, 1);
  sensitive.push(issuedB.csrfToken, issuedB.cookie.split("=")[1]);
  proxyLabel.current = labelB;
  const indexB = await page.evaluate(
    (token) =>
      window.cloudConflictResolutionPanelFixture.createAndPrepare(token, false),
    issuedB.csrfToken,
  );
  expect(indexB).toBe(1);
  await server.seedNote(1, "recovery-note-1", "# Account B base");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.download(1),
  );
  await server.seedNote(1, "recovery-note-1", note1RemoteB);
  expect(
    await page.evaluate(
      (body) =>
        window.cloudConflictResolutionPanelFixture.submitDirectMutation({
          noteId: "recovery-note-1",
          kind: "upsert",
          bodyMarkdown: body,
          state: "active",
          index: 1,
        }),
      note1LocalB,
    ),
  ).toBe(409);

  // 1. Note replacement immediately hides old note's manual recovery text and suppresses late copy + reload completions.
  proxyLabel.current = labelA;
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.selectSession(
      0,
      "recovery-note-1",
    ),
  );
  await region
    .getByRole("button", { name: "Combine text", exact: true })
    .click();
  await region
    .getByLabel("Combined note text", { exact: true })
    .fill(manualNote1Secret);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failReads(0),
  );
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    region.getByRole("textbox", {
      name: "Preserved manual combined text",
      exact: true,
    }),
  ).toHaveValue(manualNote1Secret);

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.holdClipboard(true),
  );
  await region
    .getByRole("button", { name: "Copy combined text", exact: true })
    .click();
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldClipboardCount() === 1,
  );

  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.failReads(null);
    window.cloudConflictResolutionPanelFixture.holdReads(0);
  });
  await region
    .getByRole("button", { name: "Retry loading conflict", exact: true })
    .click();
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldReadCount() === 1,
  );

  const noteSwitchedSnapshot = await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.setNote("recovery-note-2");
    const section = document.querySelector(".cloud-conflict-resolution-panel")!;
    return {
      text: section.textContent ?? "",
      textboxes: section.querySelectorAll("textarea").length,
    };
  });
  expect(noteSwitchedSnapshot.text).not.toContain(manualNote1Secret);
  expect(noteSwitchedSnapshot.textboxes).toBe(0);

  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.releaseReads(false);
    window.cloudConflictResolutionPanelFixture.releaseAllClipboard(false);
  });
  await expect(region).toContainText(note2LocalA);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.locator("body")).not.toContainText(manualNote1Secret);
  await expect(
    region.getByRole("status", {
      name: "Combined text copy status",
      exact: true,
    }),
  ).toHaveCount(0);

  // 2. Malformed/foreign binding and account replacement immediately hide manual recovery text and suppress late copy + reload completions.
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNote("recovery-note-1"),
  );
  await region
    .getByRole("button", { name: "Combine text", exact: true })
    .click();
  await region
    .getByLabel("Combined note text", { exact: true })
    .fill(manualAccountSecret);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failReads(0),
  );
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    region.getByRole("textbox", {
      name: "Preserved manual combined text",
      exact: true,
    }),
  ).toHaveValue(manualAccountSecret);

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setMalformedPreset(
      "foreign-owners",
    ),
  );
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("textbox")).toHaveCount(0);
  await expect(region.getByRole("button")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(manualAccountSecret);

  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.failReads(null);
    window.cloudConflictResolutionPanelFixture.setMalformedPreset(null);
  });
  await region
    .getByRole("button", { name: "Combine text", exact: true })
    .click();
  await region
    .getByLabel("Combined note text", { exact: true })
    .fill(manualAccountSecret);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failReads(0),
  );
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    region.getByRole("textbox", {
      name: "Preserved manual combined text",
      exact: true,
    }),
  ).toHaveValue(manualAccountSecret);

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.holdClipboard(true),
  );
  await region
    .getByRole("button", { name: "Copy combined text", exact: true })
    .click();
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldClipboardCount() === 1,
  );
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.failReads(null);
    window.cloudConflictResolutionPanelFixture.holdReads(0);
  });
  await region
    .getByRole("button", { name: "Retry loading conflict", exact: true })
    .click();
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldReadCount() === 1,
  );

  proxyLabel.current = labelB;
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.selectSession(
      1,
      "recovery-note-1",
    ),
  );
  await expect(region).toContainText(note1LocalB);
  await expect(page.locator("body")).not.toContainText(manualAccountSecret);
  await expect(
    region.getByRole("textbox", {
      name: "Preserved manual combined text",
      exact: true,
    }),
  ).toHaveCount(0);

  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.releaseReads(false);
    window.cloudConflictResolutionPanelFixture.releaseAllClipboard(false);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region).toContainText(note1LocalB);
  await expect(page.locator("body")).not.toContainText(manualAccountSecret);
  await expect(
    region.getByRole("status", {
      name: "Combined text copy status",
      exact: true,
    }),
  ).toHaveCount(0);

  // 3. In-place signal abort (without parent prop rerender) hides manual recovery text immediately, suppresses late read/copy and never closes caller stores.
  proxyLabel.current = labelA;
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.selectSession(
      0,
      "recovery-note-1",
    ),
  );
  await region
    .getByRole("button", { name: "Combine text", exact: true })
    .click();
  await region
    .getByLabel("Combined note text", { exact: true })
    .fill(manualAbortSecret);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failReads(0),
  );
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    region.getByRole("textbox", {
      name: "Preserved manual combined text",
      exact: true,
    }),
  ).toHaveValue(manualAbortSecret);

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.holdClipboard(true),
  );
  await region
    .getByRole("button", { name: "Copy combined text", exact: true })
    .click();
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldClipboardCount() === 1,
  );
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.failReads(null);
    window.cloudConflictResolutionPanelFixture.holdReads(0);
  });
  await region
    .getByRole("button", { name: "Retry loading conflict", exact: true })
    .click();
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldReadCount() === 1,
  );

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.abortSession(0, false),
  );
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("textbox")).toHaveCount(0);
  await expect(region.getByRole("button")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(manualAbortSecret);

  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.releaseReads(false);
    window.cloudConflictResolutionPanelFixture.releaseAllClipboard(false);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("textbox")).toHaveCount(0);
  await expect(region.getByRole("button")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(manualAbortSecret);
  await expect(page.locator("body")).not.toContainText(
    "Combined text copied to clipboard.",
  );
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.closeCounts(),
    ),
  ).toEqual([0, 0]);
});

async function seedPurgedConflict(
  page: Page,
  accountIndex: number,
  noteId: string,
  localBody: string,
  localState: "active" | "archived" | "trashed" = "active",
  sessionIndex = 0,
) {
  trackSecretText(localBody);
  await server.seedNote(accountIndex, noteId, `# Base for ${noteId}`);
  const downloaded = await page.evaluate(
    (idx) => window.cloudConflictResolutionPanelFixture.download(idx),
    sessionIndex,
  );
  expect(downloaded.kind).toBe("complete");
  await server.purgeNote(accountIndex, noteId);
  const status = await page.evaluate(
    (args) =>
      window.cloudConflictResolutionPanelFixture.submitDirectMutation({
        noteId: args.noteId,
        kind: "upsert",
        bodyMarkdown: args.localBody,
        state: args.localState,
        index: args.sessionIndex,
      }),
    { noteId, localBody, localState, sessionIndex },
  );
  expect(status).toBe(409);
  if (sessionIndex === 0) {
    await page.evaluate(
      (id) => window.cloudConflictResolutionPanelFixture.setNote(id),
      noteId,
    );
  }
}

test("recovers observed purged local drafts (Archived nonempty and In Trash empty text) as fresh Active Pending notes under new IDs with zero Cloud sends, preserving original conflict for separate acceptance and responsive 1280x800 and 390x844 layouts", async ({
  browser,
  baseURL,
}, testInfo) => {
  const label = "purged-new-note-primary",
    { harness } = await openHarness(browser, baseURL!, label, 0),
    { page } = harness,
    region = panelRegion(page);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNewNoteCallbackMode(
      "enabled",
    ),
  );

  // 1. Archived nonempty local draft after permanent remote purge -> fresh Active Pending upload under new noteId, zero Cloud sends, original row intact.
  const archivedLocal =
    "# Purged draft recovered as Active\n- Preserved offline checklist 原文 ##recover";
  await seedPurgedConflict(
    page,
    0,
    "purged-archived-nonempty",
    archivedLocal,
    "archived",
  );

  const localCard = region.getByRole("article", {
      name: "Draft on this device",
    }),
    remoteCard = region.getByRole("article", {
      name: "Observed Cloud version",
    });
  await expect(localCard).toContainText("Local state: Archived");
  await expect(localCard.locator(".cloud-conflict-resolution-body")).toHaveText(
    archivedLocal,
  );
  await expect(remoteCard).toContainText(
    "Observed Cloud state: Permanently purged in Cloud",
  );
  await expect(
    region.getByRole("button", { name: "Keep device version" }),
  ).toHaveCount(0);
  await expect(
    region.getByRole("button", { name: "Combine text" }),
  ).toHaveCount(0);

  const sourceBefore = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readDurableState(
        "purged-archived-nonempty",
      ),
    ),
    activeEntriesBefore = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
    ),
    commitsBeforeProposal = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.commitCount(0),
    ),
    mutationsBefore = mutations(label).length;

  const recoverBtn = region.getByRole("button", {
    name: "Recover as new note",
    exact: true,
  });
  await expect(recoverBtn).toBeVisible();
  await expect(recoverBtn).toHaveAttribute("aria-pressed", "false");
  await recoverBtn.click();
  await expect(recoverBtn).toHaveAttribute("aria-pressed", "true");

  const confirmRegion = region.getByRole("region", {
    name: "Confirm chosen version",
  });
  await expect(confirmRegion).toBeVisible();
  await expect(confirmRegion).toHaveAttribute("data-destructive", "false");
  await expect(confirmRegion).toContainText(
    "fresh Active note under a new note ID",
  );
  await expect(confirmRegion).toContainText("current local state: Archived");
  await expect(confirmRegion).toContainText("Pending upload");
  await expect(confirmRegion).toContainText(
    "Observed Cloud permanent deletion (revision 2) under the old note ID stays unchanged",
  );
  await expect(confirmRegion).toContainText(
    "original conflict recovery draft stays kept",
  );

  // Opening inline confirmation allocates/commits nothing and sends zero Cloud requests.
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.commitCount(0),
    ),
  ).toBe(commitsBeforeProposal);
  expect(mutations(label)).toHaveLength(mutationsBefore);

  // Desktop 1280x800 and narrow 390x844 layout & target-size checks + screenshots.
  const confirmNewBtn = confirmRegion.getByRole("button", {
    name: "Confirm new note recovery",
    exact: true,
  });
  const recoverBoxDesktop = await recoverBtn.boundingBox(),
    confirmBoxDesktop = await confirmNewBtn.boundingBox();
  expect(recoverBoxDesktop!.width).toBeGreaterThanOrEqual(24);
  expect(recoverBoxDesktop!.height).toBeGreaterThanOrEqual(36);
  expect(confirmBoxDesktop!.width).toBeGreaterThanOrEqual(24);
  expect(confirmBoxDesktop!.height).toBeGreaterThanOrEqual(36);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);
  await page.screenshot({
    path: testInfo.outputPath("purged-new-note-panel-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const recoverBoxMobile = await recoverBtn.boundingBox(),
    confirmBoxMobile = await confirmNewBtn.boundingBox();
  expect(recoverBoxMobile!.width).toBeGreaterThanOrEqual(24);
  expect(recoverBoxMobile!.height).toBeGreaterThanOrEqual(40);
  expect(confirmBoxMobile!.width).toBeGreaterThanOrEqual(24);
  expect(confirmBoxMobile!.height).toBeGreaterThanOrEqual(40);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("purged-new-note-panel-mobile.png"),
    fullPage: true,
  });
  await confirmNewBtn.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(
      "purged-new-note-panel-mobile-confirmation-viewport.png",
    ),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1280, height: 800 });

  // Cancel choice performs zero writes or callbacks.
  await confirmRegion
    .getByRole("button", { name: "Cancel choice", exact: true })
    .click();
  await expect(confirmRegion).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.commitCount(0),
    ),
  ).toBe(commitsBeforeProposal);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
    ),
  ).toEqual(activeEntriesBefore);

  // Confirm recovery as new note.
  await recoverBtn.click();
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();

  await expect(
    region.getByRole("status", { name: "Resolution notice", exact: true }),
  ).toContainText(
    "New Active note copy retained on this device as Pending upload",
  );
  await expect(region).not.toContainText("Saved in Cloud");
  await expect(page.locator("body")).not.toContainText("All notes synced");
  await expect(page.locator("body")).not.toContainText("Up to date");
  await expect(page.locator("body")).not.toContainText("Latest");
  await expect(page.locator("body")).not.toContainText("Live");

  // Successful callback does not re-enable duplicate preparation from the same confirmed attempt.
  await expect(recoverBtn).toBeDisabled();
  await expect(
    region.getByRole("button", { name: "Open retained note again" }),
  ).toHaveCount(0);

  const callsAfterArchived = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
  );
  expect(callsAfterArchived).toHaveLength(1);
  const newArchivedNoteId = callsAfterArchived[0].newNoteId;
  expect(callsAfterArchived[0].sessionIndex).toBe(0);
  expect(newArchivedNoteId).not.toBe("purged-archived-nonempty");
  expect(mutations(label)).toHaveLength(mutationsBefore);
  expect((await server.head(0, "purged-archived-nonempty")).kind).toBe(
    "purged",
  );

  // Original conflict row is completely untouched in IndexedDB.
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readDurableState(
        "purged-archived-nonempty",
      ),
    ),
  ).toEqual(sourceBefore);

  // Retained new note row is fresh Active Pending upload at generation 1, baseRevision 0, null trash/origin metadata.
  const retainedArchived = await page.evaluate(
    (id) => window.cloudConflictResolutionPanelFixture.readDurableState(id),
    newArchivedNoteId,
  );
  expect(retainedArchived?.generation).toBe(1);
  expect(retainedArchived?.base).toBeNull();
  expect(retainedArchived?.baseRevision).toBe(0);
  expect(retainedArchived?.inFlight).toBeNull();
  expect(retainedArchived?.conflict).toBeNull();
  expect(retainedArchived?.pending?.kind).toBe("upsert");
  if (retainedArchived?.pending?.kind === "upsert") {
    expect(retainedArchived.pending.snapshot.noteId).toBe(newArchivedNoteId);
    expect(retainedArchived.pending.snapshot.bodyMarkdown).toBe(archivedLocal);
    expect(retainedArchived.pending.snapshot.state).toBe("active");
    expect(retainedArchived.pending.snapshot.deletedAt).toBeNull();
    expect(retainedArchived.pending.snapshot.purgeAfter).toBeNull();
    expect("origin" in retainedArchived.pending.snapshot).toBe(false);
  }
  const activeEntriesAfter = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
  );
  expect(
    activeEntriesAfter.find((entry) => entry.noteId === newArchivedNoteId),
  ).toMatchObject({
    noteId: newArchivedNoteId,
    kind: "active",
    status: "Pending upload",
  });

  // Original observed-purge acceptance remains a separate explicit decision.
  await region
    .getByRole("button", { name: "Use observed Cloud version", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    region.getByRole("status", { name: "Resolution status", exact: true }),
  ).toHaveText("Deleted in Cloud");
  expect(mutations(label)).toHaveLength(mutationsBefore);
  expect(
    await page.evaluate(
      (id) => window.cloudConflictResolutionPanelFixture.readDurableState(id),
      newArchivedNoteId,
    ),
  ).toEqual(retainedArchived);

  // 2. Empty-text In Trash local draft after permanent remote purge -> fresh Active Pending upload with cleared trash timestamps.
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.clearRetainedCallbackCalls(),
  );
  await seedPurgedConflict(page, 0, "purged-trashed-empty", "", "trashed");

  const emptySourceBefore = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.readDurableState(
      "purged-trashed-empty",
    ),
  );
  if (emptySourceBefore?.conflict?.local.kind === "upsert") {
    expect(emptySourceBefore.conflict.local.snapshot.state).toBe("trashed");
    expect(emptySourceBefore.conflict.local.snapshot.deletedAt).not.toBeNull();
    expect(emptySourceBefore.conflict.local.snapshot.purgeAfter).not.toBeNull();
  }

  await expect(localCard).toContainText("Local state: In Trash");
  await expect(localCard).toContainText(
    "This local draft is an empty trashed note with no text.",
  );
  const mutationsBeforeEmpty = mutations(label).length;

  await recoverBtn.click();
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toContainText("current local state: In Trash, empty text");
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();

  await expect(
    region.getByRole("status", { name: "Resolution notice", exact: true }),
  ).toContainText(
    "New Active note copy retained on this device as Pending upload",
  );
  await expect(recoverBtn).toBeDisabled();

  const emptyCalls = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
  );
  expect(emptyCalls).toHaveLength(1);
  const emptyNewId = emptyCalls[0].newNoteId;
  expect(emptyNewId).not.toBe("purged-trashed-empty");
  expect(emptyNewId).not.toBe(newArchivedNoteId);
  expect(mutations(label)).toHaveLength(mutationsBeforeEmpty);

  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.readDurableState(
        "purged-trashed-empty",
      ),
    ),
  ).toEqual(emptySourceBefore);

  const retainedEmpty = await page.evaluate(
    (id) => window.cloudConflictResolutionPanelFixture.readDurableState(id),
    emptyNewId,
  );
  expect(retainedEmpty?.generation).toBe(1);
  expect(retainedEmpty?.base).toBeNull();
  expect(retainedEmpty?.baseRevision).toBe(0);
  expect(retainedEmpty?.inFlight).toBeNull();
  expect(retainedEmpty?.conflict).toBeNull();
  expect(retainedEmpty?.pending?.kind).toBe("upsert");
  if (retainedEmpty?.pending?.kind === "upsert") {
    expect(retainedEmpty.pending.snapshot.noteId).toBe(emptyNewId);
    expect(retainedEmpty.pending.snapshot.bodyMarkdown).toBe("");
    expect(retainedEmpty.pending.snapshot.state).toBe("active");
    expect(retainedEmpty.pending.snapshot.deletedAt).toBeNull();
    expect(retainedEmpty.pending.snapshot.purgeAfter).toBeNull();
    expect("origin" in retainedEmpty.pending.snapshot).toBe(false);
  }
});

test("enforces synchronous latch during held work, refuses stale generations, retains manual recovery text on store failures, retries failed or withheld callback handoff with the same retained ID and refuses omitted, malformed or getter callbacks without newNoteRecovery lookup", async ({
  browser,
  baseURL,
}) => {
  const label = "purged-new-note-guards",
    { harness } = await openHarness(browser, baseURL!, label, 0),
    { page } = harness,
    region = panelRegion(page);

  // 1. Omitted, undefined, malformed and getter callbacks perform zero getter calls and zero newNoteRecovery lookups while preserving safe copy-only purge UX.
  const copyOnlyBody = "# Purged draft under omitted or malformed callback";
  await seedPurgedConflict(page, 0, "purged-callback-modes", copyOnlyBody);

  const refusedModes = [
    "omitted",
    "undefined-data",
    "malformed-null",
    "malformed-string",
    "non-enumerable",
    "callback-getter",
  ] as const;

  for (const mode of refusedModes) {
    await page.evaluate(
      (nextMode) =>
        window.cloudConflictResolutionPanelFixture.setNewNoteCallbackMode(
          nextMode,
        ),
      mode,
    );
    await expect(region).toContainText(copyOnlyBody);
    await expect(
      region.getByRole("button", { name: "Recover as new note" }),
    ).toHaveCount(0);
    await expect(region).toContainText(
      "Copy your preserved draft text above to create a new note separately",
    );
    expect(
      await page.evaluate(() =>
        window.cloudConflictResolutionPanelFixture.getterCalls(),
      ),
      mode,
    ).toBe(0);
    expect(
      await page.evaluate(() =>
        window.cloudConflictResolutionPanelFixture.newNoteRecoveryCount(0),
      ),
      mode,
    ).toBe(0);
  }

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.clearCopiedCalls(),
  );
  await region.getByRole("button", { name: "Copy draft text" }).click();
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.copiedCalls(),
    ),
  ).toEqual([copyOnlyBody]);

  // Enabling valid callback on non-purged conflicts never offers Recover as new note.
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNewNoteCallbackMode(
      "enabled",
    ),
  );
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.newNoteRecoveryCount(0),
    ),
  ).toBe(1);
  await seedActiveConflict(
    page,
    0,
    "non-purged-active",
    "# Local active",
    "# Remote active",
  );
  await expect(
    region.getByRole("button", { name: "Recover as new note" }),
  ).toHaveCount(0);

  // 2. One synchronous latch covers held prepare read + held callback handoff against duplicate clicks.
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.clearRetainedCallbackCalls();
    window.cloudConflictResolutionPanelFixture.setNote("purged-callback-modes");
  });
  await expect(region).toContainText(copyOnlyBody);

  const notesBeforeLatch = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
    ),
    commitsBeforeLatch = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.commitCount(0),
    );

  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.holdReads(0);
    window.cloudConflictResolutionPanelFixture.holdNewNoteHandoff(true);
  });

  const confirmLatchBtn = region.getByRole("button", {
    name: "Confirm new note recovery",
    exact: true,
  });
  await confirmLatchBtn.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldReadCount() === 1,
  );
  await expect(confirmLatchBtn).toBeDisabled();
  await expect(confirmLatchBtn).toHaveAttribute("data-busy", "true");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseReads(false),
  );

  await page.waitForFunction(
    () =>
      window.cloudConflictResolutionPanelFixture.heldNewNoteHandoffCount() ===
      1,
  );
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
    ),
  ).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.commitCount(0),
    ),
  ).toBe(commitsBeforeLatch + 1);
  await expect(
    region.getByRole("button", { name: "Use observed Cloud version" }),
  ).toBeDisabled();

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseNewNoteHandoffs(false),
  );
  await expect(
    region.getByRole("button", { name: "Recover as new note", exact: true }),
  ).toBeDisabled();
  const notesAfterLatch = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
  );
  expect(notesAfterLatch).toHaveLength(notesBeforeLatch.length + 1);

  // 3. Stale generation refusal, busy open-note lock and unavailable store failures preserve manual combined text and copy only the model-selected device snapshot.
  const manualBuffer =
      "# Manual combined buffer preserved across purge ##manual",
    purgedSnap0 = "# Device snapshot v0 after remote purge",
    purgedSnap1 = "# Device snapshot v1 background refresh",
    purgedSnap2 = "# Device snapshot v2 unrefreshed store write";
  trackSecretText(manualBuffer, purgedSnap0, purgedSnap1, purgedSnap2);

  await seedActiveConflict(
    page,
    0,
    "purged-stale-and-unavailable",
    "# Pre-purge local",
    "# Pre-purge remote",
  );
  await region
    .getByRole("button", { name: "Combine text", exact: true })
    .click();
  await region
    .getByLabel("Combined note text", { exact: true })
    .fill(manualBuffer);

  await server.purgeNote(0, "purged-stale-and-unavailable");
  // The note already has a conflict. Retain its newer device branch, then
  // explicitly choose it through the existing UI to observe the server purge.
  await page.evaluate(
    (body) =>
      window.cloudConflictResolutionPanelFixture.advanceLocalGeneration(
        "purged-stale-and-unavailable",
        body,
        true,
      ),
    purgedSnap0,
  );
  await region
    .getByRole("button", { name: "Keep device version", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm resolution", exact: true })
    .click();
  await expect(
    region.getByRole("article", { name: "Observed Cloud version" }),
  ).toContainText("Permanently purged in Cloud");
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.clearRetainedCallbackCalls(),
  );

  const preservedTextbox = region.getByRole("textbox", {
    name: "Preserved manual combined text",
    exact: true,
  });
  await expect(preservedTextbox).toHaveValue(manualBuffer);

  // 3a. Background generation advance retires open Recover as new note confirmation.
  const notesBeforeStale = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
  );
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toBeVisible();
  await page.evaluate(
    (body) =>
      window.cloudConflictResolutionPanelFixture.advanceLocalGeneration(
        "purged-stale-and-unavailable",
        body,
        true,
      ),
    purgedSnap1,
  );
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toHaveCount(0);
  await expect(
    region.getByRole("alert", { name: "Resolution notice" }),
  ).toContainText("This note changed on this device before confirmation");
  await expect(preservedTextbox).toHaveValue(manualBuffer);

  // 3b. Unrefreshed concurrent generation advance before Confirm click returns stale without allocating a new note.
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await page.evaluate(
    (body) =>
      window.cloudConflictResolutionPanelFixture.advanceLocalGeneration(
        "purged-stale-and-unavailable",
        body,
        false,
      ),
    purgedSnap2,
  );
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await expect(
    region.getByRole("alert", { name: "Resolution notice" }),
  ).toContainText("This note changed on this device before confirmation");
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toHaveCount(0);
  await expect(preservedTextbox).toHaveValue(manualBuffer);
  await expect(
    region
      .getByRole("article", { name: "Draft on this device" })
      .locator(".cloud-conflict-resolution-body"),
  ).toHaveText(purgedSnap2);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
    ),
  ).toEqual(notesBeforeStale);

  // 3c. Busy open-note lock refuses preparation and preserves manual text.
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.openNoteOwner(
      "purged-stale-and-unavailable",
    ),
  );
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await expect(
    region.getByRole("alert", { name: "Resolution notice" }),
  ).toHaveText(
    "This note is currently open or busy in another Cloud view. Put away the open note first; any manual combined text was preserved.",
  );
  await expect(preservedTextbox).toHaveValue(manualBuffer);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.putAwayNoteOwner(
      "purged-stale-and-unavailable",
    ),
  );

  // 3d. Pre-commit store failure enters unavailable without rollback claims and preserves manual text + fake clipboard copy.
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.clearCopiedCalls();
    window.cloudConflictResolutionPanelFixture.failCommits(0);
  });
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region).not.toContainText("were not changed");
  await expect(region).not.toContainText("Saved in Cloud");
  await expect(preservedTextbox).toHaveValue(manualBuffer);
  await region
    .getByRole("button", { name: "Copy combined text", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.copiedCalls(),
    ),
  ).toEqual([manualBuffer]);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
    ),
  ).toEqual(notesBeforeStale);

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failCommits(null),
  );
  await region
    .getByRole("button", { name: "Retry loading conflict", exact: true })
    .click();
  await expect(preservedTextbox).toHaveValue(manualBuffer);
  await expect(
    region.getByRole("region", { name: "Confirm chosen version" }),
  ).toHaveCount(0);

  // Fresh proposal after recovery copies the model-selected device snapshot (purgedSnap2), never manualBuffer.
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await expect(
    region.getByRole("status", { name: "Resolution notice", exact: true }),
  ).toContainText(
    "New Active note copy retained on this device as Pending upload",
  );
  const postUnavailableCalls = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
  );
  expect(postUnavailableCalls).toHaveLength(1);
  const snap2Retained = await page.evaluate(
    (id) => window.cloudConflictResolutionPanelFixture.readDurableState(id),
    postUnavailableCalls[0].newNoteId,
  );
  expect(snap2Retained?.pending?.kind).toBe("upsert");
  if (snap2Retained?.pending?.kind === "upsert") {
    expect(snap2Retained.pending.snapshot.bodyMarkdown).toBe(purgedSnap2);
    expect(snap2Retained.pending.snapshot.bodyMarkdown).not.toBe(manualBuffer);
  }
  await expect(preservedTextbox).toHaveValue(manualBuffer);

  // 4. Callback rejection remembers retained ID and Open retained note again retries with the SAME ID and zero extra prepare/commit calls.
  const retryOpenBody = "# Retained note awaiting same-ID open retry";
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.clearRetainedCallbackCalls(),
  );
  await seedPurgedConflict(page, 0, "purged-open-retry", retryOpenBody);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failNewNoteHandoffs(1),
  );

  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();

  await expect(
    region.getByRole("alert", { name: "Resolution notice", exact: true }),
  ).toContainText(
    "New Active note copy is durably retained on this device as Pending upload",
  );
  await expect(page.locator("body")).not.toContainText("synthetic-private");
  await expect(
    region.getByRole("button", { name: "Recover as new note", exact: true }),
  ).toBeDisabled();

  const failedOpenCalls = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
  );
  expect(failedOpenCalls).toHaveLength(1);
  const rememberedId = failedOpenCalls[0].newNoteId;
  const commitsAfterFirstPrepare = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.commitCount(0),
    ),
    notesAfterFirstPrepare = await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
    );

  const openAgainBtn = region.getByRole("button", {
    name: "Open retained note again",
    exact: true,
  });
  await expect(openAgainBtn).toBeVisible();
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.holdNewNoteHandoff(true),
  );
  await openAgainBtn.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await page.waitForFunction(
    () =>
      window.cloudConflictResolutionPanelFixture.heldNewNoteHandoffCount() ===
      1,
  );
  await expect(openAgainBtn).toBeDisabled();
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseNewNoteHandoffs(false),
  );

  await expect(openAgainBtn).toHaveCount(0);
  await expect(
    region.getByRole("status", { name: "Resolution notice", exact: true }),
  ).toContainText(
    "New Active note copy retained on this device as Pending upload",
  );
  await expect(
    region.getByRole("button", { name: "Recover as new note", exact: true }),
  ).toBeDisabled();

  const retriedOpenCalls = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
  );
  expect(retriedOpenCalls).toHaveLength(2);
  expect(retriedOpenCalls[1].newNoteId).toBe(rememberedId);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.commitCount(0),
    ),
  ).toBe(commitsAfterFirstPrepare);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.listLibraryNotes("notes"),
    ),
  ).toEqual(notesAfterFirstPrepare);

  // 5. Callback rotation/omission while prepare is pending withholds automatic handoff while keeping same-binding explicit open reachable.
  const rotatedBody = "# Purged draft with rotated callback during prepare";
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.clearRetainedCallbackCalls(),
  );
  await seedPurgedConflict(page, 0, "purged-rotated-callback", rotatedBody);

  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.holdReads(0),
  );
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldReadCount() === 1,
  );
  const rotatedSlot = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.rotateNewNoteCallback(),
  );
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseReads(false),
  );

  await expect(
    region.getByRole("status", { name: "Resolution notice", exact: true }),
  ).toContainText("Automatic opening was withheld");
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
    ),
  ).toEqual([]);

  const commitsAfterWithheld = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.commitCount(0),
  );
  // Temporarily omitting callback hides Open retained note again without discarding retained state on the same account/note.
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNewNoteCallbackMode(
      "omitted",
    ),
  );
  await expect(
    region.getByRole("button", { name: "Open retained note again" }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setNewNoteCallbackMode(
      "enabled",
    ),
  );
  await region
    .getByRole("button", { name: "Open retained note again", exact: true })
    .click();

  const withheldExplicitCalls = await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
  );
  expect(withheldExplicitCalls).toHaveLength(1);
  expect(withheldExplicitCalls[0].slot).toBe(rotatedSlot);
  expect(withheldExplicitCalls[0].sessionIndex).toBe(0);
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.commitCount(0),
    ),
  ).toBe(commitsAfterWithheld);
});

test("hides old text and retained IDs synchronously and suppresses late new-note preparation or callback completions across account, note, malformed-binding and signal-abort transitions", async ({
  browser,
  baseURL,
}) => {
  const labelA = "new-note-isolation-a",
    labelB = "new-note-isolation-b",
    { harness } = await openHarness(browser, baseURL!, labelA, 0),
    { page, proxyLabel } = harness,
    region = panelRegion(page);

  const draftA1 = "# Account A purged isolation secret 1",
    draftA2 = "# Account A purged isolation secret 2",
    draftA3 = "# Account A purged isolation secret 3",
    draftB1 = "# Account B purged isolation secret 1";

  await seedPurgedConflict(page, 0, "iso-purged-1", draftA1, "active", 0);
  await seedPurgedConflict(page, 0, "iso-purged-2", draftA2, "active", 0);
  await seedPurgedConflict(page, 0, "iso-purged-3", draftA3, "active", 0);

  const issuedB = await server.openSession(labelB, 1);
  sensitive.push(issuedB.csrfToken, issuedB.cookie.split("=")[1]);
  proxyLabel.current = labelB;
  const indexB = await page.evaluate(
    (token) =>
      window.cloudConflictResolutionPanelFixture.createAndPrepare(token, false),
    issuedB.csrfToken,
  );
  expect(indexB).toBe(1);
  await seedPurgedConflict(page, 1, "iso-purged-1", draftB1, "active", 1);

  proxyLabel.current = labelA;
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.setNewNoteCallbackMode(
      "enabled",
    );
    window.cloudConflictResolutionPanelFixture.selectSession(0, "iso-purged-1");
  });
  await expect(region).toContainText(draftA1);

  // 1. Account switch during held prepare read hides Account A synchronously and never invokes Account A or Account B handler.
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.holdReads(0),
  );
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await page.waitForFunction(
    () => window.cloudConflictResolutionPanelFixture.heldReadCount() === 1,
  );

  proxyLabel.current = labelB;
  const switchedAccountDom = await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.selectSession(1, "iso-purged-1");
    const section = document.querySelector(".cloud-conflict-resolution-panel")!;
    return section.textContent ?? "";
  });
  expect(switchedAccountDom).not.toContain(draftA1);

  await expect(region).toContainText(draftB1);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseReads(false),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.retainedCallbackCalls(),
    ),
  ).toEqual([]);
  await expect(region).toContainText(draftB1);
  await expect(page.locator("body")).not.toContainText(draftA1);
  await expect(
    region.getByRole("button", { name: "Open retained note again" }),
  ).toHaveCount(0);

  // 2. Account switch during held callback handoff suppresses late rejection/notice on Account B.
  proxyLabel.current = labelA;
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.clearRetainedCallbackCalls();
    window.cloudConflictResolutionPanelFixture.selectSession(0, "iso-purged-1");
  });
  await expect(region).toContainText(draftA1);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.holdNewNoteHandoff(true),
  );
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.cloudConflictResolutionPanelFixture.heldNewNoteHandoffCount() ===
      1,
  );

  proxyLabel.current = labelB;
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.selectSession(1, "iso-purged-1"),
  );
  await expect(region).toContainText(draftB1);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseNewNoteHandoffs(true),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region).toContainText(draftB1);
  await expect(region.getByRole("alert")).toHaveCount(0);
  await expect(
    region.getByRole("button", { name: "Open retained note again" }),
  ).toHaveCount(0);

  // 3. Note replacement and foreign-owners binding replacement hide Open retained note again synchronously and suppress late retry completions.
  proxyLabel.current = labelA;
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.clearRetainedCallbackCalls();
    window.cloudConflictResolutionPanelFixture.selectSession(0, "iso-purged-2");
    window.cloudConflictResolutionPanelFixture.failNewNoteHandoffs(1);
  });
  await expect(region).toContainText(draftA2);
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await expect(
    region.getByRole("button", {
      name: "Open retained note again",
      exact: true,
    }),
  ).toBeVisible();

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.holdNewNoteHandoff(true),
  );
  await region
    .getByRole("button", { name: "Open retained note again", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.cloudConflictResolutionPanelFixture.heldNewNoteHandoffCount() ===
      1,
  );

  const noteSwitchedDom = await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.setNote("iso-purged-3");
    const section = document.querySelector(".cloud-conflict-resolution-panel")!;
    return section.textContent ?? "";
  });
  expect(noteSwitchedDom).not.toContain(draftA2);
  expect(noteSwitchedDom).not.toContain("Open retained note again");

  await expect(region).toContainText(draftA3);
  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseNewNoteHandoffs(false),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region).toContainText(draftA3);
  await expect(
    region.getByRole("button", { name: "Recover as new note", exact: true }),
  ).toBeEnabled();

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.failNewNoteHandoffs(1),
  );
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await expect(
    region.getByRole("button", {
      name: "Open retained note again",
      exact: true,
    }),
  ).toBeVisible();

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.setMalformedPreset(
      "foreign-owners",
    ),
  );
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("button")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(draftA3);

  // 4. In-place signal abort during held callback handoff hides content immediately without rollback claims or closing caller stores.
  proxyLabel.current = labelB;
  await page.evaluate(() => {
    window.cloudConflictResolutionPanelFixture.setMalformedPreset(null);
    window.cloudConflictResolutionPanelFixture.selectSession(1, "iso-purged-1");
    window.cloudConflictResolutionPanelFixture.holdNewNoteHandoff(true);
  });
  await expect(region).toContainText(draftB1);
  await region
    .getByRole("button", { name: "Recover as new note", exact: true })
    .click();
  await region
    .getByRole("button", { name: "Confirm new note recovery", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.cloudConflictResolutionPanelFixture.heldNewNoteHandoffCount() ===
      1,
  );

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.abortSession(1, false),
  );
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("alert")).not.toContainText("were not changed");
  await expect(region.getByRole("button")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(draftB1);

  await page.evaluate(() =>
    window.cloudConflictResolutionPanelFixture.releaseNewNoteHandoffs(true),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("button")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("synthetic-private");
  expect(
    await page.evaluate(() =>
      window.cloudConflictResolutionPanelFixture.closeCounts(),
    ),
  ).toEqual([0, 0]);
});
