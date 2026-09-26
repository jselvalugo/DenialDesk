import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, customFields } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  MAX_FIELDS_PER_ENTITY,
  newCustomFieldSchema,
  type NewCustomField,
} from "@/domain/settings/custom-fields";
import {
  activeCustomFields,
  createCustomField,
  CustomFieldError,
  listCustomFields,
  setCustomFieldActive,
  updateCustomField,
} from "@/domain/settings/queries";
import { createTestTenant, expectDbError } from "./helpers";

// docs/specs/settings-and-custom-fields.md: definitions, tenant isolation (R-7.2.4), audit (R-7.5.1).
type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;

function field(overrides: Partial<Record<string, unknown>> = {}): NewCustomField {
  return newCustomFieldSchema.parse({
    entity: "patient",
    label: "Referring clinic",
    key: "referring_clinic",
    fieldType: "text",
    options: [],
    required: false,
    helpText: "",
    ...overrides,
  });
}

beforeAll(async () => {
  a = await createTestTenant("Fields A");
  b = await createTestTenant("Fields B");
});

afterAll(closeDatabase);

describe("custom fields", () => {
  it("creates fields in order and audits with IDs and enums only", async () => {
    const first = await withTenant(a, (tx) => createCustomField(tx, a, field()));
    await withTenant(a, (tx) =>
      createCustomField(
        tx,
        a,
        field({ label: "Tier", key: "tier", fieldType: "select", options: ["Gold", "Silver"] }),
      ),
    );
    const rows = await withTenant(a, (tx) => activeCustomFields(tx, "patient"));
    expect(rows.map((r) => [r.key, r.position])).toEqual([
      ["referring_clinic", 0],
      ["tier", 1],
    ]);
    const [event] = await systemDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, first), eq(auditEvents.action, "settings.custom_field_created")));
    expect(event).toMatchObject({ tenantId: a.tenantId, actorUserId: a.userId, entityType: "custom_field" });
    expect(JSON.stringify(event!.metadata)).not.toContain("Referring");
  });

  it("refuses a duplicate key on the same record type but allows it on another", async () => {
    await expect(withTenant(a, (tx) => createCustomField(tx, a, field()))).rejects.toBeInstanceOf(
      CustomFieldError,
    );
    await expect(
      withTenant(a, (tx) => createCustomField(tx, a, field({ entity: "claim" }))),
    ).resolves.toBeTypeOf("string");
  });

  it("isolates tenants: another practice sees none of these fields and can't change them", async () => {
    expect(await withTenant(b, (tx) => listCustomFields(tx))).toEqual([]);
    const [row] = await withTenant(a, (tx) => activeCustomFields(tx, "patient"));
    await expect(
      withTenant(b, (tx) => setCustomFieldActive(tx, b, row!.id, row!.updatedAt.toISOString(), false)),
    ).rejects.toThrow("Field not found.");
    await expectDbError(
      withTenant(b, (tx) =>
        tx.insert(customFields).values({
          tenantId: a.tenantId,
          entity: "patient",
          key: "sneaky",
          label: "Sneaky",
          fieldType: "text",
          createdBy: b.userId,
        }),
      ),
      /row-level security/,
    );
  });

  it("edits label and choices, rejects stale edits, deactivates and reactivates", async () => {
    const [row] = await withTenant(a, (tx) => activeCustomFields(tx, "patient"));
    const changed = await withTenant(a, (tx) =>
      updateCustomField(tx, a, row!.id, row!.updatedAt.toISOString(), {
        label: "Referring practice",
        options: [],
        required: true,
        helpText: null,
      }),
    );
    expect(changed).toEqual(["label", "required"]);
    await expect(
      withTenant(a, (tx) => setCustomFieldActive(tx, a, row!.id, row!.updatedAt.toISOString(), false)),
    ).rejects.toThrow(/changed since you opened it/);

    const [fresh] = await withTenant(a, (tx) =>
      tx.select().from(customFields).where(eq(customFields.id, row!.id)),
    );
    await withTenant(a, (tx) => setCustomFieldActive(tx, a, row!.id, fresh!.updatedAt.toISOString(), false));
    expect((await withTenant(a, (tx) => activeCustomFields(tx, "patient"))).map((r) => r.key)).toEqual([
      "tier",
    ]);
    const actions = await systemDb()
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(eq(auditEvents.entityId, row!.id));
    expect(actions.map((e) => e.action)).toEqual(
      expect.arrayContaining(["settings.custom_field_updated", "settings.custom_field_deactivated"]),
    );
  });

  it("limits active fields per record type; deactivating frees a slot, reactivating needs one", async () => {
    const c = await createTestTenant("Fields C");
    const ids: string[] = [];
    for (let i = 0; i < MAX_FIELDS_PER_ENTITY; i++) {
      ids.push(
        await withTenant(c, (tx) => createCustomField(tx, c, field({ entity: "payer", key: `f${i}` }))),
      );
    }
    await expect(
      withTenant(c, (tx) => createCustomField(tx, c, field({ entity: "payer", key: "extra" }))),
    ).rejects.toThrow(/50 active fields/);
    const stamp = async (id: string) =>
      (
        await withTenant(c, (tx) => tx.select().from(customFields).where(eq(customFields.id, id)))
      )[0]!.updatedAt.toISOString();
    await withTenant(c, async (tx) => setCustomFieldActive(tx, c, ids[0]!, await stamp(ids[0]!), false));
    await withTenant(c, (tx) => createCustomField(tx, c, field({ entity: "payer", key: "extra" })));
    await expect(
      withTenant(c, async (tx) => setCustomFieldActive(tx, c, ids[0]!, await stamp(ids[0]!), true)),
    ).rejects.toThrow(/50 active fields/);
  });

  it("reactivates a field and audits it", async () => {
    const [row] = (await withTenant(a, (tx) => listCustomFields(tx))).filter((r) => !r.active);
    await withTenant(a, (tx) => setCustomFieldActive(tx, a, row!.id, row!.updatedAt.toISOString(), true));
    expect((await withTenant(a, (tx) => activeCustomFields(tx, "patient"))).map((r) => r.id)).toContain(
      row!.id,
    );
    const [event] = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.entityId, row!.id), eq(auditEvents.action, "settings.custom_field_reactivated")),
      );
    expect(event).toBeDefined();
  });

  it("the database keeps a field's identity fixed and forbids deletes", async () => {
    const [row] = await withTenant(a, (tx) => activeCustomFields(tx, "patient"));
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(customFields).set({ key: "renamed" }).where(eq(customFields.id, row!.id)),
      ),
      /custom_fields identity is immutable/,
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(customFields).set({ fieldType: "number" }).where(eq(customFields.id, row!.id)),
      ),
      /custom_fields identity is immutable/,
    );
    await expectDbError(
      withTenant(a, (tx) => tx.delete(customFields).where(eq(customFields.id, row!.id))),
      /permission denied/,
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(
          sql`insert into custom_fields (tenant_id, entity, key, label, field_type, created_by) values (${a.tenantId}, 'patient', 'choice', 'Choice', 'select', ${a.userId})`,
        ),
      ),
      /SQLSTATE 23514/,
    );
  });
});
