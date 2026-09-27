import { expect, test } from "@playwright/test";

// docs/specs/university-wiki.md: every role can read the wiki; legal values come from rules/.
test.describe("university wiki", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("lists articles by category, searches, and opens an article with its rule values", async ({
    page,
  }) => {
    await page.goto("/university");
    await expect(page).toHaveURL(/\/university\/wiki$/);
    await expect(page.getByRole("heading", { level: 1, name: "Wiki" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: /Glossary/ }),
    ).toBeVisible();

    await page.getByLabel("Search the wiki").fill("prompt pay");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("heading", { name: /articles? match "prompt pay"/ })).toBeVisible();
    await page.getByRole("link", { name: "The Florida prompt-pay clock" }).click();

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
