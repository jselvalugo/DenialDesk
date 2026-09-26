"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { addCalendarDays } from "@rules/calendar";
import { canWorkAppeals } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { appealNotes, appeals, appealSubmittedMethodEnum, claims, denials, patients } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getAppealFollowUpDays } from "@/domain/appeals/settings";
import { denialStatusForDecision, isCloseOutcome } from "@/domain/appeals/status";
import { audit } from "@/lib/audit";
import { decryptField } from "@/lib/crypto/field";

export interface ActionState {
  error?: string;
  ok?: boolean;
}

const NOT_ALLOWED = "Your role can view appeals but not change them.";
const appealId = z.uuid();

async function authorize() {
  const auth = await requireAuth();
  return { auth, allowed: canWorkAppeals(auth.role) };
}

export async function recordAppealSubmission(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  if (!allowed) return { error: NOT_ALLOWED };
  const parsed = z
    .object({
      appealId,
      method: z.enum(appealSubmittedMethodEnum.enumValues),
      submittedOn: z.iso.date(),
      trackingReference: z.string().trim().max(120).optional(),
      followUpOn: z.union([z.iso.date(), z.literal("")]).optional(),
    })
    .safeParse({
      appealId: formData.get("appealId"),
      method: formData.get("method"),
      submittedOn: formData.get("submittedOn"),
      trackingReference: formData.get("trackingReference") || undefined,
      followUpOn: formData.get("followUpOn") || undefined,
    });
  if (!parsed.success) return { error: "Choose a method and a valid submitted date." };
  const today = todayIn();
  if (parsed.data.submittedOn > today) return { error: "The submitted date can't be in the future." };

  const result = await withTenant(auth, async (tx) => {
    const [current] = await tx
      .select({
        id: appeals.id,
        status: appeals.status,
        denialId: appeals.denialId,
        createdAt: appeals.createdAt,
      })
      .from(appeals)
      .where(eq(appeals.id, parsed.data.appealId))
      .for("update");
    if (!current) return { error: "This appeal no longer exists." };
    if (!["draft", "in_review", "ready"].includes(current.status)) {
      return { error: "This appeal has already been submitted." };
    }
    const createdDate = current.createdAt.toISOString().slice(0, 10);
    if (parsed.data.submittedOn < createdDate) {
      return { error: "The submitted date can't be before the appeal was created." };
    }
    const followUpDays = await getAppealFollowUpDays(tx, auth.tenantId);
    const followUpOn = parsed.data.followUpOn || addCalendarDays(parsed.data.submittedOn, followUpDays);

    await tx
      .update(appeals)
      .set({
        status: "submitted",
        submittedMethod: parsed.data.method,
        submittedOn: parsed.data.submittedOn,
        trackingReference: parsed.data.trackingReference || null,
        followUpOn,
        updatedAt: new Date(),
      })
      .where(eq(appeals.id, parsed.data.appealId));
    await tx
      .update(denials)
      .set({ status: "appeal_submitted", appealSubmittedOn: parsed.data.submittedOn, updatedAt: new Date() })
      .where(eq(denials.id, current.denialId));
    await audit(tx, {
      action: "appeal.submission_recorded",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "appeal",
      entityId: parsed.data.appealId,
      metadata: { method: parsed.data.method },
    });
    return { ok: true };
  });
  revalidatePath(`/appeals/${parsed.data.appealId}`);
  return result;
}

export async function recordAppealDecision(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  if (!allowed) return { error: NOT_ALLOWED };
  const parsed = z
    .object({
      appealId,
      outcome: z.enum(["overturned_full", "overturned_partial", "upheld", "withdrawn", "dismissed"]),
      decisionOn: z.iso.date(),
      // Entered in dollars in the form (money is stored as integer cents everywhere else).
      // z.coerce.number() on "" would coerce to 0 (Number("") === 0); check the empty literal first.
      recoveredCents: z.union([z.literal(""), z.coerce.number().nonnegative()]).optional(),
      closeReason: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      appealId: formData.get("appealId"),
      outcome: formData.get("outcome"),
      decisionOn: formData.get("decisionOn"),
      recoveredCents: formData.get("recoveredCents") ?? "",
      closeReason: formData.get("closeReason") || undefined,
    });
  if (!parsed.success) return { error: "Choose an outcome and a valid decision date." };
  const today = todayIn();
  if (parsed.data.decisionOn > today) return { error: "The decision date can't be in the future." };

  const needsClose = isCloseOutcome(parsed.data.outcome);
  if (needsClose && !parsed.data.closeReason) {
    return { error: "A reason is required to withdraw or dismiss an appeal." };
  }
  const needsRecovered =
    parsed.data.outcome === "overturned_full" || parsed.data.outcome === "overturned_partial";
  const recoveredCents =
    parsed.data.recoveredCents === "" || parsed.data.recoveredCents === undefined
      ? undefined
      : Math.round(parsed.data.recoveredCents * 100);
  if (needsRecovered && recoveredCents === undefined) {
    return { error: "Enter the recovered amount for an overturned appeal." };
  }
  if (!needsRecovered && recoveredCents !== undefined) {
    return { error: "A recovered amount only applies to an overturned appeal." };
  }

  const result = await withTenant(auth, async (tx) => {
    const [current] = await tx
      .select({
        id: appeals.id,
        status: appeals.status,
        submittedOn: appeals.submittedOn,
        denialId: appeals.denialId,
      })
      .from(appeals)
      .where(eq(appeals.id, parsed.data.appealId))
      .for("update");
    if (!current) return { error: "This appeal no longer exists." };
    if (!["submitted", "awaiting_decision"].includes(current.status)) {
      return { error: "This appeal isn't awaiting a decision." };
    }
    if (current.submittedOn && parsed.data.decisionOn < current.submittedOn) {
      return { error: "The decision date can't be before the appeal was submitted." };
    }
    const [denial] = await tx
      .select({ deniedCents: denials.deniedCents })
      .from(denials)
      .where(eq(denials.id, current.denialId));
    if (recoveredCents !== undefined && denial && recoveredCents > denial.deniedCents) {
      return { error: "The recovered amount can't exceed the denied amount." };
    }

    const newStatus: "decided" | "withdrawn" | "dismissed" =
      parsed.data.outcome === "withdrawn" || parsed.data.outcome === "dismissed"
        ? parsed.data.outcome
        : "decided";
    await tx
      .update(appeals)
      .set({
        status: newStatus,
        decisionOutcome: parsed.data.outcome,
        decisionOn: parsed.data.decisionOn,
        recoveredCents: recoveredCents ?? null,
        closeReason: parsed.data.closeReason || null,
        updatedAt: new Date(),
      })
      .where(eq(appeals.id, parsed.data.appealId));
    await tx
      .update(denials)
      .set({ status: denialStatusForDecision(parsed.data.outcome), updatedAt: new Date() })
      .where(eq(denials.id, current.denialId));
    await audit(tx, {
      action: "appeal.decision_recorded",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "appeal",
      entityId: parsed.data.appealId,
      metadata: { outcome: parsed.data.outcome },
    });
    return { ok: true };
  });
  revalidatePath(`/appeals/${parsed.data.appealId}`);
  return result;
}

/** Returns the full member ID for an appeal's patient, and records who looked (R-7.5.1). */
export async function revealMemberId(
  appeal: string,
  reason: string,
): Promise<{ value?: string; error?: string }> {
  const { auth, allowed } = await authorize();
  if (!allowed) return { error: NOT_ALLOWED };
  const parsed = z
    .object({ appeal: appealId, reason: z.enum(["appeal", "eligibility", "payer_call", "other"]) })
    .safeParse({ appeal, reason });
  if (!parsed.success) return { error: "Choose a reason." };
  return withTenant(auth, async (tx) => {
    const [row] = await tx
      .select({ patientId: patients.id, memberIdEnc: patients.memberIdEnc })
      .from(appeals)
      .innerJoin(claims, eq(claims.id, appeals.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .where(eq(appeals.id, parsed.data.appeal));
    if (!row) return { error: "Not found." };
    await audit(tx, {
      action: "patient.member_id_revealed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "patient",
      entityId: row.patientId,
      reason: parsed.data.reason,
      metadata: { appealId: parsed.data.appeal },
    });
    return { value: decryptField(row.memberIdEnc) };
  });
}

export async function addAppealNote(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  if (!allowed) return { error: NOT_ALLOWED };
  const parsed = z
    .object({ appealId, body: z.string().trim().min(1).max(4000) })
    .safeParse({ appealId: formData.get("appealId"), body: formData.get("body") });
  if (!parsed.success) return { error: "Write a note of up to 4,000 characters." };

  const result = await withTenant(auth, async (tx) => {
    const [exists] = await tx
      .select({ id: appeals.id })
      .from(appeals)
      .where(eq(appeals.id, parsed.data.appealId));
    if (!exists) return { error: "This appeal no longer exists." };
    const [note] = await tx
      .insert(appealNotes)
      .values({
        tenantId: auth.tenantId,
        appealId: parsed.data.appealId,
        authorId: auth.userId,
        body: parsed.data.body,
      })
      .returning({ id: appealNotes.id });
    await audit(tx, {
      action: "appeal.note_added",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "appeal",
      entityId: parsed.data.appealId,
      metadata: { noteId: note!.id },
    });
    return { ok: true };
  });
  revalidatePath(`/appeals/${parsed.data.appealId}`);
  return result;
}
