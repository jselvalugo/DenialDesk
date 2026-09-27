import { describe, expect, it } from "vitest";
import { resolveRule } from "@rules/engine";
import { todayIn } from "@rules/calendar";
import { CARC } from "@/domain/carc";
import { navApps } from "@/components/shell/navigation";
import { COURSES, findCourse, findLesson } from "./catalog";
import { courseProgress, isSlug, lessonKey, progressLabel, readingMinutes } from "./content";

const today = todayIn();
const shippedPages = new Set(
  navApps({ showRevenueCycle: true, showSettings: true })
    .flatMap((app) => app.items)
    .filter((item) => item.available)
    .map((item) => item.href)
    .concat("/"),
);

describe("university catalog integrity", () => {
  it("has unique, URL-safe course and lesson slugs", () => {
    const courseIds = COURSES.map((course) => course.id);
    expect(new Set(courseIds).size).toBe(courseIds.length);
    for (const course of COURSES) {
      expect(isSlug(course.id), course.id).toBe(true);
      const lessonIds = course.lessons.map((lesson) => lesson.id);
      expect(new Set(lessonIds).size).toBe(lessonIds.length);
      expect(course.lessons.length).toBeGreaterThan(0);
      for (const lesson of course.lessons) expect(isSlug(lesson.id), lesson.id).toBe(true);
    }
  });

  it("names only rules that resolve in the catalog today (no statutory values typed in prose)", () => {
    const statute = /§|\bCFR\b|\bdays?\b.*\b(20|35|40|90|120|140|180)\b|12%|\b6 months\b|\b12 months\b/;
    for (const course of COURSES) {
      for (const lesson of course.lessons) {
        for (const block of lesson.blocks) {
          if (block.kind === "rules") {
            expect(block.ruleIds.length).toBeGreaterThan(0);
            for (const id of block.ruleIds) expect(() => resolveRule(id, today)).not.toThrow();
          } else if (block.kind === "p" || block.kind === "notice") {
            expect(block.text, `${course.id}/${lesson.id}`).not.toMatch(statute);
          } else if (block.kind === "list") {
            for (const item of block.items) expect(item, `${course.id}/${lesson.id}`).not.toMatch(statute);
          } else if (block.kind === "callout") {
            expect(block.text, `${course.id}/${lesson.id}`).not.toMatch(statute);
          } else if (block.kind === "table") {
            for (const row of block.rows) for (const cell of row) expect(cell).not.toMatch(statute);
          }
        }
      }
    }
  });

  it("names only CARCs that exist in src/domain/carc.ts", () => {
    for (const course of COURSES) {
      for (const lesson of course.lessons) {
        for (const block of lesson.blocks) {
          if (block.kind !== "carcs") continue;
          for (const code of block.codes) expect(CARC[code], `CARC ${code}`).toBeDefined();
        }
      }
    }
  });

  it("links only to shipped pages, with a label", () => {
    for (const course of COURSES) {
      for (const lesson of course.lessons) {
        for (const block of lesson.blocks) {
          if (block.kind !== "callout" || !block.href) continue;
          expect(shippedPages.has(block.href), block.href).toBe(true);
          expect(block.linkLabel).toBeTruthy();
        }
      }
    }
  });

  it("keeps table rows the same width as their columns", () => {
    for (const course of COURSES) {
      for (const lesson of course.lessons) {
        for (const block of lesson.blocks) {
          if (block.kind !== "table") continue;
          for (const row of block.rows) expect(row).toHaveLength(block.columns.length);
        }
      }
    }
  });

  it("has no emoji or exclamation marks in copy (DESIGN.md §3)", () => {
    const banned = /[!\u{1F300}-\u{1FAFF}☀-➿]/u;
    const text = JSON.stringify(COURSES);
    expect(text).not.toMatch(banned);
  });
});

describe("lookups", () => {
  it("finds courses and lessons with previous/next links", () => {
    const course = findCourse("getting-started")!;
    const first = findLesson(course.id, course.lessons[0]!.id)!;
    expect(first.previous).toBeNull();
    expect(first.next?.id).toBe(course.lessons[1]!.id);
    const last = findLesson(course.id, course.lessons.at(-1)!.id)!;
    expect(last.next).toBeNull();
    expect(findCourse("no-such-course")).toBeUndefined();
    expect(findLesson("getting-started", "no-such-lesson")).toBeUndefined();
    expect(findLesson("no-such-course", "finding-your-way")).toBeUndefined();
  });
});

describe("progress", () => {
  const course = findCourse("reading-a-denial")!;

  it("counts completed lessons by key and labels the state", () => {
    expect(progressLabel(courseProgress(course, new Set()))).toBe("Not started");
    const one = new Set([lessonKey(course.id, course.lessons[0]!.id)]);
    expect(courseProgress(course, one)).toEqual({ completed: 1, total: 3, done: false });
    expect(progressLabel(courseProgress(course, one))).toBe("1 of 3 lessons");
    const all = new Set(course.lessons.map((lesson) => lessonKey(course.id, lesson.id)));
    expect(progressLabel(courseProgress(course, all))).toBe("Complete");
  });

  it("ignores completions from another course with the same lesson slug", () => {
    const other = new Set([lessonKey("other-course", course.lessons[0]!.id)]);
    expect(courseProgress(course, other).completed).toBe(0);
  });

  it("estimates at least one minute of reading per course", () => {
    for (const c of COURSES) expect(readingMinutes(c.lessons)).toBeGreaterThanOrEqual(1);
    expect(readingMinutes([])).toBe(1);
  });
});
