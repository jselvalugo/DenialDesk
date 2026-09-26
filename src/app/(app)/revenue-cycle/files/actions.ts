"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canRunRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { EngineConfigError } from "@/domain/revenue-cycle/engine";
import { importMonthlyFile } from "@/domain/revenue-cycle/imports";
import { MAX_FILE_BYTES, parseMonthlyFile, type FileProblem } from "@/domain/revenue-cycle/monthly-file";
import { isProduction } from "@/lib/env";

export interface UploadState {
  error?: string;
  problems?: FileProblem[];
}

const formSchema = z.object({
  periodYear: z.coerce.number().int().min(2000).max(2100),
  periodMonth: z.coerce.number().int().min(1).max(12),
  defaultSiteId: z.union([z.literal(""), z.uuid()]),
});

/**
 * Imports one monthly practice-management CSV: validated in memory (never written to disk),
 * classified, and stored in one transaction. Pre-production accepts synthetic files only.
 */
export async function uploadMonthlyFile(_: UploadState, formData: FormData): Promise<UploadState> {
  const auth = await requireAuth();
  if (!canRunRevenueCycle(auth.role))
    return { error: "Only administrators and RCM managers can import files." };

  const parsed = formSchema.safeParse({
    periodYear: formData.get("periodYear"),
    periodMonth: formData.get("periodMonth"),
    defaultSiteId: formData.get("defaultSiteId") ?? "",
  });
  if (!parsed.success) return { error: "Choose the month the file covers." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file to import." };
  if (!/\.csv$/i.test(file.name))
    return { error: "Upload the file as CSV (.csv). Excel files aren't supported yet." };
  if (file.size > MAX_FILE_BYTES)
    return { error: "The file is larger than 5 MB. Split it by site or month." };
  const syntheticOnly = !isProduction();
  if (syntheticOnly && formData.get("syntheticAttestation") !== "on") {
    return { error: "Confirm that the file contains synthetic data only." };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    return { error: "The file isn't UTF-8 text. Export it from your practice-management system as CSV." };
  }
  const result = parseMonthlyFile(text, { syntheticOnly });
  if (!result.ok)
    return {
      error: "The file wasn't imported. Fix these rows and upload it again.",
      problems: result.problems,
    };

  let fileId: string;
  try {
    fileId = await withTenant(auth, (tx) =>
      importMonthlyFile(tx, {
        tenantId: auth.tenantId,
        userId: auth.userId,
        filename: file.name.slice(0, 200),
        periodYear: parsed.data.periodYear,
        periodMonth: parsed.data.periodMonth,
        defaultSiteId: parsed.data.defaultSiteId || null,
        lines: result.lines,
      }),
    );
  } catch (error) {
    if (error instanceof EngineConfigError) return { error: error.message };
    if (error instanceof Error && error.message === "Unknown site") return { error: "Choose a valid site." };
    throw error;
  }
  redirect(`/revenue-cycle/files/${fileId}`);
}
