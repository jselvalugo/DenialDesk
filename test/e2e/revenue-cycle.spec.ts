import { expect, test } from "@playwright/test";

test.describe("revenue cycle as compliance (read-only)", () => {
  test.use({ storageState: "test/e2e/.auth/viewer.json" });

  test("rules and ledger show the seeded default configuration", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Rules and ledger" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Rules and ledger" })).toBeVisible();
    const rules = page.getByRole("table", { name: "Business rules in evaluation order" });
    await expect(rules.getByRole("row")).toHaveCount(13); // header + 12 rules
    await expect(rules.getByRole("row").nth(1)).toContainText("INTEREST");
    await expect(rules.getByRole("row").last()).toContainText("Every line not matched by an earlier rule");
    await expect(page.getByRole("table", { name: "GL accounts" })).toContainText("Default AR");
    await expect(page.getByRole("table", { name: "Payer classes" })).toContainText("MCR");
    await expect(page.getByRole("button", { name: "Load the default rule set" })).toHaveCount(0);
  });
});

test.describe("revenue cycle as a denial specialist", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("is hidden from navigation and returns 404", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).not.toContainText("Revenue cycle");
    expect((await page.goto("/revenue-cycle/rules"))?.status()).toBe(404);
  });
});
