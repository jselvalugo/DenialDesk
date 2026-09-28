"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canCorrectClaims, canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import {
  correctionIssueMessage,
  correctionSchema,
  dollarsToCents,
  splitCodes,
} from "@/domain/claims/correction";
import { ClaimCorrectionError, correctClaim } from "@/domain/claims/versions";
import { revealCustomFieldValue } from "@/domain/custom-fields/values";
import { getT } from "@/i18n/server";

export interface CorrectionState {
  error?: string;
  savedVersion?: number;
}

const MAX_LINES = 50;

/** Reads the correction form; field names are `line-<n>-<field>` for each line number. */
function readForm(formData: FormData) {
  // Bounded before parsing: every field here is short (codes, amounts, a 500-character reason).
  const text = (name: string) => String(formData.get(name) ?? "").slice(0, 1_000);
  const lineNumbers = formData
    .getAll("lineNumber")
    .slice(0, MAX_LINES)
    .map((value) => Number(value));
  return {
    serviceDate: text("serviceDate"),
    diagnosisCodes: splitCodes(text("diagnosisCodes")),
    lines: lineNumbers.map((n) => ({
      lineNumber: n,
      procedureCode: text(`line-${n}-procedureCode`).trim().toUpperCase(),
      modifiers: splitCodes(text(`line-${n}-modifiers`)),
      units: Number(text(`line-${n}-units`)),
      chargeCents: dollarsToCents(text(`line-${n}-charge`)),
    })),
    reason: text("reason"),
  };
}

export async function submitCorrection(_: CorrectionState, formData: FormData): Promise<CorrectionState> {
  const auth = await requireAuth();
  const t = await getT("claims");
  if (!canCorrectClaims(auth.role)) return { error: t("action.error.forbiddenCorrect") };
  const ids = z
    .object({ claimId: z.uuid(), expectedVersion: z.coerce.number().int().min(1) })
    .safeParse({ claimId: formData.get("claimId"), expectedVersion: formData.get("expectedVersion") });
  if (!ids.success) return { error: t("action.error.reload") };
  const parsed = correctionSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const { message, line } = correctionIssueMessage(issue, t);
    return { error: line !== undefined ? t("correction.error.line", { number: line, message }) : message };
  }

  try {
    const result = await withTenant(auth, (tx) =>
      correctClaim(tx, {
        tenantId: auth.tenantId,
        userId: auth.userId,
        claimId: ids.data.claimId,
        expectedVersion: ids.data.expectedVersion,
        today: todayIn(),
        correction: parsed.data,
      }),
    );
    revalidatePath(`/claims/${ids.data.claimId}`);
    return { savedVersion: result.version };
  } catch (error) {
    if (error instanceof ClaimCorrectionError) return { error: t(error.key, error.params) };
    throw error;
  }
}

/** Reveals one custom field's value on a claim and records who looked and why (R-7.5.1). Same
 * minimum-necessary roles as revealing a patient's member ID (`canWorkDenials`). */
export async function revealClaimCustomField(
  claimId: string,
  fieldId: string,
  reason: string,
): Promise<{ value?: string; error?: string }> {
  const auth = await requireAuth();
  const t = await getT("settings");
  const tc = await getT("customFields");
  if (!canWorkDenials(auth.role)) return { error: tc("error.cantView") };
  const parsed = z
    .object({
      claimId: z.uuid(),
      fieldId: z.uuid(),
      reason: z.enum(["appeal", "eligibility", "payer_call", "other"]),
    })
    .safeParse({ claimId, fieldId, reason });
  if (!parsed.success) return { error: tc("error.chooseReason") };
  const result = await withTenant(auth, (tx) =>
    revealCustomFieldValue(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      {
        fieldId: parsed.data.fieldId,
        entity: "claim",
        recordId: parsed.data.claimId,
        reason: parsed.data.reason,
      },
      t,
    ),
  );
  if (result.error) return { error: result.error };
  return { value: String(result.value) };
}
