import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  claims,
  customFields,
  customFieldValues,
  customFieldValueVersions,
  denials,
  patients,
  payers,
} from "@/db/schema";
import type { CustomFieldRow } from "@/domain/settings/queries";
import type { TenantTx } from "@/db/tenant";
import { decryptField, encryptField } from "@/lib/crypto/field";
import { audit } from "@/lib/audit";
import { en } from "@/i18n/messages/en";
import type { Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import { activeCustomFields } from "@/domain/settings/queries";
import type { CustomFieldEntity, CustomFieldType } from "@/domain/settings/custom-fields";
import { canEditPayerFields, canWorkDenials } from "@/auth/permissions";
import type { Role } from "@/auth/session";

type SettingsT = Translator<Messages["settings"]>;
/** English translator used when a caller doesn't have the request's language (e.g. integration tests). */
const englishSettingsT: SettingsT = createTranslator(en.settings, "en");

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

/** The record's own table, keyed by entity — used only to lock its row (`lockRecordRow`), never to
 * read or change its columns. */
const PARENT_TABLE = {
  patient: patients,
  claim: claims,
  denial: denials,
  payer: payers,
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
export function serializeValue(
  field: CustomFieldRow,
  raw: unknown,
  t: SettingsT = englishSettingsT,
): string | null {
  const fail = (message: string): never => {
    throw new CustomFieldValueError(message, field.key);
  };
  const required = () => fail(t("error.required", { field: field.label }));

  if (raw === null || raw === undefined) {
    if (field.required && field.active) required();
    return null;
  }

  switch (field.fieldType as CustomFieldType) {
    case "text":
    case "long_text": {
      const value = String(raw).trim();
      if (!value) {
        if (field.required && field.active) required();
        return null;
      }
      const max = field.fieldType === "text" ? MAX_TEXT : MAX_LONG_TEXT;
      if (value.length > max) fail(t("error.maxLength", { field: field.label, max }));
      return value;
    }
    case "number": {
      if (typeof raw !== "string" && typeof raw !== "number")
        fail(t("error.mustBeNumber", { field: field.label }));
      const trimmed = typeof raw === "string" ? raw.trim() : raw;
      if (trimmed === "") {
        if (field.required && field.active) required();
        return null;
      }
      const num = typeof trimmed === "number" ? trimmed : Number(trimmed);
      if (!Number.isFinite(num)) fail(t("error.mustBeNumber", { field: field.label }));
      const magnitude = Math.abs(num);
      // Outside this range `toString()` switches to exponential notation ("1e+21"), which the
      // plain digit count below can't read; treat it the same as too many digits.
      if (magnitude !== 0 && (magnitude >= 1e21 || magnitude < 1e-6)) {
        fail(t("error.tooManyDigits", { field: field.label }));
      }
      // 15 significant digits: matches the double-precision round-trip the form displays. Counts
      // the digit characters of the shortest round-tripping representation, leading zeros dropped.
      const digits = num
        .toString()
        .replace(/[^0-9]/g, "")
        .replace(/^0+(?=\d)/, "");
      if (digits.length > 15) fail(t("error.tooManyDigits", { field: field.label }));
      return String(num);
    }
    case "date": {
      const value = (
        typeof raw === "string" ? raw : fail(t("error.mustBeDate", { field: field.label }))
      ).trim();
      if (!value) {
        if (field.required && field.active) required();
        return null;
      }
      if (!ISO_DATE.test(value) || !isRealCalendarDate(value)) {
        fail(t("error.mustBeDate", { field: field.label }));
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
        if (field.required && field.active) required();
        return null;
      }
      if (!field.options.includes(value)) fail(t("error.chooseCurrentOption", { field: field.label }));
      return value;
    }
    default:
      return fail(t("error.unknownFieldType", { field: field.label }));
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
 * model I7). A claim or denial belongs to a patient (claim -> patient, denial -> claim -> patient),
 * so their values are masked too when that patient carries any tag; payers have no linked patient
 * and are never record-sensitive. Looked up here, inside the module, rather than trusted from the
 * caller.
 */
async function recordIsSensitive(
  tx: TenantTx,
  entity: CustomFieldEntity,
  recordId: string,
): Promise<boolean> {
  if (entity === "patient") {
    const [row] = await tx
      .select({ sensitivityTags: patients.sensitivityTags })
      .from(patients)
      .where(eq(patients.id, recordId))
      .limit(1);
    return Boolean(row?.sensitivityTags.length);
  }
  if (entity === "claim") {
    const [row] = await tx
      .select({ sensitivityTags: patients.sensitivityTags })
      .from(claims)
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .where(eq(claims.id, recordId))
      .limit(1);
    return Boolean(row?.sensitivityTags.length);
  }
  if (entity === "denial") {
    const [row] = await tx
      .select({ sensitivityTags: patients.sensitivityTags })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .where(eq(denials.id, recordId))
      .limit(1);
    return Boolean(row?.sensitivityTags.length);
  }
  return false; // payer: no linked patient.
}

/**
 * The patient a record belongs to (itself for `patient`, via claim/denial otherwise; `null` for
 * `payer`, which has none) — enriches the `custom_field.values_updated` audit event (threat model
 * R1) so a claim or denial save records whose chart it belongs to, the same as `claim.viewed` /
 * `denial.viewed` already do (IDs only, never values).
 */
async function patientIdFor(
  tx: TenantTx,
  entity: CustomFieldEntity,
  recordId: string,
): Promise<string | null> {
  if (entity === "patient") return recordId;
  if (entity === "claim") {
    const [row] = await tx
      .select({ patientId: claims.patientId })
      .from(claims)
      .where(eq(claims.id, recordId))
      .limit(1);
    return row?.patientId ?? null;
  }
  if (entity === "denial") {
    const [row] = await tx
      .select({ patientId: claims.patientId })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .where(eq(denials.id, recordId))
      .limit(1);
    return row?.patientId ?? null;
  }
  return null; // payer: no linked patient.
}

/**
 * A concurrency token for the standalone "edit custom fields" page (claims, denials): a count and
 * latest `updatedAt` over this record's `custom_field_values` rows. That page never updates the
 * claim/denial row itself (custom fields are practice-internal, never billed content — no
 * `claim_versions` row, no `claims`/`denials` column changes), so the record's own `updatedAt`
 * isn't available as a stale-edit check there the way it is for patients (whose form saves the
 * patient and its values in one transaction). Read on page load; re-derived (after `lockRecordRow`
 * has locked the parent record, see below) inside `saveValuesForRecord` when `expectedValuesToken`
 * is passed, so the compare and the write happen atomically in one transaction.
 */
function valuesToken(rows: { updatedAt: Date }[]): string {
  const latest = rows.reduce<Date | null>((max, r) => (!max || r.updatedAt > max ? r.updatedAt : max), null);
  return `${rows.length}:${latest ? latest.toISOString() : ""}`;
}

export async function customFieldValuesToken(
  tx: TenantTx,
  entity: CustomFieldEntity,
  recordId: string,
): Promise<string> {
  const column = RECORD_COLUMN[entity];
  const rows = await tx
    .select({ updatedAt: customFieldValues.updatedAt })
    .from(customFieldValues)
    .where(eq(column, recordId));
  return valuesToken(rows);
}

/**
 * Locks the record's own row (`patients`/`claims`/`denials`/`payers`) before `saveValuesForRecord`
 * reads or writes anything else (only the payer role check, which touches no data, runs first),
 * and confirms it exists in this tenant. This is what makes a concurrency
 * token computed over `custom_field_values` safe: without a lock on some row that both
 * transactions must touch, `SELECT ... FOR UPDATE` over a record with zero (or few) existing
 * `custom_field_values` rows locks nothing, so two concurrent "first saves" on the very same
 * record can both read an identical token (e.g. "0:") and both pass the check — the second
 * transaction's write (an insert racing `onConflictDoNothing`, or a plain update) then silently
 * overwrites or clears the first's value with no stale-edit refusal at all. Locking the parent row
 * first forces the second transaction to block here until the first commits or rolls back, so by
 * the time it reads and compares the token afterward, it is reading the first transaction's fully
 * committed effect. `FOR NO KEY UPDATE` is a `SELECT`, never an `UPDATE` statement, so it never
 * fires `claims_require_version` (BEFORE UPDATE) or any other row trigger. A record that doesn't
 * exist in this tenant (a bad id, or one belonging to another tenant and hidden by RLS) is refused
 * here with a translated error instead of surfacing later as a raw database trigger error from the
 * `custom_field_values_guard` trigger on the first write.
 */
async function lockRecordRow(
  tx: TenantTx,
  entity: CustomFieldEntity,
  recordId: string,
  t: SettingsT,
): Promise<void> {
  const table = PARENT_TABLE[entity];
  const [row] = await tx
    .select({ id: table.id })
    .from(table)
    .where(eq(table.id, recordId))
    .for("no key update");
  if (!row) throw new CustomFieldValueError(t("error.recordNotFound"));
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
 *
 * `expectedValuesToken`, when passed, is the record's own stale-edit check for a caller that has
 * no record-row `expectedUpdatedAt` of its own to reuse (the claim/denial "edit custom fields"
 * page, which never touches the claim/denial row): the record's row is locked first
 * (`lockRecordRow`, always — see there for why), then a read of this record's current
 * `custom_field_values` rows (now guaranteed to reflect any transaction that has already
 * committed) must match the token computed when the form was opened (`customFieldValuesToken`),
 * or the save is refused before any write, with the same reload message as a stale record edit.
 */
export async function saveValuesForRecord(
  tx: TenantTx,
  actor: Actor,
  entity: CustomFieldEntity,
  recordId: string,
  inputs: Map<string, unknown>,
  t: SettingsT = englishSettingsT,
  expectedValuesToken?: string,
): Promise<string[]> {
  // Defense in depth: the settings payer pages already gate on `canEditPayerFields` before this
  // is ever reached, but a payer's values are practice configuration rather than a record a
  // front-line biller corrects (spec review, S2 PR4), so the domain layer enforces the same,
  // narrower role here too, the way the standard field-level `canWorkDenials` mask check below
  // does for a sensitive value on any entity. Checked before `lockRecordRow`, so a refused role
  // never takes a lock on the payer row and gets the role error, not "Record not found", on a
  // bad id.
  if (entity === "payer" && !canEditPayerFields(actor.role)) {
    throw new CustomFieldValueError(t("error.notPayerEditor"));
  }
  await lockRecordRow(tx, entity, recordId, t);
  const fields = await activeCustomFields(tx, entity);
  const column = RECORD_COLUMN[entity];
  if (expectedValuesToken !== undefined) {
    const current = await customFieldValuesToken(tx, entity, recordId);
    if (current !== expectedValuesToken) {
      throw new CustomFieldValueError(t("error.staleValues"));
    }
  }
  const recordSensitive = await recordIsSensitive(tx, entity, recordId);
  const changed: string[] = [];

  for (const field of fields) {
    if (!inputs.has(field.id)) continue; // not submitted: masked value, left unchanged.
    const masked = Boolean(field.sensitivity) || recordSensitive;
    if (masked && !canWorkDenials(actor.role)) {
      throw new CustomFieldValueError(t("error.cantChangeField", { field: field.label }), field.key);
    }
    const serialized = serializeValue(field, inputs.get(field.id), t);

    const [current] = await tx
      .select({ id: customFieldValues.id, valueEnc: customFieldValues.valueEnc })
      .from(customFieldValues)
      .where(and(eq(customFieldValues.fieldId, field.id), eq(column, recordId)))
      .for("update")
      .limit(1);

    const currentPlain = current?.valueEnc
      ? await decryptOrAuditFailure(tx, actor, entity, recordId, field.id, current.valueEnc)
      : null;
    if (currentPlain === serialized) continue; // unchanged (including two nulls).

    changed.push(field.key);
    const nextEnc =
      serialized === null
        ? null
        : encryptField(serialized, undefined, aadFor(actor.tenantId, field.id, recordId));

    if (current) {
      await versionThenUpdate(tx, actor, entity, recordId, field.id, current, nextEnc);
    } else {
      // No existing row: try a plain INSERT first (so the common case never pays for a version
      // lookup it doesn't need), but guard the race where another transaction's first save of the
      // same field/record commits first. `onConflictDoNothing` on the entity's partial unique index
      // means the loser's INSERT is silently skipped rather than either failing or blindly
      // overwriting the winner's row without a version record; the loser then re-reads the row the
      // winner just created and goes through the same version-then-update path as any other update.
      const { target, where } = CONFLICT_TARGET[entity];
      const inserted = await tx
        .insert(customFieldValues)
        .values({
          tenantId: actor.tenantId,
          fieldId: field.id,
          [entityColumnKey(entity)]: recordId,
          valueEnc: nextEnc,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })
        .onConflictDoNothing({ target, where })
        .returning({ id: customFieldValues.id });
      if (inserted.length === 0) {
        const [raced] = await tx
          .select({ id: customFieldValues.id, valueEnc: customFieldValues.valueEnc })
          .from(customFieldValues)
          .where(and(eq(customFieldValues.fieldId, field.id), eq(column, recordId)))
          .for("update")
          .limit(1);
        // The winner's row must exist by now (it committed the conflicting row); re-derive whether
        // this actor's value actually differs from what the winner wrote, versioning it first.
        const racedPlain = raced?.valueEnc
          ? await decryptOrAuditFailure(tx, actor, entity, recordId, field.id, raced.valueEnc)
          : null;
        if (racedPlain === serialized) {
          changed.pop(); // the winner already wrote the same value: not a change after all.
          continue;
        }
        await versionThenUpdate(tx, actor, entity, recordId, field.id, raced!, nextEnc);
      }
    }
  }
  if (changed.length > 0) {
    const patientId = await patientIdFor(tx, entity, recordId);
    await audit(tx, {
      action: "custom_field.values_updated",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "custom_field_value",
      metadata: {
        entity,
        recordId,
        changed: changed.join(","),
        ...(patientId ? { patientId } : {}),
      },
    });
  }
  return changed;
}

/** Appends the row's current ciphertext to `custom_field_value_versions`, then overwrites it.
 * `updatedAt` is stamped from the database's own wall clock (`clock_timestamp()`), not the app's
 * `new Date()`: since `lockRecordRow` serializes concurrent saves of the same record through a
 * single row lock, using the one clock every save's `UPDATE` actually executes against (rather
 * than each app server's own clock, which can skew, or `now()`, which freezes at this
 * transaction's start rather than the moment it actually got to run after waiting on that lock)
 * keeps the values-table concurrency token's "latest `updatedAt`" comparison meaningful. */
async function versionThenUpdate(
  tx: TenantTx,
  actor: Actor,
  entity: CustomFieldEntity,
  recordId: string,
  fieldId: string,
  current: { id: string; valueEnc: string | null },
  nextEnc: string | null,
): Promise<void> {
  await tx.insert(customFieldValueVersions).values({
    tenantId: actor.tenantId,
    valueId: current.id,
    fieldId,
    [entityColumnKey(entity)]: recordId,
    valueEnc: current.valueEnc,
    changedBy: actor.userId,
  });
  await tx
    .update(customFieldValues)
    .set({ valueEnc: nextEnc, updatedBy: actor.userId, updatedAt: sql`clock_timestamp()` })
    .where(eq(customFieldValues.id, current.id));
}

/**
 * Decrypts the current row's ciphertext during a save, or `null` if it can't be (a bad ciphertext
 * is treated as "changed" so a fresh save overwrites it) — auditing the failure either way, since a
 * value that fails to decrypt during a write is the same integrity signal as one found on a read.
 */
async function decryptOrAuditFailure(
  tx: TenantTx,
  actor: Actor,
  entity: CustomFieldEntity,
  recordId: string,
  fieldId: string,
  valueEnc: string,
): Promise<string | null> {
  try {
    return decryptField(valueEnc, undefined, aadFor(actor.tenantId, fieldId, recordId));
  } catch {
    await audit(tx, {
      action: "custom_field.value_integrity_failed",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "custom_field_value",
      entityId: fieldId,
      metadata: { entity, recordId },
    });
    return null;
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
  t: SettingsT = englishSettingsT,
): Promise<{ value?: CustomFieldTypedValue; error?: string }> {
  if (!canWorkDenials(actor.role)) return { error: t("error.cantReveal") };

  const [field] = await tx.select().from(customFields).where(eq(customFields.id, input.fieldId)).limit(1);
  if (!field || field.entity !== input.entity || !field.active) return { error: t("error.fieldNotFound") };

  const recordSensitive = await recordIsSensitive(tx, input.entity, input.recordId);
  if (!field.sensitivity && !recordSensitive) return { error: t("error.notLocked") };

  const column = RECORD_COLUMN[input.entity];
  const [row] = await tx
    .select({ valueEnc: customFieldValues.valueEnc })
    .from(customFieldValues)
    .where(and(eq(customFieldValues.fieldId, input.fieldId), eq(column, input.recordId)))
    .limit(1);
  if (!row?.valueEnc) return { error: t("error.noValueOnFile") };

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
    return { error: t("error.valueUnavailable") };
  }
}
