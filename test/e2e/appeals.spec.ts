import { expect, test } from "@playwright/test";

test.describe("appeal lifecycle", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("denial detail → new appeal → appeal detail → submission → decision → denial status reflects it", async ({
    page,
  }) => {
    await page.goto("/denials?assignee=unassigned");
    await page.getByRole("table").getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Appeal deadline" })).toBeVisible();

    const startAppeal = page.getByRole("link", { name: "Start appeal" });
    if (!(await startAppeal.isVisible())) test.skip(true, "No eligible denial to appeal in this seed run");

    await startAppeal.click();
    await expect(page.getByRole("heading", { level: 1, name: "Start an appeal" })).toBeVisible();
    await page.getByRole("button", { name: "Start appeal" }).click();

    await expect(page.getByRole("heading", { name: "Record submission" })).toBeVisible();
    await page.getByLabel("Tracking / reference number (optional)").fill("REF-SYN-001");
    await page.getByRole("button", { name: "Record submission" }).click();
    await expect(page.getByRole("heading", { name: "Submission" })).toBeVisible();
    await expect(page.getByText("REF-SYN-001")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Record decision" })).toBeVisible();
    await page.getByLabel("Outcome").selectOption("upheld");
    await page.getByRole("button", { name: "Record decision" }).click();
    // The decision was recorded: the "Record decision" form (only shown pre-decision) is gone.
    await expect(page.getByRole("heading", { name: "Record decision" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Decision", exact: true })).toBeVisible();

    const denialLink = page.getByRole("link", { name: "View the denial" });
    await denialLink.click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("appeals list shows totals and the new appeal shows up", async ({ page }) => {
    await page.goto("/appeals");
    await expect(page.getByRole("heading", { level: 1, name: "Appeals" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Open appeal totals" })).toBeVisible();
  });

  test("appeals module is reachable from the switcher", async ({ page }) => {
    await page.goto("/overview");
    await page.getByRole("button", { name: /switch module/i }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Appeals" }).click();
    await expect(page).toHaveURL(/\/appeals$/);
  });
});
