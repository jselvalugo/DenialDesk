"use server";

import { z } from "zod";
import { canGenerateClaimFile } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { generateClaim837P, type PointerChoice } from "@/domain/claims/edi-837p";
import { issueMessage } from "@/domain/claims/edi-837p-messages";
import { getT } from "@/i18n/server";
import { auditSystem } from "@/lib/audit";
import { hit } from "@/lib/rate-limit";

export interface Claim837State {
  error?: string;
  /** One fixed sentence per refusal; none holds a name, ID, code, date, or amount. */
  issues?: string[];
  result?: {
    /** The whole file: holds the member ID and TIN. Built in the browser into a download; stored nowhere. */
    text: string;
    /** The same file with the member ID and TIN masked, for the screen. */
    preview: string;
    filename: string;
    controlNumber: number;
    segmentCount: number;
    lineCount: number;
    pastFilingDeadline: boolean;
  };
}

const MAX_LINES = 50;

/** `pointer-<line>` checkboxes, each valued with a diagnosis position (1 to 12); bounded before use. */
function readPointers(formData: FormData): PointerChoice {
  const choice: PointerChoice = {};
  for (let line = 1; line <= MAX_LINES; line++) {
    const values = formData
      .getAll(`pointer-${line}`)
      .slice(0, 12)
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
    if (values.length > 0) choice[line] = [...new Set(values)].sort((a, b) => a - b);
  }
  return choice;
}

/**
 * Generates the 837P for one claim (docs/specs/claims.md C3a). A POST, so nothing about the claim reaches a
 * URL, title, or log. The file is returned to the signed-in user in the response and never stored.
 */
export async function generateClaim837PAction(_: Claim837State, formData: FormData): Promise<Claim837State> {
  const auth = await requireAuth();
  const t = await getT("claims");
  const ids = z.object({ claimId: z.uuid() }).safeParse({ claimId: formData.get("claimId") });
  if (!ids.success) return { error: t("edi.error.reload") };
  if (!canGenerateClaimFile(auth.role)) {
    // The domain function audits the refusal (it re-checks the role); no work is done for this role.
    await withTenant(auth, (tx) =>
      generateClaim837P(
        tx,
        { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
        ids.data.claimId,
      ),
    );
    return { error: t("edi.error.forbidden") };
  }
  // Per practice: each press decrypts a member ID and a TIN, takes a control number, and audits.
  const limited = await hit("generate_837p", `practice:${auth.tenantId}`);
  if (!limited.allowed) {
    await auditSystem({
      action: "security.rate_limited",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "claim",
      entityId: ids.data.claimId,
      reason: "generate_837p",
      metadata: { bucket: "generate_837p" },
    });
    return { error: t("edi.error.rateLimited") };
  }

  const result = await withTenant(auth, (tx) =>
    generateClaim837P(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      ids.data.claimId,
      { pointers: readPointers(formData) },
    ),
  );
  if (!result.ok) {
    if (result.reason === "forbidden") return { error: t("edi.error.forbidden") };
    if (result.reason === "not_found") return { error: t("edi.error.notFound") };
    return { error: t("edi.error.notGenerated"), issues: result.issues.map((i) => issueMessage(i, t)) };
  }
  return {
    result: {
      text: result.text,
      preview: result.preview,
      filename: result.filename,
      controlNumber: result.controlNumber,
      segmentCount: result.segmentCount,
      lineCount: result.lineCount,
      pastFilingDeadline: result.pastFilingDeadline,
    },
  };
}
