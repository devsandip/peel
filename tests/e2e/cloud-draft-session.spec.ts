import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import type {} from "../fixtures/cloud-note-cache-view";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const observed: string[] = [];
  errors.set(page, observed);
  page.on("pageerror", (error) => observed.push(error.message));
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-note-cache-view.html")}?db=peel-m0-cloud-panel-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudCacheFixture);
  await page.evaluate(() => window.cloudCacheFixture.draftOpen());
});
test.afterEach(async ({ page }) => {
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).some((db) => db.name === "peel-local-v1"),
    ),
  ).toBe(false);
  await page.evaluate(() => window.cloudCacheFixture.destroy());
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(errors.get(page)).toEqual([]);
});

test("local draft retention survives real IndexedDB reload and stays pending until controlled matching ACK", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.cloudCacheFixture.draftEdit("Retained pending source 原文"),
  );
  expect(
    await page.evaluate(() => window.cloudCacheFixture.draftFlush()),
  ).toMatchObject({
    bodyMarkdown: "Retained pending source 原文",
    status: "Pending upload",
    retained: true,
  });
  await expect(page.getByRole("region")).toHaveText(
    "Retained pending source 原文",
  );
  await expect(page.getByRole("status")).toHaveText("Pending upload");
  await page.reload();
  await page.waitForFunction(() => !!window.cloudCacheFixture);
  await page.evaluate(() => window.cloudCacheFixture.draftOpen());
  expect(
    await page.evaluate(() => window.cloudCacheFixture.draftSnapshot()),
  ).toMatchObject({
    bodyMarkdown: "Retained pending source 原文",
    status: "Pending upload",
    retained: true,
  });
  await page.evaluate(() => window.cloudCacheFixture.prepare());
  await page.evaluate(() => window.cloudCacheFixture.acknowledge());
  expect(
    await page.evaluate(() => window.cloudCacheFixture.draftRefresh()),
  ).toMatchObject({ status: "Saved in Cloud", retained: true });
});

test("actual IndexedDB retention failure keeps the draft open/copyable until successful retry and reload", async ({
  page,
}) => {
  const message = await page.evaluate(async () => {
    const f = window.cloudCacheFixture;
    f.draftFail(true);
    f.draftEdit("Copyable source after transaction abort");
    try {
      await f.draftPutAway();
      return "unexpected close";
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(message).toContain("Could not retain draft");
  expect(message).not.toContain("synthetic private");
  expect(
    await page.evaluate(() => window.cloudCacheFixture.draftSnapshot()),
  ).toMatchObject({
    bodyMarkdown: "Copyable source after transaction abort",
    canEdit: true,
    closed: false,
    retained: false,
    status: "Could not retain draft",
  });
  await expect(page.getByRole("region")).toHaveText(
    "Account A private fixture",
  );
  await page.evaluate(() => window.cloudCacheFixture.draftFail(false));
  expect(
    await page.evaluate(() => window.cloudCacheFixture.draftPutAway()),
  ).toMatchObject({ closed: true, retained: true, status: "Pending upload" });
  await page.reload();
  await page.waitForFunction(() => !!window.cloudCacheFixture);
  await page.evaluate(() => window.cloudCacheFixture.draftOpen());
  expect(
    await page.evaluate(() => window.cloudCacheFixture.draftSnapshot()),
  ).toMatchObject({
    bodyMarkdown: "Copyable source after transaction abort",
    retained: true,
    status: "Pending upload",
  });
});

test("held actual retention prevents Put away settlement and freezes further typing while draining the latest draft", async ({
  page,
}) => {
  await page.evaluate(() => {
    const f = window.cloudCacheFixture;
    f.draftHold();
    f.draftEdit("First held browser draft");
  });
  await page.waitForFunction(() => window.cloudCacheFixture.draftHeld() > 0);
  await page.evaluate(() => {
    const f = window.cloudCacheFixture;
    f.draftEdit("Newest held browser draft");
    Reflect.set(window, "syntheticCloseSettled", false);
    void f
      .draftPutAway()
      .then(() => Reflect.set(window, "syntheticCloseSettled", true));
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(
    await page.evaluate(() => window.cloudCacheFixture.draftSnapshot()),
  ).toMatchObject({ closed: false, canEdit: false, retained: false });
  expect(
    await page.evaluate(() => Reflect.get(window, "syntheticCloseSettled")),
  ).toBe(false);
  expect(
    await page.evaluate(() => {
      try {
        window.cloudCacheFixture.draftEdit("Must not change closing source");
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  await page.evaluate(() => window.cloudCacheFixture.draftRelease());
  await page.waitForFunction(
    () => Reflect.get(window, "syntheticCloseSettled") === true,
  );
  expect(
    await page.evaluate(() => window.cloudCacheFixture.draftSnapshot()),
  ).toMatchObject({
    bodyMarkdown: "Newest held browser draft",
    closed: true,
    retained: true,
    status: "Pending upload",
  });
  await expect(page.getByRole("region")).toHaveText(
    "Newest held browser draft",
  );
});
