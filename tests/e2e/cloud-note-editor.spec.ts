import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import type {} from "../fixtures/cloud-note-editor";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const observed: string[] = [];
  errors.set(page, observed);
  page.on("pageerror", (error) => observed.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          Reflect.set(window, "syntheticCopiedText", text);
        },
      },
    });
  });
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-note-editor.html")}?db=peel-m0-cloud-editor-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudEditorFixture);
});
test.afterEach(async ({ page }) => {
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).some((db) => db.name === "peel-local-v1"),
    ),
  ).toBe(false);
  await page.evaluate(() => window.cloudEditorFixture.destroy());
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(errors.get(page)).toEqual([]);
});

test("one green minus puts away the latest retained draft and actual reload keeps it pending", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "Note text" });
  await expect(page.getByRole("button")).toHaveCount(1);
  await editor.fill("Immediate browser draft 原文");
  await editor.press("Escape");
  await expect(editor).toContainText("Immediate browser draft 原文");
  await page.getByRole("button", { name: "Put away note" }).click();
  await expect(page.getByText("Note put away", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.cloudEditorFixture.dismissals()),
  ).toEqual([0]);
  await page.reload();
  await page.waitForFunction(() => !!window.cloudEditorFixture);
  await expect(editor).toContainText("Immediate browser draft 原文");
  await expect(page.getByRole("status")).toHaveText("Pending upload");
  await editor.dispatchEvent("keydown", {
    key: "w",
    ctrlKey: true,
    bubbles: true,
  });
  await expect(page.getByText("Note put away", { exact: true })).toBeVisible();
});

test("retention failure keeps editable text with Retry and stubbed Copy recovery", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "Note text" });
  await page.evaluate(() => window.cloudEditorFixture.fail(true));
  await editor.fill("Copyable source after aborted retention");
  await page.getByRole("button", { name: "Put away note" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not retain draft");
  await expect(page.getByRole("alert")).not.toContainText("synthetic private");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await page.getByRole("button", { name: "Copy text" }).click();
  expect(
    await page.evaluate(() => Reflect.get(window, "syntheticCopiedText")),
  ).toBe("Copyable source after aborted retention");
  expect(
    await page.evaluate(() => window.cloudEditorFixture.dismissals()),
  ).toEqual([]);
  await page.evaluate(() => window.cloudEditorFixture.fail(false));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Pending upload");
  await page.getByRole("button", { name: "Put away note" }).click();
  await expect(page.getByText("Note put away", { exact: true })).toBeVisible();
});

test("held retention freezes document transactions and delays dismissal", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "Note text" });
  await page.evaluate(() => window.cloudEditorFixture.hold());
  await editor.fill("First held source");
  await page.waitForFunction(() => window.cloudEditorFixture.held() > 0);
  await editor.fill("Newest held source");
  await page.getByRole("button", { name: "Put away note" }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(page.getByRole("status")).toHaveText("Retaining draft");
  await editor.press("x");
  await expect(editor).toContainText("Newest held source");
  expect(
    await page.evaluate(() => window.cloudEditorFixture.dismissals()),
  ).toEqual([]);
  await page.evaluate(() => window.cloudEditorFixture.release());
  await expect(page.getByText("Note put away", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      async () =>
        (await window.cloudEditorFixture.read(0))!.pending!.snapshot!
          .bodyMarkdown,
    ),
  ).toBe("Newest held source");
});

test("session switch clears undo history and suppresses the old held dismissal callback", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "Note text" });
  await page.evaluate(() => window.cloudEditorFixture.hold());
  await editor.fill("Account A secret source");
  await page.waitForFunction(() => window.cloudEditorFixture.held() > 0);
  await page.getByRole("button", { name: "Put away note" }).click();
  await page.evaluate(() => window.cloudEditorFixture.select(1));
  await expect(editor).toContainText("Account B fixture");
  await expect(page.locator("body")).not.toContainText(
    "Account A secret source",
  );
  await editor.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(editor).toContainText("Account B fixture");
  await page.evaluate(async () => {
    window.cloudEditorFixture.release();
    await window.cloudEditorFixture.settle();
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(
    await page.evaluate(() => window.cloudEditorFixture.dismissals()),
  ).toEqual([]);
  await expect(editor).toContainText("Account B fixture");
  expect(
    await page.evaluate(
      async () =>
        (await window.cloudEditorFixture.read(0))!.current!.snapshot!
          .bodyMarkdown,
    ),
  ).toBe("Account A secret source");
});

test("confirmed status never marks later typing Saved and literal source stays safe", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "Note text" });
  await page.evaluate(() => window.cloudEditorFixture.prepare());
  await page.evaluate(() => window.cloudEditorFixture.acknowledge());
  await expect(page.getByRole("status")).toHaveText("Saved in Cloud");
  const body = "<script>window.pwned=true</script>\nNew pending text";
  await editor.fill(body);
  await expect(page.getByRole("status")).toHaveText("Pending upload");
  expect(
    await page.evaluate(() => Reflect.get(window, "pwned")),
  ).toBeUndefined();
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.cloudEditorFixture.read(0))!.pending!.snapshot!
            .bodyMarkdown,
      ),
    )
    .toBe(body);
});

test("owner dismissal failure exposes generic recovery and retries after retention", async ({
  page,
}) => {
  await page.evaluate(() => window.cloudEditorFixture.failDismiss(true));
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Retained before failed owner dismissal");
  await page.getByRole("button", { name: "Put away note" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not put away");
  await expect(page.getByRole("alert")).not.toContainText("synthetic private");
  await expect(page.getByRole("status")).toHaveText("Pending upload");
  await page.evaluate(() => window.cloudEditorFixture.failDismiss(false));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Note put away", { exact: true })).toBeVisible();
});

test("an invalid refresh token hides cached text without invoking dismissal", async ({
  page,
}) => {
  await expect(page.getByRole("textbox", { name: "Note text" })).toBeVisible();
  await page.evaluate(() => window.cloudEditorFixture.invalid());
  await expect(page.getByRole("alert")).toHaveText("Cloud note unavailable");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Account A fixture");
  expect(
    await page.evaluate(() => window.cloudEditorFixture.dismissals()),
  ).toEqual([]);
});
