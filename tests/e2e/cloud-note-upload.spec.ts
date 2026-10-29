import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { startCloudUploadServer } from "../fixtures/cloud-upload-server";
import type {} from "../fixtures/cloud-note-upload";

let server: Awaited<ReturnType<typeof startCloudUploadServer>>;
const pageErrors: string[] = [];
test.beforeEach(async ({ page, baseURL }) => {
  server = await startCloudUploadServer(new URL(baseURL!).origin);
  pageErrors.length = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(
    (config) => Reflect.set(window, "syntheticUploadConfig", config),
    {
      api: server.api,
      token: server.token,
      scope: server.scope,
    },
  );
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-note-upload.html")}?db=peel-m0-cloud-upload-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudUploadFixture);
});
test.afterEach(async ({ page }) => {
  server.release();
  if (!page.isClosed()) {
    await page.evaluate(() => window.cloudUploadFixture.destroy());
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  }
  await server.close();
  expect(pageErrors).toEqual([]);
});

test("actual HTTP commit precedes Saved, and a separate client reads the confirmed copy", async ({
  page,
  playwright,
}) => {
  server.control.hold = true;
  const editor = page.getByRole("textbox", { name: "Note text" });
  await editor.fill("First confirmed source 原文");
  await expect.poll(() => server.control.committed).toBe(1);
  await expect(page.getByRole("status")).toHaveText("Pending upload");
  const noteId = await page.evaluate(
      () => window.cloudUploadFixture.snapshot().noteId,
    ),
    other = await playwright.request.newContext({
      extraHTTPHeaders: {
        "x-synthetic-fixture": server.token,
        "x-peel-collection": server.scope.collectionId,
        "x-peel-mode-generation": String(server.scope.modeGeneration),
      },
    });
  try {
    const remote = await other.get(server.api + "/v1/notes/" + noteId);
    expect((await remote.json()).head.snapshot.bodyMarkdown).toBe(
      "First confirmed source 原文",
    );
    await editor.fill("Newer unconfirmed typing");
    const beforeReply = await other.get(server.api + "/v1/notes/" + noteId);
    expect((await beforeReply.json()).head.snapshot.bodyMarkdown).toBe(
      "First confirmed source 原文",
    );
    server.release();
    await expect(page.getByRole("status")).toHaveText("Saved in Cloud");
    const latest = await other.get(server.api + "/v1/notes/" + noteId);
    expect((await latest.json()).head.snapshot.bodyMarkdown).toBe(
      "Newer unconfirmed typing",
    );
    await page.reload();
    await page.waitForFunction(() => !!window.cloudUploadFixture);
    await page.evaluate((id) => window.cloudUploadFixture.open(id), noteId);
    await expect(editor).toContainText("Newer unconfirmed typing");
    await expect(page.getByRole("status")).toHaveText("Saved in Cloud");
  } finally {
    await other.dispose();
  }
});

test("real authentication failure preserves pending text and Retry uploads the original operation", async ({
  page,
}) => {
  server.control.unauthorized = true;
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Keep through authentication failure");
  await expect(page.getByRole("alert")).toContainText("Sign in again");
  await expect(page.getByRole("status")).toHaveText("Pending upload");
  server.control.unauthorized = false;
  await page.getByRole("button", { name: "Retry upload" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved in Cloud");
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText(
    "Keep through authentication failure",
  );
});

test("Put away does not wait for a held server reply and committed text remains independently readable", async ({
  page,
  playwright,
}) => {
  server.control.hold = true;
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("Retain and put away without waiting for network");
  await expect.poll(() => server.control.committed).toBe(1);
  const noteId = await page.evaluate(
    () => window.cloudUploadFixture.snapshot().noteId,
  );
  await expect(page.getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "Put away note" }).click();
  await expect(page.getByText("Note put away", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.cloudUploadFixture.snapshot().status),
  ).toBe("Pending upload");
  const other = await playwright.request.newContext();
  try {
    const response = await other.get(server.api + "/v1/notes/" + noteId, {
      headers: {
        "x-synthetic-fixture": server.token,
        "x-peel-collection": server.scope.collectionId,
        "x-peel-mode-generation": String(server.scope.modeGeneration),
      },
    });
    expect((await response.json()).head.snapshot.bodyMarkdown).toBe(
      "Retain and put away without waiting for network",
    );
  } finally {
    await other.dispose();
  }
  server.release();
  await expect
    .poll(() =>
      page.evaluate(() => window.cloudUploadFixture.snapshot().status),
    )
    .toBe("Saved in Cloud");
});

test("replacing a context hides old text and suppresses held old upload notifications", async ({
  page,
}) => {
  server.control.hold = true;
  const editor = page.getByRole("textbox", { name: "Note text" });
  await editor.fill("Old context source");
  await expect.poll(() => server.control.committed).toBe(1);
  await page.evaluate(() => window.cloudUploadFixture.replace());
  await expect(page.locator(".cm-placeholder")).toBeVisible();
  server.release();
  await expect(page.locator("body")).not.toContainText("Old context source");
  await expect(page.getByRole("status")).toHaveText("Pending upload");
  await editor.fill("New context source");
  await expect(page.getByRole("status")).toHaveText("Saved in Cloud");
});
