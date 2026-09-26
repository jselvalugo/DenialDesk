"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canCorrectClaims } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { correctionSchema, dollarsToCents, splitCodes } from "@/domain/claims/correction";
import { ClaimCorrectionError, correctClaim } from "@/domain/claims/versions";

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
  if (!canCorrectClaims(auth.role)) return { error: "Your role can view claims but not correct them." };
  const ids = z
    .object({ claimId: z.uuid(), expectedVersion: z.coerce.number().int().min(1) })
    .safeParse({ claimId: formData.get("claimId"), expectedVersion: formData.get("expectedVersion") });
  if (!ids.success) return { error: "Reload the page and try again." };
  const parsed = correctionSchema.safeParse(readForm(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const line = issue.path[0] === "lines" ? `Line ${Number(issue.path[1]) + 1}: ` : "";
    return { error: `${line}${issue.message}` };
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
    if (error instanceof ClaimCorrectionError) return { error: error.message };
    throw error;
  }
}
