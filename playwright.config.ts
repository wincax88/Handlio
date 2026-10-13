import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const executablePath =
  process.env.CHROMIUM_EXECUTABLE_PATH ||
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].find(existsSync);
export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  projects: (process.env.HANDLIO_TEST_BROWSERS || "chromium")
    .split(",")
    .map((name) => ({
      name,
      use: {
        browserName: name as "chromium" | "firefox" | "webkit",
        launchOptions: name === "chromium" ? { executablePath } : {},
      },
    })),
  timeout: 90000,
  use: {
    baseURL: "http://localhost:5183",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: "list",
  webServer: {
    command:
      'npx concurrently -k "tsx watch server/index.ts" "vite --host 127.0.0.1 --port 5183 --strictPort"',
    url: "http://localhost:5183",
    reuseExistingServer: false,
    env: {
      MAIL_PROVIDER: "local",
      BILLING_ADAPTER_URL: "",
      BILLING_PROVIDER: "",
      DODO_PAYMENTS_API_KEY: "",
      AI_ADAPTER_URL: "",
      DATA_DIR: `.work/e2e-data/run-${Date.now()}`,
      PORT: "3011",
      HANDLIO_API_PROXY: "http://127.0.0.1:3011",
      APP_ORIGIN: "http://localhost:5183",
      NODE_ENV: "test",
      OPS_EMAILS:
        "ops-ui@example.test,ops-chromium@example.test,ops-firefox@example.test,ops-webkit@example.test",
    },
    timeout: 60000,
  },
});
