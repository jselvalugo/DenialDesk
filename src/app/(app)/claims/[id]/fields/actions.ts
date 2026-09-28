"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canCorrectClaims } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { activeCustomFields } from "@/domain/settings/queries";
import { parseCustomFieldInputs } from "@/domain/custom-fields/form-inputs";
import { CustomFieldValueError, saveValuesForRecord } from "@/domain/custom-fields/values";
import { getT } from "@/i18n/server";
import type { CustomFieldsSaveState } from "@/components/custom-fields/CustomFieldsEditForm";

/**
 * Saves a claim's custom field values (docs/specs/settings-and-custom-fields.md S2 PR3). Custom
 * fields are practice-internal, never billed content, so this never touches the `claims` row and
 * never creates a `claim_versions` row — its own stale-edit check is the values-table concurrency
 * token (`expectedValuesToken`), not the claim's `updatedAt`. Roles: same as claim correction
 * (`canCorrectClaims`).
 */
export async function saveClaimCustomFields(
  _: CustomFieldsSaveState,
  formData: FormData,
): Promise<CustomFieldsSaveState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  const tc = await getT("claims");
  if (!canCorrectClaims(auth.role)) return { error: tc("action.error.forbiddenCorrect") };

  const ids = z.object({ claimId: z.uuid(), expectedValuesToken: z.string().max(200) }).safeParse({
    claimId: formData.get("claimId"),
    expectedValuesToken: formData.get("expectedValuesToken"),
  });
  if (!ids.success) return { error: tc("action.error.reload") };

  try {
    await withTenant(auth, async (tx) => {
      const fields = await activeCustomFields(tx, "claim");
      const inputs = parseCustomFieldInputs(fields, formData);
      await saveValuesForRecord(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
        "claim",
        ids.data.claimId,
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
  revalidatePath(`/claims/${ids.data.claimId}`);
  redirect(`/claims/${ids.data.claimId}`);
}
