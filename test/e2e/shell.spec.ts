import { expect, test } from "@playwright/test";

test("home page shows the synthetic-data banner and an honest empty state", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("note", { name: "Environment notice" })).toContainText("Synthetic data only");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByText("No claim data yet")).toBeVisible();
});

test("skip link moves focus to the main content", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("design system page renders the sample queue", async ({ page }) => {
  await page.goto("/design");
  const table = page.getByRole("table", { name: /sample denial queue/i });
  await expect(table.getByRole("row")).toHaveCount(8);
  await expect(page.getByRole("link", { name: "Design system" })).toHaveAttribute("aria-current", "page");
});

test("unbuilt sections are not links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Denial queue/ })).toHaveCount(0);
});

test("health endpoint reports status without leaking config", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["appEnv", "db", "status"]);
  expect(JSON.stringify(body)).not.toContain("postgres://");
});
