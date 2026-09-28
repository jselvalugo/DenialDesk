import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { e2eUser } from "./support";

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
    // A real connection in the worker's practice, so the 404 below proves role gating, not a
    // missing row. Inserted as the table owner (the e2e users aren't administrators).
    const name = `E2E sandbox ${Date.now()}`;
    const [member] = await systemDb()
      .select({ tenantId: memberships.tenantId, userId: users.id })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(eq(users.email, e2eUser("worker").email));
    const inserted = await systemDb().execute<{ id: string }>(sql`
      insert into integration_connections
        (tenant_id, is_sandbox, display_name, base_url, endpoint_key, client_id, mrn_identifier_system, created_by, updated_by)
      values (${member!.tenantId}::uuid, true, ${name}, 'https://sandbox.fhir.denialdesk.invalid/r4',
        'https://sandbox.fhir.denialdesk.invalid/r4', 'sandbox-client', 'https://sandbox.fhir.denialdesk.invalid/mrn',
        ${member!.userId}::uuid, ${member!.userId}::uuid)
      returning id
    `);
    const id = inserted.rows[0]!.id;

    await page.goto("/settings");
    const tabs = page.getByRole("navigation", { name: "Settings sections" });
    await tabs.getByRole("link", { name: "Integrations" }).click();
    await expect(tabs.getByRole("link", { name: "Integrations" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "EHR/PM connections" })).toBeVisible();
    // Every role sees the summary row, but not as a link to the configuration.
    const row = page.getByRole("row", { name: new RegExp(name) });
    await expect(row).toContainText("Built-in test sandbox");
    await expect(row).toContainText("Draft");
    await expect(row.getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New connection" })).toHaveCount(0);
    expect((await request.get("/settings/integrations/new")).status()).toBe(404);
    expect((await request.get(`/settings/integrations/${id}`)).status()).toBe(404);
    // Leave the shared worker practice as it was (test fixture only; the app itself never deletes).
    await systemDb().execute(sql`delete from integration_connections where id = ${id}::uuid`);
  });
});
