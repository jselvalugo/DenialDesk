import { COURSES } from "./catalog";
import { readingMinutes } from "./content";
import { WIKI_ARTICLES } from "./wiki/catalog";

/**
 * The DenialDesk University offer shown by the access prompt on the course catalog
 * (docs/specs/denialdesk-university.md, "Access prompt"). Business content set by the owner
 * (2026-09-27), not a legal value: the starting price of access. Integer cents (CLAUDE.md).
 * What "starting at" includes, per-user vs. per-practice terms, and the purchase channel are open
 * owner items (OA-044).
 */
export const UNIVERSITY_ACCESS_FROM_CENTS = 29900;

export interface ProgramSummary {
  courses: number;
  lessons: number;
  /** Estimated reading time for every lesson, in minutes (words ÷ 200, per course, rounded up). */
  minutes: number;
  wikiArticles: number;
}

/** How long the University is, computed from the catalog so the prompt never drifts from it. */
export function programSummary(): ProgramSummary {
  return {
    courses: COURSES.length,
    lessons: COURSES.reduce((n, course) => n + course.lessons.length, 0),
    minutes: COURSES.reduce((n, course) => n + readingMinutes(course.lessons), 0),
    wikiArticles: WIKI_ARTICLES.length,
  };
}
