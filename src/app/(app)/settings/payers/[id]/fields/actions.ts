"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canEditPayerFields } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { activeCustomFields } from "@/domain/settings/queries";
import { parseCustomFieldInputs } from "@/domain/custom-fields/form-inputs";
import { CustomFieldValueError, saveValuesForRecord } from "@/domain/custom-fields/values";
import { getT } from "@/i18n/server";
import type { CustomFieldsSaveState } from "@/components/custom-fields/CustomFieldsEditForm";

/**
 * Saves a payer's custom field values (docs/specs/settings-and-custom-fields.md S2 PR4). Payers
 * are practice configuration, not a record with its own version history, so this only ever writes
 * `custom_field_values` — its stale-edit check is the values-table concurrency token
 * (`expectedValuesToken`), the same pattern PR3 used for claims and denials. Roles: administrators
 * and managers only (`canEditPayerFields`) — an owner-confirmable choice (spec S2 PR4).
 */
export async function savePayerCustomFields(
  _: CustomFieldsSaveState,
  formData: FormData,
): Promise<CustomFieldsSaveState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canEditPayerFields(auth.role)) return { error: t("error.notPayerEditor") };

  const ids = z.object({ payerId: z.uuid(), expectedValuesToken: z.string().max(200) }).safeParse({
    payerId: formData.get("payerId"),
    expectedValuesToken: formData.get("expectedValuesToken"),
  });
  if (!ids.success) return { error: t("error.reload") };

  try {
    await withTenant(auth, async (tx) => {
      const fields = await activeCustomFields(tx, "payer");
      const inputs = parseCustomFieldInputs(fields, formData);
      await saveValuesForRecord(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
        "payer",
        ids.data.payerId,
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
  revalidatePath(`/settings/payers/${ids.data.payerId}`);
  redirect(`/settings/payers/${ids.data.payerId}`);
}
