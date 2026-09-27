import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CircleCheck } from "lucide-react";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { primaryLinkButtonClass } from "@/components/ui/linkButton";
import { withTenant } from "@/db/tenant";
import { findCourse } from "@/domain/university/catalog";
import { courseProgress, lessonKey, progressLabel, readingMinutes } from "@/domain/university/content";
import { completedLessons } from "@/domain/university/queries";
import { getFormat, getT } from "@/i18n/server";
import { UniversityHeader } from "../UniversityHeader";

type Params = Promise<{ courseId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { courseId } = await params;
  const t = await getT("university");
  return { title: findCourse(courseId)?.title ?? t("eyebrow") };
}

/** One course: its lessons in order with this user's completion state. */
export default async function CoursePage({ params }: { params: Params }) {
  const { courseId } = await params;
  const course = findCourse(courseId);
  if (!course) notFound();
  const auth = await requireAuth();
  const t = await getT("university");
  const f = await getFormat();
  const completed = await withTenant(auth, (tx) => completedLessons(tx, auth.userId));
  const progress = courseProgress(course, new Set(completed.keys()));
  const nextLesson = course.lessons.find((lesson) => !completed.has(lessonKey(course.id, lesson.id)));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/university" className="font-medium text-link hover:underline">
          {t("eyebrow")}
        </Link>{" "}
        <span aria-hidden>/</span> {course.title}
      </nav>

      <UniversityHeader
        eyebrow={t("eyebrow")}
        title={course.title}
        description={course.description}
        actions={
          nextLesson ? (
            <Link href={`/university/${course.id}/${nextLesson.id}`} className={primaryLinkButtonClass}>
              {progress.completed === 0 ? t("course.startCourse") : t("course.continueCourse")}
            </Link>
          ) : (
            <Badge tone="success">{t("course.complete")}</Badge>
          )
        }
      />

      <Panel
        title={t("catalog.lessonsLabel")}
        description={t("course.lessonsDescription", {
          audience: course.audience,
          minutes: readingMinutes(course.lessons),
          progress: progressLabel(progress, t),
        })}
        flush
      >
        <ol className="divide-y divide-border">
          {course.lessons.map((lesson, index) => {
            const at = completed.get(lessonKey(course.id, lesson.id));
            return (
              <li key={lesson.id} className="flex items-start gap-4 px-4 py-4">
                <span className="w-8 shrink-0 pt-0.5 font-mono text-label text-subtle tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-heading font-semibold text-text">
                    <Link
                      href={`/university/${course.id}/${lesson.id}`}
                      className="text-link hover:underline"
                    >
                      {lesson.title}
                    </Link>
                  </h3>
                  <p className="text-body text-muted">{lesson.summary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  {at ? (
                    <span className="inline-flex items-center gap-1.5 text-label text-success-fg">
                      <CircleCheck aria-hidden="true" className="size-4" strokeWidth={2} />
                      {t("course.completedOn", { date: f.dateTime(at) })}
                    </span>
                  ) : (
                    <Badge dot={false}>{t("progress.notStarted")}</Badge>
                  )}
                  <Link
                    href={`/university/${course.id}/${lesson.id}`}
                    aria-label={t("course.openLessonAria", { title: lesson.title })}
                    className="inline-flex items-center gap-1 text-body font-medium text-link hover:underline"
                  >
                    {t("course.openLesson")}
                    <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}
