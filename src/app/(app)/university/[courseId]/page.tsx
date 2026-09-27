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
import { formatDateTime } from "@/lib/format";
import { UniversityHeader } from "../UniversityHeader";

type Params = Promise<{ courseId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { courseId } = await params;
  return { title: findCourse(courseId)?.title ?? "DenialDesk University" };
}

/** One course: its lessons in order with this user's completion state. */
export default async function CoursePage({ params }: { params: Params }) {
  const { courseId } = await params;
  const course = findCourse(courseId);
  if (!course) notFound();
  const auth = await requireAuth();
  const completed = await withTenant(auth, (tx) => completedLessons(tx, auth.userId));
  const progress = courseProgress(course, new Set(completed.keys()));
  const nextLesson = course.lessons.find((lesson) => !completed.has(lessonKey(course.id, lesson.id)));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/university" className="font-medium text-link hover:underline">
          DenialDesk University
        </Link>{" "}
        <span aria-hidden>/</span> {course.title}
      </nav>

      <UniversityHeader
        title={course.title}
        description={course.description}
        actions={
          nextLesson ? (
            <Link href={`/university/${course.id}/${nextLesson.id}`} className={primaryLinkButtonClass}>
              {progress.completed === 0 ? "Start course" : "Continue course"}
            </Link>
          ) : (
            <Badge tone="success">Course complete</Badge>
          )
        }
      />

      <Panel
        title="Lessons"
        description={`For: ${course.audience} · ${readingMinutes(course.lessons)} min reading · ${progressLabel(progress)}`}
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
                      Completed {formatDateTime(at)}
                    </span>
                  ) : (
                    <Badge dot={false}>Not started</Badge>
                  )}
                  <Link
                    href={`/university/${course.id}/${lesson.id}`}
                    aria-label={`Open lesson: ${lesson.title}`}
                    className="inline-flex items-center gap-1 text-body font-medium text-link hover:underline"
                  >
                    Open
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
