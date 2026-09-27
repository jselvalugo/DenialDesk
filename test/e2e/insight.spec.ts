import { expect, test } from "@playwright/test";
import { openFromSwitcher } from "./support";

/**
 * Insight standard reports (docs/specs/insight-standard-reports.md): every role can view a report
 * on screen; only admin/manager/compliance can download it as .xlsx (owner decision 2026-09-26,
 * reconfirmed 2026-09-26). specialist can view but never sees the download control.
 */

test.describe("insight — manager can view and download", () => {
  test.use({ storageState: "test/e2e/.auth/manager.json" });

  test("opens a report and downloads it as .xlsx", async ({ page }) => {
    await page.goto("/");
    await openFromSwitcher(page, "Reports");
    await expect(page.getByRole("heading", { level: 1, name: "Insight" })).toBeVisible();

    const firstReport = page.getByRole("link", { name: "Open" }).first();
    await firstReport.click();

    const downloadButton = page.getByRole("button", { name: "Download Excel" });
    await expect(downloadButton).toBeVisible();

    const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });
});

test.describe("insight — specialist views but cannot download", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("sees the report on screen with no download button", async ({ page }) => {
    await page.goto("/");
    await openFromSwitcher(page, "Reports");
    await expect(page.getByRole("heading", { level: 1, name: "Insight" })).toBeVisible();
    // No "download all reports" action on the list page either.
    await expect(page.getByRole("button", { name: "Download all reports (Excel)" })).toHaveCount(0);

    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page.getByRole("button", { name: "Download Excel" })).toHaveCount(0);
    await expect(
      page.getByText("Exporting this report is limited to admin, manager, and compliance roles."),
    ).toBeVisible();
  });
});

test.describe("insight — compliance can view and download", () => {
  // The "viewer" e2e user is seeded with the compliance role (test/e2e/global-setup.ts).
  // Compliance is one of the roles allowed to export (owner decision 2026-09-26): unlike
  // specialist, it does see the download control.
  test.use({ storageState: "test/e2e/.auth/viewer.json" });

  test("sees the download button on a report", async ({ page }) => {
    await page.goto("/");
    await openFromSwitcher(page, "Reports");
    await page.getByRole("link", { name: "Open" }).first().click();
    await expect(page.getByRole("button", { name: "Download Excel" })).toBeVisible();
  });
});
