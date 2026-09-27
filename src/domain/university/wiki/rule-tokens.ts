import { catalog } from "@rules/catalog";
import { resolveRule } from "@rules/engine";
import type { Rule, RuleUnit } from "@rules/types";

/**
 * What a `{{rule:<id>}}` token renders as: the value of the rule version in force on `asOf`, its
 * unit in words, its citation, and whether counsel has confirmed it. The Wiki never types a legal
 * value itself (CLAUDE.md, R-15.6); this is the only way a number from `rules/` reaches an article.
 */
export interface RuleReference {
  id: string;
  title: string;
  /** The number alone, e.g. "20" or "12%". */
  value: string;
  /** The unit in words, e.g. "calendar days" or "per year". */
  unit: string;
  /** e.g. "20 calendar days", "6 months", "12% per year". */
  valueText: string;
  citation: string;
  /** True until a human records counsel's confirmation on the rule. */
  unconfirmed: boolean;
  verifyNote?: string;
}

function unitText(value: number, unit: RuleUnit): string {
  const one = value === 1;
  switch (unit) {
    case "calendar_days":
      return one ? "calendar day" : "calendar days";
    case "business_days":
      return one ? "business day" : "business days";
    case "months":
      return one ? "month" : "months";
    case "years":
      return one ? "year" : "years";
    case "hours_after_next_business_day":
      return one
        ? "hour after the start of the next business day"
        : "hours after the start of the next business day";
    case "percent_per_year":
      return "per year";
  }
}

export function ruleValueParts(rule: Rule): { value: string; unit: string } {
  return {
    value: rule.unit === "percent_per_year" ? `${rule.value}%` : String(rule.value),
    unit: unitText(rule.value, rule.unit),
  };
}

export function ruleValueText(rule: Rule): string {
  const parts = ruleValueParts(rule);
  return `${parts.value} ${parts.unit}`;
}

export function ruleExists(id: string, rules: Rule[] = catalog): boolean {
  return rules.some((rule) => rule.id === id);
}

/** The reference for `id` as of `asOf` (YYYY-MM-DD), or null when no version is in force that day. */
export function ruleReference(id: string, asOf: string, rules: Rule[] = catalog): RuleReference | null {
  let rule: Rule;
  try {
    rule = resolveRule(id, asOf, rules);
  } catch {
    return null;
  }
  return {
    id: rule.id,
    title: rule.title,
    ...ruleValueParts(rule),
    valueText: ruleValueText(rule),
    citation: rule.citation,
    unconfirmed: rule.verify,
    verifyNote: rule.verifyNote,
  };
}

export function ruleReferences(
  ids: string[],
  asOf: string,
  rules: Rule[] = catalog,
): Map<string, RuleReference | null> {
  return new Map(ids.map((id) => [id, ruleReference(id, asOf, rules)]));
}
