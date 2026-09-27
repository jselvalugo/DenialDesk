import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { COURSES } from "@/domain/university/catalog";
import { courseProgress, progressLabel, readingMinutes } from "@/domain/university/content";
import { completedLessons } from "@/domain/university/queries";
import { UniversityHeader } from "./UniversityHeader";

export const metadata: Metadata = { title: "DenialDesk University" };

/** Course catalog with this user's progress (spec: denialdesk-university.md U1). Every role. */
export default async function UniversityPage() {
  const auth = await requireAuth();
  const completed = await withTenant(auth, (tx) => completedLessons(tx, auth.userId));
  const keys = new Set(completed.keys());
  const totalLessons = COURSES.reduce((n, course) => n + course.lessons.length, 0);
  const totalDone = COURSES.reduce((n, course) => n + courseProgress(course, keys).completed, 0);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <UniversityHeader
        eyebrow="DenialDesk University"
        title="Courses"
        description="Short courses on how DenialDesk works, how to read a denial, the Florida clocks the product enforces, and how patient data is protected. Your completions are kept for your account."
      />

      <Panel title="Courses" description={`${totalDone} of ${totalLessons} lessons completed`} flush>
        <ol className="divide-y divide-border">
          {COURSES.map((course, index) => {
            const progress = courseProgress(course, keys);
            return (
              <li key={course.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4">
                <span className="w-8 shrink-0 font-mono text-label text-subtle tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1 basis-80">
                  <h3 className="text-heading font-semibold text-text">
                    <Link href={`/university/${course.id}`} className="text-link hover:underline">
                      {course.title}
                    </Link>
                  </h3>
                  <p className="text-body text-muted">{course.description}</p>
                  <p className="mt-1 text-label text-subtle">For: {course.audience}</p>
                </div>
                <dl className="flex shrink-0 items-center gap-6 text-label text-muted">
                  <div>
                    <dt className="text-[0.6875rem] font-semibold tracking-wider uppercase">Lessons</dt>
                    <dd className="font-mono text-body text-text tabular-nums">{course.lessons.length}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.6875rem] font-semibold tracking-wider uppercase">Reading</dt>
                    <dd className="font-mono text-body text-text tabular-nums">
                      {readingMinutes(course.lessons)} min
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.6875rem] font-semibold tracking-wider uppercase">Progress</dt>
                    <dd>
                      <Badge tone={progress.done ? "success" : progress.completed > 0 ? "info" : "neutral"}>
                        {progressLabel(progress)}
                      </Badge>
                    </dd>
                  </div>
                </dl>
                <Link
                  href={`/university/${course.id}`}
                  aria-label={`Open course: ${course.title}`}
                  className="inline-flex shrink-0 items-center gap-1 text-body font-medium text-link hover:underline"
                >
                  Open course
                  <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
                </Link>
              </li>
            );
          })}
        </ol>
      </Panel>

      <p className="text-label text-muted">
        Courses describe how DenialDesk behaves and are not legal or compliance advice. Deadlines shown in a
        lesson are read from the same versioned rules the product uses, with their citations.
      </p>
    </div>
  );
}
