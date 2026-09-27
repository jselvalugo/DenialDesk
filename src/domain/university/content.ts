import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";

/**
 * DenialDesk University content model (docs/specs/denialdesk-university.md U1).
 *
 * Lessons are typed blocks so that nothing statutory is typed into prose: a `rules` block names
 * rule IDs from `rules/catalog.ts` and the page resolves them as of today (value, unit, citation,
 * ⚠️ VERIFY status). A `carcs` block names codes from `src/domain/carc.ts`. Course and lesson
 * IDs are URL slugs: no PHI, ever (R-7.4.8).
 */

type UniversityT = Translator<Messages["university"]>;

export type Block =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  /** "In DenialDesk": how the product behaves, with an optional link to the page described. */
  | { kind: "callout"; title: string; text: string; href?: string; linkLabel?: string }
  /** Legal values rendered from the rules catalog; never retyped here. */
  /** `referenceOnly`: in the catalog, but DenialDesk computes no deadline from them yet. */
  | { kind: "rules"; caption: string; ruleIds: string[]; referenceOnly?: string[] }
  /** CARC summaries and DenialDesk categories rendered from src/domain/carc.ts. */
  | { kind: "carcs"; caption: string; codes: string[] }
  /** Claim adjustment group code summaries rendered from src/domain/group-codes.ts. */
  | { kind: "groupCodes"; caption: string; codes: string[] }
  | { kind: "table"; caption: string; columns: string[]; rows: string[][] }
  /** Standing note: describes product behavior; not legal or compliance advice. */
  | { kind: "notice"; text: string };

export interface Lesson {
  /** Slug, unique within its course. */
  id: string;
  title: string;
  summary: string;
  blocks: Block[];
}

export interface Course {
  /** Slug, unique across courses. */
  id: string;
  title: string;
  description: string;
  /** Who the course is written for (plain text; every role can take every course). */
  audience: string;
  lessons: Lesson[];
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSlug(value: string): boolean {
  return SLUG.test(value) && value.length <= 64;
}

/** Stable key stored in `university_progress.lesson_id`: "<course>/<lesson>". */
export function lessonKey(courseId: string, lessonId: string): string {
  return `${courseId}/${lessonId}`;
}

function blockWords(block: Block): number {
  const count = (text: string) => text.split(/\s+/).filter(Boolean).length;
  switch (block.kind) {
    case "p":
    case "notice":
      return count(block.text);
    case "list":
      return block.items.reduce((n, item) => n + count(item), 0);
    case "callout":
      return count(block.title) + count(block.text);
    case "table":
      return block.rows.flat().reduce((n, cell) => n + count(cell), 0);
    case "rules":
      // A rendered rule row is roughly a title, a value, and a citation.
      return block.ruleIds.length * 20;
    case "carcs":
    case "groupCodes":
      return block.codes.length * 12;
  }
}

/** Reading time at 200 words per minute, at least one minute. */
export function readingMinutes(lessons: Lesson[]): number {
  const words = lessons.flatMap((lesson) => lesson.blocks).reduce((n, block) => n + blockWords(block), 0);
  return Math.max(1, Math.ceil(words / 200));
}

export interface CourseProgress {
  completed: number;
  total: number;
  /** Every lesson completed. */
  done: boolean;
}

/** Progress for one course from the set of completed lesson keys ("<course>/<lesson>"). */
export function courseProgress(course: Course, completedKeys: ReadonlySet<string>): CourseProgress {
  const completed = course.lessons.filter((lesson) =>
    completedKeys.has(lessonKey(course.id, lesson.id)),
  ).length;
  return { completed, total: course.lessons.length, done: completed === course.lessons.length };
}

/** `t` is the university-namespace translator: `progressLabel(progress, await getT("university"))`. */
export function progressLabel({ completed, total, done }: CourseProgress, t: UniversityT): string {
  if (done) return t("progress.complete");
  if (completed === 0) return t("progress.notStarted");
  return t("progress.ofLessons", { completed, total });
}
