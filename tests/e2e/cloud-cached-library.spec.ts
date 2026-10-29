import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { startCloudUploadServer } from "../fixtures/cloud-upload-server";
import { cloudScope } from "../fixtures/cloud-durable-contract";
import type {} from "../fixtures/cloud-cached-library";

let server: Awaited<ReturnType<typeof startCloudUploadServer>>;
const errors: string[] = [];
test.beforeEach(async ({ page, baseURL }) => {
  server = await startCloudUploadServer(new URL(baseURL!).origin, {
    ...cloudScope,
    ownerSubject: "synthetic-library-owner-b",
  });
  errors.length = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (config) => Reflect.set(window, "syntheticLibraryConfig", config),
    { api: server.api, contexts: server.contexts },
  );
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-cached-library.html")}?db=peel-m0-cloud-library-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudLibraryFixture);
});
test.afterEach(async ({ page }) => {
  server.release();
  await page.evaluate(() => window.cloudLibraryFixture.destroy());
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await server.close();
  expect(errors).toEqual([]);
});

test("recent cached metadata pages have no bodies and respect archive/trash", async ({
  page,
}, testInfo) => {
  const panel = page.getByRole("region", { name: "Cached Cloud library" });
  await expect(panel.getByRole("status")).toContainText(
    "has not been downloaded",
  );
  await expect(panel.getByRole("listitem")).toHaveCount(32);
  await expect(panel.getByRole("listitem").first()).toContainText(
    "Account A cached note",
  );
  await expect(panel).not.toContainText("Private body excluded");
  await page.screenshot({ path: testInfo.outputPath("cached-library.png") });
  await panel.getByRole("button", { name: "More cached notes" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(4);
  await expect(panel).toContainText('<img src=x onerror="window.pwned=true">');
  expect(await page.locator("img").count()).toBe(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "pwned")),
  ).toBeUndefined();
  await panel.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(1);
  await expect(panel).toContainText("archived title");
  await expect(panel.getByRole("button", { name: /^Open / })).toHaveCount(0);
  await panel.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(panel).toContainText("trashed title");
});

test("a cached note opens by original ID, autosaves through real HTTP and updates library after Put away", async ({
  page,
}) => {
  const panel = page.getByRole("region", { name: "Cached Cloud library" });
  await panel
    .getByRole("button", { name: "Open Account A cached note" })
    .click();
  const editor = page.getByRole("textbox", { name: "Note text" });
  await expect(editor).toContainText("Private body excluded from metadata");
  await editor.fill("Updated from cached library\nActual upload source");
  await page.getByRole("button", { name: "Put away note" }).click();
  await expect(editor).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Open Updated from cached library" }),
  ).toBeVisible();
  await expect(
    panel
      .getByRole("listitem")
      .filter({ hasText: "Updated from cached library" }),
  ).toContainText("Saved in Cloud");
  expect(server.control.committed).toBeGreaterThanOrEqual(1);
  await panel.getByRole("button", { name: "New note", exact: true }).click();
  server.control.hold = true;
  await editor.fill("New cached pending note");
  const id = await page.evaluate(() => window.cloudLibraryFixture.noteId());
  expect(id).not.toBe("shared-note");
  await page.getByRole("button", { name: "Put away note" }).click();
  const card = panel
    .getByRole("listitem")
    .filter({ hasText: "New cached pending note" });
  await expect(card).toContainText("Pending upload");
  server.release();
  await expect(card).toContainText("Saved in Cloud");
});

test("held old account and refresh results/errors never flash previous metadata", async ({
  page,
  playwright,
}) => {
  const panel = page.getByRole("region", { name: "Cached Cloud library" });
  await expect(panel).toContainText("Account A cached note");
  await page.evaluate(() => {
    window.cloudLibraryFixture.hold(0);
    window.cloudLibraryFixture.refresh();
  });
  await page.waitForFunction(() => window.cloudLibraryFixture.held() > 0);
  await expect(panel).not.toContainText("Account A cached note");
  await page.evaluate(() => window.cloudLibraryFixture.select(1));
  await expect(panel).toContainText("Account B cached note");
  await page.evaluate(() => window.cloudLibraryFixture.release(true));
  await expect(panel).not.toContainText("Account A cached note");
  await expect(panel).not.toContainText("private");
  await panel
    .getByRole("button", { name: "Open Account B cached note" })
    .click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText(
    "Account B cached note",
  );
  await expect(
    page
      .getByRole("article", { name: "Cloud note editor" })
      .getByRole("status"),
  ).toHaveText("Saved in Cloud");
  const other = await playwright.request.newContext();
  try {
    for (let owner = 0; owner < 2; owner++) {
      const context = server.contexts[owner],
        response = await other.get(server.api + "/v1/notes/shared-note", {
          headers: {
            "x-synthetic-fixture": context.token,
            "x-peel-collection": context.scope.collectionId,
            "x-peel-mode-generation": String(context.scope.modeGeneration),
          },
        });
      const head = (await response.json()).head;
      if (owner === 0) expect(head.kind).toBe("missing");
      else
        expect(head.snapshot.bodyMarkdown).toContain("Account B cached note");
    }
  } finally {
    await other.dispose();
  }
});

test("download completion stays separate from pending saves, and scope errors/cancellation are generic", async ({
  page,
}) => {
  const panel = page.getByRole("region", { name: "Cached Cloud library" });
  await page.evaluate(() => window.cloudLibraryFixture.download("incomplete"));
  await expect(panel.getByRole("status")).toContainText(
    "download is incomplete",
  );
  await page.evaluate(() => window.cloudLibraryFixture.download("complete"));
  await expect(panel.getByRole("status")).toContainText(
    "Last Cloud download complete",
  );
  await expect(panel.getByRole("listitem").first()).toContainText(
    "Pending upload",
  );
  await page.evaluate(() => {
    window.cloudLibraryFixture.foreignProgress(0);
    window.cloudLibraryFixture.refresh();
  });
  await expect(panel.getByRole("status")).toHaveText(
    "Cached Cloud library unavailable",
  );
  await page.evaluate(() => {
    window.cloudLibraryFixture.foreignProgress(null);
    window.cloudLibraryFixture.refresh();
  });
  await expect(panel).toContainText("Account A cached note");
  await page.evaluate(() => {
    window.cloudLibraryFixture.foreign(0);
    window.cloudLibraryFixture.refresh();
  });
  await expect(panel.getByRole("status")).toHaveText(
    "Cached Cloud library unavailable",
  );
  await expect(panel.getByRole("listitem")).toHaveCount(0);
  await page.evaluate(() => {
    window.cloudLibraryFixture.foreign(null);
    window.cloudLibraryFixture.refresh();
  });
  await expect(panel).toContainText("Account A cached note");
  await page.evaluate(() => {
    window.cloudLibraryFixture.fail(0);
    window.cloudLibraryFixture.refresh();
  });
  await expect(panel.getByRole("status")).toHaveText(
    "Cached Cloud library unavailable",
  );
  await expect(panel).not.toContainText("private");
  await page.evaluate(() => {
    window.cloudLibraryFixture.fail(null);
    window.cloudLibraryFixture.refresh();
  });
  await expect(panel).toContainText("Account A cached note");
  const reads = await page.evaluate(() => window.cloudLibraryFixture.reads());
  await page.evaluate(() => window.cloudLibraryFixture.invalid());
  await expect(panel.getByRole("status")).toHaveText(
    "Cached Cloud library unavailable",
  );
  expect(await page.evaluate(() => window.cloudLibraryFixture.reads())).toEqual(
    reads,
  );
  await page.evaluate(() => window.cloudLibraryFixture.refresh());
  await expect(panel).toContainText("Account A cached note");
  await page.evaluate(() => window.cloudLibraryFixture.abort());
  await expect(panel.getByRole("status")).toHaveText(
    "Cached Cloud library unavailable",
  );
  await expect(
    panel.getByRole("button", { name: "New note", exact: true }),
  ).toBeDisabled();
  await expect(panel.getByRole("listitem")).toHaveCount(0);
});

test("an actual malformed IndexedDB state refuses the whole catalog without leaking old metadata", async ({
  page,
}) => {
  const panel = page.getByRole("region", { name: "Cached Cloud library" });
  await expect(panel).toContainText("Account A cached note");
  await page.evaluate(() => window.cloudLibraryFixture.corrupt(0));
  await expect(panel.getByRole("status")).toHaveText(
    "Cached Cloud library unavailable",
  );
  await expect(panel.getByRole("listitem")).toHaveCount(0);
});

test("cached library controls remain readable and separate from status on a narrow screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const panel = page.getByRole("region", { name: "Cached Cloud library" });
  await expect(panel).toContainText("Account A cached note");
  const font = await panel
    .getByRole("button", { name: "New note", exact: true })
    .evaluate((element) => getComputedStyle(element).fontSize);
  expect(parseFloat(font)).toBeGreaterThanOrEqual(12);
  const nav = await panel.getByRole("navigation").boundingBox(),
    status = await panel.getByRole("status").boundingBox();
  expect(status!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("cached-library-mobile.png"),
  });
});
