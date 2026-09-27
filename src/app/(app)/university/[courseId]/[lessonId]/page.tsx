import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { requireAuth } from "@/auth/session";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { findLesson } from "@/domain/university/catalog";
import { lessonKey } from "@/domain/university/content";
import { completedLessons } from "@/domain/university/queries";
import { UniversityHeader } from "../../UniversityHeader";
import { CompleteLessonForm } from "./CompleteLessonForm";
import { LessonBody } from "./LessonBody";

type Params = Promise<{ courseId: string; lessonId: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { courseId, lessonId } = await params;
  const found = findLesson(courseId, lessonId);
  return { title: found ? `${found.lesson.title} · ${found.course.title}` : "DenialDesk University" };
}

/** One lesson: its body, previous/next, and "Mark lesson complete". No PHI is read; not audited. */
export default async function LessonPage({ params }: { params: Params }) {
  const { courseId, lessonId } = await params;
  const found = findLesson(courseId, lessonId);
  if (!found) notFound();
  const { course, lesson, previous, next } = found;
  const auth = await requireAuth();
  const completed = await withTenant(auth, (tx) => completedLessons(tx, auth.userId));
  const completedAt = completed.get(lessonKey(course.id, lesson.id)) ?? null;
  const position = course.lessons.findIndex((item) => item.id === lesson.id) + 1;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/university" className="font-medium text-link hover:underline">
          DenialDesk University
        </Link>{" "}
        <span aria-hidden>/</span>{" "}
        <Link href={`/university/${course.id}`} className="font-medium text-link hover:underline">
          {course.title}
        </Link>{" "}
        <span aria-hidden>/</span> {lesson.title}
      </nav>

      <UniversityHeader
        eyebrow={`${course.title} · Lesson ${position} of ${course.lessons.length}`}
        title={lesson.title}
        description={lesson.summary}
      />

      <Panel>
        <LessonBody blocks={lesson.blocks} />
      </Panel>

      <Panel
        title="Your progress"
        description="Completions are kept as a training record for your practice and can't be undone."
      >
        <CompleteLessonForm
          courseId={course.id}
          lessonId={lesson.id}
          completedAt={completedAt ? completedAt.toISOString() : null}
        />
      </Panel>

      <nav aria-label="Lesson navigation" className="flex items-center justify-between gap-4 text-body">
        {previous ? (
          <Link
            href={`/university/${course.id}/${previous.id}`}
            className="inline-flex items-center gap-1 font-medium text-link hover:underline"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" strokeWidth={2} />
            Previous: {previous.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={`/university/${course.id}/${next.id}`}
            className="inline-flex items-center gap-1 font-medium text-link hover:underline"
          >
            Next: {next.title}
            <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
          </Link>
        ) : (
          <Link
            href={`/university/${course.id}`}
            className="inline-flex items-center gap-1 font-medium text-link hover:underline"
          >
            Back to the course
            <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
          </Link>
        )}
      </nav>
    </div>
  );
}
