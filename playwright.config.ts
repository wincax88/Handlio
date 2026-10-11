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
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath },
    trace: "retain-on-failure",
    screenshot:"only-on-failure",
  },
  reporter: "list",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
