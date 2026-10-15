import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // The sandbox ships a pinned Chromium; local runs reuse it instead of downloading.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 14"], defaultBrowserType: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm db:migrate && pnpm exec next dev -p ${port}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          DATABASE_DRIVER: "pglite",
          PGLITE_DATA_DIR: ".pglite-e2e",
          DATABASE_URL: "",
          BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-123456",
          BETTER_AUTH_URL: baseURL,
          NEXT_PUBLIC_APP_URL: baseURL,
          AI_PROVIDER: process.env.E2E_AI_PROVIDER ?? "fixture",
          TRANSCRIPTION_PROVIDER: process.env.E2E_TRANSCRIPTION_PROVIDER ?? "fixture",
          STORAGE_PROVIDER: "local",
          STORAGE_LOCAL_DIR: ".storage-e2e",
          RATE_LIMITS_DISABLED: "1",
          MAX_UPLOAD_MB: "1",
        },
      },
});
