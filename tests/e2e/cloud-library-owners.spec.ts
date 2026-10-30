import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { startCloudUploadServer } from "../fixtures/cloud-upload-server";
import { cloudScope, cloudDraft } from "../fixtures/cloud-durable-contract";
import {
  createCloudClient,
  saveCloudDraft,
  startCloudMutation,
} from "../../packages/cloud-protocol/src/index";
import type {} from "../fixtures/cloud-library-owners";
import type { CloudMutationRequest } from "../../packages/cloud-protocol/src/server";
let server: Awaited<ReturnType<typeof startCloudUploadServer>>;
const errors: string[] = [];
const requests: CloudMutationRequest[] = [];
test.beforeEach(async ({ page, baseURL }) => {
  server = await startCloudUploadServer(new URL(baseURL!).origin, {
    ...cloudScope,
    ownerSubject: "synthetic-library-owners-b",
  });
  errors.length = 0;
  requests.length = 0;
  page.on("request", (request) => {
    if (request.url() === server.api + "/v1/mutations")
      requests.push(JSON.parse(request.postData()!));
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (config) => Reflect.set(window, "syntheticOwnersConfig", config),
    { api: server.api, contexts: server.contexts },
  );
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-library-owners.html")}?db=peel-m0-cloud-library-owners-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudLibraryOwnersFixture);
});
test.afterEach(async ({ page }) => {
  server.release();
  if (!page.isClosed()) {
    expect(
      await page.evaluate(() => window.cloudLibraryOwnersFixture.closeCounts()),
    ).toEqual([0, 0]);
    await page.evaluate(() => window.cloudLibraryOwnersFixture.destroy());
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  }
  await server.close();
  expect(errors).toEqual([]);
});

test("uses the same parent-owned uploader through held ACK/reopen and refreshes a closed card after confirmation", async ({
  page,
  playwright,
}) => {
  const library = page.getByRole("region", { name: "Cached Cloud library" }),
    article = page.getByRole("article", { name: "Cloud note editor" }),
    editor = article.getByRole("textbox", { name: "Note text" });
  await library
    .getByRole("button", { name: "Open Account A controller note" })
    .click();
  await expect(article.getByRole("status")).toHaveText("Saved in Cloud");
  server.control.hold = true;
  await editor.fill("First held controller text");
  await expect.poll(() => server.control.committed).toBe(2);
  await article.getByRole("button", { name: "Put away note" }).click();
  await expect(article).toHaveCount(0);
  await expect(library).toContainText("Pending upload");
  expect(
    await page.evaluate(() => window.cloudLibraryOwnersFixture.retained(0)),
  ).toHaveLength(1);
  await library
    .getByRole("button", { name: "Open First held controller text" })
    .click();
  await expect(editor).toHaveText("First held controller text");
  expect(
    await page.evaluate(() => window.cloudLibraryOwnersFixture.createdOwners()),
  ).toBe(1);
  await editor.fill("Newest controller body ##work");
  await expect(article.getByRole("status")).toHaveText("Pending upload");
  await article.getByRole("button", { name: "Put away note" }).click();
  await expect(article).toHaveCount(0);
  server.release();
  await expect(library).toContainText("Saved in Cloud");
  await expect
    .poll(() =>
      page.evaluate(() => window.cloudLibraryOwnersFixture.retained(0).length),
    )
    .toBe(0);
  expect(server.control.committed).toBe(3);
  expect(requests.map((r) => r.mutation.snapshot!.bodyMarkdown)).toEqual([
    "Account A controller note\nPrivate body 0",
    "First held controller text",
    "Newest controller body ##work",
  ]);
  const client = await playwright.request.newContext();
  try {
    const context = server.contexts[0],
      response = await client.get(server.api + "/v1/notes/shared-note", {
        headers: {
          "x-synthetic-fixture": context.token,
          "x-peel-collection": context.scope.collectionId,
          "x-peel-mode-generation": String(context.scope.modeGeneration),
        },
      });
    expect((await response.json()).head.snapshot.bodyMarkdown).toBe(
      "Newest controller body ##work",
    );
  } finally {
    await client.dispose();
  }
  await library
    .getByRole("button", { name: "Open Newest controller body ##work" })
    .click();
  await expect(editor).toHaveText("Newest controller body ##work");
  expect(
    await page.evaluate(() => window.cloudLibraryOwnersFixture.createdOwners()),
  ).toBe(2);
  await expect(page.getByRole("button", { name: /^save$/i })).toHaveCount(0);
});

test("discards an untouched capture but retains a touched empty pending note until actual confirmation", async ({
  page,
}) => {
  const library = page.getByRole("region", { name: "Cached Cloud library" }),
    article = page.getByRole("article", { name: "Cloud note editor" });
  await library.getByRole("button", { name: "New note", exact: true }).click();
  await expect(article).toBeVisible();
  const emptyId = await page.evaluate(() =>
    window.cloudLibraryOwnersFixture.latestNoteId(),
  );
  await article.getByRole("button", { name: "Put away note" }).click();
  await expect(article).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.cloudLibraryOwnersFixture.retained(0).length),
    )
    .toBe(0);
  expect(
    await page.evaluate(
      (id) => window.cloudLibraryOwnersFixture.read(0, id!),
      emptyId,
    ),
  ).toBeNull();
  server.control.hold = true;
  await library.getByRole("button", { name: "New note", exact: true }).click();
  const editor = article.getByRole("textbox", { name: "Note text" });
  await editor.fill("Temporary draft");
  await expect.poll(() => server.control.committed).toBe(1);
  await editor.fill("");
  await article.getByRole("button", { name: "Put away note" }).click();
  await expect(article).toHaveCount(0);
  expect(
    await page.evaluate(() => window.cloudLibraryOwnersFixture.retained(0)),
  ).toHaveLength(1);
  const touchedId = await page.evaluate(() =>
    window.cloudLibraryOwnersFixture.latestNoteId(),
  );
  const pending = await page.evaluate(
    (id) => window.cloudLibraryOwnersFixture.read(0, id!),
    touchedId,
  );
  expect(pending!.current!.snapshot!.bodyMarkdown).toBe("");
  expect(pending!.pending).not.toBeNull();
  server.release();
  await expect
    .poll(() =>
      page.evaluate(() => window.cloudLibraryOwnersFixture.retained(0).length),
    )
    .toBe(0);
  expect(server.control.committed).toBe(2);
});

test("late old-account cache reads cannot expose an owner or errors in the next workspace", async ({
  page,
}) => {
  await page.evaluate(() => window.cloudLibraryOwnersFixture.holdRead(0));
  await page
    .getByRole("button", { name: "Open Account A controller note" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => window.cloudLibraryOwnersFixture.heldReads()),
    )
    .toBe(1);
  await page.evaluate(() => window.cloudLibraryOwnersFixture.select(1));
  await expect(
    page.getByRole("button", { name: "Open Account B controller note" }),
  ).toBeVisible();
  await page.evaluate(() => window.cloudLibraryOwnersFixture.releaseReads());
  await page
    .getByRole("button", { name: "Open Account B controller note" })
    .click();
  const article = page.getByRole("article", { name: "Cloud note editor" });
  await expect(
    article.getByRole("textbox", { name: "Note text" }),
  ).toContainText("Private body 1");
  await expect(article.getByRole("status")).toHaveText("Saved in Cloud");
  await expect(page.locator("body")).not.toContainText("Private body 0");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() => window.cloudLibraryOwnersFixture.retained(0)),
  ).toEqual([]);
  expect(requests).toHaveLength(1);
});

test("failed retention remains owned and copyable across account cancellation without appearing in the next library", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.evaluate(() =>
    window.cloudLibraryOwnersFixture.failRetention(0, true),
  );
  const article = page.getByRole("article", { name: "Cloud note editor" });
  await article
    .getByRole("textbox", { name: "Note text" })
    .fill("Original account volatile recovery");
  await expect(article.getByRole("status")).toHaveText(
    "Could not retain draft",
  );
  await article.getByRole("button", { name: "Put away note" }).click();
  await expect(article).toBeVisible();
  await page.evaluate(() => window.cloudLibraryOwnersFixture.select(1));
  await expect(
    page.getByRole("button", { name: "Open Account B controller note" }),
  ).toBeVisible();
  const retained = await page.evaluate(() =>
    window.cloudLibraryOwnersFixture.retained(0),
  );
  expect(retained).toHaveLength(1);
  expect(retained[0]).toMatchObject({
    body: "Original account volatile recovery",
    retained: false,
    status: "Could not retain draft",
  });
  await expect(page.locator("body")).not.toContainText(
    "Original account volatile recovery",
  );
  expect(requests).toHaveLength(0);
});

test("puts away a settled Saved note without a verifying flush racing parent acknowledgement", async ({
  page,
}) => {
  const library = page.getByRole("region", { name: "Cached Cloud library" }),
    article = page.getByRole("article", { name: "Cloud note editor" });
  await library
    .getByRole("button", { name: "Open Account A controller note" })
    .click();
  await expect(article.getByRole("status")).toHaveText("Saved in Cloud");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.cloudLibraryOwnersFixture.retained(0)[0]?.retained,
      ),
    )
    .toBe(true);
  expect(requests).toHaveLength(1);
  await article.getByRole("button", { name: "Put away note" }).click();
  await expect(article).toHaveCount(0);
  await expect(library).toContainText("Saved in Cloud");
  await expect
    .poll(() =>
      page.evaluate(() => window.cloudLibraryOwnersFixture.retained(0).length),
    )
    .toBe(0);
  const state = await page.evaluate(() =>
    window.cloudLibraryOwnersFixture.read(0, "shared-note"),
  );
  expect(state?.current?.snapshot?.bodyMarkdown).toBe(
    "Account A controller note\nPrivate body 0",
  );
  expect(state?.pending).toBeNull();
  expect(state?.inFlight).toBeNull();
  expect(requests).toHaveLength(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("puts away a settled Conflict owner and preserves both real durable versions", async ({
  page,
  playwright,
}) => {
  const article = page.getByRole("article", { name: "Cloud note editor" });
  await page
    .getByRole("button", { name: "Open Account A controller note" })
    .click();
  await expect(article.getByRole("status")).toHaveText("Saved in Cloud");
  const api = await playwright.request.newContext();
  try {
    const context = server.contexts[0],
      headers = {
        "x-synthetic-fixture": context.token,
        "x-peel-collection": context.scope.collectionId,
        "x-peel-mode-generation": String(context.scope.modeGeneration),
      },
      head = await api.get(server.api + "/v1/notes/shared-note", { headers }),
      remote = (await head.json()).head.snapshot,
      next = await startCloudMutation(
        saveCloudDraft(
          createCloudClient(context.scope.collectionId, "shared-note", remote),
          {
            kind: "upsert",
            snapshot: {
              ...cloudDraft("Observed remote conflict branch"),
              noteId: "shared-note",
            },
          },
        ),
        randomUUID(),
      ),
      committed = await api.post(server.api + "/v1/mutations", {
        headers,
        data: {
          version: 1,
          collectionId: context.scope.collectionId,
          modeGeneration: context.scope.modeGeneration,
          mutation: next.inFlight,
        },
      });
    expect(committed.status()).toBe(200);
  } finally {
    await api.dispose();
  }
  await article
    .getByRole("textbox", { name: "Note text" })
    .fill("Retained device conflict branch");
  await expect(article.getByRole("status")).toHaveText("Conflict");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.cloudLibraryOwnersFixture.retained(0)[0]?.retained,
      ),
    )
    .toBe(true);
  const before = await page.evaluate(() =>
    window.cloudLibraryOwnersFixture.read(0, "shared-note"),
  );
  expect(before?.conflict?.local).toMatchObject({
    kind: "upsert",
    snapshot: { bodyMarkdown: "Retained device conflict branch" },
  });
  expect(before?.conflict?.remote?.bodyMarkdown).toBe(
    "Observed remote conflict branch",
  );
  await article.getByRole("button", { name: "Put away note" }).click();
  await expect(article).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Cached Cloud library" }),
  ).toContainText("Conflict");
  expect(
    await page.evaluate(() =>
      window.cloudLibraryOwnersFixture.read(0, "shared-note"),
    ),
  ).toEqual(before);
  expect(
    await page.evaluate(() => window.cloudLibraryOwnersFixture.retained(0)),
  ).toEqual([
    {
      noteId: "shared-note",
      body: "Retained device conflict branch",
      retained: true,
      status: "Conflict",
    },
  ]);
  expect(requests).toHaveLength(2);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
