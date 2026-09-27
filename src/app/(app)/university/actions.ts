"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { findLesson } from "@/domain/university/catalog";
import { UNIVERSITY_ACCESS_FROM_CENTS } from "@/domain/university/offer";
import { recordLessonCompleted } from "@/domain/university/queries";
import { audit } from "@/lib/audit";
import { getT } from "@/i18n/server";

export interface CompleteLessonState {
  error?: string;
  /** ISO timestamp once the lesson is complete (this call or an earlier one). */
  completedAt?: string;
}

const input = z.object({ courseId: z.string().max(64), lessonId: z.string().max(64) });

/** Marks a lesson complete for the signed-in user (spec: denialdesk-university.md U1). Every role. */
export async function completeLesson(
  _: CompleteLessonState,
  formData: FormData,
): Promise<CompleteLessonState> {
  const auth = await requireAuth();
  const parsed = input.safeParse({ courseId: formData.get("courseId"), lessonId: formData.get("lessonId") });
  const found = parsed.success ? findLesson(parsed.data.courseId, parsed.data.lessonId) : undefined;
  if (!found) {
    const t = await getT("university");
    return { error: t("complete.lessonGone") };
  }

  const { completedAt } = await withTenant(auth, (tx) =>
    recordLessonCompleted(tx, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      courseId: found.course.id,
      lessonId: found.lesson.id,
    }),
  );
  revalidatePath("/university");
  revalidatePath(`/university/${found.course.id}`);
  revalidatePath(`/university/${found.course.id}/${found.lesson.id}`);
  return { completedAt: completedAt.toISOString() };
}

export interface RequestAccessState {
  requested?: boolean;
}

/**
 * "Request access" on the University access prompt (spec: denialdesk-university.md, "Access
 * prompt"). No purchase flow exists yet (OA-043): the request is recorded as an audit event
 * (who, which practice, when, the offer price shown) so the owner can follow up. Every role.
 */
export async function requestUniversityAccess(): Promise<RequestAccessState> {
  const auth = await requireAuth();
  await withTenant(auth, (tx) =>
    audit(tx, {
      action: "university.access_requested",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "tenant",
      entityId: auth.tenantId,
      metadata: { priceFromCents: UNIVERSITY_ACCESS_FROM_CENTS },
    }),
  );
  return { requested: true };
}
