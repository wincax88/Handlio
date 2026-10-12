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
  timeout: 90000,
  use: {
    baseURL: "http://localhost:5183",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath },
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
      AI_ADAPTER_URL: "",
      DATA_DIR: `.work/e2e-data/run-${Date.now()}`,
      PORT: "3011",
      HANDLIO_API_PROXY: "http://127.0.0.1:3011",
      APP_ORIGIN: "http://localhost:5183",
      NODE_ENV: "test",
      OPS_EMAILS: "ops-ui@example.test",
    },
    timeout: 60000,
  },
});
