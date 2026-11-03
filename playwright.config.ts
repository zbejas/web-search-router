import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4310",
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 8_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run build && bun run tests/e2e/server.ts",
    url: "http://127.0.0.1:4310/_router/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
