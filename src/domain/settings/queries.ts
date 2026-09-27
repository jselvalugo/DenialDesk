import { and, asc, count, eq, max, sql } from "drizzle-orm";
import { customFields } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { en } from "@/i18n/messages/en";
import type { Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import {
  MAX_FIELDS_PER_ENTITY,
  type CustomFieldChanges,
  type CustomFieldEntity,
  type NewCustomField,
} from "./custom-fields";

// Custom field definitions (docs/specs/settings-and-custom-fields.md). Every change is audited with
// IDs and enum values only; labels are configuration, not PHI, but are still kept out of the log.

type SettingsT = Translator<Messages["settings"]>;
/** English translator used when a caller doesn't have the request's language (e.g. integration tests). */
const englishSettingsT: SettingsT = createTranslator(en.settings, "en");

export class CustomFieldError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "CustomFieldError";
  }
}

interface Actor {
  tenantId: string;
  userId: string;
}

export type CustomFieldRow = typeof customFields.$inferSelect;

/** Every field of the practice (active and inactive), grouped order: record type, then position. */
export async function listCustomFields(tx: TenantTx): Promise<CustomFieldRow[]> {
  return tx
    .select()
    .from(customFields)
    .orderBy(asc(customFields.entity), asc(customFields.position), asc(customFields.createdAt));
}

/** Active fields for one record type, in display order: what record forms will render. */
export async function activeCustomFields(tx: TenantTx, entity: CustomFieldEntity): Promise<CustomFieldRow[]> {
  return tx
    .select()
    .from(customFields)
    .where(and(eq(customFields.entity, entity), eq(customFields.active, true)))
    .orderBy(asc(customFields.position), asc(customFields.createdAt));
}

/** Serializes changes per practice and record type, so the limit and positions hold under concurrency. */
async function lockEntity(tx: TenantTx, actor: Actor, entity: CustomFieldEntity) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`custom_fields:${actor.tenantId}:${entity}`}))`,
  );
}

/** The limit counts active fields only: deactivating a field frees its slot. */
async function assertRoomFor(tx: TenantTx, entity: CustomFieldEntity, t: SettingsT = englishSettingsT) {
  const [{ active } = { active: 0 }] = await tx
    .select({ active: count() })
    .from(customFields)
    .where(and(eq(customFields.entity, entity), eq(customFields.active, true)));
  if (active >= MAX_FIELDS_PER_ENTITY) {
    throw new CustomFieldError(t("error.tooManyFields", { max: MAX_FIELDS_PER_ENTITY }));
  }
}

export async function createCustomField(
  tx: TenantTx,
  actor: Actor,
  input: NewCustomField,
  t: SettingsT = englishSettingsT,
): Promise<string> {
  await lockEntity(tx, actor, input.entity);
  await assertRoomFor(tx, input.entity, t);
  const [existing] = await tx
    .select({ last: max(customFields.position) })
    .from(customFields)
    .where(eq(customFields.entity, input.entity));
  const [taken] = await tx
    .select({ id: customFields.id })
    .from(customFields)
    .where(and(eq(customFields.entity, input.entity), eq(customFields.key, input.key)))
    .limit(1);
  if (taken) throw new CustomFieldError(t("error.duplicateKey"), "key");

  const [row] = await tx
    .insert(customFields)
    .values({
      tenantId: actor.tenantId,
      entity: input.entity,
      key: input.key,
      label: input.label,
      fieldType: input.fieldType,
      options: input.options,
      required: input.required,
      helpText: input.helpText,
      sensitivity: input.sensitivity,
      position: (existing?.last ?? -1) + 1,
      createdBy: actor.userId,
    })
    .returning({ id: customFields.id });
  await audit(tx, {
    action: "settings.custom_field_created",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "custom_field",
    entityId: row!.id,
    metadata: {
      entity: input.entity,
      fieldType: input.fieldType,
      required: input.required,
      sensitivity: input.sensitivity,
    },
  });
  return row!.id;
}

async function lockField(
  tx: TenantTx,
  fieldId: string,
  expectedUpdatedAt: string,
  t: SettingsT = englishSettingsT,
) {
  const [current] = await tx
    .select()
    .from(customFields)
    .where(eq(customFields.id, fieldId))
    .for("update")
    .limit(1);
  if (!current) throw new CustomFieldError(t("error.fieldNotFound"));
  if (current.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new CustomFieldError(t("error.staleField"));
  }
  return current;
}

/** Changes a field's label, help, choices, or required flag. Returns the names of changed settings. */
export async function updateCustomField(
  tx: TenantTx,
  actor: Actor,
  fieldId: string,
  expectedUpdatedAt: string,
  changes: CustomFieldChanges,
  t: SettingsT = englishSettingsT,
): Promise<string[]> {
  const current = await lockField(tx, fieldId, expectedUpdatedAt, t);
  const changed: string[] = [];
  if (current.label !== changes.label) changed.push("label");
  if ((current.helpText ?? null) !== changes.helpText) changed.push("helpText");
  if (current.required !== changes.required) changed.push("required");
  if (current.options.join("\n") !== changes.options.join("\n")) changed.push("options");
  if ((current.sensitivity ?? null) !== changes.sensitivity) changed.push("sensitivity");
  if (changed.length === 0) return [];
  await tx
    .update(customFields)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(customFields.id, fieldId));
  await audit(tx, {
    action: "settings.custom_field_updated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "custom_field",
    entityId: fieldId,
    metadata: {
      entity: current.entity,
      changed: changed.join(","),
      // Lowering or removing a sensitivity category is recorded with both values (enum keys only).
      ...(changed.includes("sensitivity")
        ? { sensitivityFrom: current.sensitivity, sensitivityTo: changes.sensitivity }
        : {}),
    },
  });
  return changed;
}

/** Deactivates (hides from forms, keeps history) or reactivates a field. */
export async function setCustomFieldActive(
  tx: TenantTx,
  actor: Actor,
  fieldId: string,
  expectedUpdatedAt: string,
  active: boolean,
  t: SettingsT = englishSettingsT,
): Promise<void> {
  const current = await lockField(tx, fieldId, expectedUpdatedAt, t);
  if (current.active === active) return;
  if (active) {
    await lockEntity(tx, actor, current.entity);
    await assertRoomFor(tx, current.entity, t);
  }
  await tx.update(customFields).set({ active, updatedAt: new Date() }).where(eq(customFields.id, fieldId));
  await audit(tx, {
    action: active ? "settings.custom_field_reactivated" : "settings.custom_field_deactivated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "custom_field",
    entityId: fieldId,
    metadata: { entity: current.entity },
  });
}
