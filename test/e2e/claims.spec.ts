import { expect, test } from "@playwright/test";
import { openFromSwitcher } from "./support";

test.describe("claims", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("lists unsubmitted claims with timely-filing totals and filters", async ({ page }) => {
    await page.goto("/");
    await openFromSwitcher(page, "Claims");
    await expect(page.getByRole("heading", { level: 1, name: "Claims" })).toBeVisible();
    const totals = page.getByRole("region", { name: "Unsubmitted claim totals" });
    await expect(totals.getByText("Past filing deadline")).toBeVisible();
    expect(await page.getByRole("table").getByRole("row").count()).toBeGreaterThan(3);

    await page.getByLabel("Filing deadline").selectOption("past_deadline");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/filing=past_deadline/);
    const deadlines = page.getByRole("table").getByRole("row").locator("td:nth-child(6)");
    for (const text of await deadlines.allTextContents()) expect(text).toMatch(/overdue/);
  });

  test("correcting a draft claim records a new version with the reason", async ({ page }) => {
    await page.goto("/claims");
    await page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: "Draft" })
      .getByRole("link")
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Claim versions" }).getByText("Version 1")).toBeVisible();

    await page.getByRole("button", { name: "Correct claim" }).click();
    await page.getByLabel("Line 1 units").fill("2");
    await page.getByLabel("Line 1 procedure code").fill("9921");
    await page.getByLabel(/Reason for the correction/).fill("Coder review of the visit note (synthetic)");
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Line 1: Procedure codes are 5");
    // Typed values survive the rejected submit.
    await expect(page.getByLabel("Line 1 units")).toHaveValue("2");

    await page.getByLabel("Line 1 procedure code").fill("99214");
    await page.getByRole("button", { name: "Save new version" }).click();
    await expect(page.getByRole("status")).toContainText("Saved as version 2");
    const history = page.getByRole("list", { name: "Claim versions" });
    await expect(history.getByText("Version 2")).toBeVisible();
    await expect(history.getByText("Coder review of the visit note (synthetic)")).toBeVisible();
    await expect(history.getByText("line 1 units")).toBeVisible();
    await expect(history.getByText("Riley Worker", { exact: false })).toBeVisible();
  });

  test("claims the payer accepted can't be corrected", async ({ page }) => {
    await page.goto("/claims?group=in_process");
    // Scoped to tbody: the header row's own sortable-column links (P4) would otherwise be first.
    await page.getByRole("table").locator("tbody").getByRole("link").first().click();
    await expect(page.getByText("Timely filing no longer applies.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Correct claim" })).toHaveCount(0);
  });

  test("choosing a filter keeps the current sort (P4 review)", async ({ page }) => {
    await page.goto("/claims?group=in_process&sort=billed&dir=asc");
    // "Claims" also names the module switcher's link and button; scope to the filter select itself.
    await page.locator("#select-group").selectOption("all");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/group=all/);
    await expect(page).toHaveURL(/sort=billed/);
    await expect(page).toHaveURL(/dir=asc/);
  });

  test("rejects malformed and unknown claim IDs", async ({ page }) => {
    expect((await page.goto("/claims/not-a-uuid"))?.status()).toBe(404);
    expect((await page.goto("/claims/00000000-0000-4000-8000-000000000000"))?.status()).toBe(404);
  });
});

test.describe("claims as compliance (read-only)", () => {
  test.use({ storageState: "test/e2e/.auth/viewer.json" });

  test("can review a claim and its history but not correct it", async ({ page }) => {
    await page.goto("/claims");
    // Scoped to tbody: the header row's own sortable-column links (P4) would otherwise be first.
    await page.getByRole("table").locator("tbody").getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
    await expect(page.getByText("You have read-only access to claims.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Correct claim" })).toHaveCount(0);
  });
});
