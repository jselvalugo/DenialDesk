import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { resolveRule } from "./engine";
import type { Rule } from "./types";

const base: Rule = {
  id: "test.rule",
  title: "Test",
  citation: "Test § 1",
  regimes: ["fl_insurer"],
  value: 10,
  unit: "calendar_days",
  effectiveFrom: null,
  effectiveTo: "2027-01-01",
  verify: true,
};
const next: Rule = { ...base, value: 15, effectiveFrom: "2027-01-01", effectiveTo: null };

describe("resolveRule", () => {
  it("picks the version in force: day before, day of, and day after a change", () => {
    expect(resolveRule("test.rule", "2026-12-31", [base, next]).value).toBe(10);
    expect(resolveRule("test.rule", "2027-01-01", [base, next]).value).toBe(15);
    expect(resolveRule("test.rule", "2027-01-02", [base, next]).value).toBe(15);
  });

  it("throws for unknown rules and overlapping versions", () => {
    expect(() => resolveRule("missing", "2026-01-01", [base])).toThrow(/No rule/);
    expect(() => resolveRule("test.rule", "2026-06-01", [base, { ...base, value: 11 }])).toThrow(
      /Overlapping/,
    );
  });
});

describe("catalog", () => {
  it("gives every rule a citation and keeps every rule flagged for counsel review", () => {
    for (const rule of catalog) {
      expect(rule.citation.length, rule.id).toBeGreaterThan(0);
      expect(rule.verify, rule.id).toBe(true);
    }
  });

  it("has no overlapping versions", () => {
    for (const rule of catalog) {
      const asOf = rule.effectiveFrom ?? "2026-09-26";
      expect(() => resolveRule(rule.id, asOf)).not.toThrow();
    }
  });
});
