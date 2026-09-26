import { expect, test } from "@playwright/test";

// Same build as the preview project, started with APP_ENV=production.
test("production hides the synthetic-data banner", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("note", { name: "Environment notice" })).toHaveCount(0);
});

test("production returns 404 for the design system page", async ({ request }) => {
  const response = await request.get("/design");
  expect(response.status()).toBe(404);
});

test("health endpoint reports production", async ({ request }) => {
  const body = await (await request.get("/api/health")).json();
  expect(body.appEnv).toBe("production");
});

test("the preview seed endpoint does not exist in production", async ({ request }) => {
  const response = await request.post("/api/preview/seed", {
    headers: { authorization: "Bearer x".repeat(8) },
  });
  expect(response.status()).toBe(404);
});

test("production never offers the demo login, even with DEMO_LOGIN_ENABLED set", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Explore the demo practice" })).toHaveCount(0);
});

test("the operator setup page does not exist in production", async ({ request }) => {
  const response = await request.get("/operator/setup");
  expect(response.status()).toBe(404);
});
