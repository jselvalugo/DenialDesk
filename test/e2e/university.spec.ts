import { expect, test } from "@playwright/test";
import { dismissAccessPrompt } from "./support";

/**
 * DenialDesk University (docs/specs/denialdesk-university.md U1): reachable from the global header
 * and the user menu; a lesson can be marked complete once, and the course list reflects it.
 */
test.describe("university", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("the header link opens the course catalog", async ({ page }) => {
    await page.goto("/overview");
    await page.getByRole("banner").getByRole("link", { name: "University of DenialDesk" }).click();
    await expect(page).toHaveURL(/\/university$/);
    await expect(page.getByRole("heading", { level: 1, name: "Courses" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open course: Getting started with DenialDesk" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Open course: Florida prompt pay" })).toBeVisible();
  });

  test("a practice with access sees no prompt and can open a course", async ({ page }) => {
    await page.goto("/university");
    await expect(page.getByRole("dialog", { name: "Get access to DenialDesk University" })).toHaveCount(0);
    await expect(page.getByText("Locked", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Open course: Getting started with DenialDesk" }).click();
    await expect(page).toHaveURL(/\/university\/getting-started$/);
  });

  test("the wordmark buttons in the header and on the welcome page open the wiki", async ({ page }) => {
    await page.goto("/overview");
    const headerButton = page.getByRole("banner").getByRole("link", { name: "DenialDesk Wiki" });
    const image = headerButton.getByRole("img", { name: "DenialDesk Wiki" });
    await expect
      .poll(() =>
        image.evaluate(
          (el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
    await expect(headerButton).not.toHaveAttribute("aria-current");
    await headerButton.click();
    await expect(page).toHaveURL(/\/university\/wiki$/);
    // Only the Wiki button is current here, not the University link beside it.
    await expect(headerButton).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("banner").getByRole("link", { name: "University of DenialDesk" }),
    ).not.toHaveAttribute("aria-current");
    await page.goto("/university/wiki/glossary");
    await expect(headerButton).toHaveAttribute("aria-current", "true");

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
    await page.getByRole("main").getByRole("link", { name: "University of DenialDesk" }).click();
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

// specs/denialdesk-university.md "Access": the manager practice has not bought access, so the
// courses are locked behind the prompt; the Wiki stays open.
test.describe("university locked", () => {
  test.use({ storageState: "test/e2e/.auth/manager.json" });

  test("the prompt opens on every visit with the program length and starting price, and courses are locked", async ({
    page,
  }) => {
    await page.goto("/university");
    const prompt = page.getByRole("dialog", { name: "Get access to DenialDesk University" });
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText("Access starts at $299.00");
    await expect(prompt).toContainText(/about \d+ minutes/);
    await expect(prompt.getByText("Courses", { exact: true })).toBeVisible();

    // Escape, the close button, and the backdrop each dismiss it; nothing is remembered.
    await page.keyboard.press("Escape");
    await expect(prompt).toBeHidden();
    await page.reload();
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Close" }).click();
    await expect(prompt).toBeHidden();
    await page.reload();
    await expect(prompt).toBeVisible();
    await page.mouse.click(8, 400);
    await expect(prompt).toBeHidden();

    // The catalog behind it is locked: names are not links, and a course URL returns to the catalog.
    const main = page.getByRole("main");
    await expect(main.getByText("Locked", { exact: true }).first()).toBeVisible();
    await expect(main.getByRole("link", { name: /^Open course:/ })).toHaveCount(0);
    await page.goto("/university/getting-started");
    await expect(page).toHaveURL(/\/university$/);
    await page.goto("/university/getting-started/finding-your-way");
    await expect(page).toHaveURL(/\/university$/);
    // The Wiki is not gated.
    await dismissAccessPrompt(page);
    await page.getByRole("link", { name: "Open the Wiki" }).click();
    await expect(page).toHaveURL(/\/university\/wiki$/);
  });

  test("requesting access is recorded for the practice and remembered", async ({ page }) => {
    await page.goto("/university");
    const prompt = page.getByRole("dialog", { name: "Get access to DenialDesk University" });
    await prompt.getByRole("button", { name: "Request access" }).click();
    await expect(prompt.getByRole("status")).toContainText("Request recorded for your practice");
    await expect(prompt.getByRole("button", { name: "Request access" })).toHaveCount(0);
    await expect(prompt.getByRole("button", { name: "Continue to the courses" })).toBeFocused();
    await page.reload();
    await expect(prompt.getByRole("status")).toContainText(/Access requested on \d{2}\/\d{2}\/\d{4}/);
  });
});
