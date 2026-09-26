import { expect, test } from "@playwright/test";

test.describe("demo login", () => {
  test("one click opens the demo practice without MFA", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore the demo practice" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText("Sunrise Coast Medical Group (demo)")).toBeVisible();
    await expect(page.getByText(/Demo practice · shared/)).toBeVisible();
    await expect(page.getByRole("note", { name: "Demo practice notice" })).toContainText(
      "Never enter real patient information",
    );
    await page.goto("/denials");
    await expect(page.getByRole("table").getByRole("row")).not.toHaveCount(0);
  });

  test("demo sessions can't open the operator console", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore the demo practice" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Platform console" })).toHaveCount(0);
    expect((await page.goto("/operator"))?.status()).toBe(404);
  });
});

test.describe("operator console access", () => {
  test("sends signed-out visitors to sign-in", async ({ page }) => {
    await page.goto("/operator");
    await expect(page).toHaveURL(/\/login$/);
  });

  test.describe("as a regular practice user", () => {
    test.use({ storageState: "test/e2e/.auth/worker.json" });
    test("is a 404 and not linked", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("link", { name: "Platform console" })).toHaveCount(0);
      expect((await page.goto("/operator"))?.status()).toBe(404);
    });
  });
});

test.describe("as the platform operator", () => {
  test.use({ storageState: "test/e2e/.auth/operator.json" });

  test("sees every practice and can create, suspend, and reactivate one", async ({ page, browser }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.getByRole("link", { name: "Platform console" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Practices" })).toBeVisible();
    const table = page.getByRole("table", { name: "All practices on this environment" });
    await expect(table.getByText("E2E operator practice (synthetic)").first()).toBeVisible();

    const name = `Synthetic Harbor Clinic ${Date.now()}`;
    await page.getByLabel("Practice name").fill(name);
    await page.getByLabel("Admin's full name").fill("Synthetic Admin");
    const adminEmail = `admin-${Date.now()}@e2e.denialdesk.test`;
    await page.getByLabel("Admin's work email").fill(adminEmail);
    await page.getByRole("button", { name: "Create practice" }).click();
    await expect(page.getByRole("status")).toContainText(`${name} created`);
    await expect(page.getByRole("status")).toContainText("Temporary password");

    const temporaryPassword = (await page.getByRole("status").locator("dd").nth(1).textContent())!.trim();

    // The new admin must replace the temporary password before setting up MFA.
    const adminContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      storageState: undefined,
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/login");
    await adminPage.getByLabel("Work email").fill(adminEmail);
    await adminPage.getByLabel("Password").fill(temporaryPassword);
    await adminPage.getByRole("button", { name: "Sign in" }).click();
    await expect(adminPage.getByRole("heading", { name: "Choose your password" })).toBeVisible();
    await adminPage.goto("/login/mfa/setup");
    await expect(adminPage).toHaveURL(/\/login\/password$/);
    await adminPage.getByLabel("New password", { exact: true }).fill(temporaryPassword);
    await adminPage.getByLabel("Confirm new password").fill(temporaryPassword);
    await adminPage.getByRole("button", { name: "Set password" }).click();
    await expect(adminPage.getByRole("main").getByRole("alert")).toContainText(
      "different from the temporary one",
    );
    await adminPage.getByLabel("New password", { exact: true }).fill("a synthetic harbor passphrase");
    await adminPage.getByLabel("Confirm new password").fill("a synthetic harbor passphrase");
    await adminPage.getByRole("button", { name: "Set password" }).click();
    await expect(adminPage.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
    await adminContext.close();

    const row = table.getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: `Suspend ${name}` }).click();
    await expect(row.getByText("Suspended")).toBeVisible();
    await row.getByRole("button", { name: `Reactivate ${name}` }).click();
    await expect(row.getByText("Active")).toBeVisible();
  });
});
