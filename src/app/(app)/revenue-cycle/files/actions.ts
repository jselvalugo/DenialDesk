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
import { getT } from "@/i18n/server";
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
  const t = await getT("revenue");
  if (!canRunRevenueCycle(auth.role)) return { error: t("files.error.onlyManagers") };
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
  if (!parsed.success) return { error: t("files.error.chooseMonth") };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: t("import.error.chooseFile") };
  const syntheticOnly = syntheticDataOnly();
  const check = checkUpload(
    {
      name: file.name,
      size: file.size,
      attestedSynthetic: formData.get("syntheticAttestation") === "on",
      syntheticOnly,
    },
    t,
  );
  if (!check.ok) {
    await rejected("upload_check");
    return { error: check.error };
  }
  const text = decodeUpload(await file.arrayBuffer());
  if (text === null) {
    await rejected("encoding");
    return { error: t("files.error.notUtf8") };
  }
  const result = parseMonthlyFile(text, { syntheticOnly }, t);
  if (!result.ok) {
    await rejected("validation", result.problems.length);
    return {
      error: t("import.error.notImported"),
      problems: result.problems,
    };
  }

  let fileId: string;
  try {
    fileId = await withTenant(auth, (tx) =>
      importMonthlyFile(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          periodYear: parsed.data.periodYear,
          periodMonth: parsed.data.periodMonth,
          defaultSiteId: parsed.data.defaultSiteId || null,
          lines: result.lines,
        },
        t,
      ),
    );
  } catch (error) {
    if (error instanceof EngineConfigError) return { error: error.message };
    if (error instanceof Error && error.message === "Unknown site") {
      return { error: t("files.error.invalidSite") };
    }
    throw error;
  }
  redirect(`/revenue-cycle/files/${fileId}`);
}
