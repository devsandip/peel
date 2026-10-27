import { test, expect } from "@playwright/test";
test("local editing, immediate Close, reload, tags, archive, Trash and transfer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    navigator.storage.persisted = async () => {
      throw new DOMException("Synthetic persistence denial", "SecurityError");
    };
    navigator.storage.persist = async () => {
      throw new DOMException("Synthetic persistence denial", "SecurityError");
    };
  });
  await page.goto("/");
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "Create your first note" }).click();
  const editor = page.getByRole("textbox", { name: "Note text" });
  await editor.fill(
    "# Synthetic morning\nMake **capture** quick. ##Work\n- [ ] Verify saving",
  );
  await page.getByRole("button", { name: "Save and close note" }).click();
  await expect(
    page.getByRole("button", { name: "Open Synthetic morning" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Open Synthetic morning" }).click();
  await expect(editor).toContainText("Verify saving");
  await page.getByRole("checkbox", { name: "Mark task complete" }).click();
  await page.getByRole("button", { name: "Save and close note" }).click();
  await page
    .getByRole("textbox", { name: "Search notes" })
    .fill('"capture quick"');
  await expect(
    page.getByRole("button", { name: "Open Synthetic morning" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await page
    .getByRole("button", { name: "Actions for Synthetic morning" })
    .click();
  await page
    .getByRole("menuitem", { name: "Archive note", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open Synthetic morning" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Archive", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Open Synthetic morning" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for Synthetic morning" })
    .click();
  await page.getByRole("menuitem", { name: "Move to Trash" }).click();
  await page
    .getByRole("button", { name: "Trash", exact: false })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Actions for Synthetic morning" })
    .click();
  await page.getByRole("menuitem", { name: "Restore to Notes" }).click();
  await page.getByRole("button", { name: /^Notes/ }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Request persistence" }).click();
  await expect(
    page.getByText(
      "Persistent storage is unavailable. Export important notes to keep a backup.",
    ),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export notes…" }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe("Peel-notes.zip");
  await page.getByRole("button", { name: "Close settings" }).click();
  expect(errors).toEqual([]);
});
test("a blank draft closes without creating a library entry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create your first note" }).click();
  await page.getByRole("button", { name: "Save and close note" }).click();
  await expect(
    page.getByRole("button", { name: "Create your first note" }),
  ).toBeVisible();
});
test("mobile browser fits at 390 px and note source remains safe text", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Create your first note" }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("<script>window.pwned=true</script>\n##private");
  await page.getByRole("button", { name: "Save and close note" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  expect(
    await page.evaluate(() => Reflect.get(window, "pwned")),
  ).toBeUndefined();
});

test("a failed local write blocks Put away and Retry preserves the draft", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create your first note" }).click();
  const editor = page.getByRole("textbox", { name: "Note text" });
  await editor.fill("Previously acknowledged fixture");
  await expect(
    page.getByText("Saved on this device", { exact: false }).last(),
  ).toBeVisible();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Reflect.set(window, "restorePeelPut", () => {
      IDBObjectStore.prototype.put = original;
    });
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "notes")
        throw new DOMException(
          "Synthetic disk quota failure",
          "QuotaExceededError",
        );
      return original.apply(this, args);
    };
  });
  await editor.fill("Unsaved draft must survive");
  await page.getByRole("button", { name: "Save and close note" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not save on this device",
  );
  await expect(editor).toContainText("Unsaved draft must survive");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await page.evaluate(() => Reflect.get(window, "restorePeelPut")());
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Save and close note" }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Open Unsaved draft must survive" })
    .click();
  await expect(editor).toContainText("Unsaved draft must survive");
});

test("Put away freezes document transactions while the final commit is pending", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create your first note" }).click();
  const editor = page.getByRole("textbox", { name: "Note text" });
  await page.evaluate(() => {
    const original = IDBTransaction.prototype.addEventListener;
    const pending: (() => void)[] = [];
    let released = false;
    Reflect.set(window, "releasePeelWrites", () => {
      released = true;
      IDBTransaction.prototype.addEventListener = original;
      pending.splice(0).forEach((fn) => fn());
    });
    IDBTransaction.prototype.addEventListener = function (
      this: IDBTransaction,
      type: string,
      listener: EventListenerOrEventListenerObject,
      ...rest: unknown[]
    ) {
      const transaction = this;
      const wrapped =
        type === "complete"
          ? (event: Event) => {
              const complete = () =>
                typeof listener === "function"
                  ? listener.call(transaction, event)
                  : listener.handleEvent(event);
              if (released) complete();
              else pending.push(complete);
            }
          : listener;
      return Reflect.apply(original, this, [type, wrapped, ...rest]);
    } as typeof original;
  });
  await editor.fill("approved revision");
  await page.getByRole("button", { name: "Save and close note" }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await editor.focus();
  await page.keyboard.type("unexpected");
  await expect(editor).not.toContainText("unexpected");
  await page.evaluate(() => Reflect.get(window, "releasePeelWrites")());
  await expect(
    page.getByRole("button", { name: "Open approved revision" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Open approved revision" }).click();
  await expect(editor).toContainText("approved revision");
  await expect(editor).not.toContainText("unexpected");
});

test("worker search pages results, ignores stale queries and invalidates edited text and tags", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const request = indexedDB.open("peel-local-v1", 1);
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("notes", "readwrite");
    for (let i = 0; i < 161; i++)
      tx.objectStore("notes").put({
        schemaVersion: 1,
        collectionId: "local",
        noteId: crypto.randomUUID(),
        bodyMarkdown: `# Fixture ${i}\nA searchable lavender thought. ##batch${i === 1 ? "\n" + "Long source. ".repeat(20000) : ""}`,
        state: i === 0 ? "archived" : "active",
        createdAt: "2026-10-26T12:00:00.000Z",
        updatedAt: "2026-10-26T12:00:00.000Z",
        deletedAt: null,
        purgeAfter: null,
        serverRevision: null,
        localRevision: 1,
      });
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  });
  await page.reload();
  await expect(page.locator(".library-main")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator(".note-card")).toHaveCount(80);
  await page.getByRole("button", { name: "Show more notes" }).click();
  await expect(page.locator(".note-card")).toHaveCount(160);
  const search = page.getByRole("textbox", { name: "Search notes" });
  await search.fill("no such result");
  await search.fill('"lavender thought"');
  await expect(page.locator(".result-label")).toContainText("161 matches");
  await expect(page.locator(".note-card")).toHaveCount(80);
  await page.locator(".card-open").first().click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("# Changed fixture\nAn amber thought. ##newtag");
  await page.getByRole("button", { name: "Save and close note" }).click();
  await expect(page.locator(".result-label")).toContainText("160 matches");
  await search.fill("amber");
  await expect(page.locator(".result-label")).toContainText("1 match ·");
  await expect(
    page.getByRole("button", { name: "Open Changed fixture", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".tag-list")).toContainText("newtag");
});

test("a worker startup failure is visible and Retry rebuilds search without losing notes", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    let failed = false;
    window.Worker = new Proxy(OriginalWorker, {
      construct(target, args) {
        if (!failed) {
          failed = true;
          throw new Error("Synthetic worker failure");
        }
        return Reflect.construct(target, args);
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("Search is unavailable");
  await page.getByRole("button", { name: "New note", exact: false }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("# Retained fixture\nSaved despite index failure.");
  await page.getByRole("button", { name: "Save and close note" }).click();
  await page.getByRole("button", { name: "Retry search" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open Retained fixture", exact: true }),
  ).toBeVisible();
});
