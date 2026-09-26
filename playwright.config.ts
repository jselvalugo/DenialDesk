import { defineConfig, devices } from "@playwright/test";

// Runs against production builds (`pnpm build` first): one server as a preview environment and one
// as production, so the pre-production guards are tested in both modes (ADR 0003).
const previewPort = 3000;
const productionPort = 3001;

const browser = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
  // Lets environments with a preinstalled browser skip `playwright install`.
  launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {},
};

export default defineConfig({
  testDir: "test/e2e",
  globalSetup: "./test/e2e/global-setup.ts",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      use: { ...browser, baseURL: `http://localhost:${previewPort}` },
    },
    {
      name: "preview",
      testIgnore: /production\.spec\.ts/,
      dependencies: ["setup"],
      use: { ...browser, baseURL: `http://localhost:${previewPort}` },
    },
    {
      name: "production",
      testMatch: /production\.spec\.ts/,
      use: { ...browser, baseURL: `http://localhost:${productionPort}` },
    },
  ],
  webServer: [
    {
      command: `pnpm start --port ${previewPort}`,
      port: previewPort,
      reuseExistingServer: false,
      env: {
        APP_ENV: "preview",
        DEMO_LOGIN_ENABLED: "true",
        PLATFORM_OPERATOR_EMAIL: "operator@e2e.denialdesk.test",
      },
    },
    {
      command: `pnpm start --port ${productionPort}`,
      port: productionPort,
      reuseExistingServer: false,
      // DEMO_LOGIN_ENABLED is set here too, to prove production ignores it.
      env: { APP_ENV: "production", DEMO_LOGIN_ENABLED: "true" },
    },
  ],
});
