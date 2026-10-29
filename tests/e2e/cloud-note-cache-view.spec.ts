import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import type {} from "../fixtures/cloud-note-cache-view";

test.beforeEach(async ({ page }) => {
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-note-cache-view.html")}?db=peel-m0-cloud-panel-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudCacheFixture);
});
test.afterEach(async ({ page }) => {
  await page.evaluate(() => window.cloudCacheFixture?.destroy());
});

test("only matching confirmation says Saved, newer typing stays pending and actual IndexedDB survives reload", async ({
  page,
}) => {
  const status = page.getByRole("status");
  await expect(status).toHaveText("Pending upload");
  await page.evaluate(() => window.cloudCacheFixture.prepare());
  await expect(status).toHaveText("Pending upload");
  await page.evaluate(() =>
    window.cloudCacheFixture.save("Newer pending text"),
  );
  await page.evaluate(() => window.cloudCacheFixture.acknowledge());
  await expect(status).toHaveText("Pending upload");
  await expect(page.getByRole("region")).toHaveText("Newer pending text");
  await page.reload();
  await page.waitForFunction(() => !!window.cloudCacheFixture);
  await expect(status).toHaveText("Pending upload");
  await expect(page.getByRole("region")).toHaveText("Newer pending text");
  await page.evaluate(() => window.cloudCacheFixture.prepare());
  await page.evaluate(() => window.cloudCacheFixture.acknowledge());
  await expect(status).toHaveText("Saved in Cloud");
  await page.reload();
  await page.waitForFunction(() => !!window.cloudCacheFixture);
  await expect(status).toHaveText("Saved in Cloud");
  await expect(page.getByRole("region")).toHaveText("Newer pending text");
});

test("a held new-account read immediately hides previous account text", async ({
  page,
}) => {
  await expect(page.getByRole("region")).toHaveText(
    "Account A private fixture",
  );
  const immediate = await page.evaluate(() => {
    window.cloudCacheFixture.hold(1);
    window.cloudCacheFixture.select(1);
    return document.querySelector("article")!.textContent;
  });
  expect(immediate).not.toContain("Account A private fixture");
  expect(immediate).toContain("Loading Cloud note");
  await page.waitForFunction(() => window.cloudCacheFixture.heldCount() > 0);
  await expect(page.getByRole("region")).toHaveCount(0);
  await page.evaluate(() => window.cloudCacheFixture.release());
  await expect(page.getByRole("region")).toHaveText(
    "Account B private fixture",
  );
});

for (const fail of [false, true]) {
  test(`late previous-account ${fail ? "errors" : "results"} cannot replace the active account`, async ({
    page,
  }) => {
    await expect(page.getByRole("region")).toHaveText(
      "Account A private fixture",
    );
    await page.evaluate(() => {
      window.cloudCacheFixture.hold(0);
      window.cloudCacheFixture.refresh();
    });
    await page.waitForFunction(() => window.cloudCacheFixture.heldCount() > 0);
    await page.evaluate(() => window.cloudCacheFixture.select(1));
    await expect(page.getByRole("region")).toHaveText(
      "Account B private fixture",
    );
    await page.evaluate(
      (error) => window.cloudCacheFixture.release(error),
      fail,
    );
    // Allow the released real IndexedDB read/effect chain to complete.
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.getByRole("region")).toHaveText(
      "Account B private fixture",
    );
    await expect(page.getByRole("status")).toHaveText("Pending upload");
  });
}

test("note and refresh changes hide old text, and a late note read cannot replace a missing selection", async ({
  page,
}) => {
  await expect(page.getByRole("region")).toBeVisible();
  await page.evaluate(() => {
    window.cloudCacheFixture.hold(0);
    window.cloudCacheFixture.select(0, "synthetic-other-note");
  });
  await page.waitForFunction(() => window.cloudCacheFixture.heldCount() > 0);
  await expect(page.getByRole("region")).toHaveCount(0);
  await page.evaluate(() => window.cloudCacheFixture.select(0, "missing-note"));
  await page.evaluate(() => window.cloudCacheFixture.release());
  await expect(page.getByRole("status")).toHaveText("No cached Cloud note");
  await expect(page.getByRole("region")).toHaveCount(0);
  await page.evaluate(() => window.cloudCacheFixture.select(0));
  await expect(page.getByRole("region")).toHaveText(
    "Account A private fixture",
  );
  const immediate = await page.evaluate(() => {
    window.cloudCacheFixture.hold(0);
    window.cloudCacheFixture.refresh();
    return document.querySelector("article")!.textContent;
  });
  expect(immediate).toBe("Loading Cloud note");
});

for (const kind of [
  "scope",
  "refresh",
  "foreign",
  "generation",
  "malformed",
  "error",
  "closed",
] as const) {
  test(`${kind} selection refuses old text and raw errors`, async ({
    page,
  }) => {
    await expect(page.getByRole("region")).toHaveText(
      "Account A private fixture",
    );
    const reads = await page.evaluate(() =>
      window.cloudCacheFixture.readCount(),
    );
    await page.evaluate(async (fault) => {
      const fixture = window.cloudCacheFixture;
      if (fault === "error") {
        fixture.fault(true);
        fixture.refresh();
      } else if (fault === "closed") await fixture.closeStore();
      else if (fault === "malformed") await fixture.corrupt();
      else fixture.invalid(fault);
    }, kind);
    await expect(page.getByRole("status")).toHaveText("Cloud note unavailable");
    await expect(page.getByRole("region")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "synthetic private error payload",
    );
    if (kind === "scope" || kind === "refresh")
      expect(
        await page.evaluate(() => window.cloudCacheFixture.readCount()),
      ).toBe(reads);
  });
}

test("cached markup stays literal and unmount discards held read errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const source = "<script>window.pwned=true</script>\nUnicode 原文";
  await page.evaluate((body) => window.cloudCacheFixture.save(body), source);
  await expect(page.getByRole("region")).toHaveText(source);
  expect(
    await page.evaluate(() => Reflect.get(window, "pwned")),
  ).toBeUndefined();
  await page.evaluate(() => {
    window.cloudCacheFixture.hold(0);
    window.cloudCacheFixture.refresh();
  });
  await page.waitForFunction(() => window.cloudCacheFixture.heldCount() > 0);
  await page.evaluate(() => {
    window.cloudCacheFixture.unmount();
    window.cloudCacheFixture.release(true);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByRole("article")).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name),
    ),
  ).toEqual(
    expect.arrayContaining([expect.stringMatching(/^peel-m0-cloud-panel-/)]),
  );
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).some((db) => db.name === "peel-local-v1"),
    ),
  ).toBe(false);
});
