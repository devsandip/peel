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
  await expect(editorArticle.getByRole("status")).toHaveText("Pending upload");

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
