import { expect, test } from "@playwright/test";

test.describe("remittances and prompt pay", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("remittance table opens a record with claim payments and history", async ({ page }) => {
    await page.goto("/remittances");
    await expect(page.getByRole("heading", { level: 1, name: "Remittances" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New remittance" })).toBeVisible();
    await page.getByRole("table").getByRole("row").nth(1).getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Claim payments" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Remittance history" })).toContainText("Posted");
    await page.screenshot({ path: "test-results/remittance-record.png", fullPage: true });
  });

  test("prompt-pay table opens a clock with milestones and responses", async ({ page }) => {
    await page.goto("/prompt-pay");
    await expect(page.getByRole("heading", { level: 1, name: "Prompt pay" })).toBeVisible();
    await page.screenshot({ path: "test-results/prompt-pay-list.png", fullPage: true });
    await page.getByRole("table").getByRole("row").nth(1).getByRole("link").first().click();
    await expect(page.getByRole("table", { name: "Prompt-pay milestones" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Payer responses" })).toBeVisible();
    await page.screenshot({ path: "test-results/prompt-pay-clock.png", fullPage: true });
  });
});
