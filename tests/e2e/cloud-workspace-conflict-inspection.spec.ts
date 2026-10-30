import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";
import { startCloudUploadServer } from "../fixtures/cloud-upload-server";
import { cloudScope } from "../fixtures/cloud-durable-contract";
import type {} from "../fixtures/cloud-workspace-conflict-inspection";

let server: Awaited<ReturnType<typeof startCloudUploadServer>>;
const pageErrors: string[] = [];

test.beforeEach(async ({ page, baseURL }) => {
  server = await startCloudUploadServer(new URL(baseURL!).origin, {
    ...cloudScope,
    ownerSubject: "synthetic-workspace-conflict-owner-b",
  });
  pageErrors.length = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(
    (config) => {
      Reflect.set(window, "syntheticWorkspaceConflictInspectionConfig", config);
    },
    { api: server.api, contexts: server.contexts },
  );
  await page.goto(
    `/@fs${resolve("tests/fixtures/cloud-workspace-conflict-inspection.html")}?db=peel-m0-cloud-workspace-conflict-${randomUUID()}`,
  );
  await page.waitForFunction(
    () => !!window.cloudWorkspaceConflictInspectionFixture,
  );
});

test.afterEach(async ({ page }) => {
  server.release();
  if (!page.isClosed()) {
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).some((db) => db.name === "peel-local-v1"),
      ),
    ).toBe(false);
    await page.evaluate(() =>
      window.cloudWorkspaceConflictInspectionFixture.destroy(),
    );
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  }
  await server.close();
  expect(pageErrors).toEqual([]);
});

test("navigates from Notes, Archive, Trash and Needs attention conflicts into read-only preview with zero storage writes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  const preview = page.getByRole("region", { name: "Cloud conflict preview" });

  await expect(library.getByRole("listitem")).toHaveCount(3);

  const beforeStates = await page.evaluate(async () => {
    const f = window.cloudWorkspaceConflictInspectionFixture;
    f.setForbidCommits(true);
    return {
      counts: f.counts(),
      active: await f.readState(0, "conflict-active"),
      archived: await f.readState(0, "conflict-archived"),
      trashed: await f.readState(0, "conflict-trashed"),
      remotePurged: await f.readState(0, "conflict-remote-purged"),
      localPurged: await f.readState(0, "conflict-local-purged"),
      deferredObserved: await f.readState(0, "deferred-observed-recovery"),
    };
  });

  // Non-conflict active card offers Open, never Inspect conflict.
  const editableCard = library
    .getByRole("listitem")
    .filter({ hasText: "Editable workspace note" });
  await expect(
    editableCard.getByRole("button", { name: /^Open / }),
  ).toHaveCount(1);
  await expect(
    editableCard.getByRole("button", { name: /^Inspect conflict/ }),
  ).toHaveCount(0);

  // Active conflict card offers both Open and sibling Inspect conflict without nested buttons.
  const activeConflictCard = library
    .getByRole("listitem")
    .filter({ hasText: "Active roadmap conflict" });
  await expect(activeConflictCard).toContainText("Conflict");
  await expect(
    activeConflictCard.getByRole("button", {
      name: "Open Active roadmap conflict",
    }),
  ).toHaveCount(1);
  const inspectActiveBtn = activeConflictCard.getByRole("button", {
    name: "Inspect conflict for Active roadmap conflict",
  });
  await expect(inspectActiveBtn).toHaveText("Inspect conflict");
  expect(await activeConflictCard.locator("button button").count()).toBe(0);

  await inspectActiveBtn.click();
  await expect(page.locator(".cloud-workspace")).toHaveAttribute(
    "data-inspection-open",
    "true",
  );
  await expect(page.locator(".cloud-workspace")).toHaveAttribute(
    "data-editor-open",
    "false",
  );
  await expect(
    page.getByRole("article", { name: "Cloud note editor" }),
  ).toHaveCount(0);
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(
    "Conflict: Automatic Cloud upload is paused while both preserved versions remain on this device.",
  );
  await expect(preview).toContainText(
    "Observed Cloud revision 2 (cached on this device)",
  );
  await expect(preview).toContainText(
    '<img src=x onerror="window.__conflictXss=true">',
  );
  expect(await page.locator("img").count()).toBe(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "__conflictXss")),
  ).toBeUndefined();
  await expect(
    page.getByRole("button", { name: /save|resolve|restore/i }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      window.cloudWorkspaceConflictInspectionFixture.copied(),
    ),
  ).toEqual([]);

  await preview.getByRole("button", { name: "Copy draft text" }).click();
  await expect(preview).toContainText("Draft text copied to clipboard.");
  await preview
    .getByRole("button", { name: "Copy observed Cloud text" })
    .click();
  await expect(preview).toContainText(
    "Observed Cloud text copied to clipboard.",
  );
  const copiedBodies = await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.copied(),
  );
  expect(copiedBodies).toHaveLength(2);
  expect(copiedBodies[0]).toContain("Local roadmap bullet 原文");
  expect(copiedBodies[1]).toContain(
    "Observed Cloud bullet from laptop ##roadmap",
  );

  // Archive conflict offers Inspect conflict and never opens in the active editor.
  await library.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(library.getByRole("listitem")).toHaveCount(1);
  await expect(library.getByRole("button", { name: /^Open / })).toHaveCount(0);
  await library
    .getByRole("button", {
      name: "Inspect conflict for Archived budget conflict",
    })
    .click();
  await expect(preview).toContainText("Local state: Archived");
  await expect(preview).toContainText("Observed Cloud state: Active");
  await expect(preview).toContainText(
    "Observed Cloud revision 3 (cached on this device)",
  );
  await expect(preview).toContainText("Archived local figures Q4");
  await expect(
    page.getByRole("article", { name: "Cloud note editor" }),
  ).toHaveCount(0);

  // Trash conflict offers Inspect conflict and never opens in the active editor.
  await library.getByRole("button", { name: "Trash", exact: true }).click();
  await expect(library.getByRole("listitem")).toHaveCount(1);
  await expect(library.getByRole("button", { name: /^Open / })).toHaveCount(0);
  await library
    .getByRole("button", {
      name: "Inspect conflict for Trashed receipt conflict",
    })
    .click();
  await expect(preview).toContainText("Local state: In Trash");
  await expect(preview).toContainText("Observed Cloud state: In Trash");
  await expect(preview).toContainText(
    "Observed Cloud revision 5 (cached on this device)",
  );
  await expect(preview).toContainText("Local trashed receipt details");

  // Needs attention includes active/archived/trashed/recovery/purged conflicts plus deferred-observed Pending upload recovery.
  await library
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  await expect(library.getByRole("listitem")).toHaveCount(7);

  const pendingRecoveryCard = library
    .getByRole("listitem")
    .filter({ hasText: "Pending upload" });
  await expect(pendingRecoveryCard).toHaveCount(1);
  await expect(pendingRecoveryCard).toContainText("Cloud note needs recovery");
  await expect(pendingRecoveryCard).toContainText("Local recovery required");
  await expect(
    pendingRecoveryCard.getByRole("button", { name: /^Inspect conflict/ }),
  ).toHaveCount(0);

  await library
    .locator('[data-conflict-note-id="conflict-remote-purged"]')
    .click();
  await expect(preview).toContainText(
    "Observed Cloud state: Permanently purged in Cloud",
  );
  await expect(preview).toContainText(
    "Observed Cloud revision 6 (cached on this device)",
  );
  await expect(preview).toContainText(
    "A permanently purged note ID cannot be restored; saving your draft later requires a new note ID.",
  );
  await expect(
    preview.getByRole("button", { name: "Copy draft text" }),
  ).toBeVisible();
  await expect(
    preview.getByRole("button", { name: "Copy observed Cloud text" }),
  ).toHaveCount(0);

  await library
    .locator('[data-conflict-note-id="conflict-local-purged"]')
    .click();
  await expect(preview).toContainText("Local state: Permanent purge queued");
  await expect(
    preview.getByRole("button", { name: "Copy draft text" }),
  ).toHaveCount(0);
  await expect(
    preview.getByRole("button", { name: "Copy observed Cloud text" }),
  ).toBeVisible();
  await expect(preview).toContainText(
    "Observed Cloud version kept when local purge conflicted",
  );

  await page.getByRole("button", { name: "Back to notes" }).click();
  await expect(preview).toHaveCount(0);

  const afterStates = await page.evaluate(async () => {
    const f = window.cloudWorkspaceConflictInspectionFixture;
    const result = {
      counts: f.counts(),
      active: await f.readState(0, "conflict-active"),
      archived: await f.readState(0, "conflict-archived"),
      trashed: await f.readState(0, "conflict-trashed"),
      remotePurged: await f.readState(0, "conflict-remote-purged"),
      localPurged: await f.readState(0, "conflict-local-purged"),
      deferredObserved: await f.readState(0, "deferred-observed-recovery"),
    };
    f.setForbidCommits(false);
    return result;
  });

  expect(afterStates.counts.commits).toEqual(beforeStates.counts.commits);
  expect(afterStates.counts.closes).toEqual([0, 0, 0, 0]);
  expect(afterStates.active).toEqual(beforeStates.active);
  expect(afterStates.archived).toEqual(beforeStates.archived);
  expect(afterStates.trashed).toEqual(beforeStates.trashed);
  expect(afterStates.remotePurged).toEqual(beforeStates.remotePurged);
  expect(afterStates.localPurged).toEqual(beforeStates.localPurged);
  expect(afterStates.deferredObserved).toEqual(beforeStates.deferredObserved);
});

test("retains and acknowledges active editor drafts before conflict inspection, preserving recovery on failure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });
  const preview = page.getByRole("region", { name: "Cloud conflict preview" });

  await library
    .getByRole("button", { name: "Open Editable workspace note" })
    .click();
  await expect(editorArticle.getByRole("status")).toHaveText("Saved in Cloud");

  server.control.hold = true;
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.failRetention(0, true),
  );
  const typedDraft =
    "# Retained before conflict inspection\nLatest typed body must survive retention failure ##work";
  const textbox = editorArticle.getByRole("textbox", { name: "Note text" });
  await textbox.fill(typedDraft);

  await library
    .getByRole("button", {
      name: "Inspect conflict for Active roadmap conflict",
    })
    .click();

  await expect(preview).toHaveCount(0);
  await expect(editorArticle).toBeVisible();
  await expect(textbox).toContainText(
    "Latest typed body must survive retention failure",
  );
  await expect(
    editorArticle.getByRole("button", { name: "Retry" }),
  ).toBeVisible();
  await expect(
    editorArticle.getByRole("button", { name: "Copy text" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    "synthetic-private-retention-secret-token",
  );
  expect(
    await page.evaluate(() =>
      window.cloudWorkspaceConflictInspectionFixture.putAways(),
    ),
  ).toEqual([]);

  // Retention now succeeds, but parent onPutAway rejects: editor still stays mounted with generic alert.
  await page.evaluate(() => {
    window.cloudWorkspaceConflictInspectionFixture.failRetention(0, false);
    window.cloudWorkspaceConflictInspectionFixture.failPutAway(true);
  });
  await library
    .getByRole("button", {
      name: "Inspect conflict for Active roadmap conflict",
    })
    .click();
  await expect(preview).toHaveCount(0);
  await expect(editorArticle).toBeVisible();
  await expect(textbox).toContainText(
    "Latest typed body must survive retention failure",
  );
  await expect(page.locator(".cloud-workspace-alert")).toHaveText(
    "Could not put away this note. Retry or copy the text.",
  );
  await expect(page.locator("body")).not.toContainText(
    "synthetic-private-put-away-secret-token",
  );

  // Once onPutAway succeeds, clicking Inspect conflict acknowledges closure and mounts CloudConflictPreview.
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.failPutAway(false),
  );
  await library
    .getByRole("button", {
      name: "Inspect conflict for Active roadmap conflict",
    })
    .click();
  await expect(editorArticle).toHaveCount(0);
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("Local roadmap bullet 原文");

  const putAwaysAfterSwitch = await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.putAways(),
  );
  expect(putAwaysAfterSwitch.at(-1)).toMatchObject({
    owner: 0,
    noteId: "editable-note",
    retained: true,
    closed: true,
  });
  expect(putAwaysAfterSwitch.at(-1)?.bodyMarkdown).toBe(typedDraft);

  const retainedCard = library
    .getByRole("listitem")
    .filter({ hasText: "Retained before conflict inspection" });
  await expect(retainedCard).toContainText("Pending upload");

  server.release();
  await expect(retainedCard).toContainText("Saved in Cloud");

  // Concurrent Inspect conflict + green-minus Put away during held commit notifies onPutAway once and honors dismiss.
  await library.getByRole("button", { name: "New note", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(editorArticle).toBeVisible();
  const countBeforeCoalesce = await page.evaluate(
    () => window.cloudWorkspaceConflictInspectionFixture.putAways().length,
  );
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.holdCommit(0),
  );
  await editorArticle
    .getByRole("textbox", { name: "Note text" })
    .fill("# Concurrent dismiss and conflict click\nCoalesced retention");
  await page.waitForFunction(
    () => window.cloudWorkspaceConflictInspectionFixture.heldCommitsCount() > 0,
  );

  await library
    .getByRole("button", {
      name: "Inspect conflict for Second active conflict",
    })
    .click();
  await editorArticle.getByRole("button", { name: "Put away note" }).click();
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.releaseCommits(),
  );

  await expect(editorArticle).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.cloudWorkspaceConflictInspectionFixture.putAways().length,
    ),
  ).toBe(countBeforeCoalesce + 1);
});

test("isolates held reads, superseded open/create callbacks, scope changes, in-place mutations, getters and abort", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  const preview = page.getByRole("region", { name: "Cloud conflict preview" });
  const editorArticle = page.getByRole("article", {
    name: "Cloud note editor",
  });

  // Open conflict-active, then hold reads and switch to conflict-second: old conflict text hides immediately.
  await library
    .getByRole("button", {
      name: "Inspect conflict for Active roadmap conflict",
    })
    .click();
  await expect(preview).toContainText("Local roadmap bullet 原文");

  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.holdReads(0),
  );
  await library
    .getByRole("button", {
      name: "Inspect conflict for Second active conflict",
    })
    .click();
  await page.waitForFunction(
    () =>
      window.cloudWorkspaceConflictInspectionFixture.heldReads().length === 1,
  );
  await expect(preview).toHaveAttribute("aria-busy", "true");
  await expect(preview).not.toContainText("Local roadmap bullet 原文");

  // Switch account while Account A preview read is still held, then fail the old read: zero cross-account leak.
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.selectScope(1),
  );
  await expect(preview).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.releaseReads(true),
  );
  await expect(library).toContainText("Account B private conflict");
  await expect(page.locator("body")).not.toContainText(
    "Local roadmap bullet 原文",
  );
  await expect(page.locator("body")).not.toContainText(
    "synthetic-private-read-secret-token",
  );

  await library
    .getByRole("button", {
      name: "Inspect conflict for Account B private conflict",
    })
    .click();
  await expect(preview).toContainText("Account B local draft body");

  // Switching collectionId and modeGeneration synchronously unmounts previous scope inspection.
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.selectScope(2),
  );
  await expect(preview).toHaveCount(0);
  await expect(library).toContainText("Alt collection conflict");

  await library
    .getByRole("button", {
      name: "Inspect conflict for Alt collection conflict",
    })
    .click();
  await expect(preview).toContainText("Alt collection local draft body");

  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.selectScope(3),
  );
  await expect(preview).toHaveCount(0);
  await expect(library).toContainText("Generation 2 conflict");

  // Return to Account A and test held Open superseded by Inspect conflict, and Open hiding open preview synchronously.
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.selectScope(0),
  );
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.holdOpen(0),
  );
  await library
    .getByRole("button", { name: "Open Editable workspace note" })
    .click();
  await page.waitForFunction(
    () =>
      window.cloudWorkspaceConflictInspectionFixture.heldOpens().length === 1,
  );

  await library
    .getByRole("button", {
      name: "Inspect conflict for Active roadmap conflict",
    })
    .click();
  await expect(preview).toContainText("Local roadmap bullet 原文");
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.releaseOpens(true),
  );
  await expect(preview).toContainText("Local roadmap bullet 原文");
  await expect(editorArticle).toHaveCount(0);
  await expect(page.locator(".cloud-workspace-alert")).toHaveCount(0);

  // Starting Open while conflict preview is visible hides old conflict details synchronously even while Open is held.
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.holdOpen(0),
  );
  await library
    .getByRole("button", { name: "Open Editable workspace note" })
    .click();
  await expect(preview).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.releaseOpens(false),
  );
  await expect(editorArticle).toBeVisible();
  // Switch directly from the idle open editor back to conflict inspection (exercises CloudWorkspace putAwayActiveEditor with no upload in flight).
  await library
    .getByRole("button", {
      name: "Inspect conflict for Active roadmap conflict",
    })
    .click();
  await expect(editorArticle).toHaveCount(0);
  await expect(preview).toContainText("Local roadmap bullet 原文");
  await page.getByRole("button", { name: "Back to notes" }).click();
  await expect(preview).toHaveCount(0);

  // Held Create superseded by Inspect conflict never mounts late editor over preview.
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.holdCreate(0),
  );
  await library.getByRole("button", { name: "New note", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.cloudWorkspaceConflictInspectionFixture.heldCreatesCount() === 1,
  );
  await library
    .getByRole("button", {
      name: "Inspect conflict for Second active conflict",
    })
    .click();
  await expect(preview).toContainText("Second note local draft body");
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.releaseCreates(true),
  );
  await expect(preview).toContainText("Second note local draft body");
  await expect(editorArticle).toHaveCount(0);

  // In-place caller mutation of context/scope cannot hijack open preview or copy, and rerender unmounts cleanly.
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.mountMutableContextAndCorruptInPlace(),
  );
  await library
    .getByRole("button", {
      name: "Inspect conflict for Active roadmap conflict",
    })
    .click();
  await expect(preview).toContainText("Local roadmap bullet 原文");
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.triggerRerender(),
  );
  await expect(preview).toHaveCount(0);
  await expect(library.getByRole("status")).toHaveText(
    "Cached Cloud library unavailable",
  );
  await expect(library.getByRole("listitem")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Account B private conflict",
  );
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.clearMutableContext(),
  );

  // refreshKey update while preview is open reflects honest non-conflict state, and invalid refreshKey hides preview.
  await library
    .getByRole("button", {
      name: "Inspect conflict for Second active conflict",
    })
    .click();
  await expect(preview).toContainText("Second note local draft body");
  await page.evaluate(async () => {
    await window.cloudWorkspaceConflictInspectionFixture.replaceConflictWithSaved(
      "conflict-second",
      "# Second active conflict\nExternally resolved and confirmed",
    );
    window.cloudWorkspaceConflictInspectionFixture.refresh();
  });
  await expect(preview).toContainText("Saved in Cloud");
  await expect(preview).toContainText(
    "No Cloud conflict is recorded for this note.",
  );
  await expect(preview.getByRole("button", { name: /^Copy / })).toHaveCount(0);

  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.setInvalidRefresh(),
  );
  await expect(preview).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.refresh(),
  );

  // Standalone CloudCachedLibrary omission and error handling plus accessor-getter refusal.
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.setViewMode(
      "library-no-inspect",
    ),
  );
  await expect(
    page.getByRole("button", { name: /^Inspect conflict/ }),
  ).toHaveCount(0);

  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.setViewMode(
      "library-failing-inspect",
    ),
  );
  await page
    .getByRole("button", {
      name: "Inspect conflict for Active roadmap conflict",
    })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not inspect this Cloud conflict. Preserved versions on this device were not changed.",
  );
  await expect(page.locator("body")).not.toContainText(
    "synthetic-private-inspect-secret-token",
  );
  expect(
    await page.evaluate(() =>
      window.cloudWorkspaceConflictInspectionFixture.standaloneInspectCalls(),
    ),
  ).toEqual([
    {
      ownerSubject: cloudScope.ownerSubject,
      noteId: "conflict-active",
      frozen: true,
    },
  ]);

  await page.evaluate(() => {
    window.cloudWorkspaceConflictInspectionFixture.resetGetterCalls();
    window.cloudWorkspaceConflictInspectionFixture.setGetterPreset(
      "library-scope-getter",
    );
  });
  await expect(page.getByRole("alert")).toHaveText(
    "Cached Cloud library unavailable",
  );

  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.setViewMode("workspace"),
  );
  const countsBeforeGetters = await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.counts(),
  );
  for (const preset of [
    "workspace-context-getter",
    "workspace-scope-getter",
  ] as const) {
    await page.evaluate(
      (p) => window.cloudWorkspaceConflictInspectionFixture.setGetterPreset(p),
      preset,
    );
    await expect(page.getByRole("alert")).toHaveText(
      "Cached Cloud library unavailable",
    );
  }
  expect(
    await page.evaluate(() =>
      window.cloudWorkspaceConflictInspectionFixture.getterCalls(),
    ),
  ).toBe(0);
  expect(
    await page.evaluate(() =>
      window.cloudWorkspaceConflictInspectionFixture.counts(),
    ),
  ).toEqual(countsBeforeGetters);

  // AbortSignal cancellation while conflict preview and held clipboard copy are active.
  await page.evaluate(() => {
    window.cloudWorkspaceConflictInspectionFixture.setGetterPreset("none");
    window.cloudWorkspaceConflictInspectionFixture.setClipboardBehavior({
      hold: true,
    });
  });
  await library
    .getByRole("button", {
      name: "Inspect conflict for Active roadmap conflict",
    })
    .click();
  await preview.getByRole("button", { name: "Copy draft text" }).click();
  await page.waitForFunction(
    () =>
      window.cloudWorkspaceConflictInspectionFixture.heldClipboardCount() === 1,
  );
  await page.evaluate(() => {
    window.cloudWorkspaceConflictInspectionFixture.abortCurrent();
    window.cloudWorkspaceConflictInspectionFixture.releaseClipboard(true);
  });
  await expect(preview).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "synthetic-private-clipboard-secret-token",
  );
});

test("supports keyboard focus entry, Back to notes focus restoration, 1280x800 split pane and 390x844 mobile sheet", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const library = page.getByRole("region", { name: "Cached Cloud library" });
  const preview = page.getByRole("region", { name: "Cloud conflict preview" });

  const inspectActiveBtn = library.getByRole("button", {
    name: "Inspect conflict for Active roadmap conflict",
  });
  await inspectActiveBtn.focus();
  await expect(inspectActiveBtn).toBeFocused();
  await page.keyboard.press("Enter");

  const backBtn = page.getByRole("button", { name: "Back to notes" });
  const copyDraft = preview.getByRole("button", { name: "Copy draft text" });
  const copyRemote = preview.getByRole("button", {
    name: "Copy observed Cloud text",
  });
  await expect(backBtn).toBeFocused();
  await expect(preview).toHaveAttribute("aria-busy", "false");
  await expect(copyDraft).toBeVisible();
  await expect(backBtn).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(copyDraft).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(copyRemote).toBeFocused();

  // Desktop 1280x800 split-pane and side-by-side comparison geometry.
  const libraryPaneBox = await page
      .locator(".cloud-workspace-library")
      .boundingBox(),
    inspectionPaneBox = await page
      .locator(".cloud-workspace-inspection")
      .boundingBox(),
    localCardBox = await preview
      .locator('[data-version-side="local"]')
      .boundingBox(),
    remoteCardBox = await preview
      .locator('[data-version-side="remote"]')
      .boundingBox(),
    backBox = await backBtn.boundingBox(),
    inspectBox = await inspectActiveBtn.boundingBox();

  expect(libraryPaneBox).not.toBeNull();
  expect(inspectionPaneBox).not.toBeNull();
  expect(localCardBox).not.toBeNull();
  expect(remoteCardBox).not.toBeNull();
  expect(backBox).not.toBeNull();
  expect(inspectBox).not.toBeNull();

  expect(inspectionPaneBox!.x).toBeGreaterThanOrEqual(
    libraryPaneBox!.x + libraryPaneBox!.width - 2,
  );
  expect(remoteCardBox!.x).toBeGreaterThanOrEqual(
    localCardBox!.x + localCardBox!.width,
  );
  expect(backBox!.width).toBeGreaterThanOrEqual(24);
  expect(backBox!.height).toBeGreaterThanOrEqual(36);
  expect(inspectBox!.width).toBeGreaterThanOrEqual(24);
  expect(inspectBox!.height).toBeGreaterThanOrEqual(36);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(1280);

  await page.screenshot({
    path: testInfo.outputPath("workspace-conflict-inspection-desktop.png"),
  });

  await backBtn.focus();
  await page.keyboard.press("Enter");
  await expect(preview).toHaveCount(0);
  await expect(inspectActiveBtn).toBeFocused();

  // Held preview read proves Back to notes focuses immediately and retains focus until Copy draft text mounts.
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.holdReads(0),
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      window.cloudWorkspaceConflictInspectionFixture.heldReads().length === 1,
  );
  await expect(backBtn).toBeFocused();
  await expect(preview).toHaveAttribute("aria-busy", "true");
  await expect(copyDraft).toHaveCount(0);
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.releaseReads(false),
  );
  await expect(preview).toHaveAttribute("aria-busy", "false");
  await expect(copyDraft).toBeVisible();
  await expect(backBtn).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(copyDraft).toBeFocused();
  await backBtn.focus();
  await page.keyboard.press("Enter");
  await expect(preview).toHaveCount(0);
  await expect(inspectActiveBtn).toBeFocused();

  // Disambiguate two untitled "Cloud note needs recovery" cards in Needs attention on Back to notes.
  await library
    .getByRole("button", { name: "Needs attention", exact: true })
    .click();
  const remotePurgedBtn = library.locator(
    '[data-conflict-note-id="conflict-remote-purged"]',
  );
  const localPurgedBtn = library.locator(
    '[data-conflict-note-id="conflict-local-purged"]',
  );
  await expect(remotePurgedBtn).toHaveAttribute(
    "aria-label",
    "Inspect conflict for Cloud note needs recovery",
  );
  await expect(localPurgedBtn).toHaveAttribute(
    "aria-label",
    "Inspect conflict for Cloud note needs recovery",
  );

  await localPurgedBtn.focus();
  await page.keyboard.press("Space");
  await expect(backBtn).toBeFocused();
  await page.keyboard.press("Space");
  await expect(preview).toHaveCount(0);
  await expect(localPurgedBtn).toBeFocused();
  await expect(remotePurgedBtn).not.toBeFocused();

  // Fallback to New note across a held catalog refresh when the conflict entry was cleared before close.
  await library.getByRole("button", { name: "Notes", exact: true }).click();
  await library
    .getByRole("button", {
      name: "Inspect conflict for Second active conflict",
    })
    .click();
  await expect(backBtn).toBeFocused();
  await page.evaluate(async () => {
    await window.cloudWorkspaceConflictInspectionFixture.replaceConflictWithSaved(
      "conflict-second",
      "# Second active conflict\nResolved before closing preview",
    );
    window.cloudWorkspaceConflictInspectionFixture.holdLists(0);
    window.cloudWorkspaceConflictInspectionFixture.refresh();
  });
  await page.waitForFunction(
    () =>
      window.cloudWorkspaceConflictInspectionFixture.heldLists().length >= 1,
  );
  await backBtn.click();
  await expect(preview).toHaveCount(0);
  const newNoteBtn = library.getByRole("button", {
    name: "New note",
    exact: true,
  });
  await expect(newNoteBtn).toBeFocused();
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.releaseLists(false),
  );
  await expect(
    library.getByRole("button", {
      name: "Inspect conflict for Second active conflict",
    }),
  ).toHaveCount(0);
  await expect(newNoteBtn).toBeFocused();

  // Narrow 390x844 full-viewport sheet with inert background library and live-region suppression.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() =>
    window.cloudWorkspaceConflictInspectionFixture.setConnection("paused"),
  );
  const connectionText = page.locator(".cloud-workspace-connection-text");
  await expect(connectionText).toHaveAttribute("aria-live", "polite");

  await inspectActiveBtn.click();
  await expect(backBtn).toBeFocused();
  await expect(page.locator(".cloud-workspace-library")).toHaveAttribute(
    "inert",
    "",
  );
  await expect(connectionText).toHaveAttribute("aria-live", "off");
  await expect(preview).toHaveAttribute("aria-busy", "false");

  const mobileSheetBox = await page
      .locator(".cloud-workspace-inspection")
      .boundingBox(),
    mobileBackBox = await backBtn.boundingBox(),
    mobileLocalBox = await preview
      .locator('[data-version-side="local"]')
      .boundingBox(),
    mobileRemoteBox = await preview
      .locator('[data-version-side="remote"]')
      .boundingBox();

  expect(mobileSheetBox).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  expect(mobileBackBox!.width).toBeGreaterThanOrEqual(24);
  expect(mobileBackBox!.height).toBeGreaterThanOrEqual(40);
  expect(mobileRemoteBox!.y).toBeGreaterThanOrEqual(
    mobileLocalBox!.y + mobileLocalBox!.height,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);

  await page.screenshot({
    path: testInfo.outputPath("workspace-conflict-inspection-mobile.png"),
  });

  await backBtn.click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator(".cloud-workspace-library")).not.toHaveAttribute(
    "inert",
  );
  await expect(connectionText).toHaveAttribute("aria-live", "polite");
  await expect(inspectActiveBtn).toBeFocused();
});
