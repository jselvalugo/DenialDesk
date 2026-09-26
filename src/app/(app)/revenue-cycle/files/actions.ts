"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { canRunRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { EngineConfigError } from "@/domain/revenue-cycle/engine";
import { importMonthlyFile } from "@/domain/revenue-cycle/imports";
import {
  checkUpload,
  decodeUpload,
  parseMonthlyFile,
  type FileProblem,
} from "@/domain/revenue-cycle/monthly-file";
import { auditSystem } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";

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
 * classified, and stored in one transaction. Pre-production (and anything on Netlify) accepts
 * synthetic files only. Rejections are audited with counts only.
 */
export async function uploadMonthlyFile(_: UploadState, formData: FormData): Promise<UploadState> {
  const auth = await requireAuth();
  if (!canRunRevenueCycle(auth.role))
    return { error: "Only administrators and RCM managers can import files." };
  const rejected = async (reason: string, problems = 0) => {
    await auditSystem({
      action: "rcm.file_rejected",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { reason, problems },
    });
  };

  const parsed = formSchema.safeParse({
    periodYear: formData.get("periodYear"),
    periodMonth: formData.get("periodMonth"),
    defaultSiteId: formData.get("defaultSiteId") ?? "",
  });
  if (!parsed.success) return { error: "Choose the month the file covers." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a CSV file to import." };
  const syntheticOnly = syntheticDataOnly();
  const check = checkUpload({
    name: file.name,
    size: file.size,
    attestedSynthetic: formData.get("syntheticAttestation") === "on",
    syntheticOnly,
  });
  if (!check.ok) {
    await rejected("upload_check");
    return { error: check.error };
  }
  const text = decodeUpload(await file.arrayBuffer());
  if (text === null) {
    await rejected("encoding");
    return { error: "The file isn't UTF-8 text. Export it from your practice-management system as CSV." };
  }
  const result = parseMonthlyFile(text, { syntheticOnly });
  if (!result.ok) {
    await rejected("validation", result.problems.length);
    return {
      error: "The file wasn't imported. Fix these rows and upload it again.",
      problems: result.problems,
    };
  }

  let fileId: string;
  try {
    fileId = await withTenant(auth, (tx) =>
      importMonthlyFile(tx, {
        tenantId: auth.tenantId,
        userId: auth.userId,
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
