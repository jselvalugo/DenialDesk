import { and, eq, inArray, isNull } from "drizzle-orm";
import { customFields, customFieldValues } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { decryptField } from "@/lib/crypto/field";
import type { CustomFieldEntity } from "@/domain/settings/custom-fields";
import { activeCustomFields } from "@/domain/settings/queries";
import { parseValue, type CustomFieldTypedValue } from "./values";

// Record-list columns (docs/specs/settings-and-custom-fields.md, S2 table-column addendum). This
// module is deliberately separate from `custom-fields/values.ts`: it filters to non-sensitive,
// `show_in_list` fields only, at the query itself (`sensitivity IS NULL AND show_in_list`), so a
// list/search/export page can import it without ever gaining a path to a masked value. A guard
// test (`test/integration/custom-field-values.test.ts`) asserts list/search/export modules never
// import `custom-fields/values` directly.

interface Actor {
  tenantId: string;
  userId: string;
}

export interface ListColumnDefinition {
  fieldId: string;
  key: string;
  label: string;
}

const RECORD_COLUMN = {
  patient: customFieldValues.patientId,
  claim: customFieldValues.claimId,
  denial: customFieldValues.denialId,
  payer: customFieldValues.payerId,
} as const;

/** `tenant_id|field_id|record_id` — must mirror `aadFor` in `custom-fields/values.ts`. */
function aadFor(tenantId: string, fieldId: string, recordId: string): string {
  return `${tenantId}|${fieldId}|${recordId}`;
}

/**
 * The non-sensitive, `show_in_list` fields for a record type, and their decrypted values for a
 * page of records — one query for the values, regardless of page size. Sensitive fields, and
 * fields with `show_in_list` off, never reach this function's SQL, let alone its result. Audits
 * `custom_field.values_read` once per call that decrypts at least one value (never per record).
 */
export async function loadListValues(
  tx: TenantTx,
  actor: Actor,
  entity: CustomFieldEntity,
  recordIds: string[],
): Promise<{
  columns: ListColumnDefinition[];
  valuesByRecord: Map<string, Map<string, CustomFieldTypedValue>>;
}> {
  const emptyResult = { columns: [], valuesByRecord: new Map<string, Map<string, CustomFieldTypedValue>>() };
  if (recordIds.length === 0) return emptyResult;

  const activeFields = await activeCustomFields(tx, entity);
  const listFields = activeFields.filter((f) => f.showInList && !f.sensitivity);
  if (listFields.length === 0) return emptyResult;

  const fieldIds = listFields.map((f) => f.id);
  const column = RECORD_COLUMN[entity];
  const rows = await tx
    .select({
      fieldId: customFieldValues.fieldId,
      recordId: column,
      valueEnc: customFieldValues.valueEnc,
    })
    .from(customFieldValues)
    .innerJoin(customFields, eq(customFields.id, customFieldValues.fieldId))
    .where(
      and(
        inArray(customFieldValues.fieldId, fieldIds),
        inArray(column, recordIds),
        isNull(customFields.sensitivity),
        eq(customFields.showInList, true),
      ),
    );

  const byField = new Map(listFields.map((f) => [f.id, f]));
  const valuesByRecord = new Map<string, Map<string, CustomFieldTypedValue>>();
  const decryptedFieldIds = new Set<string>();
  for (const row of rows) {
    if (!row.recordId || !row.valueEnc) continue;
    const field = byField.get(row.fieldId);
    if (!field) continue;
    try {
      const decrypted = decryptField(row.valueEnc, undefined, aadFor(actor.tenantId, field.id, row.recordId));
      const perRecord = valuesByRecord.get(row.recordId) ?? new Map();
      perRecord.set(field.key, parseValue(field, decrypted));
      valuesByRecord.set(row.recordId, perRecord);
      decryptedFieldIds.add(field.id);
    } catch {
      // A corrupted or misplaced ciphertext is simply left off the list rather than surfaced here;
      // `loadValuesForRecord` on the record's own page reports and audits the failure.
    }
  }
  if (decryptedFieldIds.size > 0) {
    await audit(tx, {
      action: "custom_field.values_read",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "custom_field_value",
      metadata: { entity, recordIds: recordIds.join(","), fieldIds: [...decryptedFieldIds].join(",") },
    });
  }
  return {
    columns: listFields.map((f) => ({ fieldId: f.id, key: f.key, label: f.label })),
    valuesByRecord,
  };
}
