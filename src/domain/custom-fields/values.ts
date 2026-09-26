import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { customFields, customFieldValues, customFieldValueVersions, patients } from "@/db/schema";
import type { CustomFieldRow } from "@/domain/settings/queries";
import type { TenantTx } from "@/db/tenant";
import { decryptField, encryptField } from "@/lib/crypto/field";
import { audit } from "@/lib/audit";
import { activeCustomFields } from "@/domain/settings/queries";
import type { CustomFieldEntity, CustomFieldType } from "@/domain/settings/custom-fields";
import { canWorkDenials } from "@/auth/permissions";
import type { Role } from "@/auth/session";

// Values stored on patient, claim, denial, and payer records (docs/specs/settings-and-custom-fields.md
// S2; ADR 0007; threat model docs/threat-models/custom-field-values.md). Every value is encrypted
// at rest, of every type: no plaintext column exists. Masking at read time follows the field's
// sensitivity category, decided here and only here — never by the caller.

export class CustomFieldValueError extends Error {
  constructor(
    message: string,
    readonly key?: string,
  ) {
    super(message);
    this.name = "CustomFieldValueError";
  }
}

interface Actor {
  tenantId: string;
  userId: string;
  role: Role;
}

export type RevealReason = "appeal" | "eligibility" | "payer_call" | "other";

const MAX_TEXT = 200;
const MAX_LONG_TEXT = 4000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The single record column set for a value of this entity. */
const RECORD_COLUMN = {
  patient: customFieldValues.patientId,
  claim: customFieldValues.claimId,
  denial: customFieldValues.denialId,
  payer: customFieldValues.payerId,
} as const;

/**
 * Conflict target for the upsert in `saveValuesForRecord`: the partial unique index for this
 * entity (`drizzle/0025`), so two concurrent saves of a value that doesn't exist yet can't both
 * try to INSERT and race each other into a unique-violation — the second becomes an UPDATE.
 */
const CONFLICT_TARGET: Record<CustomFieldEntity, { target: AnyPgColumn[]; where: SQL }> = {
  patient: {
    target: [customFieldValues.tenantId, customFieldValues.fieldId, customFieldValues.patientId],
    where: sql`${customFieldValues.patientId} is not null`,
  },
  claim: {
    target: [customFieldValues.tenantId, customFieldValues.fieldId, customFieldValues.claimId],
    where: sql`${customFieldValues.claimId} is not null`,
  },
  denial: {
    target: [customFieldValues.tenantId, customFieldValues.fieldId, customFieldValues.denialId],
    where: sql`${customFieldValues.denialId} is not null`,
  },
  payer: {
    target: [customFieldValues.tenantId, customFieldValues.fieldId, customFieldValues.payerId],
    where: sql`${customFieldValues.payerId} is not null`,
  },
};

/** `tenant_id|field_id|record_id`: binds the ciphertext to where it lives (ADR 0007). A ciphertext
 * copied to another row, record, or tenant fails to decrypt (GCM authenticates the AAD). */
function aadFor(tenantId: string, fieldId: string, recordId: string): string {
  return `${tenantId}|${fieldId}|${recordId}`;
}

/**
 * `YYYY-MM-DD` already matched `ISO_DATE`; this rejects the dates that pattern still lets through
 * because the month or day is out of range for that month or year (2026-02-29, 2026-04-31). A
 * round trip through `Date.UTC` (never local time, so this is stable regardless of server TZ)
 * normalizes an invalid day into the next month; comparing the parts back catches that.
 */
function isRealCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Validates a raw form value against a field's type and returns its canonical stored string, or
 * `null` when the value should be cleared (blank, non-required). Throws `CustomFieldValueError`
 * with the field's key on any other invalid input.
 */
export function serializeValue(field: CustomFieldRow, raw: unknown): string | null {
  const fail = (message: string): never => {
    throw new CustomFieldValueError(message, field.key);
  };

  if (raw === null || raw === undefined) {
    if (field.required && field.active) fail(`${field.label} is required.`);
    return null;
  }

  switch (field.fieldType as CustomFieldType) {
    case "text":
    case "long_text": {
      const value = String(raw).trim();
      if (!value) {
        if (field.required && field.active) fail(`${field.label} is required.`);
        return null;
      }
      const max = field.fieldType === "text" ? MAX_TEXT : MAX_LONG_TEXT;
      if (value.length > max) fail(`${field.label} must be ${max} characters or fewer.`);
      return value;
    }
    case "number": {
      if (typeof raw !== "string" && typeof raw !== "number") fail(`${field.label} must be a number.`);
      const trimmed = typeof raw === "string" ? raw.trim() : raw;
      if (trimmed === "") {
        if (field.required && field.active) fail(`${field.label} is required.`);
        return null;
      }
      const num = typeof trimmed === "number" ? trimmed : Number(trimmed);
      if (!Number.isFinite(num)) fail(`${field.label} must be a number.`);
      const magnitude = Math.abs(num);
      // Outside this range `toString()` switches to exponential notation ("1e+21"), which the
      // plain digit count below can't read; treat it the same as too many digits.
      if (magnitude !== 0 && (magnitude >= 1e21 || magnitude < 1e-6)) {
        fail(`${field.label} has too many digits.`);
      }
      // 15 significant digits: matches the double-precision round-trip the form displays. Counts
      // the digit characters of the shortest round-tripping representation, leading zeros dropped.
      const digits = num
        .toString()
        .replace(/[^0-9]/g, "")
        .replace(/^0+(?=\d)/, "");
      if (digits.length > 15) fail(`${field.label} has too many digits.`);
      return String(num);
    }
    case "date": {
      const value = (typeof raw === "string" ? raw : fail(`${field.label} must be a valid date.`)).trim();
      if (!value) {
        if (field.required && field.active) fail(`${field.label} is required.`);
        return null;
      }
      if (!ISO_DATE.test(value) || !isRealCalendarDate(value)) {
        fail(`${field.label} must be a valid date.`);
      }
      return value;
    }
    case "checkbox": {
      const value = typeof raw === "boolean" ? raw : raw === "true" || raw === "on";
      return value ? "true" : "false";
    }
    case "select": {
      const value = String(raw).trim();
      if (!value) {
        if (field.required && field.active) fail(`${field.label} is required.`);
        return null;
      }
      if (!field.options.includes(value)) fail(`Choose a current option for ${field.label}.`);
      return value;
    }
    default:
      return fail(`Unknown field type for ${field.label}.`);
  }
}

export type CustomFieldTypedValue = string | number | boolean;

/** The inverse of `serializeValue`: the canonical stored string back to its typed value. */
export function parseValue(field: CustomFieldRow, stored: string): CustomFieldTypedValue {
  switch (field.fieldType as CustomFieldType) {
    case "number":
      return Number(stored);
    case "checkbox":
      return stored === "true";
    default:
      return stored;
  }
}

export interface LoadedCustomFieldValue {
  fieldId: string;
  key: string;
  label: string;
  type: CustomFieldType;
  masked: boolean;
  value?: CustomFieldTypedValue;
  unavailable?: boolean;
}

/**
 * Whether the record itself carries record-level sensitivity (patient sensitivity tags, R-3.5.1):
 * every value on such a record is masked, even one on a field that isn't itself sensitive (threat
 * model I7). Only patients carry these tags today; other entities are never record-sensitive.
 * Looked up here, inside the module, rather than trusted from the caller.
 */
async function recordIsSensitive(
  tx: TenantTx,
  entity: CustomFieldEntity,
  recordId: string,
): Promise<boolean> {
  if (entity !== "patient") return false;
  const [row] = await tx
    .select({ sensitivityTags: patients.sensitivityTags })
    .from(patients)
    .where(eq(patients.id, recordId))
    .limit(1);
  return Boolean(row?.sensitivityTags.length);
}

/**
 * Active fields for a record type, each with its value on this record (if any). Sensitive fields,
 * and every field on a record that itself carries sensitivity tags, are masked: their ciphertext
 * is never decrypted. A ciphertext that fails to decrypt (tampering, or copied to another row) is
 * reported as `unavailable` and audited — never thrown, so the rest of the record still renders.
 * Decrypting any unmasked value is itself a PHI read and is audited once per call (R-7.5.1).
 */
export async function loadValuesForRecord(
  tx: TenantTx,
  actor: Actor,
  entity: CustomFieldEntity,
  recordId: string,
): Promise<LoadedCustomFieldValue[]> {
  const fields = await activeCustomFields(tx, entity);
  if (fields.length === 0) return [];
  const column = RECORD_COLUMN[entity];
  const [rows, recordSensitive] = await Promise.all([
    tx
      .select({ fieldId: customFieldValues.fieldId, valueEnc: customFieldValues.valueEnc })
      .from(customFieldValues)
      .where(eq(column, recordId)),
    recordIsSensitive(tx, entity, recordId),
  ]);
  const byField = new Map(rows.map((r) => [r.fieldId, r.valueEnc]));

  const results: LoadedCustomFieldValue[] = [];
  const decryptedFieldIds: string[] = [];
  for (const field of fields) {
    const masked = Boolean(field.sensitivity) || recordSensitive;
    const valueEnc = byField.get(field.id);
    const base = {
      fieldId: field.id,
      key: field.key,
      label: field.label,
      type: field.fieldType as CustomFieldType,
    };
    if (!valueEnc || masked) {
      results.push({ ...base, masked });
      continue;
    }
    try {
      const decrypted = decryptField(valueEnc, undefined, aadFor(actor.tenantId, field.id, recordId));
      results.push({ ...base, masked, value: parseValue(field, decrypted) });
      decryptedFieldIds.push(field.id);
    } catch {
      await audit(tx, {
        action: "custom_field.value_integrity_failed",
        actorUserId: actor.userId,
        tenantId: actor.tenantId,
        entityType: "custom_field_value",
        entityId: field.id,
        metadata: { entity, recordId },
      });
      results.push({ ...base, masked, unavailable: true });
    }
  }
  if (decryptedFieldIds.length > 0) {
    await audit(tx, {
      action: "custom_field.values_read",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "custom_field_value",
      metadata: { entity, recordId, fieldIds: decryptedFieldIds.join(",") },
    });
  }
  return results;
}

/**
 * Upserts the values submitted for a record's active fields. Only changed values are written
 * (compared by decrypting the current row); a field absent from `inputs` (a masked sensitive value
 * the form never received back) is left unchanged. Writing a field that is masked (sensitive, or
 * on a record with sensitivity tags) is refused unless the actor may reveal member IDs (the same
 * minimum-necessary roles, R-5.1.2) — masking a value is meaningless if anyone can silently
 * overwrite it. The prior ciphertext of any changed or cleared value is kept in
 * `custom_field_value_versions` (owner decision 2026-09-26). Meant to run inside the same
 * transaction as the record's own create/update, so the record's `expectedUpdatedAt` check covers
 * these writes too. Returns the keys of the fields that changed (never their values).
 */
export async function saveValuesForRecord(
  tx: TenantTx,
  actor: Actor,
  entity: CustomFieldEntity,
  recordId: string,
  inputs: Map<string, unknown>,
): Promise<string[]> {
  const fields = await activeCustomFields(tx, entity);
  const column = RECORD_COLUMN[entity];
  const recordSensitive = await recordIsSensitive(tx, entity, recordId);
  const changed: string[] = [];

  for (const field of fields) {
    if (!inputs.has(field.id)) continue; // not submitted: masked value, left unchanged.
    const masked = Boolean(field.sensitivity) || recordSensitive;
    if (masked && !canWorkDenials(actor.role)) {
      throw new CustomFieldValueError(`Your role can't change ${field.label}.`, field.key);
    }
    const serialized = serializeValue(field, inputs.get(field.id));

    const [current] = await tx
      .select({ id: customFieldValues.id, valueEnc: customFieldValues.valueEnc })
      .from(customFieldValues)
      .where(and(eq(customFieldValues.fieldId, field.id), eq(column, recordId)))
      .for("update")
      .limit(1);

    const currentPlain = current?.valueEnc
      ? safeDecrypt(current.valueEnc, aadFor(actor.tenantId, field.id, recordId))
      : null;
    if (currentPlain === serialized) continue; // unchanged (including two nulls).

    changed.push(field.key);
    const nextEnc =
      serialized === null
        ? null
        : encryptField(serialized, undefined, aadFor(actor.tenantId, field.id, recordId));

    if (current) {
      // A prior state existed (an update or a clear): keep it, append-only, before overwriting.
      await tx.insert(customFieldValueVersions).values({
        tenantId: actor.tenantId,
        valueId: current.id,
        fieldId: field.id,
        [entityColumnKey(entity)]: recordId,
        valueEnc: current.valueEnc,
        changedBy: actor.userId,
      });
      await tx
        .update(customFieldValues)
        .set({ valueEnc: nextEnc, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(customFieldValues.id, current.id));
    } else {
      // No existing row: upsert (rather than a plain INSERT) so two concurrent first saves of the
      // same field/record can't both race an INSERT into the partial unique index.
      const { target, where } = CONFLICT_TARGET[entity];
      await tx
        .insert(customFieldValues)
        .values({
          tenantId: actor.tenantId,
          fieldId: field.id,
          [entityColumnKey(entity)]: recordId,
          valueEnc: nextEnc,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target,
          targetWhere: where,
          set: { valueEnc: nextEnc, updatedBy: actor.userId, updatedAt: new Date() },
        });
    }
  }
  if (changed.length > 0) {
    await audit(tx, {
      action: "custom_field.values_updated",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "custom_field_value",
      metadata: { entity, recordId, changed: changed.join(",") },
    });
  }
  return changed;
}

function safeDecrypt(valueEnc: string, aad: string): string | null {
  try {
    return decryptField(valueEnc, undefined, aad);
  } catch {
    return null; // treated as "changed" so a bad ciphertext gets overwritten by a fresh save.
  }
}

function entityColumnKey(entity: CustomFieldEntity): "patientId" | "claimId" | "denialId" | "payerId" {
  return `${entity}Id` as "patientId" | "claimId" | "denialId" | "payerId";
}

/**
 * Decrypts one sensitive value for a single view and records who looked and why (R-7.5.1).
 * Minimum necessary (R-5.1.2): limited to the same roles that may reveal a patient's full member
 * ID (`canWorkDenials`, matching `revealPatientMemberIdFor` / `revealMemberId`). Refused, with no
 * decrypt attempted at all, unless the field belongs to the given entity, is active, and is
 * actually masked (sensitive itself, or on a record with sensitivity tags) — there is nothing to
 * "open" on an ordinary value.
 */
export async function revealCustomFieldValue(
  tx: TenantTx,
  actor: Actor,
  input: { fieldId: string; entity: CustomFieldEntity; recordId: string; reason: RevealReason },
): Promise<{ value?: CustomFieldTypedValue; error?: string }> {
  if (!canWorkDenials(actor.role)) return { error: "Your role can't reveal custom field values." };

  const [field] = await tx.select().from(customFields).where(eq(customFields.id, input.fieldId)).limit(1);
  if (!field || field.entity !== input.entity || !field.active) return { error: "Field not found." };

  const recordSensitive = await recordIsSensitive(tx, input.entity, input.recordId);
  if (!field.sensitivity && !recordSensitive) return { error: "This value isn't locked." };

  const column = RECORD_COLUMN[input.entity];
  const [row] = await tx
    .select({ valueEnc: customFieldValues.valueEnc })
    .from(customFieldValues)
    .where(and(eq(customFieldValues.fieldId, input.fieldId), eq(column, input.recordId)))
    .limit(1);
  if (!row?.valueEnc) return { error: "No value on file." };

  await audit(tx, {
    action: "custom_field.value_revealed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "custom_field_value",
    entityId: input.fieldId,
    reason: input.reason,
    metadata: { entity: input.entity, recordId: input.recordId },
  });

  try {
    const decrypted = decryptField(
      row.valueEnc,
      undefined,
      aadFor(actor.tenantId, input.fieldId, input.recordId),
    );
    return { value: parseValue(field, decrypted) };
  } catch {
    await audit(tx, {
      action: "custom_field.value_integrity_failed",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "custom_field_value",
      entityId: input.fieldId,
      metadata: { entity: input.entity, recordId: input.recordId },
    });
    return { error: "Value unavailable." };
  }
}
