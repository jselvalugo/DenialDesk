"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import {
  getUniversityAccess,
  hasUniversityAccess,
  requestUniversityAccess as requestAccess,
} from "@/domain/university/access";
import { findLesson } from "@/domain/university/catalog";
import { recordLessonCompleted } from "@/domain/university/queries";
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

  const result = await withTenant(auth, async (tx) => {
    // The courses are locked until the practice has access (spec: "Access").
    if (!hasUniversityAccess(await getUniversityAccess(tx, auth.tenantId))) return null;
    return recordLessonCompleted(tx, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      courseId: found.course.id,
      lessonId: found.lesson.id,
    });
  });
  if (!result) {
    const t = await getT("university");
    return { error: t("access.locked") };
  }
  const { completedAt } = result;
  revalidatePath("/university");
  revalidatePath(`/university/${found.course.id}`);
  revalidatePath(`/university/${found.course.id}/${found.lesson.id}`);
  return { completedAt: completedAt.toISOString() };
}

export interface RequestAccessState {
  requested?: boolean;
  error?: string;
}

/**
 * "Request access" on the University access prompt (spec: denialdesk-university.md, "Access").
 * Records the request on the practice's access row (one per practice; the operator sees it in the
 * console) and audits it. Every role.
 */
// Called by useActionState with (state, formData); neither is needed, so none is declared.
export async function requestUniversityAccess(): Promise<RequestAccessState> {
  const auth = await requireAuth();
  const t = await getT("university");
  try {
    await withTenant(auth, (tx) => requestAccess(tx, { tenantId: auth.tenantId, userId: auth.userId }));
  } catch {
    return { error: t("access.failed") };
  }
  revalidatePath("/university");
  return { requested: true };
}
