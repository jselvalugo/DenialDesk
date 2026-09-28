"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { claims, denialNotes, denials, memberships, patients } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { denialStatusEnum } from "@/db/schema";
import { nextAppealSubmittedOn } from "@/domain/denial-status";
import { getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { decryptField } from "@/lib/crypto/field";

export interface ActionState {
  error?: string;
  ok?: boolean;
}

const denialId = z.uuid();

async function authorize() {
  const auth = await requireAuth();
  return { auth, allowed: canWorkDenials(auth.role) };
}

export async function changeStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  const t = await getT("denials");
  if (!allowed) return { error: t("error.notAllowedChange") };
  const parsed = z
    .object({ denialId, status: z.enum(denialStatusEnum.enumValues) })
    .safeParse({ denialId: formData.get("denialId"), status: formData.get("status") });
  if (!parsed.success) return { error: t("error.invalidStatus") };

  const result = await withTenant(auth, async (tx) => {
    // Lock the row so concurrent edits record the correct "from" status in the audit trail.
    const [current] = await tx
      .select({ status: denials.status, appealSubmittedOn: denials.appealSubmittedOn })
      .from(denials)
      .where(eq(denials.id, parsed.data.denialId))
      .for("update");
    if (!current) return { error: t("error.notFound") };
    if (current.status === parsed.data.status) return { ok: true };
    const stamped = nextAppealSubmittedOn(parsed.data.status, current.appealSubmittedOn, todayIn());
    await tx
      .update(denials)
      .set({
        status: parsed.data.status,
        appealSubmittedOn: stamped,
        updatedAt: new Date(),
      })
      .where(eq(denials.id, parsed.data.denialId));
    await audit(tx, {
      action: "denial.status_changed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "denial",
      entityId: parsed.data.denialId,
      metadata: {
        from: current.status,
        to: parsed.data.status,
        // Keep the previous appeal-filed date when a re-stamp overwrites it (R-7.5.1, R-3.10.3).
        ...(current.appealSubmittedOn !== null && stamped !== current.appealSubmittedOn
          ? { previousAppealSubmittedOn: current.appealSubmittedOn }
          : {}),
      },
    });
    return { ok: true };
  });
  revalidatePath(`/denials/${parsed.data.denialId}`);
  return result;
}

export async function assignDenial(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  const t = await getT("denials");
  if (!allowed) return { error: t("error.notAllowedChange") };
  const parsed = z
    .object({ denialId, assigneeId: z.union([z.uuid(), z.literal("")]) })
    .safeParse({ denialId: formData.get("denialId"), assigneeId: formData.get("assigneeId") });
  if (!parsed.success) return { error: t("error.invalidAssignee") };
  const assigneeId = parsed.data.assigneeId || null;

  const result = await withTenant(auth, async (tx) => {
    // Foreign keys don't check tenant, so confirm the assignee belongs to this practice.
    if (assigneeId) {
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.tenantId, auth.tenantId), eq(memberships.userId, assigneeId)));
      if (!member) return { error: t("error.assigneeNotOnTeam") };
    }
    const updated = await tx
      .update(denials)
      .set({ assigneeId, updatedAt: new Date() })
      .where(eq(denials.id, parsed.data.denialId))
      .returning({ id: denials.id });
    if (updated.length === 0) return { error: t("error.notFound") };
    await audit(tx, {
      action: "denial.assigned",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "denial",
      entityId: parsed.data.denialId,
      metadata: { assigneeId },
    });
    return { ok: true };
  });
  revalidatePath(`/denials/${parsed.data.denialId}`);
  return result;
}

export async function addNote(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  const t = await getT("denials");
  if (!allowed) return { error: t("error.notAllowedChange") };
  const parsed = z
    .object({ denialId, body: z.string().trim().min(1).max(4000) })
    .safeParse({ denialId: formData.get("denialId"), body: formData.get("body") });
  if (!parsed.success) return { error: t("error.invalidNote") };

  const result = await withTenant(auth, async (tx) => {
    const [exists] = await tx
      .select({ id: denials.id })
      .from(denials)
      .where(eq(denials.id, parsed.data.denialId));
    if (!exists) return { error: t("error.notFound") };
    const [note] = await tx
      .insert(denialNotes)
      .values({
        tenantId: auth.tenantId,
        denialId: parsed.data.denialId,
        authorId: auth.userId,
        body: parsed.data.body,
      })
      .returning({ id: denialNotes.id });
    await audit(tx, {
      action: "denial.note_added",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "denial",
      entityId: parsed.data.denialId,
      metadata: { noteId: note!.id },
    });
    return { ok: true };
  });
  revalidatePath(`/denials/${parsed.data.denialId}`);
  return result;
}

/** Returns the full member ID for a denial's patient, and records who looked (R-7.5.1). */
export async function revealMemberId(
  denial: string,
  reason: string,
): Promise<{ value?: string; error?: string }> {
  // Minimum necessary (R-5.1.2): only people who work denials need the full member ID.
  const { auth, allowed } = await authorize();
  const t = await getT("denials");
  if (!allowed) return { error: t("error.notAllowedChange") };
  const parsed = z
    .object({ denial: denialId, reason: z.enum(["appeal", "eligibility", "payer_call", "other"]) })
    .safeParse({ denial, reason });
  if (!parsed.success) return { error: t("error.invalidRevealReason") };
  return withTenant(auth, async (tx) => {
    const [row] = await tx
      .select({ patientId: patients.id, memberIdEnc: patients.memberIdEnc })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .where(eq(denials.id, parsed.data.denial));
    if (!row || !row.memberIdEnc) return { error: t("error.revealNotFound") };
    await audit(tx, {
      action: "patient.member_id_revealed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "patient",
      entityId: row.patientId,
      reason: parsed.data.reason,
      metadata: { denialId: parsed.data.denial },
    });
    return { value: decryptField(row.memberIdEnc) };
  });
}
