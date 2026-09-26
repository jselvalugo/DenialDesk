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
  await page.getByRole("button", { name: "App launcher" }).click();
  const launcher = page.getByRole("dialog", { name: "App launcher" });
  await expect(launcher.getByText("Appeals")).toBeVisible();
  await expect(page.getByRole("link", { name: /^Appeals/ })).toHaveCount(0);
  await expect(launcher.getByRole("link", { name: "Denial queue" })).toBeVisible();
});

test("the app launcher searches apps and pages and opens one", async ({ page }) => {
  await page.goto("/design");
  await page.keyboard.press("Control+k");
  const launcher = page.getByRole("dialog", { name: "App launcher" });
  await expect(launcher.getByLabel("Search apps and pages")).toBeFocused();
  await launcher.getByLabel("Search apps and pages").fill("queue");
  await expect(launcher.getByRole("link", { name: "Design system" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(launcher).toBeHidden();
  await page.getByRole("button", { name: "App launcher" }).click();
  await launcher.getByRole("link", { name: "Setup app" }).click();
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Design system" }),
  ).toHaveAttribute("aria-current", "page");
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
  // 404 without a valid token; 429 once this network exceeds the endpoint's rate limit.
  expect([404, 429]).toContain((await request.post("/api/preview/seed")).status());
  const wrong = await request.post("/api/preview/seed", {
    headers: { authorization: `Bearer ${"w".repeat(40)}` },
  });
  expect([404, 429]).toContain(wrong.status());
});

test("navigation icons are decorative and link names stay text-only", async ({ page }) => {
  await page.goto("/design");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await page.getByRole("button", { name: "App launcher" }).click();
  const launcher = page.getByRole("dialog", { name: "App launcher" });
  for (const scope of [nav, launcher]) {
    const icons = scope.locator("svg");
    expect(await icons.count()).toBeGreaterThan(0);
    for (const icon of await icons.all()) await expect(icon).toHaveAttribute("aria-hidden", "true");
  }
  await expect(nav.getByRole("link", { name: "Design system", exact: true })).toBeVisible();
  await expect(launcher.getByRole("link", { name: "Denial queue", exact: true })).toBeVisible();
});
