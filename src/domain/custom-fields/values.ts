import { and, eq } from "drizzle-orm";
import { customFields, customFieldValues } from "@/db/schema";
import type { CustomFieldRow } from "@/domain/settings/queries";
import type { TenantTx } from "@/db/tenant";
import { decryptField, encryptField } from "@/lib/crypto/field";
import { audit } from "@/lib/audit";
import { activeCustomFields } from "@/domain/settings/queries";
import type { CustomFieldEntity, CustomFieldType } from "@/domain/settings/custom-fields";

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

/** `tenant_id|field_id|record_id`: binds the ciphertext to where it lives (ADR 0007). A ciphertext
 * copied to another row, record, or tenant fails to decrypt (GCM authenticates the AAD). */
function aadFor(tenantId: string, fieldId: string, recordId: string): string {
  return `${tenantId}|${fieldId}|${recordId}`;
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
      const trimmed = typeof raw === "string" ? raw.trim() : raw;
      if (trimmed === "") {
        if (field.required && field.active) fail(`${field.label} is required.`);
        return null;
      }
      const num = typeof trimmed === "number" ? trimmed : Number(trimmed);
      if (!Number.isFinite(num)) fail(`${field.label} must be a number.`);
      // 15 significant digits: matches the double-precision round-trip the form displays.
      if (num.toPrecision(15).replace(/[-.]/g, "").replace(/0+$/, "").length > 15) {
        fail(`${field.label} has too many digits.`);
      }
      return String(num);
    }
    case "date": {
      const value = String(raw).trim();
      if (!value) {
        if (field.required && field.active) fail(`${field.label} is required.`);
        return null;
      }
      if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) {
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
 * Active fields for a record type, each with its value on this record (if any). Sensitive fields,
 * and any field on a record the caller marks `recordSensitive`, are masked: their ciphertext is
 * never decrypted. A ciphertext that fails to decrypt (tampering, or copied to another row) is
 * reported as `unavailable` and audited — never thrown, so the rest of the record still renders.
 */
export async function loadValuesForRecord(
  tx: TenantTx,
  actor: Actor,
  entity: CustomFieldEntity,
  recordId: string,
  options: { recordSensitive: boolean },
): Promise<LoadedCustomFieldValue[]> {
  const fields = await activeCustomFields(tx, entity);
  if (fields.length === 0) return [];
  const column = RECORD_COLUMN[entity];
  const rows = await tx
    .select({ fieldId: customFieldValues.fieldId, valueEnc: customFieldValues.valueEnc })
    .from(customFieldValues)
    .where(eq(column, recordId));
  const byField = new Map(rows.map((r) => [r.fieldId, r.valueEnc]));

  const results: LoadedCustomFieldValue[] = [];
  for (const field of fields) {
    const masked = Boolean(field.sensitivity) || options.recordSensitive;
    const valueEnc = byField.get(field.id);
    const base = {
      fieldId: field.id,
      key: field.key,
      label: field.label,
      type: field.fieldType as CustomFieldType,
    };
    if (!valueEnc) {
      results.push({ ...base, masked });
      continue;
    }
    if (masked) {
      results.push({ ...base, masked });
      continue;
    }
    try {
      const decrypted = decryptField(valueEnc, undefined, aadFor(actor.tenantId, field.id, recordId));
      results.push({ ...base, masked, value: parseValue(field, decrypted) });
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
  return results;
}

/**
 * Upserts the values submitted for a record's active fields. Only changed values are written
 * (compared by decrypting the current row); a field absent from `inputs` (a masked sensitive value
 * the form never received back) is left unchanged. Meant to run inside the same transaction as the
 * record's own create/update, so the record's `expectedUpdatedAt` check covers these writes too.
 * Returns the keys of the fields that changed (never their values).
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
  const changed: string[] = [];

  for (const field of fields) {
    if (!inputs.has(field.id)) continue; // not submitted: masked value, left unchanged.
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
      await tx
        .update(customFieldValues)
        .set({ valueEnc: nextEnc, updatedBy: actor.userId, updatedAt: new Date() })
        .where(eq(customFieldValues.id, current.id));
    } else {
      await tx.insert(customFieldValues).values({
        tenantId: actor.tenantId,
        fieldId: field.id,
        [entityColumnKey(entity)]: recordId,
        valueEnc: nextEnc,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      });
    }
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

/** Decrypts one sensitive value for a single view and records who looked and why (R-7.5.1). */
export async function revealCustomFieldValue(
  tx: TenantTx,
  actor: Actor,
  input: { fieldId: string; entity: CustomFieldEntity; recordId: string; reason: RevealReason },
): Promise<{ value?: CustomFieldTypedValue; error?: string }> {
  const column = RECORD_COLUMN[input.entity];
  const [field] = await tx.select().from(customFields).where(eq(customFields.id, input.fieldId)).limit(1);
  if (!field) return { error: "Field not found." };
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
