import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import type {} from "../fixtures/cloud-conflict-preview";

const UNAVAILABLE_COPY =
  "Cloud conflict preview unavailable. Preserved versions on this device were not changed.";

const CONFLICT_SUMMARY_COPY =
  "Conflict: Automatic Cloud upload is paused while both preserved versions remain on this device.";

const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-conflict-preview.html")}?db=peel-m0-cloud-conflict-${randomUUID()}`,
  );
  await page.waitForFunction(() => !!window.cloudConflictPreviewFixture);
});

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) {
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).some((db) => db.name === "peel-local-v1"),
      ),
    ).toBe(false);
    await page.evaluate(() => window.cloudConflictPreviewFixture.destroy());
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  }
  expect(pageErrors).toEqual([]);
});

test("displays preserved conflict versions from IndexedDB across reload with zero storage writes or automatic clipboard access", async ({
  page,
}) => {
  const before = await page.evaluate(() =>
    window.cloudConflictPreviewFixture.readStoredState(0, "conflict-active"),
  );
  expect(before?.conflict).not.toBeNull();

  const region = page.getByRole("region", { name: "Cloud conflict preview" });
  await expect(
    region.getByRole("heading", { level: 1, name: "Cloud conflict preview" }),
  ).toBeVisible();
  await expect(region.getByRole("status")).toHaveText(CONFLICT_SUMMARY_COPY);

  const localCard = region.getByRole("article", {
    name: "Draft on this device",
  });
  const remoteCard = region.getByRole("article", {
    name: "Observed Cloud version",
  });
  await expect(localCard).toContainText("Local state: Active");
  await expect(localCard).toContainText(
    "Base revision: 1 (unconfirmed local change)",
  );
  await expect(localCard.locator(".cloud-conflict-preview-body")).toHaveText(
    "# Shopping list\n- Local oat milk\n- Matcha powder 原文 ##home",
  );

  await expect(remoteCard).toContainText("Observed Cloud state: Active");
  await expect(remoteCard).toContainText(
    "Observed Cloud revision 2 (cached on this device)",
  );
  await expect(remoteCard.locator(".cloud-conflict-preview-body")).toHaveText(
    "# Shopping list\n- Observed almond milk\n- Sencha tea ##home",
  );

  await expect(page.locator("body")).not.toContainText("All notes synced");
  await expect(page.locator("body")).not.toContainText("Up to date");
  await expect(page.locator("body")).not.toContainText("Latest");
  await expect(page.locator("body")).not.toContainText("Live");
  await expect(
    page.getByRole("button", {
      name: /save|put away|resolve|restore|retry/i,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => window.cloudConflictPreviewFixture.copiedCalls()),
  ).toEqual([]);

  await localCard.getByRole("button", { name: "Copy draft text" }).click();
  await remoteCard
    .getByRole("button", { name: "Copy observed Cloud text" })
    .click();

  await page.reload();
  await page.waitForFunction(() => !!window.cloudConflictPreviewFixture);
  await expect(
    region
      .getByRole("article", { name: "Draft on this device" })
      .locator(".cloud-conflict-preview-body"),
  ).toHaveText(
    "# Shopping list\n- Local oat milk\n- Matcha powder 原文 ##home",
  );
  await expect(
    region
      .getByRole("article", { name: "Observed Cloud version" })
      .locator(".cloud-conflict-preview-body"),
  ).toHaveText("# Shopping list\n- Observed almond milk\n- Sencha tea ##home");

  const after = await page.evaluate(() =>
    window.cloudConflictPreviewFixture.readStoredState(0, "conflict-active"),
  );
  expect(after).toEqual(before);
  expect(
    await page.evaluate(() =>
      window.cloudConflictPreviewFixture.unexpectedWrites(),
    ),
  ).toBe(0);
  expect(
    await page.evaluate(() =>
      window.cloudConflictPreviewFixture.unexpectedCloses(),
    ),
  ).toBe(0);
});

test("distinguishes archived, trashed, local purge, remote permanent purge and empty active notes", async ({
  page,
}) => {
  const region = page.getByRole("region", { name: "Cloud conflict preview" });
  const localCard = region.getByRole("article", {
    name: "Draft on this device",
  });
  const remoteCard = region.getByRole("article", {
    name: "Observed Cloud version",
  });

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.setNote("conflict-lifecycle"),
  );
  await expect(localCard).toContainText("Local state: Archived");
  await expect(localCard.locator(".cloud-conflict-preview-body")).toHaveText(
    "# Quarterly archive\nArchived on laptop",
  );
  await expect(remoteCard).toContainText("Observed Cloud state: In Trash");
  await expect(remoteCard).toContainText(
    "Observed Cloud revision 3 (cached on this device)",
  );
  await expect(remoteCard.locator(".cloud-conflict-preview-body")).toHaveText(
    "# Quarterly archive\nMoved to Trash on phone",
  );
  await expect(
    localCard.getByRole("button", { name: "Copy draft text" }),
  ).toBeVisible();
  await expect(
    remoteCard.getByRole("button", { name: "Copy observed Cloud text" }),
  ).toBeVisible();

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.setNote("conflict-remote-purged"),
  );
  await expect(localCard).toContainText("Local state: Active");
  await expect(localCard.locator(".cloud-conflict-preview-body")).toHaveText(
    "# Recoverable local draft\nKeep this text safe on this device",
  );
  await expect(
    localCard.getByRole("button", { name: "Copy draft text" }),
  ).toBeVisible();
  await expect(remoteCard).toContainText(
    "Observed Cloud state: Permanently purged in Cloud",
  );
  await expect(remoteCard).toContainText(
    "Observed Cloud revision 2 (cached on this device)",
  );
  await expect(remoteCard).toContainText(
    "This note identity was permanently purged in Cloud at observed revision 2. No remote note text exists. A permanently purged note ID cannot be restored; saving your draft later requires a new note ID.",
  );
  await expect(
    remoteCard.getByRole("button", { name: "Copy observed Cloud text" }),
  ).toHaveCount(0);

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.setNote("conflict-local-purged"),
  );
  await expect(localCard).toContainText("Local state: Permanent purge queued");
  await expect(localCard).toContainText(
    "Permanent deletion is queued on this device. No local draft text is stored for this version.",
  );
  await expect(
    localCard.getByRole("button", { name: "Copy draft text" }),
  ).toHaveCount(0);
  await expect(remoteCard).toContainText("Observed Cloud state: Active");
  await expect(remoteCard.locator(".cloud-conflict-preview-body")).toHaveText(
    "# Remote note kept alive\nEdited elsewhere before purge",
  );
  await remoteCard
    .getByRole("button", { name: "Copy observed Cloud text" })
    .click();
  expect(
    await page.evaluate(() => window.cloudConflictPreviewFixture.copiedCalls()),
  ).toEqual(["# Remote note kept alive\nEdited elsewhere before purge"]);

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.setNote("conflict-empty-remote"),
  );
  await expect(localCard).toContainText("Local state: In Trash");
  await expect(localCard.locator(".cloud-conflict-preview-body")).toHaveText(
    "# Trashed local draft\nStill has text",
  );
  await expect(
    localCard.getByRole("button", { name: "Copy draft text" }),
  ).toBeVisible();
  await expect(remoteCard).toContainText("Observed Cloud state: Active");
  await expect(remoteCard).toContainText(
    "This observed Cloud version is an empty active note with no text.",
  );
  await expect(remoteCard).not.toContainText("permanently purged");
  await expect(
    remoteCard.getByRole("button", { name: "Copy observed Cloud text" }),
  ).toHaveCount(0);
});

test("shows honest non-conflict cache statuses without fabricating comparison columns", async ({
  page,
}) => {
  const region = page.getByRole("region", { name: "Cloud conflict preview" });

  const cases = [
    {
      noteId: "missing-note",
      status: "No cached Cloud note",
      detail:
        "No cached Cloud note is stored for this selection on this device.",
    },
    {
      noteId: "note-pending",
      status: "Pending upload",
      detail:
        "No Cloud conflict is recorded for this note. Local changes remain pending upload on this device.",
    },
    {
      noteId: "note-saved",
      status: "Saved in Cloud",
      detail: "No Cloud conflict is recorded for this note.",
    },
    {
      noteId: "note-deleted",
      status: "Deleted in Cloud",
      detail:
        "No Cloud conflict is recorded for this note. This note identity was permanently deleted in Cloud.",
    },
  ];

  for (const entry of cases) {
    await page.evaluate(
      (id) => window.cloudConflictPreviewFixture.setNote(id),
      entry.noteId,
    );
    await expect(region.getByRole("status")).toHaveText(entry.status);
    await expect(region).toContainText(entry.detail);
    await expect(region.getByRole("article")).toHaveCount(0);
    await expect(region.getByRole("button")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "Deferred remote head while sending",
    );
  }
});

test("renders untrusted HTML, Markdown and Unicode as literal selectable text without script execution", async ({
  page,
}) => {
  const region = page.getByRole("region", { name: "Cloud conflict preview" });
  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.setNote("conflict-literal-html"),
  );

  const localCard = region.getByRole("article", {
    name: "Draft on this device",
  });
  const remoteCard = region.getByRole("article", {
    name: "Observed Cloud version",
  });

  await expect(localCard).toContainText(
    "Base revision: None (created offline before conflict)",
  );
  const expectedLocal =
    '<script>window.__pwnedLocal = true</script>\n<img src=x onerror="window.__pwnedImg=1">\n**Literal** `markdown` 原文';
  const expectedRemote =
    '<svg onload="window.__pwnedRemote = true"></svg>\n# Heading stays literal\n' +
    "LONGTOKEN_".repeat(22);

  const localBody = localCard.locator("pre.cloud-conflict-preview-body");
  const remoteBody = remoteCard.locator("pre.cloud-conflict-preview-body");
  await expect(localBody).toHaveText(expectedLocal);
  await expect(remoteBody).toHaveText(expectedRemote);

  expect(await region.locator("img, svg, script").count()).toBe(0);
  expect(
    await page.evaluate(() => ({
      local: Reflect.get(window, "__pwnedLocal"),
      img: Reflect.get(window, "__pwnedImg"),
      remote: Reflect.get(window, "__pwnedRemote"),
    })),
  ).toEqual({
    local: undefined,
    img: undefined,
    remote: undefined,
  });

  expect(
    await localBody.evaluate((el) => getComputedStyle(el).userSelect),
  ).toBe("text");
  expect(
    await remoteBody.evaluate((el) => getComputedStyle(el).userSelect),
  ).toBe("text");
});

test("immediately hides previous data and discards late reads across account, collection, generation, in-place scope, note, refresh and unmount transitions", async ({
  page,
}) => {
  const region = page.getByRole("region", { name: "Cloud conflict preview" });
  await expect(region).toContainText("Local oat milk");

  const immediateAccountSwitch = await page.evaluate(() => {
    window.cloudConflictPreviewFixture.holdReads(1);
    window.cloudConflictPreviewFixture.select(1);
    const section = document.querySelector(".cloud-conflict-preview")!;
    return {
      text: section.textContent ?? "",
      busy: section.getAttribute("aria-busy"),
      cards: section.querySelectorAll("article").length,
    };
  });
  expect(immediateAccountSwitch.text).not.toContain("Local oat milk");
  expect(immediateAccountSwitch.text).toContain(
    "Loading Cloud conflict preview...",
  );
  expect(immediateAccountSwitch.busy).toBe("true");
  expect(immediateAccountSwitch.cards).toBe(0);

  await page.waitForFunction(
    () => window.cloudConflictPreviewFixture.heldReadCount() === 1,
  );
  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.releaseReads(false),
  );
  await expect(region).toContainText("Account B private local draft");
  await expect(region).not.toContainText("Local oat milk");

  for (const fail of [false, true]) {
    await page.evaluate(() => {
      window.cloudConflictPreviewFixture.select(0);
    });
    await expect(region).toContainText("Local oat milk");

    await page.evaluate(() => {
      window.cloudConflictPreviewFixture.holdReads(0);
      window.cloudConflictPreviewFixture.refresh();
    });
    await page.waitForFunction(
      () => window.cloudConflictPreviewFixture.heldReadCount() === 1,
    );
    await expect(region.getByRole("article")).toHaveCount(0);

    await page.evaluate(() =>
      window.cloudConflictPreviewFixture.select(1, "conflict-active", {
        mutateScopeInPlace: true,
      }),
    );
    await expect(region).toContainText("Account B private local draft");

    await page.evaluate(
      (shouldFail) =>
        window.cloudConflictPreviewFixture.releaseReads(shouldFail),
      fail,
    );
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(region).toContainText("Account B private local draft");
    await expect(region).not.toContainText("Local oat milk");
    await expect(page.getByRole("alert")).toHaveCount(0);
  }

  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.holdReads(1);
    window.cloudConflictPreviewFixture.refresh();
  });
  await page.waitForFunction(
    () => window.cloudConflictPreviewFixture.heldReadCount() === 1,
  );
  await page.evaluate(() => window.cloudConflictPreviewFixture.select(2));
  await expect(region).toContainText("Alternate collection local draft");
  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.releaseReads(true),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region).toContainText("Alternate collection local draft");

  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.holdReads(2);
    window.cloudConflictPreviewFixture.refresh();
  });
  await page.waitForFunction(
    () => window.cloudConflictPreviewFixture.heldReadCount() === 1,
  );
  await page.evaluate(() => window.cloudConflictPreviewFixture.select(3));
  await expect(region).toContainText("Generation 2 local draft");
  await expect(region).toContainText(
    "Observed Cloud revision 4 (cached on this device)",
  );
  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.releaseReads(false),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region).toContainText("Generation 2 local draft");

  await page.evaluate(() => window.cloudConflictPreviewFixture.select(0));
  await expect(region).toContainText("Local oat milk");
  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.holdReads(0);
    window.cloudConflictPreviewFixture.setNote("conflict-lifecycle");
  });
  await page.waitForFunction(
    () => window.cloudConflictPreviewFixture.heldReadCount() === 1,
  );
  await expect(region.getByRole("article")).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.setNote("missing-note"),
  );
  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.releaseReads(false),
  );
  await expect(region.getByRole("status")).toHaveText("No cached Cloud note");
  await expect(region.getByRole("article")).toHaveCount(0);

  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.holdReads(0);
    window.cloudConflictPreviewFixture.setNote("conflict-active");
  });
  await page.waitForFunction(
    () => window.cloudConflictPreviewFixture.heldReadCount() === 1,
  );
  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.unmount();
    window.cloudConflictPreviewFixture.releaseReads(true);
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(region).toHaveCount(0);
});

test("refuses invalid props, getters, aborted signals, foreign scopes, corrupt rows and closed stores without raw error leaks", async ({
  page,
}) => {
  const region = page.getByRole("region", { name: "Cloud conflict preview" });
  await expect(region).toContainText("Local oat milk");

  const zeroReadCases: Array<() => void> = [
    () =>
      window.cloudConflictPreviewFixture.setMalformedPreset("invalid-scope"),
    () =>
      window.cloudConflictPreviewFixture.setMalformedPreset("invalid-note-id"),
    () => window.cloudConflictPreviewFixture.setMalformedPreset("null-context"),
    () =>
      window.cloudConflictPreviewFixture.setMalformedPreset("context-getter"),
    () => window.cloudConflictPreviewFixture.setMalformedPreset("scope-getter"),
    () => window.cloudConflictPreviewFixture.setRefreshKey(-1),
    () => window.cloudConflictPreviewFixture.setRefreshKey(1.5),
    () => window.cloudConflictPreviewFixture.renderPreAborted(),
  ];

  for (let index = 0; index < zeroReadCases.length; index++) {
    await page.evaluate(() => {
      window.cloudConflictPreviewFixture.resetSignal();
      window.cloudConflictPreviewFixture.setRefreshKey(0);
      window.cloudConflictPreviewFixture.select(0, "conflict-active");
    });
    await expect(region).toContainText("Local oat milk");

    const readsBefore = await page.evaluate(() =>
      window.cloudConflictPreviewFixture.readCount(),
    );
    await page.evaluate(zeroReadCases[index]);

    await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
    await expect(region.getByRole("article")).toHaveCount(0);
    await expect(region.getByRole("button")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Local oat milk");
    await expect(page.locator("body")).not.toContainText("synthetic-private");
    expect(
      await page.evaluate(() => window.cloudConflictPreviewFixture.readCount()),
    ).toBe(readsBefore);
  }

  expect(
    await page.evaluate(() => window.cloudConflictPreviewFixture.getterCalls()),
  ).toBe(0);

  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.resetSignal();
    window.cloudConflictPreviewFixture.setRefreshKey(0);
    window.cloudConflictPreviewFixture.select(0, "conflict-active");
  });
  await expect(region).toContainText("Local oat milk");

  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.holdReads(0);
    window.cloudConflictPreviewFixture.refresh();
  });
  await page.waitForFunction(
    () => window.cloudConflictPreviewFixture.heldReadCount() === 1,
  );
  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.abort();
    window.cloudConflictPreviewFixture.releaseReads(false);
  });
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("article")).toHaveCount(0);

  for (const preset of ["foreign-scope", "foreign-generation"] as const) {
    await page.evaluate((kind) => {
      window.cloudConflictPreviewFixture.resetSignal();
      window.cloudConflictPreviewFixture.select(0, "conflict-active");
      window.cloudConflictPreviewFixture.setMalformedPreset(kind);
    }, preset);
    await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
    await expect(region.getByRole("article")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("belongs to another");
  }

  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.resetSignal();
    window.cloudConflictPreviewFixture.select(0, "conflict-active");
    window.cloudConflictPreviewFixture.failReads(0);
    window.cloudConflictPreviewFixture.refresh();
  });
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(page.locator("body")).not.toContainText("synthetic-private");
  await page.evaluate(() => window.cloudConflictPreviewFixture.failReads(null));

  await page.evaluate(async () => {
    window.cloudConflictPreviewFixture.select(0, "conflict-active");
    await window.cloudConflictPreviewFixture.corruptNote(0, "conflict-active");
  });
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("article")).toHaveCount(0);

  await page.evaluate(async () => {
    window.cloudConflictPreviewFixture.select(1, "conflict-active");
  });
  await expect(region).toContainText("Account B private local draft");
  await page.evaluate(async () => {
    await window.cloudConflictPreviewFixture.closeUnderlyingStore(1);
  });
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(region.getByRole("article")).toHaveCount(0);
});

test("copies explicit per-side text with independent single-flight locks, generic error recovery and stale-outcome refusal", async ({
  page,
}) => {
  const region = page.getByRole("region", { name: "Cloud conflict preview" });
  const localCard = region.getByRole("article", {
    name: "Draft on this device",
  });
  const remoteCard = region.getByRole("article", {
    name: "Observed Cloud version",
  });
  const copyDraft = localCard.getByRole("button", { name: "Copy draft text" });
  const copyRemote = remoteCard.getByRole("button", {
    name: "Copy observed Cloud text",
  });

  await expect(copyDraft).toBeVisible();
  await expect(copyRemote).toBeVisible();

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.holdClipboard(true),
  );
  await page.evaluate(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      ".cloud-conflict-preview-copy",
    );
    buttons[0].click();
    buttons[0].click();
  });
  await expect(copyDraft).toBeDisabled();
  await expect(copyRemote).toBeEnabled();
  expect(
    await page.evaluate(() =>
      window.cloudConflictPreviewFixture.heldClipboardCount(),
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() => window.cloudConflictPreviewFixture.copiedCalls()),
  ).toEqual(["# Shopping list\n- Local oat milk\n- Matcha powder 原文 ##home"]);

  await copyRemote.click();
  await expect(copyRemote).toBeDisabled();
  expect(
    await page.evaluate(() =>
      window.cloudConflictPreviewFixture.heldClipboardCount(),
    ),
  ).toBe(2);
  expect(
    await page.evaluate(() => window.cloudConflictPreviewFixture.copiedCalls()),
  ).toEqual([
    "# Shopping list\n- Local oat milk\n- Matcha powder 原文 ##home",
    "# Shopping list\n- Observed almond milk\n- Sencha tea ##home",
  ]);

  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.holdClipboard(false);
    window.cloudConflictPreviewFixture.releaseNextClipboard(false);
  });
  await expect(copyDraft).toBeEnabled();
  await expect(localCard.getByRole("status")).toHaveText(
    "Draft text copied to clipboard.",
  );
  await expect(copyRemote).toBeDisabled();

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.releaseNextClipboard(true),
  );
  await expect(copyRemote).toBeEnabled();
  await expect(remoteCard.getByRole("alert")).toHaveText(
    "Could not copy observed Cloud text. Select the text below to copy it manually.",
  );
  await expect(page.locator("body")).not.toContainText("synthetic-private");

  await copyRemote.click();
  await expect(remoteCard.getByRole("alert")).toHaveCount(0);
  await expect(remoteCard.getByRole("status")).toHaveText(
    "Observed Cloud text copied to clipboard.",
  );

  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.clearCopiedCalls();
    window.cloudConflictPreviewFixture.holdClipboard(true);
  });
  await copyDraft.click();
  await expect(copyDraft).toBeDisabled();
  await page.evaluate(async () => {
    await window.cloudConflictPreviewFixture.updateActiveConflictBodies(
      "# Updated local draft after refresh",
      "# Updated remote version after refresh",
    );
    window.cloudConflictPreviewFixture.refresh();
  });
  await expect(localCard.locator(".cloud-conflict-preview-body")).toHaveText(
    "# Updated local draft after refresh",
  );
  await expect(localCard.getByRole("status")).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.releaseAllClipboard(false),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(localCard.getByRole("status")).toHaveCount(0);
  await expect(localCard.getByRole("alert")).toHaveCount(0);

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.clearCopiedCalls(),
  );
  await copyDraft.click();
  expect(
    await page.evaluate(() => window.cloudConflictPreviewFixture.copiedCalls()),
  ).toEqual(["# Updated local draft after refresh"]);

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.holdClipboard(true),
  );
  await copyRemote.click();
  await page.evaluate(() => window.cloudConflictPreviewFixture.select(1));
  await expect(region).toContainText("Account B private local draft");
  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.releaseAllClipboard(true),
  );
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page.getByRole("alert")).toHaveCount(0);

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.holdClipboard(true),
  );
  await remoteCard
    .getByRole("button", { name: "Copy observed Cloud text" })
    .click();
  await page.evaluate(() => {
    window.cloudConflictPreviewFixture.abort();
    window.cloudConflictPreviewFixture.releaseAllClipboard(false);
  });
  await expect(region.getByRole("alert")).toHaveText(UNAVAILABLE_COPY);
  await expect(page.locator("body")).not.toContainText("copied to clipboard");
});

test("supports keyboard navigation, dark mode, target sizing and responsive desktop and 390px layouts without overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const region = page.getByRole("region", { name: "Cloud conflict preview" });
  const localCard = region.getByRole("article", {
    name: "Draft on this device",
  });
  const remoteCard = region.getByRole("article", {
    name: "Observed Cloud version",
  });
  const copyDraft = localCard.getByRole("button", { name: "Copy draft text" });
  const copyRemote = remoteCard.getByRole("button", {
    name: "Copy observed Cloud text",
  });

  await expect(copyDraft).toBeVisible();
  await copyDraft.focus();
  await expect(copyDraft).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(localCard.getByRole("status")).toHaveText(
    "Draft text copied to clipboard.",
  );

  await page.keyboard.press("Tab");
  await expect(copyRemote).toBeFocused();
  await page.keyboard.press("Space");
  await expect(remoteCard.getByRole("status")).toHaveText(
    "Observed Cloud text copied to clipboard.",
  );

  const localBoxDesktop = await localCard.boundingBox(),
    remoteBoxDesktop = await remoteCard.boundingBox(),
    draftBtnDesktop = await copyDraft.boundingBox(),
    remoteBtnDesktop = await copyRemote.boundingBox();
  expect(localBoxDesktop).not.toBeNull();
  expect(remoteBoxDesktop).not.toBeNull();
  expect(remoteBoxDesktop!.x).toBeGreaterThanOrEqual(
    localBoxDesktop!.x + localBoxDesktop!.width - 1,
  );
  expect(
    Math.abs(remoteBoxDesktop!.y - localBoxDesktop!.y),
  ).toBeLessThanOrEqual(2);
  expect(draftBtnDesktop!.width).toBeGreaterThanOrEqual(24);
  expect(draftBtnDesktop!.height).toBeGreaterThanOrEqual(24);
  expect(remoteBtnDesktop!.width).toBeGreaterThanOrEqual(24);
  expect(remoteBtnDesktop!.height).toBeGreaterThanOrEqual(24);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);

  await page.screenshot({
    path: testInfo.outputPath("conflict-preview-desktop.png"),
    fullPage: true,
  });

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.setNote("conflict-literal-html"),
  );
  await expect(localCard).toContainText("window.__pwnedLocal");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.evaluate(() =>
    window.cloudConflictPreviewFixture.setNote("conflict-active"),
  );
  await expect(localCard).toContainText("Local oat milk");
  const localBoxMobile = await localCard.boundingBox(),
    remoteBoxMobile = await remoteCard.boundingBox(),
    draftBtnMobile = await copyDraft.boundingBox(),
    remoteBtnMobile = await copyRemote.boundingBox();
  expect(remoteBoxMobile!.y).toBeGreaterThanOrEqual(
    localBoxMobile!.y + localBoxMobile!.height - 1,
  );
  expect(draftBtnMobile!.width).toBeGreaterThanOrEqual(24);
  expect(draftBtnMobile!.height).toBeGreaterThanOrEqual(40);
  expect(remoteBtnMobile!.width).toBeGreaterThanOrEqual(24);
  expect(remoteBtnMobile!.height).toBeGreaterThanOrEqual(40);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: testInfo.outputPath("conflict-preview-mobile.png"),
    fullPage: true,
  });

  await page.emulateMedia({ colorScheme: "dark" });
  const darkSurface = await region.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(darkSurface).not.toBe("rgb(255, 254, 250)");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
