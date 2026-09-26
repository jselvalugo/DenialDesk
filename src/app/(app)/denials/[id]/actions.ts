"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { claims, denialNotes, denials, memberships, patients } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { denialStatusEnum } from "@/db/schema";
import { audit } from "@/lib/audit";
import { decryptField } from "@/lib/crypto/field";

export interface ActionState {
  error?: string;
  ok?: boolean;
}

const NOT_ALLOWED = "Your role can view denials but not change them.";
const denialId = z.uuid();

async function authorize() {
  const auth = await requireAuth();
  return { auth, allowed: canWorkDenials(auth.role) };
}

export async function changeStatus(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  if (!allowed) return { error: NOT_ALLOWED };
  const parsed = z
    .object({ denialId, status: z.enum(denialStatusEnum.enumValues) })
    .safeParse({ denialId: formData.get("denialId"), status: formData.get("status") });
  if (!parsed.success) return { error: "Choose a valid status." };

  const result = await withTenant(auth, async (tx) => {
    const [current] = await tx
      .select({ status: denials.status })
      .from(denials)
      .where(eq(denials.id, parsed.data.denialId));
    if (!current) return { error: "This denial no longer exists." };
    if (current.status === parsed.data.status) return { ok: true };
    await tx
      .update(denials)
      .set({ status: parsed.data.status, updatedAt: new Date() })
      .where(eq(denials.id, parsed.data.denialId));
    await audit(tx, {
      action: "denial.status_changed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "denial",
      entityId: parsed.data.denialId,
      metadata: { from: current.status, to: parsed.data.status },
    });
    return { ok: true };
  });
  revalidatePath(`/denials/${parsed.data.denialId}`);
  return result;
}

export async function assignDenial(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  if (!allowed) return { error: NOT_ALLOWED };
  const parsed = z
    .object({ denialId, assigneeId: z.union([z.uuid(), z.literal("")]) })
    .safeParse({ denialId: formData.get("denialId"), assigneeId: formData.get("assigneeId") });
  if (!parsed.success) return { error: "Choose a team member." };
  const assigneeId = parsed.data.assigneeId || null;

  const result = await withTenant(auth, async (tx) => {
    // Foreign keys don't check tenant, so confirm the assignee belongs to this practice.
    if (assigneeId) {
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.tenantId, auth.tenantId), eq(memberships.userId, assigneeId)));
      if (!member) return { error: "That person isn't on this practice's team." };
    }
    const updated = await tx
      .update(denials)
      .set({ assigneeId, updatedAt: new Date() })
      .where(eq(denials.id, parsed.data.denialId))
      .returning({ id: denials.id });
    if (updated.length === 0) return { error: "This denial no longer exists." };
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
  if (!allowed) return { error: NOT_ALLOWED };
  const parsed = z
    .object({ denialId, body: z.string().trim().min(1).max(4000) })
    .safeParse({ denialId: formData.get("denialId"), body: formData.get("body") });
  if (!parsed.success) return { error: "Write a note of up to 4,000 characters." };

  const result = await withTenant(auth, async (tx) => {
    const [exists] = await tx
      .select({ id: denials.id })
      .from(denials)
      .where(eq(denials.id, parsed.data.denialId));
    if (!exists) return { error: "This denial no longer exists." };
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
  const auth = await requireAuth();
  const parsed = z
    .object({ denial: denialId, reason: z.enum(["appeal", "eligibility", "payer_call", "other"]) })
    .safeParse({ denial, reason });
  if (!parsed.success) return { error: "Choose a reason." };
  return withTenant(auth, async (tx) => {
    const [row] = await tx
      .select({ patientId: patients.id, memberIdEnc: patients.memberIdEnc })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .where(eq(denials.id, parsed.data.denial));
    if (!row) return { error: "Not found." };
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
