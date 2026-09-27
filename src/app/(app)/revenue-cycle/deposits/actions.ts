"use server";

import { redirect } from "next/navigation";
import { canRunRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { DEPOSIT_MAX_BYTES, parseDepositFile } from "@/domain/revenue-cycle/aging";
import { decodeUpload } from "@/domain/revenue-cycle/monthly-file";
import { revalidatePath } from "next/cache";
import { DepositError, importDeposits, reverseDepositsFor } from "@/domain/revenue-cycle/receivables";
import { getT } from "@/i18n/server";
import { auditSystem } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";

export interface DepositUploadState {
  error?: string;
  problems?: Array<{ row: number; message: string }>;
}

/**
 * Imports a bank deposit CSV: only Date and Amount are read; other columns are ignored and never
 * stored. Pre-production (and anything on Netlify) accepts marked synthetic files only, with an
 * attestation. Every refusal is audited with a reason and counts.
 */
export async function uploadDeposits(_: DepositUploadState, formData: FormData): Promise<DepositUploadState> {
  const auth = await requireAuth();
  const t = await getT("revenue");
  const rejected = (reason: string, problems = 0) =>
    auditSystem({
      action: "rcm.deposits_rejected",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { reason, problems },
    });
  if (!canRunRevenueCycle(auth.role)) {
    await rejected("forbidden");
    return { error: t("deposits.error.onlyManagers") };
  }
  const syntheticOnly = syntheticDataOnly();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0 || !/\.csv$/i.test(file.name)) {
    await rejected("upload_check");
    return { error: t("deposits.error.chooseCsv") };
  }
  if (syntheticOnly && formData.get("syntheticAttestation") !== "on") {
    await rejected("upload_check");
    return { error: t("import.error.confirmSynthetic") };
  }
  if (file.size > DEPOSIT_MAX_BYTES) {
    await rejected("too_large");
    return { error: t("deposits.error.tooLarge") };
  }
  const text = decodeUpload(await file.arrayBuffer());
  if (text === null) {
    await rejected("encoding");
    return { error: t("deposits.error.notUtf8") };
  }
  const parsed = parseDepositFile(text, { syntheticOnly }, t);
  if (!parsed.ok) {
    await rejected("validation", parsed.problems.length);
    return {
      error: t("import.error.notImported"),
      problems: parsed.problems,
    };
  }
  try {
    await withTenant(auth, (tx) => importDeposits(tx, auth, parsed.deposits, t));
  } catch (error) {
    if (!(error instanceof DepositError)) throw error;
    await rejected("refused");
    return { error: error.message };
  }
  redirect("/revenue-cycle/ar-aging");
}

/** Reverses an imported deposit file (administrators, with a reason). */
export async function reverseDeposits(
  _: DepositUploadState,
  formData: FormData,
): Promise<DepositUploadState> {
  const auth = await requireAuth();
  const t = await getT("revenue");
  const result = await reverseDepositsFor(
    auth,
    formData.get("fileId"),
    String(formData.get("reason") ?? ""),
    t,
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/revenue-cycle/deposits");
  return {};
}
