import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, memberships, universityProgress, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { COURSES } from "@/domain/university/catalog";
import { lessonKey } from "@/domain/university/content";
import { completedLessons, recordLessonCompleted } from "@/domain/university/queries";
import { createTestTenant, expectDbError } from "./helpers";

// docs/specs/denialdesk-university.md U1: completions are per user per practice, idempotent,
// audited once, append-only, and tenant-scoped (R-7.2.4, R-7.5.1, R-10.4).

let ctx: { tenantId: string; userId: string };
let other: { tenantId: string; userId: string };
const course = COURSES[0]!;
const lesson = course.lessons[0]!;

beforeAll(async () => {
  ctx = await createTestTenant("University");
  other = await createTestTenant("University other");
});

afterAll(() => closeDatabase());

describe("lesson completion", () => {
  it("records a completion once and audits it, then reports it as completed", async () => {
    const first = await withTenant(ctx, (tx) =>
      recordLessonCompleted(tx, { ...ctx, courseId: course.id, lessonId: lesson.id }),
    );
    expect(first.inserted).toBe(true);

    const again = await withTenant(ctx, (tx) =>
      recordLessonCompleted(tx, { ...ctx, courseId: course.id, lessonId: lesson.id }),
    );
    expect(again.inserted).toBe(false);
    expect(again.completedAt.getTime()).toBe(first.completedAt.getTime());

    const completed = await withTenant(ctx, (tx) => completedLessons(tx, ctx.userId));
    expect([...completed.keys()]).toEqual([lessonKey(course.id, lesson.id)]);

    const events = await systemDb()
      .select({ metadata: auditEvents.metadata, entityType: auditEvents.entityType })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, ctx.tenantId), eq(auditEvents.action, "university.lesson_completed")),
      )
      .orderBy(desc(auditEvents.occurredAt));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      entityType: "university_lesson",
      metadata: { courseId: course.id, lessonId: lesson.id },
    });
  });

  it("keeps each user's progress separate inside a practice", async () => {
    const suffix = ctx.userId.slice(0, 8);
    const [colleague] = await systemDb()
      .insert(users)
      .values({
        email: `colleague-${suffix}@synthetic.test`,
        displayName: `Synthetic Colleague ${suffix}`,
        passwordHash: "not-used",
      })
      .returning({ id: users.id });
    await systemDb()
      .insert(memberships)
      .values({ tenantId: ctx.tenantId, userId: colleague!.id, role: "specialist" });
    const theirs = await withTenant({ tenantId: ctx.tenantId, userId: colleague!.id }, (tx) =>
      completedLessons(tx, colleague!.id),
    );
    expect(theirs.size).toBe(0);
  });

  it("is invisible to another practice", async () => {
    const rows = await withTenant(other, (tx) =>
      tx
        .select({ id: universityProgress.id })
        .from(universityProgress)
        .where(eq(universityProgress.userId, ctx.userId)),
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses a row stamped with another practice (row-level security WITH CHECK)", async () => {
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.insert(universityProgress).values({
          tenantId: other.tenantId,
          userId: other.userId,
          lessonId: lessonKey(course.id, lesson.id),
        }),
      ),
      /row-level security/,
    );
  });

  it("refuses a completion for a user who is not a member of the practice", async () => {
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.insert(universityProgress).values({
          tenantId: ctx.tenantId,
          userId: other.userId,
          lessonId: lessonKey(course.id, lesson.id),
        }),
      ),
      /university_progress_member_fk/,
    );
  });

  it("refuses a lesson id that is not a course/lesson slug", async () => {
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx
          .insert(universityProgress)
          .values({ tenantId: ctx.tenantId, userId: ctx.userId, lessonId: "Not a slug" }),
      ),
      /university_progress_lesson_id_valid/,
    );
  });

  it("is append-only for the app role: no update, no delete", async () => {
    await expectDbError(
      withTenant(ctx, (tx) => tx.update(universityProgress).set({ completedAt: new Date() })),
      /permission denied/,
    );
    await expectDbError(
      withTenant(ctx, (tx) => tx.delete(universityProgress)),
      /permission denied/,
    );
  });
});
