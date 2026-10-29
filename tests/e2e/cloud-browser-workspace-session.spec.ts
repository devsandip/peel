import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { startCloudBrowserWorkspaceSessionServer } from "../fixtures/cloud-browser-workspace-session-server";
import type {} from "../fixtures/cloud-browser-workspace-session";

let server: Awaited<ReturnType<typeof startCloudBrowserWorkspaceSessionServer>>,
  inFlight = 0;
const errors: string[] = [];
async function issue(index: number) {
  const issued = await server.issue(index);
  expect(issued.cookie).toContain("; HttpOnly; Secure; SameSite=Lax;");
  return issued.csrfToken;
}
test.beforeEach(async ({ page, baseURL }) => {
  server = await startCloudBrowserWorkspaceSessionServer(
    new URL(baseURL!).origin,
  );
  inFlight = 0;
  errors.length = 0;
  const csrfToken = await issue(0);
  page.on("pageerror", () => errors.push("Unexpected browser exception"));
  await page.addInitScript(
    (csrfToken) =>
      Reflect.set(window, "syntheticBrowserWorkspaceConfig", { csrfToken }),
    csrfToken,
  );
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
    inFlight++;
    try {
      const response = await route.fetch({
        url:
          server.api +
          new URL(request.url()).pathname +
          new URL(request.url()).search,
        // Explicit synthetic proxy cookie, never claimed as browser-managed authentication.
        headers: { ...request.headers(), cookie: server.cookie() },
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
    `/@fs${resolve("tests/fixtures/cloud-browser-workspace-session.html")}?db=peel-m0-cloud-browser-workspace-${randomUUID()}`,
  );
  await page.waitForFunction(
    () => !!window.cloudBrowserWorkspaceSessionFixture,
  );
});
test.afterEach(async ({ page }) => {
  if (!server) return;
  server.release();
  try {
    await expect.poll(() => inFlight).toBe(0);
    if (!page.isClosed()) {
      const initialized = await page.evaluate(
        () => !!window.cloudBrowserWorkspaceSessionFixture,
      );
      if (initialized)
        await page.evaluate(() =>
          window.cloudBrowserWorkspaceSessionFixture.destroy(),
        );
      expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    }
  } finally {
    await server.close();
  }
  expect(errors).toEqual([]);
});

test("discovers through the synthetic session proxy and autosaves with Put away before matching Cloud confirmation", async ({
  page,
}) => {
  expect(server.observations).toEqual([]);
  await page.evaluate(() =>
    window.cloudBrowserWorkspaceSessionFixture.prepare(),
  );
  const library = page.getByRole("region", { name: "Cached Cloud library" }),
    article = page.getByRole("article", { name: "Cloud note editor" });
  await expect(library).toBeVisible();
  expect(server.observations).toEqual([
    {
      path: "/v1/library-context",
      status: 200,
      hasCookie: true,
      hasBinding: true,
    },
  ]);
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.resolverCalls(),
    ),
  ).toEqual([1]);
  expect(server.control.committed).toBe(0);
  expect(server.control.pages).toBe(0);
  server.control.holdMutation = true;
  await library.getByRole("button", { name: "New note", exact: true }).click();
  await article
    .getByRole("textbox", { name: "Note text" })
    .fill("Discovered context autosave");
  await expect(article.getByRole("button", { name: /^Save$/ })).toHaveCount(0);
  await expect.poll(() => server.control.committed).toBe(1);
  await expect(article.getByRole("status")).toHaveText("Pending upload");
  const [pending] = await page.evaluate(() =>
    window.cloudBrowserWorkspaceSessionFixture.retained(),
  );
  expect(pending).toMatchObject({
    body: "Discovered context autosave",
    status: "Pending upload",
    retained: true,
  });
  await article.getByRole("button", { name: "Put away note" }).click();
  await expect(article).toHaveCount(0);
  await expect(library).toContainText("Pending upload");
  server.release();
  await expect(library).toContainText("Saved in Cloud");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.cloudBrowserWorkspaceSessionFixture.retained().length,
      ),
    )
    .toBe(0);
  const head = await server.head(0, pending.noteId);
  expect(head.kind).toBe("note");
  if (head.kind === "note")
    expect(head.snapshot.bodyMarkdown).toBe("Discovered context autosave");
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.closeCounts(),
    ),
  ).toEqual([0]);
});

test("explicit download refreshes the discovered account's catalog and replacement keeps the original cache", async ({
  page,
}) => {
  await server.seedRemote(0, "shared-note", "Account A discovered remote");
  await server.seedRemote(1, "shared-note", "Account B discovered remote");
  await page.evaluate(() =>
    window.cloudBrowserWorkspaceSessionFixture.prepare(),
  );
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  await expect(library).toContainText("has not been downloaded");
  await expect(library).not.toContainText("Account A discovered remote");
  await page.getByRole("button", { name: "Download Cloud notes" }).click();
  await expect(
    page.getByRole("status", { name: "Cloud download state" }),
  ).toHaveText("complete");
  await expect(library).toContainText("Account A discovered remote");
  await expect(library).not.toContainText("Account B discovered remote");
  const csrfToken = await issue(1);
  await page.evaluate(
    (token) => window.cloudBrowserWorkspaceSessionFixture.select(token),
    csrfToken,
  );
  await expect(library).toHaveCount(0);
  await expect(
    page.getByText("Account A discovered remote", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudBrowserWorkspaceSessionFixture.prepare(),
  );
  await expect(library).not.toContainText("Account A discovered remote");
  await page.getByRole("button", { name: "Download Cloud notes" }).click();
  await expect(library).toContainText("Account B discovered remote");
  await expect(library).not.toContainText("Account A discovered remote");
  expect(
    (
      await page.evaluate(() =>
        window.cloudBrowserWorkspaceSessionFixture.read(0, "shared-note"),
      )
    )?.current?.snapshot?.bodyMarkdown,
  ).toBe("Account A discovered remote");
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.resolverCalls(),
    ),
  ).toEqual([1, 1]);
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.closeCounts(),
    ),
  ).toEqual([0, 0]);
  expect(server.control.committed).toBe(0);
});

test("cancels a held old discovery before any cache lookup and withholds its late result", async ({
  page,
}) => {
  server.control.holdContext = true;
  const old = page.evaluate(() =>
    window.cloudBrowserWorkspaceSessionFixture.prepare().then(
      () => "unexpected ready",
      (error) => error.kind,
    ),
  );
  await expect.poll(() => server.control.contexts).toBe(1);
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.resolverCalls(),
    ),
  ).toEqual([0]);
  const csrfToken = await issue(1);
  await page.evaluate(
    (token) => window.cloudBrowserWorkspaceSessionFixture.select(token),
    csrfToken,
  );
  expect(await old).toBe("canceled");
  server.release();
  await page.evaluate(() =>
    window.cloudBrowserWorkspaceSessionFixture.prepare(),
  );
  await expect(
    page.getByRole("status", { name: "Workspace preparation" }),
  ).toHaveText("ready");
  expect(
    await page.evaluate(
      () => window.cloudBrowserWorkspaceSessionFixture.view(0).kind,
    ),
  ).toBe("canceled");
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.resolverCalls(),
    ),
  ).toEqual([0, 1]);
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.read(0, "shared-note"),
    ),
  ).toBeNull();
  expect(
    await page.evaluate(
      () => window.cloudBrowserWorkspaceSessionFixture.scope().ownerSubject,
    ),
  ).toBe("fixture-owner-b");
  expect(server.control.committed).toBe(0);
});

test("late original-account confirmation stays pending and copyable after a new account replaces the workspace", async ({
  page,
}) => {
  await page.evaluate(() =>
    window.cloudBrowserWorkspaceSessionFixture.prepare(),
  );
  server.control.holdMutation = true;
  const library = page.getByRole("region", { name: "Cached Cloud library" }),
    article = page.getByRole("article", { name: "Cloud note editor" });
  await library.getByRole("button", { name: "New note", exact: true }).click();
  await article
    .getByRole("textbox", { name: "Note text" })
    .fill("Original account retained source");
  await expect.poll(() => server.control.committed).toBe(1);
  const [pending] = await page.evaluate(() =>
    window.cloudBrowserWorkspaceSessionFixture.retained(0),
  );
  const csrfToken = await issue(1);
  await page.evaluate(
    (token) => window.cloudBrowserWorkspaceSessionFixture.select(token),
    csrfToken,
  );
  await expect(article).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudBrowserWorkspaceSessionFixture.prepare(),
  );
  server.release();
  await expect.poll(() => inFlight).toBe(0);
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.retained(0),
    ),
  ).toEqual([pending]);
  await expect(library).not.toContainText("Original account retained source");
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.retained(1),
    ),
  ).toEqual([]);
  const original = await server.head(0, pending.noteId),
    other = await server.head(1, pending.noteId);
  expect(original.kind).toBe("note");
  expect(other.kind).not.toBe("note");
  expect(
    await page.evaluate(() =>
      window.cloudBrowserWorkspaceSessionFixture.closeCounts(),
    ),
  ).toEqual([0, 0]);
});
