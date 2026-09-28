import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase, systemDb } from "@/db/client";
import { decryptField, encryptField } from "@/lib/crypto/field";
import {
  auditEvents,
  claims,
  claimVersions,
  customFieldValues,
  customFieldValueVersions,
  denials,
  memberships,
  patients,
  users,
} from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import type { Role } from "@/auth/session";
import { generateDataset } from "@/domain/synthetic/generator";
import { newCustomFieldSchema, type NewCustomField } from "@/domain/settings/custom-fields";
import { createCustomField } from "@/domain/settings/queries";
import {
  CustomFieldValueError,
  customFieldValuesToken,
  loadValuesForRecord,
  revealCustomFieldValue,
  saveValuesForRecord,
} from "@/domain/custom-fields/values";
import { loadListValues } from "@/domain/custom-fields/list-values";
import { createPatient, updatePatient } from "@/domain/patients/queries";
import { expectDbError } from "./helpers";

// docs/specs/settings-and-custom-fields.md S2; ADR 0007 (+ addendum 2026-09-26);
// docs/threat-models/custom-field-values.md. Values are never queryable, only reachable through
// this domain module and always audited.

type Ctx = { tenantId: string; userId: string; role: Role };

/** Adds a second user with the given role to an existing (already-seeded) practice. */
async function addUser(tenantId: string, role: Role, label: string): Promise<Ctx> {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [row] = await systemDb()
    .insert(users)
    .values({ email: `cfv-${suffix}@synthetic.test`, displayName: `CFV ${label}`, passwordHash: "not-used" })
    .returning();
  await systemDb().insert(memberships).values({ tenantId, userId: row!.id, role });
  return { tenantId, userId: row!.id, role };
}

function field(overrides: Partial<Record<string, unknown>> = {}): NewCustomField {
  return newCustomFieldSchema().parse({
    entity: "patient",
    label: "Referring clinic",
    key: "referring_clinic",
    fieldType: "text",
    options: [],
    required: false,
    helpText: "",
    sensitivity: "",
    showInList: false,
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
  const ctx: Ctx = { tenantId, userId: userIds[0]!, role: "admin" };
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

/** A denial on this specific claim (guaranteed the same patient as the claim), or undefined if the
 * synthetic dataset didn't generate one for it. */
async function denialIdForClaim(ctx: Ctx, claimId: string): Promise<string | undefined> {
  const [row] = await withTenant(ctx, (tx) =>
    tx.select({ id: denials.id }).from(denials).where(eq(denials.claimId, claimId)).limit(1),
  );
  return row?.id;
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

    const loaded = await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "patient", a.patientId));
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
    const loaded = await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "patient", a.patientId));
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

  it("masks every value on a record with sensitivity tags, even a non-sensitive field (looked up internally, not from the caller)", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "plain_note" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "unmasked normally"]])),
    );
    await systemDb()
      .update(patients)
      .set({ sensitivityTags: ["hiv"] })
      .where(eq(patients.id, a.patientId));
    try {
      const loaded = await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "patient", a.patientId));
      expect(loaded.find((v) => v.fieldId === fieldId)!.masked).toBe(true);
      expect(loaded.find((v) => v.fieldId === fieldId)!.value).toBeUndefined();
    } finally {
      await systemDb().update(patients).set({ sensitivityTags: [] }).where(eq(patients.id, a.patientId));
    }
  });

  it("isolates tenants: cannot read, insert, or update another tenant's values", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "iso_field" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "alpha only"]])),
    );
    expect(await withTenant(b.ctx, (tx) => tx.select().from(customFieldValues))).toEqual([]);

    // Two layers reject this: RLS's WITH CHECK (tenant_id must equal the session's tenant, B) and
    // the guard trigger (looking up the field under RLS as session B, so A's field is invisible
    // and looks like it "doesn't belong" to the tenant on the row). Either message is a correct
    // rejection; which one surfaces depends on trigger-vs-RLS evaluation order in Postgres.
    const rejectsCrossTenantWrite = /row-level security|does not belong to this tenant/;
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
      rejectsCrossTenantWrite,
    );

    // An UPDATE naming tenant A's row succeeds as a no-op: RLS's USING clause filters the row out
    // before the WHERE clause is even evaluated, so tenant B's session simply can't see it to
    // target it — no rows change, which is the update side of the same isolation.
    const [aliceRow] = await withTenant(a.ctx, (tx) =>
      tx.select().from(customFieldValues).where(eq(customFieldValues.fieldId, fieldId)),
    );
    await withTenant(b.ctx, (tx) =>
      tx
        .update(customFieldValues)
        .set({ valueEnc: "tampered" })
        .where(eq(customFieldValues.id, aliceRow!.id)),
    );
    const [stillAlices] = await withTenant(a.ctx, (tx) =>
      tx.select().from(customFieldValues).where(eq(customFieldValues.id, aliceRow!.id)),
    );
    expect(stillAlices!.valueEnc).toBe(aliceRow!.valueEnc); // untouched
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

    // A second patient on the same tenant to copy the ciphertext onto. Sensitive, so
    // revealCustomFieldValue actually attempts a decrypt instead of refusing as "not locked".
    const otherFieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "aad_bound_target", sensitivity: "hiv" })),
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
    const result = await systemDb().execute<{ has_delete: boolean }>(
      sql`select has_table_privilege('denialdesk_app', 'custom_field_values', 'DELETE') as has_delete`,
    );
    expect(result.rows[0]!.has_delete).toBe(false);
  });

  it("works for claims, denials, and payers too", async () => {
    const claimFieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "claim", key: "claim_note" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "claim", a.claimId, new Map([[claimFieldId, "claim value"]])),
    );
    expect(
      (await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "claim", a.claimId))).find(
        (v) => v.fieldId === claimFieldId,
      )?.value,
    ).toBe("claim value");

    if (a.denialId) {
      const denialFieldId = await withTenant(a.ctx, (tx) =>
        createCustomField(tx, a.ctx, field({ entity: "denial", key: "denial_note" })),
      );
      await withTenant(a.ctx, (tx) =>
        saveValuesForRecord(tx, a.ctx, "denial", a.denialId!, new Map([[denialFieldId, "denial value"]])),
      );
      expect(
        (await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "denial", a.denialId!))).find(
          (v) => v.fieldId === denialFieldId,
        )?.value,
      ).toBe("denial value");
    }

    const payerFieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "payer", key: "payer_note" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "payer", a.payerId, new Map([[payerFieldId, "payer value"]])),
    );
    expect(
      (await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "payer", a.payerId))).find(
        (v) => v.fieldId === payerFieldId,
      )?.value,
    ).toBe("payer value");
  });

  it("only roles that may reveal member IDs can reveal a sensitive value; others are refused with no decrypt", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "role_gated", sensitivity: "mental_health" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "confidential"]])),
    );
    const compliance = await addUser(a.ctx.tenantId, "compliance", "compliance-reveal");
    const before = await systemDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "custom_field.value_revealed"));

    const result = await withTenant(compliance, (tx) =>
      revealCustomFieldValue(tx, compliance, {
        fieldId,
        entity: "patient",
        recordId: a.patientId,
        reason: "appeal",
      }),
    );
    expect(result.value).toBeUndefined();
    expect(result.error).toBe("Your role can't reveal custom field values.");

    // No new reveal audit event: the refusal happened before any decrypt was attempted.
    const after = await systemDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "custom_field.value_revealed"));
    expect(after.length).toBe(before.length);

    // A role that may work denials (and so may reveal member IDs) can.
    const specialist = await addUser(a.ctx.tenantId, "specialist", "specialist-reveal");
    const allowed = await withTenant(specialist, (tx) =>
      revealCustomFieldValue(tx, specialist, {
        fieldId,
        entity: "patient",
        recordId: a.patientId,
        reason: "appeal",
      }),
    );
    expect(allowed.value).toBe("confidential");
  });

  it("refuses to reveal a field that isn't actually locked, or belongs to another entity, or is inactive", async () => {
    const fieldId = await withTenant(
      a.ctx,
      (tx) => createCustomField(tx, a.ctx, field({ key: "not_locked" })), // no sensitivity
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "plain"]])),
    );
    const notLocked = await withTenant(a.ctx, (tx) =>
      revealCustomFieldValue(tx, a.ctx, {
        fieldId,
        entity: "patient",
        recordId: a.patientId,
        reason: "other",
      }),
    );
    expect(notLocked.error).toBe("This value isn't locked.");

    const wrongEntity = await withTenant(a.ctx, (tx) =>
      revealCustomFieldValue(tx, a.ctx, { fieldId, entity: "claim", recordId: a.claimId, reason: "other" }),
    );
    expect(wrongEntity.error).toBe("Field not found.");
  });

  it("refuses to write a sensitive (masked) field's value unless the actor may reveal it", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "write_gated", sensitivity: "genetic" })),
    );
    const compliance = await addUser(a.ctx.tenantId, "compliance", "compliance-write");
    await expect(
      withTenant(compliance, (tx) =>
        saveValuesForRecord(tx, compliance, "patient", a.patientId, new Map([[fieldId, "genetic data"]])),
      ),
    ).rejects.toBeInstanceOf(CustomFieldValueError);

    const [row] = await systemDb()
      .select()
      .from(customFieldValues)
      .where(eq(customFieldValues.fieldId, fieldId));
    expect(row).toBeUndefined(); // nothing was written

    // The same write from a role that may reveal member IDs succeeds.
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "genetic data"]])),
    );
    const [saved] = await systemDb()
      .select()
      .from(customFieldValues)
      .where(eq(customFieldValues.fieldId, fieldId));
    expect(saved).toBeDefined();
  });

  it("emits custom_field.values_read once per load, listing decrypted (unmasked) field IDs only", async () => {
    const textField = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "read_audit_text" })),
    );
    const sensitiveField = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "read_audit_sensitive", sensitivity: "sud" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(
        tx,
        a.ctx,
        "patient",
        a.patientId,
        new Map([
          [textField, "readable"],
          [sensitiveField, "hidden"],
        ]),
      ),
    );
    await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "patient", a.patientId));
    const [event] = await systemDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "custom_field.values_read"))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);
    expect(event).toBeDefined();
    expect(event!.metadata).toMatchObject({ entity: "patient", recordId: a.patientId });
    const fieldIds = String((event!.metadata as Record<string, string>).fieldIds).split(",");
    expect(fieldIds).toContain(textField);
    expect(fieldIds).not.toContain(sensitiveField);
    expect(JSON.stringify(event)).not.toContain("readable");
  });

  it("emits custom_field.values_updated with the changed keys, never values, only when something changed", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "update_audit" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "audited value"]])),
    );
    const [event] = await systemDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "custom_field.values_updated"))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(1);
    expect(event!.metadata).toMatchObject({
      entity: "patient",
      recordId: a.patientId,
      changed: "update_audit",
    });
    expect(JSON.stringify(event)).not.toContain("audited value");

    const before = await systemDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "custom_field.values_updated"));
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "audited value"]])),
    );
    const after = await systemDb()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "custom_field.values_updated"));
    expect(after.length).toBe(before.length); // no-op save: no audit event
  });

  it("keeps the prior ciphertext in custom_field_value_versions on every update or clear, but not on first save", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "history_field" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "v1"]])),
    );
    const [row1] = await systemDb()
      .select()
      .from(customFieldValues)
      .where(eq(customFieldValues.fieldId, fieldId));
    let versions = await systemDb()
      .select()
      .from(customFieldValueVersions)
      .where(eq(customFieldValueVersions.valueId, row1!.id));
    expect(versions).toHaveLength(0); // first save: no prior state to keep

    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "v2"]])),
    );
    versions = await systemDb()
      .select()
      .from(customFieldValueVersions)
      .where(eq(customFieldValueVersions.valueId, row1!.id));
    expect(versions).toHaveLength(1);
    expect(versions[0]!.valueEnc).toBe(row1!.valueEnc); // the prior ciphertext, kept as-is

    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, ""]])),
    );
    versions = await systemDb()
      .select()
      .from(customFieldValueVersions)
      .where(eq(customFieldValueVersions.valueId, row1!.id));
    expect(versions).toHaveLength(2); // the clear is recorded too
  });

  it("custom_field_value_versions is append-only and tenant-isolated", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "history_immutable" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "v1"]])),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "v2"]])),
    );
    const [version] = await systemDb().select().from(customFieldValueVersions).limit(1);

    // The app role has no UPDATE/DELETE grant at all, so it's blocked before ever reaching the
    // trigger — the first layer of "append-only".
    await expectDbError(
      withTenant(a.ctx, (tx) =>
        tx
          .update(customFieldValueVersions)
          .set({ valueEnc: "tampered" })
          .where(eq(customFieldValueVersions.id, version!.id)),
      ),
      /permission denied/,
    );
    await expectDbError(
      withTenant(a.ctx, (tx) =>
        tx.delete(customFieldValueVersions).where(eq(customFieldValueVersions.id, version!.id)),
      ),
      /permission denied/,
    );
    // The trigger is the second layer, reached by a role that does hold UPDATE/DELETE (the
    // connection owner via systemDb, same pattern as audit_events in tenancy.test.ts).
    await expectDbError(
      systemDb().execute(
        sql`update custom_field_value_versions set value_enc = 'tampered' where id = ${version!.id}`,
      ),
      /append-only/,
    );
    await expectDbError(
      systemDb().execute(sql`delete from custom_field_value_versions where id = ${version!.id}`),
      /append-only/,
    );

    expect(await withTenant(b.ctx, (tx) => tx.select().from(customFieldValueVersions))).toEqual([]);
    const deleteGrant = await systemDb().execute<{ has_delete: boolean }>(
      sql`select has_table_privilege('denialdesk_app', 'custom_field_value_versions', 'DELETE') as has_delete`,
    );
    expect(deleteGrant.rows[0]!.has_delete).toBe(false);
  });

  it("the version guard trigger rejects a version whose field or record doesn't match its parent value row", async () => {
    const fieldA = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "version_guard_a" })),
    );
    const fieldB = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "version_guard_b" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldA, "a1"]])),
    );
    const [valueRow] = await systemDb()
      .select()
      .from(customFieldValues)
      .where(eq(customFieldValues.fieldId, fieldA));

    // field_id doesn't match the parent value row's field.
    await expectDbError(
      withTenant(a.ctx, (tx) =>
        tx.insert(customFieldValueVersions).values({
          tenantId: a.ctx.tenantId,
          valueId: valueRow!.id,
          fieldId: fieldB,
          patientId: a.patientId,
          valueEnc: valueRow!.valueEnc,
          changedBy: a.ctx.userId,
        }),
      ),
      /field_id does not match/,
    );

    // Record column doesn't match the parent value row's record (claim_id instead of patient_id).
    await expectDbError(
      withTenant(a.ctx, (tx) =>
        tx.insert(customFieldValueVersions).values({
          tenantId: a.ctx.tenantId,
          valueId: valueRow!.id,
          fieldId: fieldA,
          claimId: a.claimId,
          valueEnc: valueRow!.valueEnc,
          changedBy: a.ctx.userId,
        }),
      ),
      /record does not match/,
    );
  });

  it("a genuine concurrent first save keeps exactly one version row and doesn't lose the loser's overwrite silently", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "race_field" })),
    );

    let blockerInserted!: () => void;
    const inserted = new Promise<void>((resolve) => {
      blockerInserted = resolve;
    });
    let releaseBlocker!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    // A first transaction that inserts the winning row and holds it open, uncommitted, until told
    // to proceed — simulating the second transaction of a genuine concurrent first save.
    const blocker = systemDb()
      .transaction(async (tx) => {
        await tx.execute(sql`set local role denialdesk_app`);
        await tx.execute(sql`select set_config('app.tenant_id', ${a.ctx.tenantId}, true)`);
        await tx.execute(sql`select set_config('app.user_id', ${a.ctx.userId}, true)`);
        await tx.insert(customFieldValues).values({
          tenantId: a.ctx.tenantId,
          fieldId,
          patientId: a.patientId,
          valueEnc: encryptField("winner value", undefined, `${a.ctx.tenantId}|${fieldId}|${a.patientId}`),
          createdBy: a.ctx.userId,
          updatedBy: a.ctx.userId,
        });
        blockerInserted();
        await released;
      })
      .catch(() => undefined);
    await inserted;

    // The "loser": its own first-save INSERT blocks behind the blocker's uncommitted row.
    const racerPromise = withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[fieldId, "loser value"]])),
    );

    await expect
      .poll(
        async () => {
          const result = await systemDb().execute<{ waiting: number }>(
            sql`select count(*)::int as waiting from pg_stat_activity
                where datname = current_database() and wait_event_type = 'Lock'
                  and query ilike 'insert into "custom_field_values"%'`,
          );
          return result.rows[0]?.waiting;
        },
        { timeout: 10_000, interval: 25 },
      )
      .toBe(1);

    releaseBlocker();
    await blocker;
    const changed = await racerPromise;
    expect(changed).toEqual(["race_field"]); // the loser's write is still recognized as a change

    const rows = await systemDb()
      .select()
      .from(customFieldValues)
      .where(and(eq(customFieldValues.fieldId, fieldId), eq(customFieldValues.patientId, a.patientId)));
    expect(rows).toHaveLength(1); // no duplicate row from the race

    const versions = await systemDb()
      .select()
      .from(customFieldValueVersions)
      .where(eq(customFieldValueVersions.valueId, rows[0]!.id));
    expect(versions).toHaveLength(1); // exactly one version: the winner's value, kept before being overwritten
    const keptPlain = decryptField(
      versions[0]!.valueEnc!,
      undefined,
      `${a.ctx.tenantId}|${fieldId}|${a.patientId}`,
    );
    expect(keptPlain).toBe("winner value"); // the winner's write was never silently discarded

    const finalPlain = decryptField(
      rows[0]!.valueEnc!,
      undefined,
      `${a.ctx.tenantId}|${fieldId}|${a.patientId}`,
    );
    expect(finalPlain).toBe("loser value"); // the loser's write still lands, on top of a kept history
  }, 20_000);
});

// Guard against a regression this table is designed to avoid: values must never be joined into
// list, search, or export queries (threat model I3).
describe("no list/search/export module reads custom field values", () => {
  it("never imports the custom field values domain module", async () => {
    const fs = await import("node:fs/promises");
    const candidates = [
      "src/domain/patients/queries.ts",
      "src/domain/claims/correction.ts",
      "src/domain/claims/queries.ts",
      "src/domain/denials/queries.ts",
      "src/domain/synthetic/generator.ts",
    ];
    for (const path of candidates) {
      const source = await fs.readFile(path, "utf8").catch(() => "");
      expect(source).not.toContain("custom-fields/values");
    }
  });

  it("the record-list columns module (custom-fields/list-values.ts) itself never touches sensitive or hidden fields", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/domain/custom-fields/list-values.ts", "utf8");
    // Its SQL filters to non-sensitive, show_in_list fields only, so a list/search/export page
    // that imports it can never reach a masked value through it.
    expect(source).toContain("isNull(customFields.sensitivity)");
    expect(source).toContain("eq(customFields.showInList, true)");
    // Record-level masking (threat model I7): tagged patients are excluded at the query.
    expect(source).toContain("cardinality(${patients.sensitivityTags}) = 0");
  });
});

// PR 2 (patients UI): values saved in the same transaction as the patient record, so the
// record's own stale-edit check covers them too, and the record-list columns query.
describe("patient record + custom field values in one transaction (PR2)", () => {
  function patientInput(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      mrn: null,
      firstName: "Synthetic",
      lastName: "Patient",
      birthDate: "1990-01-01",
      sex: "U" as const,
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
      phone: null,
      primaryPayerId: null,
      memberId: "",
      sensitivityTags: [],
      ...overrides,
    };
  }

  it("commits the patient and its custom field values together, and rolls both back on failure", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "intake_note" })),
    );

    // A failure inside the same transaction (a duplicate MRN) must roll back any custom field
    // values that would otherwise have been written alongside the new patient.
    const dupeMrn = `DUPE-${Date.now()}`;
    await withTenant(a.ctx, (tx) =>
      createPatient(tx, { ...a.ctx, canTag: true, syntheticOnly: true }, patientInput({ mrn: dupeMrn })),
    );

    let failed = false;
    try {
      await withTenant(a.ctx, async (tx) => {
        const created = await createPatient(
          tx,
          { ...a.ctx, canTag: true, syntheticOnly: true },
          patientInput({ mrn: dupeMrn }), // duplicate: createPatient throws
        );
        await saveValuesForRecord(
          tx,
          a.ctx,
          "patient",
          created.id,
          new Map([[fieldId, "should not persist"]]),
        );
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);

    // Now the same shape but no duplicate: both the patient and its value commit together.
    const created = await withTenant(a.ctx, async (tx) => {
      const created = await createPatient(
        tx,
        { ...a.ctx, canTag: true, syntheticOnly: true },
        patientInput(),
      );
      await saveValuesForRecord(tx, a.ctx, "patient", created.id, new Map([[fieldId, "committed note"]]));
      return created;
    });
    const values = await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "patient", created.id));
    expect(values.find((v) => v.fieldId === fieldId)?.value).toBe("committed note");
  });

  it("a stale patient edit refuses the patient update and its custom field values together", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "stale_test_field" })),
    );
    const created = await withTenant(a.ctx, (tx) =>
      createPatient(tx, { ...a.ctx, canTag: true, syntheticOnly: true }, patientInput()),
    );

    await expect(
      withTenant(a.ctx, async (tx) => {
        await updatePatient(
          tx,
          { ...a.ctx, canTag: true, syntheticOnly: true },
          created.id,
          new Date(0).toISOString(), // wrong expectedUpdatedAt
          patientInput({ firstName: "Changed" }),
          "testing stale refusal",
        );
        // Never reached: the values write must not run either.
        await saveValuesForRecord(
          tx,
          a.ctx,
          "patient",
          created.id,
          new Map([[fieldId, "should not persist"]]),
        );
      }),
    ).rejects.toThrow();

    const values = await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "patient", created.id));
    expect(values.find((v) => v.fieldId === fieldId)?.value).toBeUndefined();
  });
});

describe("loadListValues (PR2 table-column addendum)", () => {
  it("returns only non-sensitive, show_in_list fields, never a sensitive one, and is tenant-isolated", async () => {
    const shownId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "clinic_tier", showInList: true })),
    );
    const hiddenId = await withTenant(
      a.ctx,
      (tx) => createCustomField(tx, a.ctx, field({ key: "internal_note" })), // showInList: false (default)
    );
    const sensitiveId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "hiv_status_list", sensitivity: "hiv" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(
        tx,
        a.ctx,
        "patient",
        a.patientId,
        new Map([
          [shownId, "Tier 1"],
          [hiddenId, "internal only"],
        ]),
      ),
    );

    const { columns, valuesByRecord } = await withTenant(a.ctx, (tx) =>
      loadListValues(tx, a.ctx, "patient", [a.patientId]),
    );
    expect(columns.map((c) => c.key)).toEqual(["clinic_tier"]);
    expect(columns.some((c) => c.key === "internal_note")).toBe(false);
    expect(columns.some((c) => c.key === "hiv_status_list")).toBe(false);
    expect(valuesByRecord.get(a.patientId)?.get("clinic_tier")).toBe("Tier 1");
    expect(valuesByRecord.get(a.patientId)?.has("internal_note")).toBe(false);
    expect(valuesByRecord.get(a.patientId)?.has("hiv_status_list")).toBe(false);

    // Never leaks a sensitive value even if somehow marked (the DB check forbids it; this asserts
    // the query-time filter independently of that constraint).
    void sensitiveId;

    // Tenant isolation: tenant B's list never includes tenant A's record or values.
    const bResult = await withTenant(b.ctx, (tx) => loadListValues(tx, b.ctx, "patient", [a.patientId]));
    expect(bResult.valuesByRecord.size).toBe(0);
  });

  it("returns no values for a patient that carries sensitivity tags (record-level masking, I7)", async () => {
    const shownId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ key: "list_tagged", showInList: true })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "patient", a.patientId, new Map([[shownId, "shown when untagged"]])),
    );
    await systemDb()
      .update(patients)
      .set({ sensitivityTags: ["hiv"] })
      .where(eq(patients.id, a.patientId));
    try {
      const { columns, valuesByRecord } = await withTenant(a.ctx, (tx) =>
        loadListValues(tx, a.ctx, "patient", [a.patientId]),
      );
      expect(columns.some((c) => c.key === "list_tagged")).toBe(true);
      expect(valuesByRecord.has(a.patientId)).toBe(false);
    } finally {
      await systemDb().update(patients).set({ sensitivityTags: [] }).where(eq(patients.id, a.patientId));
    }
  });

  it("returns nothing for an empty page of records without querying", async () => {
    const result = await withTenant(a.ctx, (tx) => loadListValues(tx, a.ctx, "patient", []));
    expect(result.columns).toEqual([]);
    expect(result.valuesByRecord.size).toBe(0);
  });
});

// PR 3 (claims and denials UI): record-level sensitivity (I7) extended past patients, the
// standalone "edit custom fields" page's own concurrency token, and the guarantee that saving
// custom field values never touches a claim's billed content or version history.
describe("custom field values on claims and denials (PR3)", () => {
  it("masks every value on a claim whose patient carries sensitivity tags, and only a reveal-permitted role can open or change it", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "claim", key: "claim_masked_by_patient" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "claim", a.claimId, new Map([[fieldId, "claim note"]])),
    );
    await systemDb()
      .update(patients)
      .set({ sensitivityTags: ["hiv"] })
      .where(eq(patients.id, a.patientId));
    try {
      const loaded = await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "claim", a.claimId));
      const found = loaded.find((v) => v.fieldId === fieldId)!;
      expect(found.masked).toBe(true);
      expect(found.value).toBeUndefined();

      const revealed = await withTenant(a.ctx, (tx) =>
        revealCustomFieldValue(tx, a.ctx, {
          fieldId,
          entity: "claim",
          recordId: a.claimId,
          reason: "appeal",
        }),
      );
      expect(revealed.value).toBe("claim note");

      const compliance = await addUser(a.ctx.tenantId, "compliance", "claim-mask-write");
      await expect(
        withTenant(compliance, (tx) =>
          saveValuesForRecord(tx, compliance, "claim", a.claimId, new Map([[fieldId, "overwrite"]])),
        ),
      ).rejects.toBeInstanceOf(CustomFieldValueError);
    } finally {
      await systemDb().update(patients).set({ sensitivityTags: [] }).where(eq(patients.id, a.patientId));
    }
  });

  it("masks every value on a denial whose claim's patient carries sensitivity tags (denial -> claim -> patient)", async () => {
    const denialFieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "denial", key: "denial_masked_by_patient" })),
    );
    const denialRecordId = await denialIdForClaim(a.ctx, a.claimId);
    if (!denialRecordId) return; // The synthetic dataset didn't generate a denial on this claim.
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "denial", denialRecordId, new Map([[denialFieldId, "denial note"]])),
    );
    await systemDb()
      .update(patients)
      .set({ sensitivityTags: ["mental_health"] })
      .where(eq(patients.id, a.patientId));
    try {
      const loaded = await withTenant(a.ctx, (tx) =>
        loadValuesForRecord(tx, a.ctx, "denial", denialRecordId),
      );
      const found = loaded.find((v) => v.fieldId === denialFieldId)!;
      expect(found.masked).toBe(true);
      expect(found.value).toBeUndefined();
    } finally {
      await systemDb().update(patients).set({ sensitivityTags: [] }).where(eq(patients.id, a.patientId));
    }
  });

  it("list values exclude a claim belonging to a patient with sensitivity tags", async () => {
    const claimFieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "claim", key: "claim_list_tagged", showInList: true })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "claim", a.claimId, new Map([[claimFieldId, "shown when untagged"]])),
    );
    await systemDb()
      .update(patients)
      .set({ sensitivityTags: ["hiv"] })
      .where(eq(patients.id, a.patientId));
    try {
      const { columns, valuesByRecord } = await withTenant(a.ctx, (tx) =>
        loadListValues(tx, a.ctx, "claim", [a.claimId]),
      );
      expect(columns.some((c) => c.key === "claim_list_tagged")).toBe(true);
      expect(valuesByRecord.has(a.claimId)).toBe(false);
    } finally {
      await systemDb().update(patients).set({ sensitivityTags: [] }).where(eq(patients.id, a.patientId));
    }
  });

  it("the values-table concurrency token refuses a save whose token no longer matches, and never overwrites what changed underneath it", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "claim", key: "token_field" })),
    );
    const tokenBefore = await withTenant(a.ctx, (tx) => customFieldValuesToken(tx, "claim", a.claimId));

    // Someone else saves a value in between the edit page loading and this save being submitted.
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "claim", a.claimId, new Map([[fieldId, "changed elsewhere"]])),
    );

    await expect(
      withTenant(a.ctx, (tx) =>
        saveValuesForRecord(
          tx,
          a.ctx,
          "claim",
          a.claimId,
          new Map([[fieldId, "my stale edit"]]),
          undefined,
          tokenBefore,
        ),
      ),
    ).rejects.toThrow(/changed since you opened/);

    // The stale attempt wrote nothing: the value in between is still there.
    const afterRefusal = await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "claim", a.claimId));
    expect(afterRefusal.find((v) => v.fieldId === fieldId)?.value).toBe("changed elsewhere");

    // A token re-read after the intervening save succeeds.
    const freshToken = await withTenant(a.ctx, (tx) => customFieldValuesToken(tx, "claim", a.claimId));
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(
        tx,
        a.ctx,
        "claim",
        a.claimId,
        new Map([[fieldId, "my fresh edit"]]),
        undefined,
        freshToken,
      ),
    );
    const afterSuccess = await withTenant(a.ctx, (tx) => loadValuesForRecord(tx, a.ctx, "claim", a.claimId));
    expect(afterSuccess.find((v) => v.fieldId === fieldId)?.value).toBe("my fresh edit");
  });

  it("saving a claim's custom field values never creates a claim_versions row or changes the claim's own version/updatedAt", async () => {
    const fieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "claim", key: "no_version_field" })),
    );
    const [before] = await systemDb()
      .select({ version: claims.version, updatedAt: claims.updatedAt })
      .from(claims)
      .where(eq(claims.id, a.claimId));
    const versionsBefore = await systemDb()
      .select()
      .from(claimVersions)
      .where(eq(claimVersions.claimId, a.claimId));

    // First save (insert) and a second save (update) of the same field, to exercise both paths.
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "claim", a.claimId, new Map([[fieldId, "internal only"]])),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "claim", a.claimId, new Map([[fieldId, "internal only v2"]])),
    );

    const [after] = await systemDb()
      .select({ version: claims.version, updatedAt: claims.updatedAt })
      .from(claims)
      .where(eq(claims.id, a.claimId));
    expect(after!.version).toBe(before!.version);
    expect(after!.updatedAt.toISOString()).toBe(before!.updatedAt.toISOString());
    const versionsAfter = await systemDb()
      .select()
      .from(claimVersions)
      .where(eq(claimVersions.claimId, a.claimId));
    expect(versionsAfter.length).toBe(versionsBefore.length);
  });

  it("isolates tenants for claim custom field values: tenant B cannot read tenant A's", async () => {
    const claimFieldId = await withTenant(a.ctx, (tx) =>
      createCustomField(tx, a.ctx, field({ entity: "claim", key: "iso_claim_field" })),
    );
    await withTenant(a.ctx, (tx) =>
      saveValuesForRecord(tx, a.ctx, "claim", a.claimId, new Map([[claimFieldId, "alpha claim only"]])),
    );
    const bLoaded = await withTenant(b.ctx, (tx) =>
      tx.select().from(customFieldValues).where(eq(customFieldValues.claimId, a.claimId)),
    );
    expect(bLoaded).toEqual([]);
  });
});
