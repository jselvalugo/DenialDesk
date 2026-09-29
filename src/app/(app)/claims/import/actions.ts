"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canImportCharges } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { isUniqueViolation, withTenant } from "@/db/tenant";
import {
  checkChargeUpload,
  MAX_IMPORT_BYTES,
  parseChargeFile,
  problemMessage,
  UPLOAD_CHECK_KEYS,
  type ChargeProblem,
} from "@/domain/claims/charge-file";
import { importChargeClaims, type ImportWarnings } from "@/domain/claims/charge-import";
import { decodeUpload } from "@/domain/revenue-cycle/monthly-file";
import { getT } from "@/i18n/server";
import { auditSystem } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";
import { hit } from "@/lib/rate-limit";

export interface ImportProblemRow {
  row: number;
  column: string;
  code: string;
  message: string;
}

export interface ImportState {
  error?: string;
  /** Up to the report limit; row numbers, header names, codes, and fixed sentences only. */
  problems?: ImportProblemRow[];
  /** All problems found, which can exceed `problems.length`. */
  totalProblems?: number;
  result?: { claims: number; lines: number; billedCents: number; warnings: ImportWarnings };
}

const formSchema = z.object({ providerId: z.uuid(), locationId: z.uuid() });

/** IDs and counts only: never a row value, a code, or the file's name (docs/specs/claims.md C2). */
type RejectReason =
  "forbidden" | "upload_check" | "encoding" | "validation" | "duplicate" | "conflict" | "error";

/**
 * Imports one charge CSV as draft claims (docs/specs/claims.md C2). The file is read in memory as
 * untrusted input, never written anywhere, and either every claim is created or none is. Refusals are
 * audited with a fixed reason and counts.
 */
export async function importCharges(_: ImportState, formData: FormData): Promise<ImportState> {
  const auth = await requireAuth();
  const t = await getT("claims");
  // Names this attempt in the audit log: the batch ID of a completed import, the entity ID of a refused one.
  const attemptId = randomUUID();
  const rejected = (reason: RejectReason, counts: { rows?: number; problems?: number } = {}) =>
    auditSystem({
      action: "claim.import_rejected",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "claim_import",
      entityId: attemptId,
      reason,
      metadata: { rows: counts.rows ?? 0, problems: counts.problems ?? 0 },
    });

  if (!canImportCharges(auth.role)) {
    await rejected("forbidden");
    return { error: t("import.error.forbidden") };
  }
  // Per practice, so one practice's imports can't crowd out another's and a stream of large files can't
  // hold the practice's import lock (docs/threat-models/charge-import.md).
  const limited = await hit("import_charges", `practice:${auth.tenantId}`);
  if (!limited.allowed) {
    await auditSystem({
      action: "security.rate_limited",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "claim_import",
      entityId: attemptId,
      reason: "import_charges",
      metadata: { bucket: "import_charges" },
    });
    return { error: t("import.error.rateLimited") };
  }
  const file = formData.get("file");
  const syntheticOnly = syntheticDataOnly();
  const check = checkChargeUpload({
    name: file instanceof File ? file.name : "",
    size: file instanceof File ? file.size : 0,
    attestedSynthetic: formData.get("syntheticAttestation") === "on",
    syntheticOnly,
  });
  if (!(file instanceof File) || check) {
    await rejected("upload_check");
    const key = UPLOAD_CHECK_KEYS[check ?? "chooseFile"];
    return { error: t(key, { size: MAX_IMPORT_BYTES / (1024 * 1024) }) };
  }
  const ids = formSchema.safeParse({
    providerId: formData.get("providerId"),
    locationId: formData.get("locationId"),
  });
  if (!ids.success) {
    await rejected("upload_check");
    return { error: t("import.error.defaults") };
  }
  const text = decodeUpload(await file.arrayBuffer());
  if (text === null) {
    await rejected("encoding");
    return { error: t("import.error.notUtf8") };
  }

  const today = todayIn();
  const parsed = parseChargeFile(text, { syntheticOnly, today });
  const refusal = (problems: ChargeProblem[], total: number): ImportState => ({
    error: t("import.error.notImported"),
    totalProblems: total,
    problems: problems.map((p) => ({
      row: p.row,
      column: p.column ?? "",
      code: p.code,
      message: problemMessage(p, t),
    })),
  });
  if (!parsed.ok) {
    await rejected("validation", { rows: parsed.rowCount, problems: parsed.total });
    return refusal(parsed.problems, parsed.total);
  }

  let outcome;
  try {
    outcome = await withTenant(auth, (tx) =>
      importChargeClaims(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
        { rowCount: parsed.rowCount, claims: parsed.claims },
        ids.data,
        today,
        attemptId,
      ),
    );
  } catch (error) {
    // Another import or a seed created one of these claim numbers between the check and the insert.
    if (isUniqueViolation(error)) {
      await rejected("conflict", { rows: parsed.rowCount });
      return { error: t("import.error.conflict") };
    }
    // Anything else (a database failure) is not the user's file: audit the refusal with a fixed reason and
    // counts only, then let it surface. The transaction has rolled back, so no claim was created.
    await rejected("error", { rows: parsed.rowCount });
    throw error;
  }
  if (!outcome.ok) {
    if (outcome.reason === "forbidden") {
      await rejected("forbidden");
      return { error: t("import.error.forbidden") };
    }
    if (outcome.reason === "defaults") {
      await rejected("upload_check", { rows: parsed.rowCount });
      return { error: t("import.error.defaults") };
    }
    await rejected(outcome.reason, { rows: parsed.rowCount, problems: outcome.total });
    return refusal(outcome.problems, outcome.total);
  }
  revalidatePath("/claims");
  return {
    result: {
      claims: outcome.claims,
      lines: outcome.lines,
      billedCents: outcome.billedCents,
      warnings: outcome.warnings,
    },
  };
}
