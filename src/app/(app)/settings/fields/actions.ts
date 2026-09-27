"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { isUniqueViolation } from "@/db/errors";
import { withTenant } from "@/db/tenant";
import {
  customFieldChangesSchema,
  keyFromLabel,
  newCustomFieldSchema,
  parseOptions,
} from "@/domain/settings/custom-fields";
import {
  CustomFieldError,
  setCustomFieldActive,
  updateCustomField,
  createCustomField,
} from "@/domain/settings/queries";
import { customFields } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getT } from "@/i18n/server";
import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";

export interface CustomFieldFormState {
  error?: string;
  field?: string;
}

type SettingsT = Translator<Messages["settings"]>;
const uuid = z.uuid();

function text(formData: FormData, name: string, max = 200) {
  return String(formData.get(name) ?? "").slice(0, max);
}

function common(formData: FormData) {
  return {
    label: text(formData, "label"),
    options: parseOptions(text(formData, "options", 4000)),
    required: formData.get("required") === "on",
    helpText: text(formData, "helpText", 400),
    sensitivity: text(formData, "sensitivity", 40),
  };
}

function failure(error: unknown, t: SettingsT): CustomFieldFormState {
  if (error instanceof CustomFieldError) return { error: error.message, field: error.field };
  if (isUniqueViolation(error)) return { error: t("error.duplicateKey"), field: "key" };
  throw error;
}

function issue(error: z.ZodError): CustomFieldFormState {
  const first = error.issues[0]!;
  return { error: first.message, field: String(first.path[0] ?? "") };
}

export async function addCustomField(
  _: CustomFieldFormState,
  formData: FormData,
): Promise<CustomFieldFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canConfigureSettings(auth.role)) return { error: t("error.notAdmin") };
  const label = text(formData, "label");
  const parsed = newCustomFieldSchema(t).safeParse({
    ...common(formData),
    entity: text(formData, "entity"),
    key: text(formData, "key", 60).trim() || keyFromLabel(label),
    fieldType: text(formData, "fieldType"),
  });
  if (!parsed.success) return issue(parsed.error);
  try {
    await withTenant(auth, (tx) => createCustomField(tx, auth, parsed.data, t));
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath("/settings/fields");
  redirect(`/settings/fields?records=${parsed.data.entity}`);
}

export async function saveCustomField(
  _: CustomFieldFormState,
  formData: FormData,
): Promise<CustomFieldFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canConfigureSettings(auth.role)) return { error: t("error.notAdmin") };
  const id = uuid.safeParse(text(formData, "id"));
  if (!id.success) return { error: t("error.fieldNotFound") };
  const expected = text(formData, "updatedAt", 40);
  let entity: string;
  try {
    entity = await withTenant(auth, async (tx) => {
      const [stored] = await tx
        .select({ fieldType: customFields.fieldType, entity: customFields.entity })
        .from(customFields)
        .where(eq(customFields.id, id.data))
        .limit(1);
      if (!stored) throw new CustomFieldError(t("error.fieldNotFound"));
      const parsed = customFieldChangesSchema(t).safeParse({
        ...common(formData),
        fieldType: stored.fieldType,
      });
      if (!parsed.success) {
        const state = issue(parsed.error);
        throw new CustomFieldError(state.error!, state.field);
      }
      await updateCustomField(tx, auth, id.data, expected, parsed.data, t);
      return stored.entity;
    });
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath("/settings/fields");
  redirect(`/settings/fields?records=${entity}`);
}

/** Deactivate or reactivate from the list; errors (stale row) come back to the list. */
export async function toggleCustomField(
  _: CustomFieldFormState,
  formData: FormData,
): Promise<CustomFieldFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canConfigureSettings(auth.role)) return { error: t("error.notAdmin") };
  const id = uuid.safeParse(text(formData, "id"));
  if (!id.success) return { error: t("error.fieldNotFound") };
  try {
    await withTenant(auth, (tx) =>
      setCustomFieldActive(
        tx,
        auth,
        id.data,
        text(formData, "updatedAt", 40),
        formData.get("active") === "true",
        t,
      ),
    );
  } catch (error) {
    return failure(error, t);
  }
  revalidatePath("/settings/fields");
  return {};
}
