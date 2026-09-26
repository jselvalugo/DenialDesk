import { expect, test } from "@playwright/test";
import { and, eq, gte } from "drizzle-orm";
import { SESSION_COOKIE } from "@/auth/policy";
import { currentStep } from "@/auth/totp";
import { systemDb } from "@/db/client";
import { auditEvents, users } from "@/db/schema";
import { e2eUser, freshCode, openFromLauncher, signInWithPassword } from "./support";

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

  test("demo sessions are sent to sign-in, and the operator can sign in from there", async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000); // may wait up to 30 s for a TOTP step the setup sign-in didn't use
    const startedAt = new Date(Date.now() - 1000);
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore the demo practice" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await page.getByRole("button", { name: "App launcher" }).click();
    await expect(page.getByRole("dialog", { name: "App launcher" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Platform console" })).toHaveCount(0);
    await page.goto("/operator");
    await expect(page).toHaveURL(/\/login\?reason=account$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Signing in ends the demo session");
    await expect(page.getByRole("button", { name: "Explore the demo practice" })).toHaveCount(0);

    // The sign-in page no longer bounces a demo session back to the demo.
    await page.goto("/login");
    await expect(page.getByRole("status")).toContainText("Signing in ends the demo session");
    const demoCookie = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE)!;
    const operator = e2eUser("operator");
    await signInWithPassword(page, operator);
    await page
      .getByLabel("6-digit code")
      .fill(await freshCode(operator.totpSecret!, new Set([currentStep()])));
    await page.getByRole("button", { name: "Verify" }).click();
    await openFromLauncher(page, "Platform console");
    await expect(page.getByRole("heading", { level: 1, name: "Practices" })).toBeVisible();

    // Signing in ended the demo session: its old cookie no longer works anywhere, and that's audited.
    const replay = await browser.newContext();
    await replay.addCookies([demoCookie]);
    const replayPage = await replay.newPage();
    await replayPage.goto("/");
    await expect(replayPage).toHaveURL(/\/login$/);
    await replay.close();
    const [operatorRow] = await systemDb().select().from(users).where(eq(users.email, operator.email));
    const replaced = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "auth.session_replaced"),
          eq(auditEvents.actorUserId, operatorRow!.id),
          gte(auditEvents.occurredAt, startedAt),
        ),
      );
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.metadata).toMatchObject({ previousAuthMethod: "demo" });
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
      await page.getByRole("button", { name: "App launcher" }).click();
      await expect(page.getByRole("dialog", { name: "App launcher" })).toBeVisible();
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
    await openFromLauncher(page, "Platform console");
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
