import { expect, test } from "@playwright/test";

/**
 * DenialDesk University (docs/specs/denialdesk-university.md U1): reachable from the global header
 * and the user menu; a lesson can be marked complete once, and the course list reflects it.
 */
test.describe("university", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("the header link opens the course catalog", async ({ page }) => {
    await page.goto("/overview");
    await page.getByRole("link", { name: "University" }).click();
    await expect(page).toHaveURL(/\/university$/);
    await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open course: Getting started with DenialDesk" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Open course: Florida prompt pay" })).toBeVisible();
  });

  test("the user menu links to the University", async ({ page }) => {
    await page.goto("/overview");
    await page.getByRole("button", { name: /Riley Worker/ }).click();
    await page.getByRole("link", { name: "DenialDesk University" }).click();
    await expect(page).toHaveURL(/\/university$/);
  });

  test("the welcome page points new users at the University", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "New here? Start with DenialDesk University" }).click();
    await expect(page).toHaveURL(/\/university$/);
  });

  test("a lesson shows rules from the catalog with their citation and verification state", async ({
    page,
  }) => {
    await page.goto("/university/florida-prompt-pay/the-electronic-clock");
    await expect(page.getByRole("heading", { level: 1, name: "The electronic-claim clock" })).toBeVisible();
    const table = page.getByRole("table", {
      name: "Electronic claims: payer milestones and the provider's response window",
    });
    await expect(table).toBeVisible();
    await expect(table.getByText("Fla. Stat. § 627.6131(4)(e)", { exact: true }).first()).toBeVisible();
    await expect(table.getByText("Fla. Stat. § 641.3155 (mirrors § 627.6131(4)(e))").first()).toBeVisible();
    await expect(table.getByText("Payer's receipt of the claim").first()).toBeVisible();
    await expect(table.getByText("Pending counsel verification").first()).toBeVisible();
    // Scoped to main: the pre-production banner is also a note.
    await expect(page.getByRole("main").getByRole("note")).toContainText("Pending counsel verification");
  });

  test("completing a lesson is recorded once and shown on the course page", async ({ page }) => {
    await page.goto("/university/getting-started");
    await expect(
      page.getByRole("heading", { level: 1, name: "Getting started with DenialDesk" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Start course" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Finding your way around" })).toBeVisible();

    await page.getByRole("button", { name: "Mark lesson complete" }).click();
    const main = page.getByRole("main");
    await expect(main.getByRole("status")).toContainText("Lesson completed");
    await expect(page.getByRole("button", { name: "Mark lesson complete" })).toHaveCount(0);

    // Reloading keeps it complete; there is no way to undo it.
    await page.reload();
    await expect(main.getByRole("status")).toContainText("Lesson completed");

    await page.getByRole("link", { name: "Next: The path a claim takes" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "The path a claim takes" })).toBeVisible();

    await page.getByRole("link", { name: "Getting started with DenialDesk" }).first().click();
    await expect(page.getByText("1 of 3 lessons")).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue course" })).toBeVisible();
    await expect(page.getByText(/^Completed \d{2}\/\d{2}\/\d{4}/)).toHaveCount(1);
  });

  test("unknown courses and lessons are 404", async ({ request }) => {
    expect((await request.get("/university/no-such-course")).status()).toBe(404);
    expect((await request.get("/university/getting-started/no-such-lesson")).status()).toBe(404);
  });
});
