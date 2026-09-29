"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canWorkAppeals } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { appealNotes, appeals, appealSubmittedMethodEnum, claims, denials, patients } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { recordSubmission } from "@/domain/appeals/actions";
import { denialStatusForDecision, isCloseOutcome } from "@/domain/appeals/status";
import { memberIdBelongsToClaimPayer } from "@/domain/patients/member-id";
import { getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { decryptField } from "@/lib/crypto/field";
import { parseDollarsToCents } from "@/lib/format";

export interface ActionState {
  error?: string;
  ok?: boolean;
}

const appealId = z.uuid();

async function authorize() {
  const auth = await requireAuth();
  return { auth, allowed: canWorkAppeals(auth.role) };
}

export async function recordAppealSubmission(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  const t = await getT("appeals");
  if (!allowed) return { error: t("error.notAllowedChange") };
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
  if (!parsed.success) return { error: t("error.invalidSubmission") };

  const outcome = await withTenant(auth, (tx) =>
    recordSubmission(tx, auth, {
      appealId: parsed.data.appealId,
      method: parsed.data.method,
      submittedOn: parsed.data.submittedOn,
      trackingReference: parsed.data.trackingReference,
      followUpOn: parsed.data.followUpOn || undefined,
    }),
  );
  revalidatePath(`/appeals/${parsed.data.appealId}`);
  const result: ActionState = outcome.errorKey ? { error: t(outcome.errorKey) } : { ok: outcome.ok };
  return result;
}

export async function recordAppealDecision(_: ActionState, formData: FormData): Promise<ActionState> {
  const { auth, allowed } = await authorize();
  const t = await getT("appeals");
  if (!allowed) return { error: t("error.notAllowedChange") };
  const parsed = z
    .object({
      appealId,
      outcome: z.enum(["overturned_full", "overturned_partial", "upheld", "withdrawn", "dismissed"]),
      decisionOn: z.iso.date(),
      // Entered in dollars in the form (money is stored as integer cents everywhere else);
      // parsed below with parseDollarsToCents, which rejects anything but a plain amount.
      recoveredDollars: z.string().trim().optional(),
      closeReason: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      appealId: formData.get("appealId"),
      outcome: formData.get("outcome"),
      decisionOn: formData.get("decisionOn"),
      recoveredDollars: formData.get("recoveredDollars") ?? "",
      closeReason: formData.get("closeReason") || undefined,
    });
  if (!parsed.success) return { error: t("error.invalidDecision") };
  const today = todayIn();
  if (parsed.data.decisionOn > today) return { error: t("error.decisionInFuture") };

  const needsClose = isCloseOutcome(parsed.data.outcome);
  if (needsClose && !parsed.data.closeReason) {
    return { error: t("error.reasonRequired") };
  }
  const needsRecovered =
    parsed.data.outcome === "overturned_full" || parsed.data.outcome === "overturned_partial";
  const recoveredText = parsed.data.recoveredDollars ?? "";
  let recoveredCents: number | undefined;
  if (recoveredText !== "") {
    const cents = parseDollarsToCents(recoveredText);
    if (cents === null) return { error: t("error.invalidRecoveredAmount") };
    recoveredCents = cents;
  }
  if (needsRecovered && recoveredCents === undefined) {
    return { error: t("error.recoveredAmountRequired") };
  }
  if (!needsRecovered && recoveredCents !== undefined) {
    return { error: t("error.recoveredAmountNotApplicable") };
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
    if (!current) return { error: t("error.notFound") };
    if (!["submitted", "awaiting_decision"].includes(current.status)) {
      return { error: t("error.notAwaitingDecision") };
    }
    if (current.submittedOn && parsed.data.decisionOn < current.submittedOn) {
      return { error: t("error.decisionBeforeSubmitted") };
    }
    const [denial] = await tx
      .select({ deniedCents: denials.deniedCents, status: denials.status })
      .from(denials)
      .where(eq(denials.id, current.denialId));
    if (!denial) return { error: t("error.denialGone") };
    if (recoveredCents !== undefined && recoveredCents > denial.deniedCents) {
      return { error: t("error.recoveredExceedsDenied") };
    }

    const newStatus: "decided" | "withdrawn" | "dismissed" =
      parsed.data.outcome === "withdrawn" || parsed.data.outcome === "dismissed"
        ? parsed.data.outcome
        : "decided";
    const newDenialStatus = denialStatusForDecision(parsed.data.outcome);
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
      .set({ status: newDenialStatus, updatedAt: new Date() })
      .where(eq(denials.id, current.denialId));
    await audit(tx, {
      action: "appeal.decision_recorded",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "appeal",
      entityId: parsed.data.appealId,
      metadata: { outcome: parsed.data.outcome, denialId: current.denialId },
    });
    if (denial.status !== newDenialStatus) {
      await audit(tx, {
        action: "denial.status_changed",
        actorUserId: auth.userId,
        tenantId: auth.tenantId,
        entityType: "denial",
        entityId: current.denialId,
        metadata: { from: denial.status, to: newDenialStatus, appealId: parsed.data.appealId },
      });
    }
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
  const t = await getT("appeals");
  if (!allowed) return { error: t("error.notAllowedChange") };
  const parsed = z
    .object({ appeal: appealId, reason: z.enum(["appeal", "eligibility", "payer_call", "other"]) })
    .safeParse({ appeal, reason });
  if (!parsed.success) return { error: t("error.invalidRevealReason") };
  return withTenant(auth, async (tx) => {
    const [row] = await tx
      .select({
        patientId: patients.id,
        memberIdEnc: patients.memberIdEnc,
        primaryPayerId: patients.primaryPayerId,
        claimPayerId: claims.payerId,
      })
      .from(appeals)
      .innerJoin(claims, eq(claims.id, appeals.claimId))
      .innerJoin(patients, eq(patients.id, claims.patientId))
      .where(eq(appeals.id, parsed.data.appeal));
    if (!row || !row.memberIdEnc) return { error: t("error.revealNotFound") };
    // The member ID on file is the primary payer's; never reveal it on another payer's claim (R-5.1.2).
    if (!memberIdBelongsToClaimPayer(row.primaryPayerId, row.claimPayerId)) {
      return { error: t("error.revealOtherPayer") };
    }
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
  const t = await getT("appeals");
  if (!allowed) return { error: t("error.notAllowedChange") };
  const parsed = z
    .object({ appealId, body: z.string().trim().min(1).max(4000) })
    .safeParse({ appealId: formData.get("appealId"), body: formData.get("body") });
  if (!parsed.success) return { error: t("error.invalidNote") };

  const result = await withTenant(auth, async (tx) => {
    const [exists] = await tx
      .select({ id: appeals.id })
      .from(appeals)
      .where(eq(appeals.id, parsed.data.appealId));
    if (!exists) return { error: t("error.notFound") };
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
