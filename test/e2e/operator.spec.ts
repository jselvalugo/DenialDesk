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
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome, / })).toBeVisible();

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
      await page.getByRole("button", { name: /, switch module$/ }).click();
      await expect(page.getByRole("dialog", { name: "Go to" })).toBeVisible();
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
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome, / })).toBeVisible();

    await page.goto("/operator");
    await expect(page).toHaveURL(/\/operator\/login$/);
    await signInOperator(page, e2eUser("operator"), new Set([currentStep()]));
    const names = (await page.context().cookies()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining([SESSION_COOKIE, OPERATOR_SESSION_COOKIE]));

    // The practice session is untouched, and signing out of the console leaves it alone.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome, / })).toBeVisible();
    await page.goto("/operator");
    await expect(page.getByRole("heading", { level: 1, name: "Practices" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/operator\/login$/);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome, / })).toBeVisible();
  });
});

test.describe("as the platform operator", () => {
  test.use({ storageState: "test/e2e/.auth/operator.json" });

  test("records a practice's BAA, downloads the signed copy, and the list shows its status", async ({
    page,
    browser,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/operator/practices/new");
    const name = `Synthetic Coral Clinic ${Date.now()}`;
    await page.getByLabel("Practice name").fill(name);
    await page.getByLabel("Admin's full name").fill("Synthetic Admin");
    await page.getByLabel("Admin's work email").fill(`baa-admin-${Date.now()}@e2e.denialdesk.test`);
    await page.getByRole("button", { name: "Create practice" }).click();
    await expect(page.getByRole("status")).toContainText(`${name} created`);
    await expect(page.getByRole("link", { name: "Open practice" })).toHaveAttribute(
      "href",
      /^\/operator\/practices\/[0-9a-f-]{36}$/,
    );
    // "Create another" clears the one-time password and shows an empty form.
    await page.getByRole("button", { name: "Create another" }).click();
    await expect(page.getByText("Temporary password")).toHaveCount(0);
    await expect(page.getByLabel("Practice name")).toHaveValue("");
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/operator$/);

    const table = page.getByRole("table", { name: "All practices on this environment" });
    const row = table.getByRole("row", { name: new RegExp(name) });
    await expect(row.getByRole("cell").nth(3)).toHaveText("No BAA");
    await row.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("No agreement on file")).toBeVisible();

    // Synthetic PDF bytes; never a real agreement. The preview server is synthetic-only (ADR 0003),
    // so the file name must start with SYN- and the operator attests to it.
    await page.getByLabel("Signed agreement").setInputFiles({
      name: "SYN-baa.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n% synthetic e2e BAA\n%%EOF\n", "latin1"),
    });
    await page.getByLabel("Effective date").fill("2026-09-01");
    await page.getByLabel("Expires on").fill("2027-08-31");
    await page.getByLabel("Date signed").fill("2026-08-28");
    await page.getByLabel("Signed for the practice by").fill("Synthetic Signer, Practice Administrator");
    await page.getByLabel("Signed for DenialDesk by").fill("Synthetic Officer, DenialDesk");
    await page.getByLabel("This is a synthetic test document").check();
    await page.getByRole("button", { name: "Record agreement" }).click();
    await expect(page.getByRole("status")).toContainText("SYN-baa.pdf recorded as the active agreement");

    const agreements = page.getByRole("table", { name: "Agreements on file" });
    await expect(agreements.getByRole("row")).toHaveCount(2); // header + one agreement
    await expect(agreements).toContainText("08/31/2027");

    const downloading = page.waitForEvent("download");
    await agreements.getByRole("link", { name: "SYN-baa.pdf" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("SYN-baa.pdf");
    const chunks: Buffer[] = [];
    for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("latin1");
    expect(body.startsWith("%PDF-1.7")).toBe(true);
    const downloadUrl = new URL(download.url());
    // Served as an attachment, never cached or sniffed (spec security notes).
    const served = await page.request.get(downloadUrl.pathname);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("application/pdf");
    expect(served.headers()["content-disposition"]).toBe('attachment; filename="SYN-baa.pdf"');
    expect(served.headers()["cache-control"]).toBe("no-store");
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");

    // Recording a renewal keeps the first agreement on file as superseded.
    await page.getByLabel("Signed agreement").setInputFiles({
      name: "SYN-baa-renewal.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n% synthetic e2e BAA renewal\n%%EOF\n", "latin1"),
    });
    await page.getByLabel("Effective date").fill("2026-09-15");
    await page.getByLabel("Date signed").fill("2026-09-10");
    await page.getByLabel("Signed for the practice by").fill("Synthetic Signer, Practice Administrator");
    await page.getByLabel("Signed for DenialDesk by").fill("Synthetic Officer, DenialDesk");
    await page.getByLabel("This is a synthetic test document").check();
    await page.getByRole("button", { name: "Record agreement" }).click();
    await expect(page.getByRole("status")).toContainText("previous agreement is kept as superseded");
    await expect(agreements.getByRole("row")).toHaveCount(3);
    await expect(agreements.getByRole("row").nth(1)).toContainText("Active");
    await expect(agreements.getByRole("row").nth(2)).toContainText("Superseded");

    // The first upload was the wrong file: mark it as recorded in error. It stays listed.
    await page
      .getByLabel("Agreement", { exact: true })
      .selectOption({ label: "SYN-baa.pdf · effective 09/01/2026 · Superseded" });
    await page.getByLabel("Why it was recorded in error").fill("Wrong file was uploaded for this practice.");
    await page.getByRole("button", { name: "Mark as recorded in error" }).click();
    await expect(page.getByRole("status").filter({ hasText: "recorded in error" })).toBeVisible();
    await expect(agreements.getByRole("row")).toHaveCount(3);
    await expect(agreements.getByRole("row").nth(2)).toContainText("Recorded in error");
    await expect(agreements.getByRole("row").nth(2)).toContainText("Wrong file was uploaded");

    await page.goto("/operator");
    await expect(
      table
        .getByRole("row", { name: new RegExp(name) })
        .getByRole("cell")
        .nth(3),
    ).toHaveText("Active");

    // Without an operator session the signed copy isn't served: the request is sent to sign in.
    const anonymous = await browser.newContext({ baseURL: downloadUrl.origin, storageState: undefined });
    const response = await anonymous.request.get(downloadUrl.pathname, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toMatch(/\/operator\/login$/);
    await anonymous.close();
  });

  test("sees every practice and can create, suspend, and reactivate one", async ({ page, browser }) => {
    test.setTimeout(60_000);
    await page.goto("/operator");
    await expect(page.getByRole("heading", { level: 1, name: "Practices" })).toBeVisible();
    await expect(page.getByText("Back to")).toHaveCount(0);
    const table = page.getByRole("table", { name: "All practices on this environment" });

    // Creating a practice happens on its own page, reached from the list.
    await page.getByRole("link", { name: "New practice" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New practice" })).toBeVisible();
    const name = `Synthetic Harbor Clinic ${Date.now()}`;
    await page.getByLabel("Practice name").fill(name);
    await page.getByLabel("Admin's full name").fill("Synthetic Admin");
    const adminEmail = `admin-${Date.now()}@e2e.denialdesk.test`;
    await page.getByLabel("Admin's work email").fill(adminEmail);
    await page.getByRole("button", { name: "Create practice" }).click();
    await expect(page.getByRole("status")).toContainText(`${name} created`);
    await expect(page.getByRole("status")).toContainText("Temporary password");

    const temporaryPassword = (await page.getByRole("status").locator("dd").nth(1).textContent())!.trim();
    await page.getByRole("link", { name: "All practices" }).click();

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
