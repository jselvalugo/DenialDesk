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

  test("the wordmark buttons in the header and on the welcome page open the wiki", async ({ page }) => {
    await page.goto("/overview");
    await page.getByRole("banner").getByRole("link", { name: "DenialDesk Wiki" }).click();
    await expect(page).toHaveURL(/\/university\/wiki$/);
    await page.goto("/");
    await page.getByRole("main").getByRole("link", { name: "DenialDesk Wiki" }).click();
    await expect(page).toHaveURL(/\/university\/wiki$/);
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

// docs/specs/university-wiki.md: every role can read the wiki; legal values come from rules/.
test.describe("university wiki", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("the course catalog links to the wiki, which lists, searches, and opens an article", async ({
    page,
  }) => {
    await page.goto("/university");
    await page.getByRole("link", { name: "Open the Wiki" }).click();
    await expect(page).toHaveURL(/\/university\/wiki$/);
    await expect(page.getByRole("heading", { level: 1, name: "Wiki" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: /Glossary/ }),
    ).toBeVisible();

    await page.getByLabel("Search the wiki").fill("prompt pay");
    await page.getByRole("button", { name: "Search" }).click();
    const results = page.getByRole("region", { name: "Search results" });
    await expect(results.getByRole("status")).toContainText(/articles? match “prompt pay”/);
    // The query was POSTed, never put in the address bar (CLAUDE.md #4).
    expect(page.url()).not.toContain("prompt");
    await results.getByRole("link", { name: "The Florida prompt-pay clock" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "The Florida prompt-pay clock" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible();
    // A rule token rendered a value with its citation, never a typed number.
    const value = page.locator('[data-rule="fl.promptpay.electronic.pay_or_contest"]').first();
    await expect(value).toContainText("627.6131");
    await expect(page.getByRole("heading", { name: "Rules referenced" })).toBeVisible();
  });

  test("an unknown article is a 404", async ({ request }) => {
    expect((await request.get("/university/wiki/no-such-article")).status()).toBe(404);
  });
});

test("a wiki article is never served without a session", async ({ request }) => {
  const response = await request.get("/university/wiki/glossary", { maxRedirects: 0 });
  expect([302, 303, 307, 404]).toContain(response.status());
  expect(await response.text()).not.toContain("Files and transactions");
});
