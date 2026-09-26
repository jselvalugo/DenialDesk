import { describe, expect, it } from "vitest";
import { addCalendarDays } from "./calendar";
import { catalog } from "./catalog";
import { daysUntil, MEDICARE_LEVEL_AFTER, medicareNextLevelDeadline, rulesForBasis } from "./deadlines";
import { resolveRule } from "./engine";
import type { Rule } from "./types";

// Decision dated 2026-06-01 → presumed received 2026-06-06 (+5), then the level's window.
const cases = [
  ["reconsideration", 180, "2026-12-03", "42 CFR § 405.962(a)"],
  ["alj_hearing", 60, "2026-08-05", "42 CFR § 405.1002(a)"],
  ["council_review", 60, "2026-08-05", "42 CFR § 405.1102(a)"],
  ["judicial_review", 60, "2026-08-05", "42 CFR § 405.1132; § 405.1136 (judicial review)"],
] as const;

describe.each(cases)("Medicare %s deadline", (nextLevel, windowDays, due, citation) => {
  const deadline = medicareNextLevelDeadline({
    regime: "medicare",
    nextLevel,
    priorDecisionDate: "2026-06-01",
  })!;

  it(`is 5-day receipt presumption plus ${windowDays} days`, () => {
    expect(deadline.date).toBe(due);
    expect(deadline.citation).toBe(citation);
    expect(deadline.verify).toBe(true);
    expect(rulesForBasis(deadline.basis, "2026-06-01").map((r) => r.value)).toEqual([5, windowDays]);
  });

  it.each([
    [-1, 1], // day before
    [0, 0], // day of
    [1, -1], // day after
  ])("boundary: %i day(s) from due, %i days remain", (offset, remaining) => {
    expect(daysUntil(deadline.date, addCalendarDays(due, offset))).toBe(remaining);
  });

  it.each(["medicare_advantage", "fl_insurer", "fl_hmo", "erisa_self_funded"] as const)(
    "does not apply to %s",
    (regime) => {
      expect(medicareNextLevelDeadline({ regime, nextLevel, priorDecisionDate: "2026-06-01" })).toBeNull();
    },
  );
});

describe("Medicare appeal chain", () => {
  it("maps each decision to the next level", () => {
    expect(MEDICARE_LEVEL_AFTER).toEqual({
      redetermination: "reconsideration",
      reconsideration: "alj_hearing",
      alj_hearing: "council_review",
      council_review: "judicial_review",
    });
  });

  it("counts calendar days across a year end", () => {
    const d = medicareNextLevelDeadline({
      regime: "medicare",
      nextLevel: "alj_hearing",
      priorDecisionDate: "2026-11-10",
    });
    expect(d?.date).toBe("2027-01-14");
  });

  it("is not shifted by the DST change (2026-03-08)", () => {
    const d = medicareNextLevelDeadline({
      regime: "medicare",
      nextLevel: "alj_hearing",
      priorDecisionDate: "2026-03-01",
    });
    expect(d?.date).toBe("2026-05-05");
  });

  it("uses the version in force on the decision date (effective-date switchover)", () => {
    const base = catalog.find((r) => r.id === "medicare.alj_hearing.filing_window")!;
    const versions: Rule[] = [
      { ...base, effectiveTo: "2027-01-01" },
      { ...base, value: 90, effectiveFrom: "2027-01-01" },
    ];
    expect(resolveRule(base.id, "2026-12-31", versions).value).toBe(60);
    expect(resolveRule(base.id, "2027-01-01", versions).value).toBe(90);
  });

  it("keeps every level 2–5 rule flagged VERIFY", () => {
    const rules = catalog.filter((r) =>
      /^medicare\.(appeals|reconsideration|alj_hearing|council_review|judicial_review)\./.test(r.id),
    );
    expect(rules).toHaveLength(5);
    expect(rules.every((r) => r.verify)).toBe(true);
  });
});
