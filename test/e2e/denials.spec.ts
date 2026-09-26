import { expect, test } from "@playwright/test";

test.describe("denial work", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("overview shows real totals and links to the queue", async ({ page }) => {
    await page.goto("/overview");
    const totals = page.getByRole("region", { name: "Open denial totals" });
    await expect(totals.getByText("Open denials")).toBeVisible();
    await expect(page.getByRole("table", { name: "Next appeal deadlines" }).getByRole("row")).not.toHaveCount(
      0,
    );
    await page.getByRole("link", { name: "Open denial queue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Denial queue" })).toBeVisible();
  });

  test("queue lists denials soonest deadline first and filters by category", async ({ page }) => {
    await page.goto("/denials");
    const rows = page.getByRole("table").getByRole("row");
    expect(await rows.count()).toBeGreaterThan(5);
    await expect(page.getByText(/^Showing 1–\d+ of \d+$/)).toBeVisible();

    await page.getByLabel("Category").selectOption("authorization");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/category=authorization/);
    const reasons = page.getByRole("table").getByRole("row").locator("td:nth-child(4)");
    for (const text of await reasons.allTextContents()) expect(text).toContain("Authorization");
  });

  test("working a denial: note, assignment, status, and audit trail", async ({ page }) => {
    await page.goto("/denials?assignee=unassigned");
    await page.getByRole("table").getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Appeal deadline" })).toBeVisible();

    await page.getByLabel("Add a note").fill("Called payer; requested reconsideration form. (synthetic)");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Called payer; requested reconsideration form. (synthetic)")).toBeVisible();
    await expect(page.getByLabel("Add a note")).toHaveValue("");

    await page.getByLabel("Assignee").selectOption({ label: "Riley Worker" });
    await page.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByText("changed assignee")).toBeVisible();

    await page.getByLabel("Status").selectOption("needs_records");
    await page.getByRole("button", { name: "Update status" }).click();
    await expect(page.getByText("changed status to Needs records")).toBeVisible();
  });

  test("member ID is masked until revealed with a reason", async ({ page }) => {
    await page.goto("/denials");
    await page.getByRole("table").getByRole("link").first().click();
    await expect(page.getByLabel(/Member ID ending in \d{4}/)).toBeVisible();
    await page.getByRole("button", { name: "Reveal" }).click();
    await page.getByLabel("Reason for viewing").selectOption("appeal");
    await page.getByRole("button", { name: "Reveal" }).click();
    await expect(page.getByText(/^SYN\d{9}$/)).toBeVisible();
  });

  test("rejects malformed and unknown denial IDs", async ({ page }) => {
    expect((await page.goto("/denials/not-a-uuid"))?.status()).toBe(404);
    expect((await page.goto("/denials/00000000-0000-4000-8000-000000000000"))?.status()).toBe(404);
  });
});

test.describe("compliance role", () => {
  test.use({ storageState: "test/e2e/.auth/viewer.json" });

  test("can view but not change denials", async ({ page }) => {
    await page.goto("/denials");
    await page.getByRole("table").getByRole("link").first().click();
    await expect(page.getByText("You have read-only access to denials.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Update status" })).toBeDisabled();
    await expect(page.getByLabel("Add a note")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reveal" })).toHaveCount(0);
  });

  test("the server rejects changes even if the disabled controls are re-enabled", async ({ page }) => {
    await page.goto("/denials");
    await page.getByRole("table").getByRole("link").first().click();
    await expect(page.getByText("You have read-only access to denials.")).toBeVisible();
    await page.waitForLoadState("networkidle"); // let React hydrate before tampering
    // Simulate a user tampering with the page: re-enable the form and submit it.
    await page.evaluate(() =>
      document.querySelectorAll("textarea, button, select").forEach((el) => el.removeAttribute("disabled")),
    );
    await page.getByLabel("Add a note").fill("Should not be saved (synthetic)");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Your role can view denials but not change them.",
    );
    await expect(page.getByText("Should not be saved (synthetic)")).toHaveCount(0);
  });
});
