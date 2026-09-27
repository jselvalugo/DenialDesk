"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canCorrectClaims } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import {
  correctionIssueMessage,
  correctionSchema,
  dollarsToCents,
  splitCodes,
} from "@/domain/claims/correction";
import { ClaimCorrectionError, correctClaim } from "@/domain/claims/versions";
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
