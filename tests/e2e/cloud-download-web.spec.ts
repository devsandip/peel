import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { startCloudUploadServer } from "../fixtures/cloud-upload-server";
import type {} from "../fixtures/cloud-download-web";

let server: Awaited<ReturnType<typeof startCloudUploadServer>>;
let pageLimit = 32,
  inFlight = 0;
const errors: string[] = [],
  requests: string[] = [];
test.beforeEach(async ({ page, baseURL }) => {
  server = await startCloudUploadServer(
    new URL(baseURL!).origin,
    undefined,
    true,
  );
  errors.length = 0;
  requests.length = 0;
  pageLimit = 32;
  inFlight = 0;
  page.on("pageerror", () => errors.push("Unexpected browser exception"));
  await page.addInitScript(
    (scope) => Reflect.set(window, "syntheticDownloadConfig", { scope }),
    server.scope,
  );
  // Synthetic same-origin proxy only; actual HTTP/pull/signatures/storage remain real.
  await page.route("**/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    expect(url.origin).toBe(new URL(baseURL!).origin);
    expect(request.headers()["x-peel-csrf"]).toBe("c".repeat(43));
    requests.push(
      url.pathname +
        (url.searchParams.has("after")
          ? "?after"
          : url.searchParams.has("pageToken")
            ? "?pageToken"
            : ""),
    );
    // Ask the real service for smaller supported pages to exercise pass continuation.
    if (url.searchParams.has("pageToken"))
      url.searchParams.set("limit", String(pageLimit));
    inFlight++;
    try {
      const response = await route.fetch({
        url: server.api + url.pathname + url.search,
        headers: { ...request.headers(), "x-synthetic-fixture": server.token },
        maxRedirects: 0,
      });
      await route.fulfill({ response });
    } catch {
      if (
        !page.isClosed() &&
        !/ABORTED|CANCELLED/i.test(request.failure()?.errorText ?? "")
      )
        errors.push("Unexpected fixture proxy failure");
    } finally {
      inFlight--;
    }
  });
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-download-web.html")}?db=peel-m0-cloud-web-download-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudDownloadFixture);
});
test.afterEach(async ({ page }) => {
  server.release();
  await expect.poll(() => inFlight).toBe(0);
  await page.evaluate(() => window.cloudDownloadFixture.destroy());
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await server.close();
  expect(errors).toEqual([]);
});

test("an unseeded browser cache downloads independent Cloud notes and later checkpoint edits", async ({
  page,
}, testInfo) => {
  const panel = page.getByRole("region", { name: "Cached Cloud library" }),
    status = page.getByRole("status", { name: "Cloud download" });
  await expect(panel.getByRole("listitem")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.cloudDownloadFixture.state("remote-34")),
  ).toBeNull();
  for (let i = 0; i < 35; i++)
    await server.seedRemote(
      `remote-${String(i).padStart(2, "0")}`,
      `Remote note ${i}\nBody is not catalog metadata`,
    );
  await page.getByRole("button", { name: "Download Cloud notes" }).click();
  await expect(status).toContainText("complete:");
  await expect(panel.getByRole("listitem")).toHaveCount(32);
  await expect(panel).toContainText("Saved in Cloud");
  await expect(panel).not.toContainText("Body is not catalog metadata");
  await panel.getByRole("button", { name: "More cached notes" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(3);
  expect(
    (await page.evaluate(() => window.cloudDownloadFixture.state("remote-34")))
      ?.current?.snapshot?.bodyMarkdown,
  ).toContain("Remote note 34");
  await page.screenshot({
    path: testInfo.outputPath("downloaded-cloud-library.png"),
  });
  await server.seedRemote(
    "remote-00",
    "Updated remote note\nLater committed body",
  );
  await server.seedRemote("late-note", "Later Cloud commit");
  await page.reload();
  await page.waitForFunction(() => !!window.cloudDownloadFixture);
  const start = requests.length;
  await page.getByRole("button", { name: "Download Cloud notes" }).click();
  await expect(status).toContainText("complete:");
  expect(requests[start]).toBe("/v1/sync?after");
  await expect(panel).toContainText("Updated remote note");
  await expect(panel).toContainText("Later Cloud commit");
  expect(
    (await page.evaluate(() => window.cloudDownloadFixture.state("remote-00")))
      ?.baseRevision,
  ).toBe(2);
});

test("completed downloads keep local drafts pending and competing source in conflict", async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.cloudDownloadFixture.retain(
      "pending-only",
      "Pending local note",
    );
    await window.cloudDownloadFixture.retain("shared", "Local competing note");
  });
  await server.seedRemote("shared", "Committed remote source");
  await page.getByRole("button", { name: "Download Cloud notes" }).click();
  await expect(
    page.getByRole("status", { name: "Cloud download" }),
  ).toContainText("complete:");
  const panel = page.getByRole("region", { name: "Cached Cloud library" });
  await expect(
    panel.getByRole("listitem").filter({ hasText: "Pending local note" }),
  ).toContainText("Pending upload");
  await expect(
    panel.getByRole("listitem").filter({ hasText: "Local competing note" }),
  ).toContainText("Conflict");
  const state = await page.evaluate(() =>
    window.cloudDownloadFixture.state("shared"),
  );
  expect(state?.current?.snapshot?.bodyMarkdown).toBe("Local competing note");
  expect(state?.conflict?.remote?.bodyMarkdown).toBe("Committed remote source");
  await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
});

test("a browser reload resumes the persisted page after a bounded incomplete pass", async ({
  page,
}) => {
  pageLimit = 1;
  for (let i = 0; i < 12; i++)
    await server.seedRemote(`remote-${i}`, `Remote ${i}`);
  await page.getByRole("button", { name: "Download Cloud notes" }).click();
  await expect(
    page.getByRole("status", { name: "Cloud download" }),
  ).toContainText("more:");
  expect(
    await page.evaluate(() => window.cloudDownloadFixture.progress()),
  ).toMatchObject({ started: true, more: true, complete: false });
  await page.reload();
  await page.waitForFunction(() => !!window.cloudDownloadFixture);
  const start = requests.length;
  await page.getByRole("button", { name: "Download Cloud notes" }).click();
  await expect(
    page.getByRole("status", { name: "Cloud download" }),
  ).toContainText("complete:");
  expect(requests[start]).toBe("/v1/notes?pageToken");
  await expect(
    page
      .getByRole("region", { name: "Cached Cloud library" })
      .getByRole("listitem"),
  ).toHaveCount(12);
});

test("a held old response cannot populate a reopened context after cancellation", async ({
  page,
}) => {
  await server.seedRemote("remote", "Remote after cancellation");
  server.control.holdDownloads = true;
  await page.getByRole("button", { name: "Download Cloud notes" }).click();
  await expect.poll(() => server.control.downloaded).toBe(1);
  await page.evaluate(() => window.cloudDownloadFixture.reopen());
  server.release();
  await expect.poll(() => inFlight).toBe(0);
  expect(
    await page.evaluate(() => window.cloudDownloadFixture.progress()),
  ).toMatchObject({ started: false, more: false });
  expect(
    await page.evaluate(() => window.cloudDownloadFixture.state("remote")),
  ).toBeNull();
  await expect(
    page
      .getByRole("region", { name: "Cached Cloud library" })
      .getByRole("listitem"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Download Cloud notes" }).click();
  await expect(
    page.getByRole("status", { name: "Cloud download" }),
  ).toContainText("complete:");
  await expect(
    page.getByRole("region", { name: "Cached Cloud library" }),
  ).toContainText("Remote after cancellation");
});
