import { describe, expect, it } from "vitest";
import type { Rule } from "@rules/types";
import { ruleExists, ruleReference, ruleValueText } from "./rule-tokens";

const base: Omit<Rule, "id" | "value" | "unit"> = {
  title: "t",
  citation: "Fla. Stat. § 0",
  regimes: ["fl_insurer"],
  anchor: null,
  rollForward: "none",
  side: "provider",
  effectiveFrom: null,
  effectiveTo: null,
  verify: true,
  confirmedBy: null,
};

describe("ruleValueText", () => {
  it.each([
    [20, "calendar_days", "20 calendar days"],
    [1, "calendar_days", "1 calendar day"],
    [6, "months", "6 months"],
    [1, "years", "1 year"],
    [24, "hours_after_next_business_day", "24 hours after the start of the next business day"],
    [12, "percent_per_year", "12% per year"],
  ] as const)("%s %s → %s", (value, unit, text) => {
    expect(ruleValueText({ ...base, id: "x", value, unit })).toBe(text);
  });
});

describe("ruleReference", () => {
  it("resolves the version in force on the date and reports the verify flag", () => {
    const rules: Rule[] = [
      { ...base, id: "x", value: 10, unit: "calendar_days", effectiveTo: "2026-01-01" },
      { ...base, id: "x", value: 12, unit: "calendar_days", effectiveFrom: "2026-01-01", verify: false },
    ];
    expect(ruleReference("x", "2025-12-31", rules)).toMatchObject({
      valueText: "10 calendar days",
      unconfirmed: true,
    });
    expect(ruleReference("x", "2026-01-01", rules)).toMatchObject({
      valueText: "12 calendar days",
      unconfirmed: false,
    });
  });

  it("effective dating is a boundary: nothing the day before effectiveFrom, the value on the day", () => {
    const rules: Rule[] = [
      { ...base, id: "x", value: 30, unit: "calendar_days", effectiveFrom: "2026-01-01" },
    ];
    expect(ruleReference("x", "2025-12-31", rules)).toBeNull();
    expect(ruleReference("x", "2026-01-01", rules)?.valueText).toBe("30 calendar days");
    expect(ruleReference("x", "2026-01-02", rules)?.valueText).toBe("30 calendar days");
  });

  it("returns null for an unknown rule or a date with no version in force", () => {
    const rules: Rule[] = [{ ...base, id: "x", value: 1, unit: "months", effectiveFrom: "2026-01-01" }];
    expect(ruleReference("nope", "2026-06-01", rules)).toBeNull();
    expect(ruleReference("x", "2025-06-01", rules)).toBeNull();
    expect(ruleExists("x", rules)).toBe(true);
    expect(ruleExists("nope", rules)).toBe(false);
  });

  it("reads the real catalog: the Florida initial timely-filing rule is cited", () => {
    const reference = ruleReference("fl.timely_filing.initial", "2026-09-27");
    expect(reference?.citation).toContain("627.6131");
    expect(reference?.valueText).toMatch(/months?$/);
  });
});
