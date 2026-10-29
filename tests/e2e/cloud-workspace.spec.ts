import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { startCloudUploadServer } from "../fixtures/cloud-upload-server";
import { cloudScope } from "../fixtures/cloud-durable-contract";
import type {} from "../fixtures/cloud-workspace";

let server: Awaited<ReturnType<typeof startCloudUploadServer>>;
const pageErrors: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  server = await startCloudUploadServer(new URL(baseURL!).origin, {
    ...cloudScope,
    ownerSubject: "synthetic-workspace-owner-b",
  });
  pageErrors.length = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(
    (config) => {
      Reflect.set(window, "syntheticWorkspaceConfig", config);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            Reflect.set(window, "syntheticCopiedText", text);
          },
        },
      });
    },
    { api: server.api, contexts: server.contexts },
  );
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-workspace.html")}?db=peel-m0-cloud-workspace-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudWorkspaceFixture);
});

test.afterEach(async ({ page }) => {
  server.release();
  if (!page.isClosed()) {
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).some((db) => db.name === "peel-local-v1"),
      ),
    ).toBe(false);
    await page.evaluate(() => window.cloudWorkspaceFixture.destroy());
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  }
  await server.close();
  expect(pageErrors).toEqual([]);
});

test("browses cached collections safely, opens original ID, autosaves via HTTP and confirms after Put away", async ({
  page,
  playwright,
}) => {
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  await expect(library.getByRole("listitem")).toHaveCount(3);
  await expect(library).not.toContainText("Account A private body");
  await expect(library).toContainText(
    '<img src=x onerror="window.pwned=true">',
  );
  expect(await page.locator("img").count()).toBe(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "pwned")),
  ).toBeUndefined();

  await library.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(library.getByRole("listitem")).toHaveCount(1);
  await expect(library).toContainText("Archived workspace note");
  await expect(library.getByRole("button", { name: /^Open / })).toHaveCount(0);

  await library.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(library).toContainText("Trashed workspace note");

  await library.getByRole("button", { name: "Notes", exact: true }).click();
  await library
    .getByRole("button", { name: "Open Account A workspace note" })
    .click();

  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  const editor = editorArticle.getByRole("textbox", { name: "Note text" });
  await expect(editor).toContainText("Account A private body ##work");
  await expect(editorArticle.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^save$/i })).toHaveCount(0);
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");
  const committedBeforeEdit = server.control.committed;

  server.control.hold = true;
  await editor.fill(
    "# Updated in Cloud workspace\nConfirmed after editor view closes ##work",
  );
  await expect
    .poll(() => server.control.committed)
    .toBe(committedBeforeEdit + 1);
  await expect(editorArticle.getByRole("status")).toHaveText("Pending upload");

  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle).toHaveCount(0);

  expect(
    await page.evaluate(() => window.cloudWorkspaceFixture.putAways()),
  ).toEqual([
    {
      owner: 0,
      noteId: "shared-note",
      retained: true,
      matchedSession: true,
    },
  ]);

  const updatedCard = library
    .getByRole("listitem")
    .filter({ hasText: "Updated in Cloud workspace" });
  await expect(updatedCard).toContainText("Pending upload");

  const apiClient = await playwright.request.newContext();
  try {
    const ownerA = server.contexts[0];
    const responseA = await apiClient.get(
      server.api + "/v1/notes/shared-note",
      {
        headers: {
          "x-synthetic-fixture": ownerA.token,
          "x-peel-collection": ownerA.scope.collectionId,
          "x-peel-mode-generation": String(ownerA.scope.modeGeneration),
        },
      },
    );
    expect((await responseA.json()).head.snapshot.bodyMarkdown).toBe(
      "# Updated in Cloud workspace\nConfirmed after editor view closes ##work",
    );

    const ownerB = server.contexts[1];
    const responseB = await apiClient.get(
      server.api + "/v1/notes/shared-note",
      {
        headers: {
          "x-synthetic-fixture": ownerB.token,
          "x-peel-collection": ownerB.scope.collectionId,
          "x-peel-mode-generation": String(ownerB.scope.modeGeneration),
        },
      },
    );
    expect((await responseB.json()).head.kind).toBe("missing");
  } finally {
    await apiClient.dispose();
  }

  server.release();
  await expect(updatedCard).toContainText("Saved in Cloud");
});

test("discards untouched new captures without rows and flushes retained drafts on split-view note switch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const library = page.getByRole("region", { name: "Cached Cloud library" });

  await library.getByRole("button", { name: "New note", exact: true }).click();
  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  await expect(editorArticle.locator(".cm-placeholder")).toBeVisible();
  const untouchedId = await page.evaluate(() =>
    window.cloudWorkspaceFixture.latestNoteId(0),
  );
  expect(untouchedId).toBeTruthy();

  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle).toHaveCount(0);
  expect(
    await page.evaluate(
      (id) => window.cloudWorkspaceFixture.readState(0, id!),
      untouchedId,
    ),
  ).toBeNull();
  await expect(library.getByRole("listitem")).toHaveCount(3);
  await expect(
    library.getByRole("button", { name: "New note", exact: true }),
  ).toBeFocused();

  await library.getByRole("button", { name: "New note", exact: true }).click();
  const createdId = await page.evaluate(() =>
    window.cloudWorkspaceFixture.latestNoteId(0),
  );
  expect(createdId).not.toBe(untouchedId);

  server.control.hold = true;
  const editor = editorArticle.getByRole("textbox", { name: "Note text" });
  await editor.fill(
    "# Split switch draft\nRetained before opening another note",
  );

  await library
    .getByRole("button", { name: "Open Second cached note" })
    .click();
  await expect(editor).toContainText("Body for split switch verification");

  const createdCard = library
    .getByRole("listitem")
    .filter({ hasText: "Split switch draft" });
  await expect(createdCard).toContainText("Pending upload");

  server.release();
  await expect(createdCard).toContainText("Saved in Cloud");
});

test("failed retention, 401 upload pause and failed owner Put away keep editor recoverable without private leaks", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  await library
    .getByRole("button", { name: "Open Account A workspace note" })
    .click();

  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  const editor = editorArticle.getByRole("textbox", { name: "Note text" });
  await expect(editor).toContainText("Account A private body ##work");
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");

  server.control.unauthorized = true;
  await editor.fill("Keep pending text through 401 failure");
  await expect(editorArticle.getByRole("alert")).toContainText("Sign in again");
  await expect(editorArticle.getByRole("status")).toHaveText("Pending upload");
  server.control.unauthorized = false;
  await editorArticle.getByRole("button", { name: "Retry upload" }).click();
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.failRetention(0, true),
  );
  await editor.fill("Recoverable text after aborted retention");
  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle.getByRole("alert")).toContainText(
    "Could not retain draft",
  );
  await expect(editorArticle.getByRole("alert")).not.toContainText(
    "synthetic private",
  );
  await expect(editor).toHaveAttribute("contenteditable", "true");

  await library
    .getByRole("button", { name: "Open Second cached note" })
    .click();
  await expect(editor).toContainText(
    "Recoverable text after aborted retention",
  );

  await editorArticle.getByRole("button", { name: "Copy text" }).click();
  expect(
    await page.evaluate(() => Reflect.get(window, "syntheticCopiedText")),
  ).toBe("Recoverable text after aborted retention");

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.failRetention(0, false),
  );
  await editorArticle
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(editorArticle.getByRole("alert")).toHaveCount(0);
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");

  await page.evaluate(() => window.cloudWorkspaceFixture.failPutAway(true));
  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle.getByRole("alert")).toContainText(
    "Could not put away this note",
  );
  await expect(editorArticle.getByRole("alert")).not.toContainText(
    "synthetic private",
  );

  await page.evaluate(() => window.cloudWorkspaceFixture.failPutAway(false));
  await editorArticle
    .getByRole("button", { name: "Retry", exact: true })
    .click();
  await expect(editorArticle).toHaveCount(0);
  await expect(
    library.getByRole("button", {
      name: "Open Recoverable text after aborted retention",
    }),
  ).toBeVisible();
});

test("hides old account content immediately, ignores stale callbacks and preserves retained owners", async ({
  page,
}) => {
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  await library
    .getByRole("button", { name: "Open Account A workspace note" })
    .click();

  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  const editor = editorArticle.getByRole("textbox", { name: "Note text" });
  await expect(editor).toContainText("Account A private body ##work");
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");

  server.control.hold = true;
  await editor.fill(
    "# Account A retained before switch\nConfidential Account A body",
  );
  await expect
    .poll(async () => {
      const state = await page.evaluate(() =>
        window.cloudWorkspaceFixture.readState(0, "shared-note"),
      );
      return state?.current?.kind === "upsert"
        ? state.current.snapshot.bodyMarkdown
        : null;
    })
    .toContain("Confidential Account A body");

  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle).toHaveCount(0);

  await page.evaluate(() => window.cloudWorkspaceFixture.holdOpen(0));
  await library
    .getByRole("button", { name: "Open Second cached note" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.cloudWorkspaceFixture.heldOpens().length),
    )
    .toBe(1);

  await page.evaluate(() => window.cloudWorkspaceFixture.selectAccount(1));
  await expect(library).toContainText("Account B workspace note");
  await expect(page.locator("body")).not.toContainText("Account A");
  await expect(page.locator("body")).not.toContainText(
    "Confidential Account A body",
  );

  await page.evaluate(() => window.cloudWorkspaceFixture.releaseOpens(true));
  server.release();
  await expect(page.locator("body")).not.toContainText("Account A");
  await expect(page.locator("body")).not.toContainText("synthetic private");
  await expect(page.getByRole("alert")).toHaveCount(0);

  expect(
    await page.evaluate(() =>
      window.cloudWorkspaceFixture.retainedOwnersCount(0),
    ),
  ).toBe(1);
  const preservedA = await page.evaluate(() =>
    window.cloudWorkspaceFixture.readState(0, "shared-note"),
  );
  expect(
    preservedA?.current?.kind === "upsert"
      ? preservedA.current.snapshot.bodyMarkdown
      : null,
  ).toBe("# Account A retained before switch\nConfidential Account A body");

  await page.evaluate(() => window.cloudWorkspaceFixture.holdOpen(1));
  await library
    .getByRole("button", { name: "Open Account B workspace note" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.cloudWorkspaceFixture.heldOpens().length),
    )
    .toBe(1);
  await library.getByRole("button", { name: "New note", exact: true }).click();
  await expect(editorArticle.locator(".cm-placeholder")).toBeVisible();
  await page.evaluate(() => window.cloudWorkspaceFixture.releaseOpens(true));
  await expect(editorArticle.locator(".cm-placeholder")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await editor.fill("Account B active draft");
  await page.evaluate(() => window.cloudWorkspaceFixture.setInvalidRefresh());
  await expect(editorArticle).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Account B active draft",
  );
  await expect(library.getByRole("status")).toHaveText(
    "Cached Cloud library unavailable",
  );

  await page.evaluate(() => window.cloudWorkspaceFixture.refresh());
  await expect(library).toContainText("Account B workspace note");

  await page.evaluate(() => window.cloudWorkspaceFixture.failOpen(1));
  await library
    .getByRole("button", { name: "Open Account B workspace note" })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not open this cached note. Your drafts remain on this device.",
  );
  await expect(page.getByRole("alert")).not.toContainText("synthetic private");
  await page.evaluate(() => window.cloudWorkspaceFixture.failOpen(null));

  await library
    .getByRole("button", { name: "Open Account B workspace note" })
    .click();
  await expect(editor).toContainText("Account B workspace note");
  await page.evaluate(() => window.cloudWorkspaceFixture.setInvalidScope(true));
  await expect(editorArticle).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveText(
    "Cached Cloud library unavailable",
  );

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.setInvalidScope(false),
  );
  await library
    .getByRole("button", { name: "Open Account B workspace note" })
    .click();
  await expect(editor).toContainText("Account B workspace note");
  await page.evaluate(() => window.cloudWorkspaceFixture.abortCurrent());
  await expect(editorArticle).toHaveCount(0);
  await expect(library.getByRole("status")).toHaveText(
    "Cached Cloud library unavailable",
  );
});

test("supports keyboard focus, Escape preservation and responsive desktop and 390px layouts", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  const openCard = library.getByRole("button", {
    name: "Open Account A workspace note",
  });
  await openCard.focus();
  await expect(openCard).toBeFocused();
  await page.keyboard.press("Enter");

  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  const editor = editorArticle.getByRole("textbox", { name: "Note text" });
  await expect(editor).toBeFocused();
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");

  const libraryBox = await page
      .locator(".cloud-workspace-library")
      .boundingBox(),
    editorPaneBox = await page.locator(".cloud-workspace-editor").boundingBox(),
    putAwayButton = editorArticle.getByRole("button", {
      name: "Put away note",
    });
  expect(libraryBox).not.toBeNull();
  expect(editorPaneBox).not.toBeNull();
  expect(editorPaneBox!.x).toBeGreaterThanOrEqual(
    libraryBox!.x + libraryBox!.width - 1,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);
  expect(
    await putAwayButton.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe("rgb(98, 197, 107)");
  await expect(putAwayButton).toHaveText("−");

  const desktopShot = testInfo.outputPath("workspace-desktop-split.png");
  await page.screenshot({ path: desktopShot });

  await page.keyboard.press("Escape");
  await expect(editorArticle).toBeVisible();
  await editor.fill("# Keyboard workspace note\nPut away via shortcut");

  await editor.dispatchEvent("keydown", {
    key: "w",
    ctrlKey: true,
    bubbles: true,
  });
  await expect(editorArticle).toHaveCount(0);

  const renamedCard = library.getByRole("button", {
    name: "Open Keyboard workspace note",
  });
  await expect(renamedCard).toBeVisible();
  await expect(
    library
      .getByRole("listitem")
      .filter({ hasText: "Keyboard workspace note" }),
  ).toContainText("Saved in Cloud");
  await expect(renamedCard).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  const newButtonFont = await library
    .getByRole("button", { name: "New note", exact: true })
    .evaluate((element) => getComputedStyle(element).fontSize);
  expect(parseFloat(newButtonFont)).toBeGreaterThanOrEqual(12);
  const navBox = await library.getByRole("navigation").boundingBox(),
    statusBox = await library.getByRole("status").boundingBox();
  expect(statusBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: testInfo.outputPath("workspace-mobile-library.png"),
  });

  await renamedCard.click();
  await expect(editor).toBeFocused();
  await expect(page.locator(".cloud-workspace-library")).toHaveAttribute(
    "inert",
    "",
  );
  const mobileEditorBox = await editorArticle.boundingBox(),
    mobileCloseBox = await putAwayButton.boundingBox();
  expect(mobileEditorBox!.width).toBe(390);
  expect(mobileEditorBox!.height).toBe(844);
  expect(mobileCloseBox!.width).toBeGreaterThanOrEqual(24);
  expect(mobileCloseBox!.height).toBeGreaterThanOrEqual(24);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: testInfo.outputPath("workspace-mobile-editor.png"),
  });

  await putAwayButton.click();
  await expect(editorArticle).toHaveCount(0);
  await expect(page.locator(".cloud-workspace-library")).not.toHaveAttribute(
    "inert",
  );
  await expect(renamedCard).toBeFocused();
});

test("coalesces concurrent library-switch and Put-away closure through one retained parent callback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });

  await library
    .getByRole("button", { name: "Open Account A workspace note", exact: true })
    .click();
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");
  const before = await page.evaluate(
    () => window.cloudWorkspaceFixture.putAways().length,
  );

  await page.evaluate(() => window.cloudWorkspaceFixture.holdCommit(0));
  await editorArticle
    .getByRole("textbox", { name: "Note text" })
    .fill("Concurrent closure retained source");
  await page.waitForFunction(
    () => window.cloudWorkspaceFixture.heldCommits() > 0,
  );

  await library
    .getByRole("button", { name: "Open Second cached note", exact: true })
    .click();
  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await page.evaluate(() => window.cloudWorkspaceFixture.releaseCommits());

  await expect
    .poll(() =>
      page.evaluate(() => window.cloudWorkspaceFixture.putAways().length),
    )
    .toBeGreaterThan(before);
  expect(
    await page.evaluate(() => window.cloudWorkspaceFixture.putAways().length),
  ).toBe(before + 1);
  expect(
    await page.evaluate(() => window.cloudWorkspaceFixture.putAways().at(-1)),
  ).toEqual({
    owner: 0,
    noteId: "shared-note",
    retained: true,
    matchedSession: true,
  });
});

test("uses neutral New-note focus fallback instead of focusing another note with a duplicate title", async ({
  page,
}) => {
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  const duplicateLabel = "Open Account A workspace note";

  await library
    .getByRole("button", { name: duplicateLabel, exact: true })
    .click();
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");
  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle).toHaveCount(0);

  await library.getByRole("button", { name: "New note", exact: true }).click();
  await editorArticle
    .getByRole("textbox", { name: "Note text" })
    .fill(
      "Account A workspace note\nA different newer note with a duplicate title",
    );
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");
  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle).toHaveCount(0);

  const duplicates = library.getByRole("button", {
    name: duplicateLabel,
    exact: true,
  });
  await expect(duplicates).toHaveCount(2);

  await duplicates.nth(1).click();
  await expect(
    editorArticle.getByRole("textbox", { name: "Note text" }),
  ).toContainText("Account A private body");
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");
  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle).toHaveCount(0);

  await expect(duplicates.nth(0)).not.toBeFocused();
  await expect(
    library.getByRole("button", { name: "New note", exact: true }),
  ).toBeFocused();
});

test("renders fixed truthful copy for all five optional connection states without automatic callbacks or Save buttons", async ({
  page,
}) => {
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  const connectionBanner = page.locator(".cloud-workspace-connection");
  const connectionText = page.locator(".cloud-workspace-connection-text");

  await expect(connectionBanner).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry sync" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign in again" })).toHaveCount(
    0,
  );

  const states = [
    {
      kind: "cached" as const,
      copy: "Showing notes cached on this device.",
      retryCount: 0,
      signInCount: 0,
    },
    {
      kind: "syncing" as const,
      copy: "Syncing with Cloud\u2026",
      retryCount: 0,
      signInCount: 0,
    },
    {
      kind: "offline" as const,
      copy: "Offline. New edits stay pending on this device.",
      retryCount: 0,
      signInCount: 0,
    },
    {
      kind: "paused" as const,
      copy: "Cloud sync is paused. Your pending drafts remain on this device.",
      retryCount: 1,
      signInCount: 0,
    },
    {
      kind: "sign-in-required" as const,
      copy: "Sign in again to resume Cloud sync. Your pending drafts remain on this device.",
      retryCount: 0,
      signInCount: 1,
    },
  ];

  for (const entry of states) {
    await page.evaluate(
      (kind) => window.cloudWorkspaceFixture.setConnection(kind),
      entry.kind,
    );
    await expect(connectionBanner).toHaveAttribute(
      "data-connection-kind",
      entry.kind,
    );
    await expect(connectionText).toHaveText(entry.copy);
    await expect(page.getByRole("button", { name: "Retry sync" })).toHaveCount(
      entry.retryCount,
    );
    await expect(
      page.getByRole("button", { name: "Sign in again" }),
    ).toHaveCount(entry.signInCount);
    await expect(page.locator("body")).not.toContainText("All notes synced");
    await expect(page.locator("body")).not.toContainText("Up to date");
    await expect(connectionText).not.toContainText("Live");
  }

  await page.evaluate(() => window.cloudWorkspaceFixture.setConnection(null));
  await expect(connectionBanner).toHaveCount(0);
  expect(
    await page.evaluate(() => window.cloudWorkspaceFixture.recoveryCalls()),
  ).toEqual([]);

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.setConnection("offline"),
  );
  await expect(connectionText).toHaveText(
    "Offline. New edits stay pending on this device.",
  );
  await library
    .getByRole("button", { name: "Refresh cached notes", exact: true })
    .click();
  await expect(library.getByRole("listitem")).toHaveCount(3);
  expect(
    await page.evaluate(() => window.cloudWorkspaceFixture.recoveryCalls()),
  ).toEqual([]);

  await library
    .getByRole("button", { name: "Open Account A workspace note" })
    .click();
  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  const editor = editorArticle.getByRole("textbox", { name: "Note text" });
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");
  await expect(editorArticle.getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^save$/i })).toHaveCount(0);

  const committedBeforeEdit = server.control.committed;
  server.control.hold = true;
  await editor.fill("# Offline workspace edit\nRetained locally while offline");
  await expect
    .poll(() => server.control.committed)
    .toBe(committedBeforeEdit + 1);
  await expect(editorArticle.getByRole("status")).toHaveText("Pending upload");

  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle).toHaveCount(0);
  const editedCard = library
    .getByRole("listitem")
    .filter({ hasText: "Offline workspace edit" });
  await expect(editedCard).toContainText("Pending upload");
  await expect(connectionText).toHaveText(
    "Offline. New edits stay pending on this device.",
  );

  server.release();
  await expect(editedCard).toContainText("Saved in Cloud");
  expect(
    await page.evaluate(() => window.cloudWorkspaceFixture.recoveryCalls()),
  ).toEqual([]);
});

test("gates Retry sync and Sign in again by state and callback, enforces single-flight and keeps parent state authoritative", async ({
  page,
}) => {
  const connectionText = page.locator(".cloud-workspace-connection-text");
  const retryButton = page.getByRole("button", { name: "Retry sync" });
  const signInButton = page.getByRole("button", { name: "Sign in again" });

  await page.evaluate(() => {
    window.cloudWorkspaceFixture.setRecoveryCallbacks({
      retrySync: false,
      signIn: true,
    });
    window.cloudWorkspaceFixture.setConnection("paused");
  });
  await expect(connectionText).toHaveText(
    "Cloud sync is paused. Your pending drafts remain on this device.",
  );
  await expect(retryButton).toHaveCount(0);
  await expect(signInButton).toHaveCount(0);

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.setInvalidRecoveryCallbacks(true),
  );
  await expect(retryButton).toHaveCount(0);
  await expect(signInButton).toHaveCount(0);

  await page.evaluate(() => {
    window.cloudWorkspaceFixture.setRecoveryCallbacks({
      retrySync: true,
      signIn: true,
    });
    window.cloudWorkspaceFixture.holdRecovery(0);
  });
  await expect(retryButton).toBeVisible();
  await expect(retryButton).toBeEnabled();

  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>(
      ".cloud-workspace-connection-action",
    )!;
    button.click();
    button.click();
  });
  await expect(retryButton).toBeDisabled();
  expect(
    await page.evaluate(() => window.cloudWorkspaceFixture.heldRecoveries()),
  ).toEqual([{ action: "retry-sync", owner: 0 }]);
  expect(
    await page.evaluate(
      () => window.cloudWorkspaceFixture.recoveryCalls().length,
    ),
  ).toBe(1);

  await page.evaluate(() => window.cloudWorkspaceFixture.refresh());
  await expect(retryButton).toBeDisabled();

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.releaseRecoveries(false),
  );
  await expect(retryButton).toBeEnabled();
  await expect(connectionText).toHaveText(
    "Cloud sync is paused. Your pending drafts remain on this device.",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.setConnection("syncing"),
  );
  await expect(connectionText).toHaveText("Syncing with Cloud\u2026");

  await page.evaluate(() => {
    window.cloudWorkspaceFixture.failRecoverySync(0);
    window.cloudWorkspaceFixture.setConnection("paused");
  });
  await retryButton.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not resume Cloud sync. Your pending drafts remain on this device.",
  );
  await expect(page.locator("body")).not.toContainText("synthetic private");
  await expect(retryButton).toBeEnabled();

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.failRecoverySync(null),
  );
  await retryButton.click();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.evaluate(() => {
    window.cloudWorkspaceFixture.setRecoveryCallbacks({
      retrySync: true,
      signIn: false,
    });
    window.cloudWorkspaceFixture.setConnection("sign-in-required");
  });
  await expect(connectionText).toHaveText(
    "Sign in again to resume Cloud sync. Your pending drafts remain on this device.",
  );
  await expect(signInButton).toHaveCount(0);
  await expect(retryButton).toHaveCount(0);

  await page.evaluate(() => {
    window.cloudWorkspaceFixture.setRecoveryCallbacks({
      retrySync: true,
      signIn: true,
    });
    window.cloudWorkspaceFixture.failRecoveryAsync(0);
  });
  await expect(signInButton).toBeEnabled();
  await signInButton.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not start Cloud sign-in. Your pending drafts remain on this device.",
  );
  await expect(page.locator("body")).not.toContainText("synthetic private");
  await expect(page.locator("body")).not.toContainText("token-xyz");
  await expect(signInButton).toBeEnabled();
});

test("passes original captured context despite in-place caller mutation and ignores stale recovery results across status, refresh, abort and account replacement", async ({
  page,
}) => {
  const retryButton = page.getByRole("button", { name: "Retry sync" });
  const signInButton = page.getByRole("button", { name: "Sign in again" });

  await page.evaluate(() => {
    window.cloudWorkspaceFixture.setConnection("paused");
    window.cloudWorkspaceFixture.mountMutableContextAndCorruptInPlace();
  });
  await retryButton.click();
  expect(
    await page.evaluate(() => window.cloudWorkspaceFixture.recoveryCalls()),
  ).toEqual([
    {
      action: "retry-sync",
      owner: 0,
      ownerSubject: server.contexts[0].scope.ownerSubject,
      collectionId: server.contexts[0].scope.collectionId,
      modeGeneration: server.contexts[0].scope.modeGeneration,
      matchedOriginalStore: true,
      frozenContext: true,
      frozenScope: true,
    },
  ]);
  await page.evaluate(() => window.cloudWorkspaceFixture.clearMutableContext());

  await page.evaluate(() => window.cloudWorkspaceFixture.holdRecovery(0));
  await retryButton.click();
  await expect(retryButton).toBeDisabled();
  await page.evaluate(() =>
    window.cloudWorkspaceFixture.setConnection("offline"),
  );
  await page.evaluate(() =>
    window.cloudWorkspaceFixture.setConnection("paused"),
  );
  await expect(retryButton).toBeEnabled();
  await page.evaluate(() =>
    window.cloudWorkspaceFixture.releaseFirstRecovery(true),
  );
  await expect(retryButton).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await retryButton.click();
  await expect(retryButton).toBeDisabled();
  await page.evaluate(() => window.cloudWorkspaceFixture.setInvalidRefresh());
  await expect(page.locator(".cloud-workspace-connection")).toHaveCount(0);
  await expect(retryButton).toHaveCount(0);
  await page.evaluate(() => window.cloudWorkspaceFixture.refresh());
  await expect(retryButton).toBeEnabled();
  await page.evaluate(() =>
    window.cloudWorkspaceFixture.releaseRecoveries(true),
  );
  await expect(retryButton).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.evaluate(() => window.cloudWorkspaceFixture.holdRecovery(0));
  await retryButton.click();
  await expect(retryButton).toBeDisabled();
  await page.evaluate(() => {
    window.cloudWorkspaceFixture.selectAccount(1);
    window.cloudWorkspaceFixture.setConnection("sign-in-required");
  });
  await expect(signInButton).toBeEnabled();
  await page.evaluate(() =>
    window.cloudWorkspaceFixture.releaseRecoveries(true),
  );
  await expect(signInButton).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("synthetic private");

  await page.evaluate(() => window.cloudWorkspaceFixture.holdRecovery(1));
  await signInButton.click();
  await expect(signInButton).toBeDisabled();
  await page.evaluate(() => window.cloudWorkspaceFixture.abortCurrent());
  await expect(page.locator(".cloud-workspace-connection")).toHaveCount(0);
  await expect(signInButton).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudWorkspaceFixture.releaseRecoveries(true),
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("synthetic private");
});

test("renders generic unavailable presentation for malformed connection inputs without leaking extra fields or losing open pending drafts", async ({
  page,
}) => {
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  await library
    .getByRole("button", { name: "Open Account A workspace note" })
    .click();

  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  const editor = editorArticle.getByRole("textbox", { name: "Note text" });
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");

  const committedBeforeEdit = server.control.committed;
  server.control.hold = true;
  await editor.fill(
    "# Draft preserved across malformed connection\nPending body kept safe",
  );
  await expect
    .poll(() => server.control.committed)
    .toBe(committedBeforeEdit + 1);
  await expect(editorArticle.getByRole("status")).toHaveText("Pending upload");

  const presets = [
    "null",
    "primitive",
    "array",
    "empty-object",
    "unknown-kind",
    "all-synced-kind",
    "extra-secret-fields",
    "symbol-extra",
    "non-enumerable",
    "class-instance",
    "accessor-getter",
  ] as const;

  for (const preset of presets) {
    await page.evaluate(
      (item) => window.cloudWorkspaceFixture.setMalformedConnection(item),
      preset,
    );
    await expect(page.locator(".cloud-workspace-unavailable")).toHaveText(
      "Cloud sync status unavailable. Your pending drafts remain on this device.",
    );
    await expect(page.locator(".cloud-workspace-connection")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry sync" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Sign in again" }),
    ).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("synthetic-secret");
    await expect(page.locator("body")).not.toContainText("synthetic-bearer");
    await expect(page.locator("body")).not.toContainText("synthetic-symbol");
    await expect(page.locator("body")).not.toContainText("synthetic-error");
    await expect(page.locator("body")).not.toContainText("synthetic-getter");
    await expect(page.locator("body")).not.toContainText("All notes synced");
    await expect(editor).toContainText("Pending body kept safe");
    await expect(editor).toHaveAttribute("contenteditable", "true");
  }

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.setConnection("offline"),
  );
  await expect(page.locator(".cloud-workspace-unavailable")).toHaveCount(0);
  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle).toHaveCount(0);

  const retainedCard = library
    .getByRole("listitem")
    .filter({ hasText: "Draft preserved across malformed connection" });
  await expect(retainedCard).toContainText("Pending upload");

  server.release();
  await expect(retainedCard).toContainText("Saved in Cloud");
});

test("preserves desktop split and 390px sheet geometry, target sizes, keyboard activation and inert background containment with connection controls", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  const connectionBanner = page.locator(".cloud-workspace-connection");
  const connectionText = page.locator(".cloud-workspace-connection-text");
  const retryButton = page.getByRole("button", { name: "Retry sync" });
  const signInButton = page.getByRole("button", { name: "Sign in again" });

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.setConnection("paused"),
  );
  await library
    .getByRole("button", { name: "Open Account A workspace note" })
    .click();

  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  const editor = editorArticle.getByRole("textbox", { name: "Note text" });
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");
  await expect(editorArticle.getByRole("button")).toHaveCount(1);
  await expect(connectionText).toHaveAttribute("aria-live", "polite");

  const desktopConnectionBox = await connectionBanner.boundingBox(),
    desktopLibraryBox = await library.boundingBox(),
    desktopEditorPaneBox = await page
      .locator(".cloud-workspace-editor")
      .boundingBox(),
    desktopRetryBox = await retryButton.boundingBox();
  expect(desktopConnectionBox).not.toBeNull();
  expect(desktopLibraryBox).not.toBeNull();
  expect(desktopEditorPaneBox).not.toBeNull();
  expect(desktopRetryBox).not.toBeNull();
  expect(desktopRetryBox!.width).toBeGreaterThanOrEqual(24);
  expect(desktopRetryBox!.height).toBeGreaterThanOrEqual(32);
  expect(desktopLibraryBox!.y).toBeGreaterThanOrEqual(
    desktopConnectionBox!.y + desktopConnectionBox!.height,
  );
  expect(desktopEditorPaneBox!.x).toBeGreaterThanOrEqual(
    desktopConnectionBox!.x + desktopConnectionBox!.width - 1,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);

  await retryButton.focus();
  await expect(retryButton).toBeFocused();
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(
      () => window.cloudWorkspaceFixture.recoveryCalls().at(-1)?.action,
    ),
  ).toBe("retry-sync");
  await expect(editor).toContainText("Account A private body");

  await page.screenshot({
    path: testInfo.outputPath("workspace-status-desktop-split.png"),
  });

  await page.evaluate(() =>
    window.cloudWorkspaceFixture.setConnection("sign-in-required"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".cloud-workspace-library")).toHaveAttribute(
    "inert",
    "",
  );
  await expect(connectionText).toHaveAttribute("aria-live", "off");
  const mobileEditorBox = await editorArticle.boundingBox();
  expect(mobileEditorBox!.width).toBe(390);
  expect(mobileEditorBox!.height).toBe(844);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await expect(editorArticle).toHaveCount(0);
  await expect(page.locator(".cloud-workspace-library")).not.toHaveAttribute(
    "inert",
  );
  await expect(connectionText).toHaveAttribute("aria-live", "polite");

  const mobileConnectionBox = await connectionBanner.boundingBox(),
    mobileLibraryBox = await library.boundingBox(),
    mobileSignInBox = await signInButton.boundingBox();
  expect(mobileConnectionBox).not.toBeNull();
  expect(mobileLibraryBox).not.toBeNull();
  expect(mobileSignInBox).not.toBeNull();
  expect(mobileSignInBox!.width).toBeGreaterThanOrEqual(24);
  expect(mobileSignInBox!.height).toBeGreaterThanOrEqual(36);
  expect(mobileLibraryBox!.y).toBeGreaterThanOrEqual(
    mobileConnectionBox!.y + mobileConnectionBox!.height,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await signInButton.focus();
  await expect(signInButton).toBeFocused();
  await page.keyboard.press("Space");
  expect(
    await page.evaluate(
      () => window.cloudWorkspaceFixture.recoveryCalls().at(-1)?.action,
    ),
  ).toBe("sign-in");

  await page.screenshot({
    path: testInfo.outputPath("workspace-status-mobile-library.png"),
  });
});
