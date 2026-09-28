import { expect, test, type Page } from "@playwright/test";

// docs/specs/patient-integrations.md "PI1b": Settings › Integrations and the Patients data-source
// drop-down. Uses a dedicated practice (test/e2e/global-setup.ts "integrations" practice) so
// activating a connection here never affects patients.spec.ts's practice. Each test creates and
// activates its own sandbox connection (security review PR #81, item 20) rather than asserting on
// state a sibling test happened to leave behind. Only one connection may be outside draft/revoked
// per tenant at a time, and "New connection" is hidden while one exists (item 4) — the first test
// revokes its own connection before finishing so the second, run after it in this single-worker
// file, has a clean slate to create its own; this file still depends on that run order (Playwright
// runs a file's tests in declaration order with `workers: 1`, as configured here), which a fully
// separate practice per test would remove at the cost of a second seeded admin/viewer pair.

async function createAndActivateSandbox(page: Page, name: string): Promise<void> {
  await page.goto("/settings/integrations");
  await page.getByRole("link", { name: "New connection" }).first().click();
  await expect(page.getByRole("heading", { name: "Connect an integration" })).toBeVisible();

  const form = page.getByRole("form", { name: "Connect an integration" });
  await form.getByLabel("Connection name").fill(name);
  await form.getByRole("button", { name: "Use the synthetic sandbox" }).click();
  await expect(form.getByLabel("Base URL")).toHaveValue("https://sandbox.fhir.denialdesk.invalid/r4");
  await expect(form.getByLabel("Client ID")).toHaveValue("sandbox-client");
  await form.getByLabel("MRN identifier system").fill("http://hospital.example.org/mrn");
  await form.getByRole("button", { name: "Create connection" }).click();

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Draft")).toBeVisible();

  await page.getByRole("button", { name: "Activate sandbox connection" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
}

test.describe("patient integrations (PI1b)", () => {
  test.use({ storageState: "test/e2e/.auth/intAdmin.json" });

  test("an admin creates and activates a sandbox connection; Patients reflects it", async ({ page }) => {
    await expect(page.locator("body")).toBeVisible();
    await createAndActivateSandbox(page, "Sandbox EHR Admin");

    // The Patients tab now shows the connection's data-source menu, and hand-registering is closed.
    await page.goto("/patients");
    await expect(page.getByRole("link", { name: "Register patient" })).toHaveCount(0);
    await expect(
      page.getByText("Patients are synced from Sandbox EHR Admin; edit them in your EHR/PM."),
    ).toBeVisible();

    const menuButton = page.getByRole("button", { name: "Patients data source: Not yet synced" });
    await expect(menuButton).toBeVisible();
    // The menu shows the connection's full name (security review PR #81, item 2), not truncated.
    await expect(menuButton).toContainText("Source: Sandbox EHR Admin");
    await menuButton.click();
    const menu = page.getByRole("menu", { name: "Patients data source: Not yet synced" });
    // The panel is portaled to document.body and positioned from the button's rect (item 2); assert
    // it is actually on screen, not just present in the DOM.
    await expect(menu).toBeVisible();
    await expect(menu).toBeInViewport();
    await expect(menu.getByText("Sandbox EHR Admin")).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Manage connection" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Manage connection" })).toBeInViewport();
    await expect(menu.getByRole("menuitem", { name: "Pause sync" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Connect an integration…" })).toHaveCount(0);

    await menu.getByRole("menuitem", { name: "Pause sync" }).click();
    await expect(page.getByRole("button", { name: "Patients data source: Paused" })).toBeVisible();

    // Revoke, ending this test with no live connection: only one connection may be outside
    // draft/revoked per tenant at a time, and "New connection" is hidden while one exists
    // (security review PR #81, item 4), so the next test needs this one gone to create its own
    // (item 20: each test sets up its own state, never relying on what a sibling test leaves
    // behind while it's still live). Navigated to directly, rather than through the drop-down
    // again: the drop-down's `open` state survives the Pause form's server action (the same
    // client component instance re-renders with fresh props, it isn't remounted), so a second
    // click on the trigger button would toggle it closed instead of opening it.
    await page.goto("/settings/integrations");
    await page.getByRole("link", { name: "Sandbox EHR Admin" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Sandbox EHR Admin" })).toBeVisible();
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await page.getByLabel("Reason").selectOption("no_longer_used");
    await page.getByRole("button", { name: "Revoke connection" }).click();
    await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  });

  test("a non-admin sees the data-source menu read-only", async ({ browser }) => {
    const adminContext = await browser.newContext({ storageState: "test/e2e/.auth/intAdmin.json" });
    const adminPage = await adminContext.newPage();
    await createAndActivateSandbox(adminPage, "Sandbox EHR Viewer");
    await adminContext.close();

    const context = await browser.newContext({ storageState: "test/e2e/.auth/intViewer.json" });
    const page = await context.newPage();
    await page.goto("/patients");
    await expect(page.getByRole("link", { name: "Register patient" })).toHaveCount(0);
    const menuButton = page.getByRole("button", { name: /^Patients data source: / });
    await expect(menuButton).toBeVisible();
    await expect(menuButton).toContainText("Source: Sandbox EHR Viewer");
    await menuButton.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu).toBeInViewport();
    await expect(menu.getByRole("menuitem", { name: "Manage connection" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Connect an integration…" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: /Pause sync|Resume sync/ })).toHaveCount(0);
    await context.close();
  });
});
