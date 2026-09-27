import { and, eq } from "drizzle-orm";
import { universityProgress } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { getUniversityAccess, hasUniversityAccess } from "./access";
import { lessonKey } from "./content";

/** This user's completed lessons in this practice: "<course>/<lesson>" → completion time. */
export async function completedLessons(tx: TenantTx, userId: string): Promise<Map<string, Date>> {
  const rows = await tx
    .select({ lessonId: universityProgress.lessonId, completedAt: universityProgress.completedAt })
    .from(universityProgress)
    .where(eq(universityProgress.userId, userId));
  return new Map(rows.map((row) => [row.lessonId, row.completedAt]));
}

/**
 * Records a lesson completion once. Idempotent: a second call changes nothing and is not audited.
 * The caller has already checked that the course and lesson exist in the catalog.
 */
export async function recordLessonCompleted(
  tx: TenantTx,
  input: { tenantId: string; userId: string; courseId: string; lessonId: string },
): Promise<{ inserted: boolean; completedAt: Date }> {
  const key = lessonKey(input.courseId, input.lessonId);
  const [row] = await tx
    .insert(universityProgress)
    .values({ tenantId: input.tenantId, userId: input.userId, lessonId: key })
    .onConflictDoNothing()
    .returning({ id: universityProgress.id, completedAt: universityProgress.completedAt });
  if (row) {
    await audit(tx, {
      action: "university.lesson_completed",
      actorUserId: input.userId,
      tenantId: input.tenantId,
      entityType: "university_lesson",
      entityId: row.id,
      metadata: { courseId: input.courseId, lessonId: input.lessonId },
    });
    return { inserted: true, completedAt: row.completedAt };
  }
  const [existing] = await tx
    .select({ completedAt: universityProgress.completedAt })
    .from(universityProgress)
    .where(and(eq(universityProgress.userId, input.userId), eq(universityProgress.lessonId, key)));
  return { inserted: false, completedAt: existing!.completedAt };
}

/**
 * Completes a lesson only while the practice has University access (spec: denialdesk-university.md,
 * "Access"); returns null when the courses are locked. The server-side guard behind the course and
 * lesson redirects: a direct call to the action can't record progress on a locked practice.
 */
export async function completeLessonIfUnlocked(
  tx: TenantTx,
  input: { tenantId: string; userId: string; courseId: string; lessonId: string },
): Promise<{ inserted: boolean; completedAt: Date } | null> {
  if (!hasUniversityAccess(await getUniversityAccess(tx, input.tenantId))) return null;
  return recordLessonCompleted(tx, input);
}
