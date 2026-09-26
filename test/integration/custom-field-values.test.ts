import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, claims, customFieldValues, denials, patients } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { generateDataset } from "@/domain/synthetic/generator";
import { newCustomFieldSchema, type NewCustomField } from "@/domain/settings/custom-fields";
import { createCustomField } from "@/domain/settings/queries";
import {
  loadValuesForRecord,
  revealCustomFieldValue,
  saveValuesForRecord,
} from "@/domain/custom-fields/values";
import { expectDbError } from "./helpers";

// docs/specs/settings-and-custom-fields.md S2; ADR 0007; docs/threat-models/custom-field-values.md.
// Values are never queryable, only reachable through this domain module and always audited.

type Ctx = { tenantId: string; userId: string };

function field(overrides: Partial<Record<string, unknown>> = {}): NewCustomField {
  return newCustomFieldSchema.parse({
    entity: "patient",
    label: "Referring clinic",
    key: "referring_clinic",
    fieldType: "text",
    options: [],
    required: false,
    helpText: "",
    sensitivity: "",
    ...overrides,
  });
}

/** A practice with one patient, claim, denial, and payer to attach values to. */
async function seededPractice(label: string, seed: number) {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `CFV ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [{ email: `cfv-${suffix}@synthetic.test`, displayName: `CFV ${label}`, role: "admin" }],
    dataset: generateDataset({ asOf: todayIn(), seed, patients: 2, claims: 4 }),
  });
  const ctx: Ctx = { tenantId, userId: userIds[0]! };
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({
        patientId: patients.id,
        claimId: claims.id,
        payerId: claims.payerId,
      })
      .from(claims)
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .limit(1),
  );
  const [denial] = await withTenant(ctx, (tx) => tx.select({ id: denials.id }).from(denials).limit(1));
  return {
    ctx,
    patientId: row!.patientId,
    claimId: row!.claimId,
    payerId: row!.payerId,
    denialId: denial?.id,
  };
}

let a: Awaited<ReturnType<typeof seededPractice>>;
let b: Awaited<ReturnType<typeof seededPractice>>;

beforeAll(async () => {
  a = await seededPractice("alpha", 101);
  b = await seededPractice("beta", 202);
});

afterAll(closeDatabase);

describe("custom field values", () => {
  it("saves, loads, and only re-writes what changed", async () => {
    const fieldId = await withTenant(a.ctx, (tx) => createCustomField(tx, a.ctx, field()));
    const changed = await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "Bay Clinic"]])),
    );
    expect(changed).toEqual(["referring_clinic"]);

    const loaded = await withTenant(a.ctx, (tx) =>
      loadValuesForRecord(tx, a.ctx, "patient", a.patientId, { recordSensitive: false }),
    );
    expect(loaded).toEqual([
      {
        fieldId,
        key: "referring_clinic",
        label: "Referring clinic",
        type: "text",
        masked: false,
        value: "Bay Clinic",
      },
    ]);

    // Re-saving the same value writes nothing.
    const unchanged = await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "Bay Clinic"]])),
    );
    expect(unchanged).toEqual([]);

    // A field left out of the submitted map (masked, not re-submitted) stays unchanged.
    const skip = await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map()),
    );
    expect(skip).toEqual([]);

    // Clearing writes NULL, never a delete.
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, ""]])),
    );
    const [row] = await systemDb()
      .select()
      .from(customFieldValues)
      .where(eq(customFieldValues.fieldId, fieldId));
    expect(row!.valueEnc).toBeNull();
  });

  it("masks a sensitive field's value and never decrypts it on load", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "hiv_status", sensitivity: "hiv" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "positive"]])),
    );
    const loaded = await withTenant(a.ctx, (tx) =>
      loadValuesForRecord(tx, a.ctx, "patient", a.patientId, { recordSensitive: false }),
    );
    const found = loaded.find((v) => v.fieldId === fieldId)!;
    expect(found.masked).toBe(true);
    expect(found.value).toBeUndefined();

    const revealed = await withTenant(a.ctx, (tx) =>
      revealCustomFieldValue(tx, a.ctx, {
        fieldId,
        entity: "patient",
        recordId: a.patientId,
        reason: "appeal",
      }),
    );
    expect(revealed.value).toBe("positive");

    const events = await systemDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "custom_field.value_revealed"));
    expect(events.some((e) => e.entityId === fieldId)).toBe(true);
    for (const e of events) expect(JSON.stringify(e)).not.toContain("positive");
  });

  it("masks every value on a record the caller marks sensitive, even a non-sensitive field", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "plain_note" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "unmasked normally"]])),
    );
    const loaded = await withTenant(a.ctx, (tx) =>
      loadValuesForRecord(tx, a.ctx, "patient", a.patientId, { recordSensitive: true }),
    );
    expect(loaded.find((v) => v.fieldId === fieldId)!.masked).toBe(true);
  });

  it("isolates tenants: cannot read, insert, or update another tenant's values", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "iso_field" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "alpha only"]])),
    );
    expect(await withTenant(b.ctx, (tx) => tx.select().from(customFieldValues))).toEqual([]);

    await expectDbError(
      withTenant(b.ctx, (tx) =>
        tx.insert(customFieldValues).values({
          tenantId: a.ctx.tenantId,
          fieldId,
          patientId: a.patientId,
          createdBy: b.ctx.userId,
          updatedBy: b.ctx.userId,
        }),
      ),
      /row-level security/,
    );
  });

  it("the guard trigger rejects a field/record from another tenant and an entity mismatch", async () => {
    const claimField = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "claim", key: "claim_only" })),
    );
    // Field is for claims, but the row targets patient_id: entity mismatch.
    await expectDbError(
      withTenant(a.ctx, (tx) =>
        tx.insert(customFieldValues).values({
          tenantId: a.ctx.tenantId,
          fieldId: claimField,
          patientId: a.patientId,
          createdBy: a.ctx.userId,
          updatedBy: a.ctx.userId,
        }),
      ),
      /not a patient field/,
    );

    const patientField = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "cross_tenant_record" })),
    );
    // b's patient with a's field: field and record tenants don't match (bypassing app-level RLS
    // checks isn't possible from application code, so this is exercised as the operator role).
    await expectDbError(
      systemDb().execute(
        sql`insert into custom_field_values (tenant_id, field_id, patient_id, created_by, updated_by)
              values (${b.ctx.tenantId}, ${patientField}, ${b.patientId}, ${b.ctx.userId}, ${b.ctx.userId})`,
      ),
      /does not belong to this tenant/,
    );
  });

  it("the database requires exactly one record column and forbids more than one", async () => {
    const fieldId = await withTenant(a.ctx, (tx) => createCustomField(tx, a.ctx, field({ key: "two_cols" })));
    await expectDbError(
      withTenant(a.ctx, (tx) =>
        tx.insert(customFieldValues).values({
          tenantId: a.ctx.tenantId,
          fieldId,
          patientId: a.patientId,
          claimId: a.claimId,
          createdBy: a.ctx.userId,
          updatedBy: a.ctx.userId,
        }),
      ),
      /SQLSTATE 23514/,
    );
  });

  it("keeps identity columns immutable and forbids deletes", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "immutable" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "v1"]])),
    );
    const [row] = await withTenant(a.ctx, (tx) =>
      tx.select().from(customFieldValues).where(eq(customFieldValues.fieldId, fieldId)),
    );
    await expectDbError(
      withTenant(a.ctx, (tx) =>
        tx.update(customFieldValues).set({ patientId: a.claimId }).where(eq(customFieldValues.id, row!.id)),
      ),
      /identity is immutable/,
    );
    await expectDbError(
      withTenant(a.ctx, (tx) => tx.delete(customFieldValues).where(eq(customFieldValues.id, row!.id))),
      /permission denied/,
    );
  });

  it("a ciphertext copied to another row fails to decrypt (AAD binds it to its own row)", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "aad_bound" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "bound value"]])),
    );
    const [row] = await systemDb()
      .select()
      .from(customFieldValues)
      .where(eq(customFieldValues.fieldId, fieldId));

    // A second patient on the same tenant to copy the ciphertext onto.
    const otherFieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "aad_bound_target" })),
    );
    const [otherPatient] = await withTenant(a.ctx, (tx) =>
      tx
        .select({ id: patients.id })
        .from(patients)
        .where(sql`${patients.id} != ${a.patientId}`)
        .limit(1),
    );
    await withTenant(a.ctx, (tx) =>
      tx.insert(customFieldValues).values({
        tenantId: a.ctx.tenantId,
        fieldId: otherFieldId,
        patientId: otherPatient!.id,
        valueEnc: row!.valueEnc,
        createdBy: a.ctx.userId,
        updatedBy: a.ctx.userId,
      }),
    );

    const reveal = await withTenant(a.ctx, (tx) =>
      revealCustomFieldValue(tx, a.ctx, {
        fieldId: otherFieldId,
        entity: "patient",
        recordId: otherPatient!.id,
        reason: "other",
      }),
    );
    expect(reveal.error).toBe("Value unavailable.");
    const failures = await systemDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "custom_field.value_integrity_failed"));
    expect(failures.some((e) => e.entityId === otherFieldId)).toBe(true);
    for (const e of failures) expect(JSON.stringify(e)).not.toContain("bound value");
  });

  it("has no DELETE grant", async () => {
    const rows = (await systemDb().execute(
      sql`select has_table_privilege('denialdesk_app', 'custom_field_values', 'DELETE') as has_delete`,
    )) as unknown as { has_delete: boolean }[];
    expect(rows[0]!.has_delete).toBe(false);
  });

  it("works for claims, denials, and payers too", async () => {
    const claimFieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "claim", key: "claim_note" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "claim", a.claimId, new Map([[claimFieldId, "claim value"]])),
    );
    expect(
      (
        await withTenant(a.ctx, (tx) =>
          loadValuesForRecord(tx, a.ctx, "claim", a.claimId, { recordSensitive: false }),
        )
      ).find((v) => v.fieldId === claimFieldId)?.value,
    ).toBe("claim value");

    if (a.denialId) {
      const denialFieldId = await withTenant(a.ctx, (tx) =>
        createCustomField(tx, a.ctx, field({ entity: "denial", key: "denial_note" })),
      );
      await withTenant(a.ctx, (tx) =>
        saveValuesForRecord(tx, a.ctx, "denial", a.denialId!, new Map([[denialFieldId, "denial value"]])),
      );
      expect(
        (
          await withTenant(a.ctx, (tx) =>
            loadValuesForRecord(tx, a.ctx, "denial", a.denialId!, { recordSensitive: false }),
          )
        ).find((v) => v.fieldId === denialFieldId)?.value,
      ).toBe("denial value");
    }

    const payerFieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "payer", key: "payer_note" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "payer", a.payerId, new Map([[payerFieldId, "payer value"]])),
    );
    expect(
      (
        await withTenant(a.ctx, (tx) =>
          loadValuesForRecord(tx, a.ctx, "payer", a.payerId, { recordSensitive: false }),
        )
      ).find((v) => v.fieldId === payerFieldId)?.value,
    ).toBe("payer value");
  });
});

// Guard against a regression this table is designed to avoid: values must never be joined into
// list, search, or export queries (threat model I3).
describe("no list/search/export module reads custom field values", () => {
  it("never imports the custom field values domain module", async () => {
    const fs = await import("node:fs/promises");
    const candidates = [
      "src/domain/patients/queries.ts",
      "src/domain/claims/correction.ts",
      "src/domain/synthetic/generator.ts",
    ];
    for (const path of candidates) {
      const source = await fs.readFile(path, "utf8").catch(() => "");
      expect(source).not.toContain("custom-fields/values");
    }
  });
});
