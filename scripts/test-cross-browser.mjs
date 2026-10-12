import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, HANDLIO_TEST_BROWSERS: "chromium,firefox,webkit" } });
process.exit(result.status ?? 1);
