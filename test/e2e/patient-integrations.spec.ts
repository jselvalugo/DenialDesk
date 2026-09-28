import { expect, test } from "@playwright/test";

// docs/specs/patient-integrations.md "PI1b": Settings › Integrations and the Patients data-source
// drop-down. Uses a dedicated practice (test/e2e/global-setup.ts "integrations" practice) so
// activating a connection here never affects patients.spec.ts's practice.

test.describe("patient integrations (PI1b)", () => {
  test.use({ storageState: "test/e2e/.auth/intAdmin.json" });

  test("an admin creates and activates a sandbox connection; Patients reflects it", async ({ page }) => {
    await page.goto("/settings/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByText("No integrations yet")).toBeVisible();

    await page.getByRole("link", { name: "New connection" }).first().click();
    await expect(page.getByRole("heading", { name: "Connect an integration" })).toBeVisible();

    const form = page.getByRole("form", { name: "Connect an integration" });
    await form.getByLabel("Connection name").fill("Sandbox EHR");
    await form.getByRole("button", { name: "Use the synthetic sandbox" }).click();
    await expect(form.getByLabel("Base URL")).toHaveValue("https://sandbox.fhir.denialdesk.invalid/r4");
    await expect(form.getByLabel("Client ID")).toHaveValue("sandbox-client");
    await form.getByLabel("MRN identifier system").fill("http://hospital.example.org/mrn");
    await form.getByRole("button", { name: "Create connection" }).click();

    await expect(page.getByRole("heading", { level: 1, name: "Sandbox EHR" })).toBeVisible();
    await expect(page.getByText("Draft")).toBeVisible();

    await page.getByRole("button", { name: "Activate sandbox connection" }).click();
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    // The Patients tab now shows the connection's data-source menu, and hand-registering is closed.
    await page.goto("/patients");
    await expect(page.getByRole("link", { name: "Register patient" })).toHaveCount(0);
    await expect(
      page.getByText("Patients are synced from Sandbox EHR; edit them in your EHR/PM."),
    ).toBeVisible();

    const menuButton = page.getByRole("button", { name: "Patients data source: Not yet synced" });
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toContainText("Source: Sandbox EHR");
    await menuButton.click();
    const menu = page.getByRole("menu", { name: "Patients data source: Not yet synced" });
    await expect(menu.getByRole("menuitem", { name: "Manage connection" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Pause sync" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Connect an integration…" })).toHaveCount(0);

    await menu.getByRole("menuitem", { name: "Pause sync" }).click();
    await expect(page.getByRole("button", { name: "Patients data source: Paused" })).toBeVisible();
  });

  test("a non-admin sees the data-source menu read-only", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "test/e2e/.auth/intViewer.json" });
    const page = await context.newPage();
    await page.goto("/patients");
    await expect(page.getByRole("link", { name: "Register patient" })).toHaveCount(0);
    const menuButton = page.getByRole("button", { name: /^Patients data source: / });
    await expect(menuButton).toBeVisible();
    await menuButton.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Manage connection" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Connect an integration…" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: /Pause sync|Resume sync/ })).toHaveCount(0);
    await context.close();
  });
});
