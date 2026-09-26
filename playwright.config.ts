import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: "test/e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        // Lets environments with a preinstalled browser skip `playwright install`.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : {},
      },
    },
  ],
  webServer: {
    command: process.env.CI ? `pnpm start --port ${port}` : `pnpm dev --port ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
    env: { APP_ENV: process.env.APP_ENV ?? "development" },
  },
});
