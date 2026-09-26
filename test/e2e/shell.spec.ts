import { expect, test } from "@playwright/test";

test("sign-in page shows the synthetic-data banner", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("note", { name: "Environment notice" })).toContainText("Synthetic data only");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("skip link moves focus to the main content", async ({ page }) => {
  await page.goto("/design");
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
  await page.goto("/design");
  await expect(page.getByRole("link", { name: /^Appeals/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Denial queue" })).toBeVisible();
});

test("health endpoint reports status without leaking config", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["appEnv", "db", "status"]);
  expect(JSON.stringify(body)).not.toContain("postgres://");
});

test("pages send a nonce-based Content-Security-Policy and load without violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  const response = await page.goto("/login");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  await page.getByLabel("Work email").fill("csp-check@e2e.denialdesk.test");
  expect(violations).toEqual([]);
});

test("the preview seed endpoint rejects requests without the secret token", async ({ request }) => {
  expect((await request.post("/api/preview/seed")).status()).toBe(404);
  const wrong = await request.post("/api/preview/seed", {
    headers: { authorization: `Bearer ${"w".repeat(40)}` },
  });
  expect(wrong.status()).toBe(404);
});
