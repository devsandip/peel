import { test, expect } from "@playwright/test";
import { installNativeFixture } from "../fixtures/native-shell";
type Fixture = {
  available: boolean;
  calls: string[];
  errors: string[];
  holdSave: boolean;
  failSaves: boolean;
  failShortcutSave: boolean;
  loginStatus: string;
  failLoginChange: boolean;
  holdLoginChange: boolean;
  releaseLoginChange: () => void;
  loginChanges: boolean[];
  releaseSave: () => void;
  acknowledgements: { operationId: string; success: boolean }[];
  emit: (event: string, payload: unknown) => void;
};
test("native startup recovery waits for selected storage and a canceled picker keeps the location", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(installNativeFixture, {
    cold: true,
    failRetry: true,
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Reconnect your notes folder" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, "nativeFixture") as Fixture).calls.includes(
        "list_notes",
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Retry opening library" }).click();
  await expect(page.getByRole("alert")).toContainText("still disconnected");
  await page.getByRole("button", { name: "Retry opening library" }).click();
  await expect(
    page.getByRole("heading", { name: "Notes", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("/synthetic/Peel library", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).available = false;
    window.dispatchEvent(new Event("focus"));
  });
  await expect(
    page.getByRole("button", { name: "Check folder again" }),
  ).toBeVisible();
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).available = true;
  });
  await page.getByRole("button", { name: "Check folder again" }).click();
  await expect(
    page.getByRole("button", { name: "Choose notes folder…" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Choose notes folder…" }).click();
  await expect(
    page.getByRole("button", { name: "Choose notes folder…" }),
  ).toBeEnabled();
  await expect(
    page.getByText("/synthetic/Peel library", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("native shortcut form keeps canceled/failed edits, supports disable, defaults and retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(installNativeFixture, {
    cold: false,
    failRetry: false,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const section = page.getByRole("region", { name: "Global shortcuts" });
  await expect(
    section.getByText("Control Option N", { exact: true }),
  ).toBeVisible();
  await section
    .getByRole("button", { name: "Change Capture shortcut" })
    .click();
  await section
    .getByRole("combobox", { name: "Shortcut key" })
    .selectOption("KeyJ");
  await section.getByRole("button", { name: "Cancel shortcut change" }).click();
  await expect(
    section.getByText("Control Option N", { exact: true }),
  ).toBeVisible();
  await section
    .getByRole("button", { name: "Change Capture shortcut" })
    .click();
  await section
    .getByRole("combobox", { name: "Shortcut key" })
    .selectOption("KeyJ");
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).failShortcutSave = true;
  });
  await section
    .getByRole("button", { name: "Save shortcut", exact: true })
    .click();
  await expect(section.getByRole("alert")).toContainText(
    "Previous settings were kept",
  );
  await expect(
    section.getByText("Control Option N", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).failShortcutSave = false;
  });
  await section
    .getByRole("button", { name: "Save shortcut", exact: true })
    .click();
  await expect(
    section.getByText("Control Option J", { exact: true }),
  ).toBeVisible();
  await section
    .getByRole("button", { name: "Change Capture shortcut" })
    .click();
  await section
    .getByRole("button", { name: "Disable shortcut", exact: true })
    .click();
  await expect(section.getByText("Disabled", { exact: true })).toBeVisible();
  await section
    .getByRole("button", { name: "Restore shortcut defaults" })
    .click();
  await expect(
    section.getByText("Control Option N", { exact: true }),
  ).toBeVisible();
  await section.getByRole("button", { name: "Retry activation" }).click();
  await expect(
    section.getByRole("button", { name: "Retry activation" }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
test("login item settings wait for OS status, expose approval/failure and honor external changes", async ({
  page,
}) => {
  await page.addInitScript(installNativeFixture, {
    cold: false,
    failRetry: false,
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const section = page.getByRole("region", { name: "Launch at login" });
  await expect(section.getByRole("status")).toContainText("Off.");
  expect(
    await page.evaluate(
      () => (Reflect.get(window, "nativeFixture") as Fixture).loginChanges,
    ),
  ).toEqual([]);
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).holdLoginChange = true;
  });
  await section
    .getByRole("button", { name: "Turn on launch at login" })
    .click();
  await expect(section.getByRole("status")).toContainText("Off.");
  await expect(
    section.getByRole("button", { name: "Turn on launch at login" }),
  ).toBeDisabled();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    const fixture = Reflect.get(window, "nativeFixture") as Fixture;
    fixture.holdLoginChange = false;
    fixture.releaseLoginChange();
  });
  await expect(section.getByRole("status")).toContainText(
    "Waiting for approval",
  );
  await section
    .getByRole("button", { name: "Open Login Items settings" })
    .click();
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, "nativeFixture") as Fixture).calls.includes(
        "open_login_item_settings",
      ),
    ),
  ).toBe(true);
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).loginStatus = "enabled";
    window.dispatchEvent(new Event("focus"));
  });
  await expect(section.getByRole("status")).toContainText("On.");
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).failLoginChange = true;
  });
  await section
    .getByRole("button", { name: "Turn off launch at login" })
    .click();
  await expect(section.getByRole("alert")).toContainText("change failed");
  await expect(section.getByRole("status")).toContainText("On.");
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).failLoginChange = false;
  });
  await section
    .getByRole("button", { name: "Turn off launch at login" })
    .click();
  await expect(section.getByRole("status")).toContainText("Off.");
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).loginStatus = "isolated";
  });
  await section
    .getByRole("button", { name: "Check login status again" })
    .click();
  await expect(section.getByRole("status")).toContainText(
    "isolated test library",
  );
  await expect(
    section.getByRole("button", { name: /Turn (on|off) launch at login/ }),
  ).toHaveCount(0);
});
test("native relocation freezes and acknowledges only durable saves, releases failure and retains restart freeze", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(installNativeFixture, {
    cold: false,
    failRetry: false,
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: /^Archive/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Open Native bridge fixture" })
    .click();
  const editor = page.getByRole("textbox", { name: "Note text" });
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).holdSave = true;
  });
  await editor.fill("# Native bridge fixture\nSynthetic held draft");
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).emit(
      "peel-request-relocation",
      "held",
    );
  });
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).emit(
      "peel-relocation-finished",
      { id: "stale", keepFrozen: false, error: null },
    );
  });
  await expect(
    page.getByText("Saving every open note and changing the library folder…"),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (Reflect.get(window, "nativeFixture") as Fixture).acknowledgements,
    ),
  ).toEqual([]);
  await page.evaluate(() => {
    const f = Reflect.get(window, "nativeFixture") as Fixture;
    f.holdSave = false;
    f.releaseSave();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (Reflect.get(window, "nativeFixture") as Fixture).acknowledgements,
      ),
    )
    .toEqual([{ operationId: "held", success: true }]);
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).emit(
      "peel-relocation-finished",
      { id: "held", keepFrozen: false, error: null },
    );
  });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).failSaves = true;
  });
  await editor.fill(
    "# Native bridge fixture\nSynthetic failed draft remains here",
  );
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).emit(
      "peel-request-relocation",
      "failed",
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (Reflect.get(window, "nativeFixture") as Fixture).acknowledgements.at(
          -1,
        ),
      ),
    )
    .toEqual({ operationId: "failed", success: false });
  await expect(editor).toContainText("Synthetic failed draft remains here");
  await page.evaluate(() => {
    const f = Reflect.get(window, "nativeFixture") as Fixture;
    f.failSaves = false;
    f.emit("peel-relocation-finished", {
      id: "failed",
      keepFrozen: false,
      error: "Synthetic move canceled",
    });
  });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).emit(
      "peel-request-relocation",
      "restart",
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (Reflect.get(window, "nativeFixture") as Fixture).acknowledgements.at(
          -1,
        ),
      ),
    )
    .toEqual({ operationId: "restart", success: true });
  await page.evaluate(() => {
    (Reflect.get(window, "nativeFixture") as Fixture).emit(
      "peel-relocation-finished",
      {
        id: "restart",
        keepFrozen: true,
        error: "Synthetic selection needs restart",
      },
    );
  });
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "Quit and reopen Synkies" }).click();
  expect(
    await page.evaluate(() =>
      (Reflect.get(window, "nativeFixture") as Fixture).calls.includes(
        "request_quit",
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (Reflect.get(window, "nativeFixture") as Fixture).errors,
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
