import { expect, test } from "@playwright/test";
import { and, eq, gte } from "drizzle-orm";
import { OPERATOR_SESSION_COOKIE, SESSION_COOKIE } from "@/auth/policy";
import { currentStep } from "@/auth/totp";
import { systemDb } from "@/db/client";
import { auditEvents, users } from "@/db/schema";
import { e2eUser, freshCode, signInOperator, signInWithPassword } from "./support";

test.describe("sign-in", () => {
  test("there is no demo practice: sign-in offers only the practice account form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Explore the demo practice" })).toHaveCount(0);
  });

  test("a sign-in ends a half-finished sign-in in the same browser, audited", async ({ page, browser }) => {
    test.setTimeout(60_000); // may wait up to 30 s for a TOTP step the setup sign-in didn't use
    const startedAt = new Date(Date.now() - 1000);
    // One person enters a password and walks away before two-step verification.
    await signInWithPassword(page, e2eUser("viewer"));
    await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
    const abandoned = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE)!;

    // Someone else signs in on the same browser.
    const worker = e2eUser("worker");
    await signInWithPassword(page, worker);
    await page.getByLabel("6-digit code").fill(await freshCode(worker.totpSecret!, new Set([currentStep()])));
    await page.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    // The abandoned session no longer works anywhere, and its end is audited.
    const replay = await browser.newContext();
    await replay.addCookies([abandoned]);
    const replayPage = await replay.newPage();
    await replayPage.goto("/login/mfa");
    await expect(replayPage).toHaveURL(/\/login$/);
    await replay.close();
    const [workerRow] = await systemDb().select().from(users).where(eq(users.email, worker.email));
    const replaced = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "auth.session_replaced"),
          eq(auditEvents.actorUserId, workerRow!.id),
          gte(auditEvents.occurredAt, startedAt),
        ),
      );
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.metadata).toMatchObject({ previousAuthMethod: "password_mfa" });
  });
});

test.describe("operator console access", () => {
  test("sends signed-out visitors to the operator sign-in", async ({ page }) => {
    await page.goto("/operator");
    await expect(page).toHaveURL(/\/operator\/login$/);
    await expect(page.getByRole("heading", { name: "Operator sign-in" })).toBeVisible();
  });

  test.describe("as a regular practice user", () => {
    test.use({ storageState: "test/e2e/.auth/worker.json" });
    test("gets the operator sign-in, not the console, and no console link", async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: "App launcher" }).click();
      await expect(page.getByRole("dialog", { name: "App launcher" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Platform console" })).toHaveCount(0);
      await page.goto("/operator");
      await expect(page).toHaveURL(/\/operator\/login$/);
    });

    test("can't sign in to the console with a practice account", async ({ page }) => {
      const worker = e2eUser("worker");
      await page.goto("/operator/login");
      await page.getByLabel("Work email").fill(worker.email);
      await page.getByLabel("Password").fill(worker.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText("Email or password is incorrect");
    });
  });

  test("the operator account can't sign in to a practice", async ({ page }) => {
    const operator = e2eUser("operator");
    await signInWithPassword(page, operator);
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Email or password is incorrect");
  });

  test("there is no operator setup page: the account comes only from hosting configuration", async ({
    request,
  }) => {
    expect((await request.get("/operator/setup")).status()).toBe(404);
  });
});

test.describe("operator and practice sessions side by side", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("the operator signs in while a practice session in the same browser keeps working", async ({
    page,
  }) => {
    test.setTimeout(60_000); // may wait up to 30 s for a TOTP step the setup sign-in didn't use
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    await page.goto("/operator");
    await expect(page).toHaveURL(/\/operator\/login$/);
    await signInOperator(page, e2eUser("operator"), new Set([currentStep()]));
    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining([SESSION_COOKIE, OPERATOR_SESSION_COOKIE]));

    // The practice session is untouched, and signing out of the console leaves it alone.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await page.goto("/operator");
    await expect(page.getByRole("heading", { level: 1, name: "Practices" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/operator\/login$/);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });
});

test.describe("as the platform operator", () => {
  test.use({ storageState: "test/e2e/.auth/operator.json" });

  test("sees every practice and can create, suspend, and reactivate one", async ({ page, browser }) => {
    test.setTimeout(60_000);
    await page.goto("/operator");
    await expect(page.getByRole("heading", { level: 1, name: "Practices" })).toBeVisible();
    await expect(page.getByText("Back to")).toHaveCount(0);
    const table = page.getByRole("table", { name: "All practices on this environment" });

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
