import { eq } from "drizzle-orm";
import { addCalendarDays, todayIn } from "@rules/calendar";
import type { TenantTx } from "@/db/tenant";
import { appeals, denials, type appealSubmittedMethodEnum } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getAppealFollowUpDays } from "./settings";

export interface RecordSubmissionInput {
  appealId: string;
  method: (typeof appealSubmittedMethodEnum.enumValues)[number];
  /** ISO date (YYYY-MM-DD); validated against "today" and the appeal's creation date here. */
  submittedOn: string;
  trackingReference?: string;
  /** A user-entered override; when absent, computed from the practice's follow-up-day setting. */
  followUpOn?: string;
}

export interface RecordSubmissionResult {
  error?: string;
  ok?: boolean;
}

/**
 * Records that an appeal was submitted and syncs the linked denial's status (spec: appeals.md A1,
 * "Action: record submission"). Pure domain logic — no auth, no form parsing, no Next.js —
 * so it can be exercised directly in integration tests and from the server action alike.
 */
export async function recordSubmission(
  tx: TenantTx,
  auth: { tenantId: string; userId: string },
  input: RecordSubmissionInput,
): Promise<RecordSubmissionResult> {
  const today = todayIn();
  if (input.submittedOn > today) return { error: "The submitted date can't be in the future." };

  const [current] = await tx
    .select({
      id: appeals.id,
      status: appeals.status,
      denialId: appeals.denialId,
      createdAt: appeals.createdAt,
    })
    .from(appeals)
    .where(eq(appeals.id, input.appealId))
    .for("update");
  if (!current) return { error: "This appeal no longer exists." };
  if (!["draft", "in_review", "ready"].includes(current.status)) {
    return { error: "This appeal has already been submitted." };
  }
  // The practice's calendar date, not UTC: an appeal created late evening ET can still be "today"
  // in UTC's next day, which would otherwise reject a same-day submission.
  const createdDate = todayIn(undefined, current.createdAt);
  if (input.submittedOn < createdDate) {
    return { error: "The submitted date can't be before the appeal was created." };
  }

  const followUpDays = await getAppealFollowUpDays(tx, auth.tenantId);
  const followUpOn = input.followUpOn || addCalendarDays(input.submittedOn, followUpDays);
  const [denialBefore] = await tx
    .select({ status: denials.status })
    .from(denials)
    .where(eq(denials.id, current.denialId));

  await tx
    .update(appeals)
    .set({
      status: "submitted",
      submittedMethod: input.method,
      submittedOn: input.submittedOn,
      trackingReference: input.trackingReference || null,
      followUpOn,
      updatedAt: new Date(),
    })
    .where(eq(appeals.id, input.appealId));
  await tx
    .update(denials)
    .set({ status: "appeal_submitted", appealSubmittedOn: input.submittedOn, updatedAt: new Date() })
    .where(eq(denials.id, current.denialId));
  await audit(tx, {
    action: "appeal.submission_recorded",
    actorUserId: auth.userId,
    tenantId: auth.tenantId,
    entityType: "appeal",
    entityId: input.appealId,
    metadata: { method: input.method, denialId: current.denialId },
  });
  if (denialBefore && denialBefore.status !== "appeal_submitted") {
    await audit(tx, {
      action: "denial.status_changed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "denial",
      entityId: current.denialId,
      metadata: { from: denialBefore.status, to: "appeal_submitted", appealId: input.appealId },
    });
  }
  return { ok: true };
}
