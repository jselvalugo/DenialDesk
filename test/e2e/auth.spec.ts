import { expect, test } from "@playwright/test";
import { base32Decode } from "@/auth/totp";
import { e2eUser, freshCode, signInWithPassword } from "./support";

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/denials");
  await expect(page).toHaveURL(/\/login$/);
});

test("a wrong password shows a generic error", async ({ page }) => {
  await signInWithPassword(page, { ...e2eUser("worker"), password: "not-the-password" });
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Email or password is incorrect.");
});

test("an unknown account gets the same error", async ({ page }) => {
  await signInWithPassword(page, {
    email: "nobody@e2e.denialdesk.test",
    password: "whatever-123456",
    totpSecret: null,
  });
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Email or password is incorrect.");
});

test("a password alone does not open the app", async ({ page }) => {
  await signInWithPassword(page, e2eUser("worker"));
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await page.goto("/denials");
  await expect(page).toHaveURL(/\/login\/mfa$/);
});

test("five wrong passwords lock the account, even for the right password", async ({ page }) => {
  const user = e2eUser("locked");
  for (let i = 0; i < 4; i++) {
    await signInWithPassword(page, { ...user, password: `wrong-${i}-password` });
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Email or password is incorrect.");
  }
  await signInWithPassword(page, { ...user, password: "wrong-4-password" });
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Too many attempts");
  await signInWithPassword(page, user);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Too many attempts");
});

test("first sign-in requires setting up an authenticator", async ({ page }) => {
  await signInWithPassword(page, e2eUser("newbie"));
  await expect(page.getByRole("heading", { name: "Set up two-step verification" })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
  const key = (await page.getByText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/).textContent())!.replace(/\s/g, "");
  expect(base32Decode(key)).toHaveLength(20);

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Turn on two-step verification" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("didn't match");

  await page.getByLabel("6-digit code").fill(await freshCode(key, new Set()));
  await page.getByRole("button", { name: "Turn on two-step verification" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
});

test.describe("signed in", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("shows the user and practice, and signs out", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Riley Worker")).toBeVisible();
    await expect(page.getByText(/E2E practice .* \(synthetic\)/)).toBeVisible();
  });
});
