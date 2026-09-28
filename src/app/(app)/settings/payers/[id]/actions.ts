"use server";

import { z } from "zod";
import { canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { revealCustomFieldValue } from "@/domain/custom-fields/values";
import { getT } from "@/i18n/server";

/**
 * Reveals one locked custom field value on a payer and records who looked and why (R-7.5.1). Same
 * minimum-necessary roles as revealing a patient's member ID or a claim/denial custom field
 * (`canWorkDenials`) — one role list for every "open a locked value" action (ADR 0007 addendum).
 */
export async function revealPayerCustomField(
  payerId: string,
  fieldId: string,
  reason: string,
): Promise<{ value?: string; error?: string }> {
  const auth = await requireAuth();
  const t = await getT("settings");
  const tc = await getT("customFields");
  if (!canWorkDenials(auth.role)) return { error: tc("error.cantView") };
  const parsed = z
    .object({
      payerId: z.uuid(),
      fieldId: z.uuid(),
      reason: z.enum(["appeal", "eligibility", "payer_call", "other"]),
    })
    .safeParse({ payerId, fieldId, reason });
  if (!parsed.success) return { error: tc("error.chooseReason") };
  const result = await withTenant(auth, (tx) =>
    revealCustomFieldValue(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      {
        fieldId: parsed.data.fieldId,
        entity: "payer",
        recordId: parsed.data.payerId,
        reason: parsed.data.reason,
      },
      t,
    ),
  );
  if (result.error) return { error: result.error };
  return { value: String(result.value) };
}
