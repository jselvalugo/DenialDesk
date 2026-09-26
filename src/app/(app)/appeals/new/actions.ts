"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { canWorkAppeals } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { appeals, claims, denials, payers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { firstLevelDeadline } from "@/domain/appeals/deadline";
import { openAppealsForDenial } from "@/domain/appeals/queries";
import { ACTION_STATUSES } from "@/domain/denial-status";
import { audit } from "@/lib/audit";

export interface CreateAppealState {
  error?: string;
}

const NOT_ALLOWED = "Your role can view appeals but not start one.";

/** Starts a first-level appeal from a denial and redirects to it (spec: appeals.md A1). */
export async function createAppeal(_: CreateAppealState, formData: FormData): Promise<CreateAppealState> {
  const auth = await requireAuth();
  if (!canWorkAppeals(auth.role)) return { error: NOT_ALLOWED };
  const parsed = z.object({ denialId: z.uuid() }).safeParse({ denialId: formData.get("denialId") });
  if (!parsed.success) return { error: "Choose a denial to appeal." };

  const result = await withTenant(auth, async (tx) => {
    const [row] = await tx
      .select({ denial: denials, claim: claims, payer: payers })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(payers, eq(payers.id, claims.payerId))
      .where(eq(denials.id, parsed.data.denialId))
      .for("update");
    if (!row) return { error: "This denial no longer exists." };
    if (!ACTION_STATUSES.includes(row.denial.status)) {
      return { error: "This denial isn't awaiting action, so no new appeal can be started from it." };
    }
    const open = await openAppealsForDenial(tx, parsed.data.denialId);
    if (open.length > 0) return { error: "This denial already has an open appeal." };

    const deadline = firstLevelDeadline({
      regime: row.payer.regime,
      noticeDate: row.denial.noticeDate,
      payerAppealWindowDays: row.payer.appealWindowDays,
    });

    const [inserted] = await tx
      .insert(appeals)
      .values({
        tenantId: auth.tenantId,
        denialId: row.denial.id,
        claimId: row.claim.id,
        level: "first_level",
        status: "draft",
        deadline: deadline?.date ?? null,
        deadlineBasis: deadline?.basis ?? null,
        deadlineCitation: deadline?.citation ?? null,
        filedBy: auth.userId,
      })
      .returning({ id: appeals.id });
    await tx
      .update(denials)
      .set({ status: "appeal_drafted", updatedAt: new Date() })
      .where(eq(denials.id, row.denial.id));
    await audit(tx, {
      action: "appeal.created",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "appeal",
      entityId: inserted!.id,
      metadata: { denialId: row.denial.id, level: "first_level" },
    });
    return { id: inserted!.id };
  });

  if ("error" in result) return result;
  redirect(`/appeals/${result.id}`);
}
