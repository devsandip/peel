import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { createHash } from "node:crypto";

// Production artifact checks only. Own temporary browser context and synthetic notes.
const root = "apps/web/dist",
  files = new Map();
for (const name of await readdir(root, { recursive: true })) {
  try {
    files.set("/" + name, await readFile(join(root, name)));
  } catch (e) {
    if (e.code !== "EISDIR") throw e;
  }
}
const original = files.get("/sw.js").toString();
const version = original.match(/^\/\/ Peel offline shell: ([a-f0-9]{64})/)[1];
const next = createHash("sha256")
    .update(version + "synthetic-next")
    .digest("hex"),
  failed = createHash("sha256")
    .update(version + "synthetic-failed")
    .digest("hex");
let variant = "base";
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
  };
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/v1/probe") {
    res.setHeader("Content-Type", "application/json");
    res.end('{"synthetic":"uncached-api-probe"}');
    return;
  }
  const data = files.get(pathname);
  if (!data || req.method !== "GET") {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    mime[extname(pathname)] || "application/octet-stream",
  );
  if (pathname === "/sw.js") {
    res.end(
      original.replaceAll(
        version,
        variant === "failed" ? failed : variant === "next" ? next : version,
      ),
    );
    return;
  }
  if (
    variant === "failed" &&
    pathname.endsWith(".css") &&
    req.headers["sec-fetch-dest"] === "empty"
  ) {
    res.end("/* Synthetic integrity mismatch */");
    return;
  }
  res.end(data);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const checks = {},
  errors = [];
try {
  browser = await chromium.launch({
    executablePath:
      process.env.PEEL_BROWSER_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
  });
  const context = await browser.newContext(),
    origin = `http://127.0.0.1:${server.address().port}`;
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.active,
  );
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText(
      "Peel can reopen without an internet connection. Browser data can still be cleared.",
    ),
  ).toBeVisible();
  checks.initialVerifiedInstallReady = true;
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Create your first note" }).click();
  const body = "# Airplane fixture\nSynthetic offline capture. ##travel";
  await page.getByRole("textbox", { name: "Note text" }).fill(body);
  await page.getByRole("button", { name: "Save and close note" }).click();
  await expect(
    page.getByRole("button", { name: "Open Airplane fixture" }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Open Airplane fixture" }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText(
    "Synthetic offline capture",
  );
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill(body + "\nEdited while offline.");
  await page.getByRole("button", { name: "Save and close note" }).click();
  await expect(
    page.getByRole("button", { name: "Open Airplane fixture" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search notes" }).fill("airplane");
  await expect(
    page.getByRole("button", { name: "Open Airplane fixture" }),
  ).toBeVisible();
  checks.offlineReloadEditAndWorkerSearch = true;
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.getByRole("button", { name: /^New note/ }).click();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill("# Second offline fixture\nCreated with the network disabled.");
  await page.getByRole("button", { name: "Save and close note" }).click();
  await expect(
    page.getByRole("button", { name: "Open Second offline fixture" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open Second offline fixture" }),
  ).toBeVisible();
  checks.offlineCreateSurvivesReload = true;
  await context.setOffline(false);
  await page.evaluate(async () => {
    await fetch("/v1/probe?synthetic=cache-boundary");
    await fetch("/?synthetic=post-probe", { method: "POST", body: "probe" });
  });
  const boundary = await page.evaluate(async (needle) => {
    const keys = (await caches.keys()).filter((k) =>
      k.startsWith("peel-shell-"),
    );
    let valid = keys.length === 1,
      containsNote = false,
      searchWorker = false;
    for (const key of keys) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        valid &&=
          request.method === "GET" &&
          !url.search &&
          (url.pathname === "/index.html" ||
            url.pathname === "/peel.svg" ||
            url.pathname.startsWith("/assets/"));
        searchWorker ||= url.pathname.includes("search.worker-");
        containsNote ||= (await (await cache.match(request)).text()).includes(
          needle,
        );
      }
    }
    return valid && !containsNote && searchWorker;
  }, body);
  expect(boundary).toBe(true);
  checks.onlyPublicShellCachedNoNotesQueriesOrAPI = true;
  await page.evaluate(async () => {
    for (const key of await caches.keys())
      if (key.startsWith("peel-shell-")) await caches.delete(key);
  });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retry offline setup" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry offline setup" }).click();
  await expect(
    page.getByText(
      "Peel can reopen without an internet connection. Browser data can still be cleared.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close settings" }).click();
  checks.missingPublicCacheRepairPreservesLocalNotes = await page
    .getByRole("button", { name: "Open Airplane fixture" })
    .isVisible();
  const update = () =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const finished = new Promise((resolve) =>
        registration.addEventListener(
          "updatefound",
          () => {
            const worker = registration.installing;
            worker.addEventListener("statechange", () => {
              if (["installed", "redundant"].includes(worker.state))
                resolve(worker.state);
            });
          },
          { once: true },
        ),
      );
      await registration.update();
      return finished;
    });
  variant = "failed";
  expect(await update()).toBe("redundant");
  expect(
    await page.evaluate(
      async (bad) => (await caches.keys()).some((k) => k.endsWith(bad)),
      failed,
    ),
  ).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open Airplane fixture" }),
  ).toBeVisible();
  checks.failedIntegrityUpdatePreservesOldOfflineShell = true;
  await context.setOffline(false);
  await page.evaluate(async () => {
    await (
      await caches.open("synthetic-unrelated-cache")
    ).put("/unrelated-probe", new Response("Synthetic unrelated fixture"));
  });
  await page.getByRole("button", { name: "Open Airplane fixture" }).click();
  variant = "next";
  expect(await update()).toBe("installed");
  expect(
    await page.evaluate(
      async () => !!(await navigator.serviceWorker.getRegistration()).waiting,
    ),
  ).toBe(true);
  await expect(page.getByRole("textbox", { name: "Note text" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "Note text" })
    .fill(body + "\nSaved while the update waits.");
  await expect(
    page.getByText("Saved on this device", { exact: false }).last(),
  ).toBeVisible();
  checks.waitingUpdateKeepsEditorAndAcceptsDurableEdits = true;
  await page.getByRole("button", { name: "Save and close note" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByText("An update is ready.", { exact: false }),
  ).toBeVisible();
  await page.close();
  const reopened = await context.newPage();
  reopened.on("pageerror", (e) => errors.push(e.message));
  await reopened.goto(origin);
  await reopened.waitForFunction(async (revision) => {
    const names = await caches.keys();
    return (
      names.some((k) => k.endsWith(revision)) &&
      names.filter((k) => k.startsWith("peel-shell-")).length === 1
    );
  }, next);
  expect(
    await reopened.evaluate(async () =>
      (await caches.keys()).includes("synthetic-unrelated-cache"),
    ),
  ).toBe(true);
  await context.setOffline(true);
  await reopened.reload();
  await reopened.getByRole("button", { name: "Open Airplane fixture" }).click();
  await expect(
    reopened.getByRole("textbox", { name: "Note text" }),
  ).toContainText("Saved while the update waits");
  checks.newShellActivatesAfterClientsCloseAndPreservesNotes = true;
  checks.unrelatedCachesPreserved = true;
  await context.close();
  variant = "failed";
  const firstFailureContext = await browser.newContext(),
    firstFailurePage = await firstFailureContext.newPage();
  firstFailurePage.on("pageerror", (e) => errors.push(e.message));
  await firstFailurePage.goto(origin);
  await firstFailurePage
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(
    firstFailurePage.getByRole("button", { name: "Retry offline setup" }),
  ).toBeVisible();
  await firstFailurePage
    .getByRole("button", { name: "Close settings" })
    .click();
  await firstFailurePage
    .getByRole("button", { name: "Create your first note" })
    .click();
  await firstFailurePage
    .getByRole("textbox", { name: "Note text" })
    .fill(
      "# Setup failure fixture\nCapture survives an unavailable offline shell.",
    );
  await firstFailurePage
    .getByRole("button", { name: "Save and close note" })
    .click();
  await expect(
    firstFailurePage.getByRole("button", {
      name: "Open Setup failure fixture",
    }),
  ).toBeVisible();
  variant = "base";
  await firstFailurePage
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await firstFailurePage
    .getByRole("button", { name: "Retry offline setup" })
    .click();
  await expect(
    firstFailurePage.getByText(
      "Peel can reopen without an internet connection. Browser data can still be cleared.",
    ),
  ).toBeVisible();
  await firstFailureContext.setOffline(true);
  await firstFailurePage.reload();
  await expect(
    firstFailurePage.getByRole("button", {
      name: "Open Setup failure fixture",
    }),
  ).toBeVisible();
  checks.initialInstallFailureKeepsCaptureAndRetryRecovers = true;
  await firstFailureContext.close();
  const unsupportedContext = await browser.newContext();
  await unsupportedContext.addInitScript(() => {
    delete Navigator.prototype.serviceWorker;
  });
  const unsupportedPage = await unsupportedContext.newPage();
  unsupportedPage.on("pageerror", (e) => errors.push(e.message));
  await unsupportedPage.goto(origin);
  await unsupportedPage
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await expect(
    unsupportedPage.getByText(
      "This browser cannot prepare offline access. Saved notes remain in this browser profile.",
    ),
  ).toBeVisible();
  await expect(
    unsupportedPage.getByRole("button", { name: "Retry offline setup" }),
  ).toHaveCount(0);
  checks.missingServiceWorkerAPIShowsTruthfulUnavailableState = true;
  await unsupportedContext.close();
  const report = {
    scope:
      "Production Chrome offline shell and update checks in isolated synthetic browser context; not Safari/iPhone, eviction or full performance acceptance",
    generatedAt: new Date().toISOString(),
    browser: await browser.version(),
    checks,
    errors,
  };
  await mkdir("scratch", { recursive: true });
  await writeFile(
    "scratch/offline-shell.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
