import { defineConfig, devices } from "@playwright/test";

const devServer = process.env.PLAYWRIGHT_DEV === "1";
const port = devServer ? 3106 : 3105;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    extraHTTPHeaders: { Authorization: `Basic ${Buffer.from("e2e-admin:e2e-only-not-a-real-password").toString("base64")}` },
    httpCredentials: { username: "e2e-admin", password: "e2e-only-not-a-real-password" },
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    env: { BENCHMARK_ADMIN_USER: "e2e-admin", BENCHMARK_ADMIN_PASSWORD: "e2e-only-not-a-real-password" },
    command: devServer ? `npm run dev -- -p ${port}` : `npm run build && npm run start -- -p ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
