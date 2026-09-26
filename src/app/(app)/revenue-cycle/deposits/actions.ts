"use server";

import { redirect } from "next/navigation";
import { canRunRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { DEPOSIT_MAX_BYTES, parseDepositFile } from "@/domain/revenue-cycle/aging";
import { decodeUpload } from "@/domain/revenue-cycle/monthly-file";
import { importDeposits } from "@/domain/revenue-cycle/receivables";
import { auditSystem } from "@/lib/audit";

export interface DepositUploadState {
  error?: string;
  problems?: Array<{ row: number; message: string }>;
}

/** Imports a bank deposit CSV (date and amount only; other columns are ignored, never stored). */
export async function uploadDeposits(_: DepositUploadState, formData: FormData): Promise<DepositUploadState> {
  const auth = await requireAuth();
  if (!canRunRevenueCycle(auth.role))
    return { error: "Only administrators and RCM managers can import deposits." };
  const rejected = (reason: string, problems = 0) =>
    auditSystem({
      action: "rcm.deposits_rejected",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { reason, problems },
    });
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to import." };
  if (!/\.csv$/i.test(file.name)) return { error: "Upload the bank export as CSV (.csv)." };
  if (file.size > DEPOSIT_MAX_BYTES) {
    await rejected("too_large");
    return { error: "The file is larger than 1 MB. Split it by month." };
  }
  const text = decodeUpload(await file.arrayBuffer());
  if (text === null) {
    await rejected("encoding");
    return { error: "The file isn't UTF-8 text. Export it from your bank as CSV." };
  }
  const parsed = parseDepositFile(text);
  if (!parsed.ok) {
    await rejected("validation", parsed.problems.length);
    return {
      error: "The file wasn't imported. Fix these rows and upload it again.",
      problems: parsed.problems,
    };
  }
  await withTenant(auth, (tx) => importDeposits(tx, auth, parsed.deposits));
  redirect("/revenue-cycle/ar-aging");
}
