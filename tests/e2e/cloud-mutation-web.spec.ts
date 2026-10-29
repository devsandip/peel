import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { startCloudUploadServer } from "../fixtures/cloud-upload-server";
import type {} from "../fixtures/cloud-mutation-web";

let server: Awaited<ReturnType<typeof startCloudUploadServer>>,
  inFlight = 0;
const errors: string[] = [],
  operations: { opId: string; contentHash: string }[] = [];
test.beforeEach(async ({ page, baseURL }) => {
  server = await startCloudUploadServer(new URL(baseURL!).origin);
  errors.length = 0;
  operations.length = 0;
  inFlight = 0;
  page.on("pageerror", () => errors.push("Unexpected browser exception"));
  await page.addInitScript(
    (scope) => Reflect.set(window, "syntheticMutationConfig", { scope }),
    server.scope,
  );
  await page.route("**/v1/mutations", async (route) => {
    const request = route.request();
    expect(new URL(request.url()).origin).toBe(new URL(baseURL!).origin);
    expect(request.method()).toBe("POST");
    expect(request.headers()["x-peel-csrf"]).toBe("c".repeat(43));
    const mutation = request.postDataJSON().mutation;
    operations.push({ opId: mutation.opId, contentHash: mutation.contentHash });
    inFlight++;
    try {
      const response = await route.fetch({
        url: server.api + "/v1/mutations",
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
    `/@fs${resolve("tests/fixtures/cloud-mutation-web.html")}?db=peel-m0-cloud-web-mutation-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudMutationWebFixture);
});
test.afterEach(async ({ page }) => {
  server.release();
  await expect.poll(() => inFlight).toBe(0);
  await page.evaluate(() => window.cloudMutationWebFixture.destroy());
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  await server.close();
  expect(errors).toEqual([]);
});

test("only the matching web confirmation saves newer retained typing", async ({
  page,
  playwright,
}) => {
  server.control.hold = true;
  const first = page.evaluate(async () => {
    const id = await window.cloudMutationWebFixture.capture("First source");
    await window.cloudMutationWebFixture.upload();
    return id;
  });
  await expect.poll(() => server.control.committed).toBe(1);
  const noteId = await page.evaluate(() =>
    window.cloudMutationWebFixture.noteId(),
  );
  expect(noteId).not.toBeNull();
  await page.evaluate(() =>
    window.cloudMutationWebFixture.edit("Newer source"),
  );
  await expect(page.getByRole("status")).toContainText("Pending upload");
  server.release();
  server.control.hold = true;
  const id = await first;
  expect(id).toBe(noteId);
  await expect.poll(() => server.control.committed).toBe(2);
  const state = await page.evaluate(
    (id) => window.cloudMutationWebFixture.state(id),
    id,
  );
  expect(state?.current?.snapshot?.bodyMarkdown).toBe("Newer source");
  expect(state?.inFlight).not.toBeNull();
  await expect(page.getByRole("status")).toContainText("Pending upload");
  const independent = await playwright.request.newContext();
  try {
    const response = await independent.get(`${server.api}/v1/notes/${id}`, {
      headers: {
        "x-synthetic-fixture": server.token,
        "x-peel-collection": server.scope.collectionId,
        "x-peel-mode-generation": String(server.scope.modeGeneration),
      },
    });
    expect((await response.json()).head.snapshot.bodyMarkdown).toBe(
      "Newer source",
    );
  } finally {
    await independent.dispose();
  }
  server.release();
  await expect(page.getByRole("status")).toContainText("Saved in Cloud");
  expect(
    (await page.evaluate((id) => window.cloudMutationWebFixture.state(id), id))
      ?.pending,
  ).toBeNull();
  expect(operations[0].opId).not.toBe(operations[1].opId);
});

test("real401 pauses scheduling and explicit recovery reuses the durable operation", async ({
  page,
}) => {
  server.control.unauthorized = true;
  const id = await page.evaluate(async () => {
    const id = await window.cloudMutationWebFixture.capture(
      "Retained while sign-in is required",
    );
    await window.cloudMutationWebFixture.upload();
    return id;
  });
  expect(
    await page.evaluate(() => window.cloudMutationWebFixture.view()),
  ).toMatchObject({
    upload: "sign-in-required",
    status: "Pending upload",
    retained: true,
  });
  expect(operations).toHaveLength(1);
  expect(server.control.committed).toBe(0);
  server.control.unauthorized = false;
  await page.evaluate(() => window.cloudMutationWebFixture.schedule());
  expect(operations).toHaveLength(1);
  await page.evaluate(() => window.cloudMutationWebFixture.upload());
  await expect(page.getByRole("status")).toContainText("Saved in Cloud");
  expect(operations[1]).toEqual(operations[0]);
  expect(
    (await page.evaluate((id) => window.cloudMutationWebFixture.state(id), id))
      ?.baseRevision,
  ).toBe(1);
});

test("reload after a lost successful reply retries the identical operation without a second revision", async ({
  page,
  playwright,
}) => {
  server.control.hold = true;
  const lost = page
    .evaluate(async () => {
      const id = await window.cloudMutationWebFixture.capture(
        "Recover this exact source",
      );
      await window.cloudMutationWebFixture.upload();
      return id;
    })
    .catch((error) => {
      if (
        !/Execution context was destroyed|Target page.*closed/i.test(
          String(error),
        )
      )
        throw error;
      return null;
    });
  await expect.poll(() => server.control.committed).toBe(1);
  const before = operations[0];
  const noteId = await page.evaluate(() =>
    window.cloudMutationWebFixture.noteId(),
  );
  if (!noteId) throw Error("Missing explicit synthetic owner ID");
  expect(
    (
      await page.evaluate(
        (id) => window.cloudMutationWebFixture.state(id),
        noteId,
      )
    )?.inFlight?.opId,
  ).toBe(before.opId);
  await page.reload();
  await page.waitForFunction(() => !!window.cloudMutationWebFixture);
  server.release();
  await expect.poll(() => inFlight).toBe(0);
  await lost;
  await page.evaluate(async (id) => {
    await window.cloudMutationWebFixture.open(id);
    await window.cloudMutationWebFixture.upload();
  }, noteId);
  await expect(page.getByRole("status")).toContainText("Saved in Cloud");
  expect(operations[1]).toEqual(before);
  const independent = await playwright.request.newContext();
  try {
    const response = await independent.get(`${server.api}/v1/notes/${noteId}`, {
      headers: {
        "x-synthetic-fixture": server.token,
        "x-peel-collection": server.scope.collectionId,
        "x-peel-mode-generation": String(server.scope.modeGeneration),
      },
    });
    const head = (await response.json()).head;
    expect(head.revision).toBe(1);
    expect(head.snapshot.bodyMarkdown).toBe("Recover this exact source");
  } finally {
    await independent.dispose();
  }
});
