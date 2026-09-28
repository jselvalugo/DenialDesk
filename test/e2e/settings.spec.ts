import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

// docs/specs/settings-and-custom-fields.md. Administrators' add/edit flow is covered by
// test/integration/custom-fields.test.ts; the e2e users are not administrators.
test.describe("settings", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("shows section tabs, and custom fields are view-only for non-administrators", async ({
    page,
    request,
  }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Settings sections" });
    await expect(tabs.getByRole("link", { name: "General" })).toHaveAttribute("aria-current", "page");
    await expect(tabs.getByRole("link", { name: "Users and roles" })).toHaveCount(0);
    await expect(tabs.getByText("Users and roles")).toBeVisible();

    await tabs.getByRole("link", { name: "Custom fields" }).click();
    await expect(tabs.getByRole("link", { name: "Custom fields" })).toHaveAttribute("aria-current", "page");
    await page
      .getByRole("navigation", { name: "Record types" })
      .getByRole("link", { name: /Claims/ })
      .click();
    await expect(page.getByRole("heading", { name: "Claims fields" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add field" })).toHaveCount(0);
    expect((await request.get("/settings/fields/new")).status()).toBe(404);
  });

  test("integrations: every role sees the connection summary; only administrators open or create one (PI1b-2)", async ({
    page,
    request,
  }) => {
    await page.goto("/settings");
    const tabs = page.getByRole("navigation", { name: "Settings sections" });
    await tabs.getByRole("link", { name: "Integrations" }).click();
    await expect(tabs.getByRole("link", { name: "Integrations" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "EHR/PM connections" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New connection" })).toHaveCount(0);
    expect((await request.get("/settings/integrations/new")).status()).toBe(404);
    expect((await request.get(`/settings/integrations/${randomUUID()}`)).status()).toBe(404);
  });
});
