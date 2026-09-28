"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { activeCustomFields } from "@/domain/settings/queries";
import { parseCustomFieldInputs } from "@/domain/custom-fields/form-inputs";
import { CustomFieldValueError, saveValuesForRecord } from "@/domain/custom-fields/values";
import { getT } from "@/i18n/server";
import type { CustomFieldsSaveState } from "@/components/custom-fields/CustomFieldsEditForm";

/**
 * Saves a denial's custom field values (docs/specs/settings-and-custom-fields.md S2 PR3). Custom
 * fields are practice-internal and never change the denial itself, so this only writes
 * `custom_field_values`; its own stale-edit check is the values-table concurrency token
 * (`expectedValuesToken`), not the denial's `updatedAt`. Roles: same as working denials
 * (`canWorkDenials`, R-5.1.2).
 */
export async function saveDenialCustomFields(
  _: CustomFieldsSaveState,
  formData: FormData,
): Promise<CustomFieldsSaveState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  const td = await getT("denials");
  if (!canWorkDenials(auth.role)) return { error: td("error.notAllowedChange") };

  const ids = z.object({ denialId: z.uuid(), expectedValuesToken: z.string().max(200) }).safeParse({
    denialId: formData.get("denialId"),
    expectedValuesToken: formData.get("expectedValuesToken"),
  });
  if (!ids.success) return { error: td("error.fieldsReload") };

  try {
    await withTenant(auth, async (tx) => {
      const fields = await activeCustomFields(tx, "denial");
      const inputs = parseCustomFieldInputs(fields, formData);
      await saveValuesForRecord(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
        "denial",
        ids.data.denialId,
        inputs,
        t,
        ids.data.expectedValuesToken,
      );
    });
  } catch (error) {
    if (error instanceof CustomFieldValueError) {
      return { error: error.message, field: error.key ? `cf.${error.key}` : undefined };
    }
    throw error;
  }
  revalidatePath(`/denials/${ids.data.denialId}`);
  redirect(`/denials/${ids.data.denialId}`);
}
