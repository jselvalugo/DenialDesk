import { describe, expect, it } from "vitest";
import { COURSES } from "./catalog";
import { programSummary, UNIVERSITY_ACCESS_FROM_CENTS } from "./offer";
import { WIKI_ARTICLES } from "./wiki/catalog";

describe("university offer", () => {
  it("summarizes the program from the catalog", () => {
    const summary = programSummary();
    expect(summary.courses).toBe(COURSES.length);
    expect(summary.lessons).toBe(COURSES.flatMap((c) => c.lessons).length);
    expect(summary.minutes).toBeGreaterThanOrEqual(COURSES.length);
    expect(summary.wikiArticles).toBe(WIKI_ARTICLES.length);
  });

  it("prices access in whole cents, starting at $299", () => {
    expect(UNIVERSITY_ACCESS_FROM_CENTS).toBe(29900);
    expect(Number.isInteger(UNIVERSITY_ACCESS_FROM_CENTS)).toBe(true);
  });
});
