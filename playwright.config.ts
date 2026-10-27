import { defineConfig } from "@playwright/test";
const executablePath =
  process.env.PEEL_BROWSER_PATH ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : undefined);
export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:4320", launchOptions: { executablePath } },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:4320",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
