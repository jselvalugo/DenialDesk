import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { COURSES } from "@/domain/university/catalog";
import { courseProgress, progressLabel, readingMinutes } from "@/domain/university/content";
import { programSummary, UNIVERSITY_ACCESS_FROM_CENTS } from "@/domain/university/offer";
import { completedLessons } from "@/domain/university/queries";
import { getT } from "@/i18n/server";
import { AccessPrompt } from "./AccessPrompt";
import { UniversityHeader } from "./UniversityHeader";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("university");
  return { title: t("eyebrow") };
}

/** Course catalog with this user's progress (spec: denialdesk-university.md U1). Every role. */
export default async function UniversityPage() {
  const auth = await requireAuth();
  const t = await getT("university");
  const completed = await withTenant(auth, (tx) => completedLessons(tx, auth.userId));
  const keys = new Set(completed.keys());
  const totalLessons = COURSES.reduce((n, course) => n + course.lessons.length, 0);
  const totalDone = COURSES.reduce((n, course) => n + courseProgress(course, keys).completed, 0);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <AccessPrompt summary={programSummary()} priceFromCents={UNIVERSITY_ACCESS_FROM_CENTS} />
      <UniversityHeader
        eyebrow={t("eyebrow")}
        title={t("catalog.title")}
        description={t("catalog.description")}
        actions={
          <Link
            href="/university/wiki"
            className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-body font-medium text-text hover:bg-surface-muted"
          >
            {t("catalog.openWiki")}
          </Link>
        }
      />

      <Panel
        title={t("catalog.title")}
        description={t("catalog.lessonsCompleted", { done: totalDone, total: totalLessons })}
        flush
      >
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
                  <p className="mt-1 text-label text-subtle">
                    {t("catalog.audience", { audience: course.audience })}
                  </p>
                </div>
                <dl className="flex shrink-0 items-center gap-6 text-label text-muted">
                  <div>
                    <dt className="text-[0.6875rem] font-semibold tracking-wider uppercase">
                      {t("catalog.lessonsLabel")}
                    </dt>
                    <dd className="font-mono text-body text-text tabular-nums">{course.lessons.length}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.6875rem] font-semibold tracking-wider uppercase">
                      {t("catalog.readingLabel")}
                    </dt>
                    <dd className="font-mono text-body text-text tabular-nums">
                      {t("catalog.readingMinutes", { count: readingMinutes(course.lessons) })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.6875rem] font-semibold tracking-wider uppercase">
                      {t("catalog.progressLabel")}
                    </dt>
                    <dd>
                      <Badge tone={progress.done ? "success" : progress.completed > 0 ? "info" : "neutral"}>
                        {progressLabel(progress, t)}
                      </Badge>
                    </dd>
                  </div>
                </dl>
                <Link
                  href={`/university/${course.id}`}
                  aria-label={t("catalog.openCourseAria", { title: course.title })}
                  className="inline-flex shrink-0 items-center gap-1 text-body font-medium text-link hover:underline"
                >
                  {t("catalog.openCourse")}
                  <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
                </Link>
              </li>
            );
          })}
        </ol>
      </Panel>

      <p className="text-label text-muted">{t("catalog.disclaimer")}</p>
    </div>
  );
}
