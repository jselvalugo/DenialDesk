import { catalog } from "./catalog";
import type { Regime, Rule } from "./types";

function inForce(rule: Rule, asOf: string): boolean {
  return (
    (rule.effectiveFrom === null || rule.effectiveFrom <= asOf) &&
    (rule.effectiveTo === null || asOf < rule.effectiveTo)
  );
}

/** The version of `id` in force on `asOf` (YYYY-MM-DD). Throws if none or if versions overlap. */
export function resolveRule(id: string, asOf: string, rules: Rule[] = catalog): Rule {
  const matches = rules.filter((rule) => rule.id === id && inForce(rule, asOf));
  if (matches.length === 0) throw new Error(`No rule "${id}" in force on ${asOf}`);
  if (matches.length > 1) throw new Error(`Overlapping versions of rule "${id}" on ${asOf}`);
  return matches[0]!;
}

export function appliesTo(rule: Rule, regime: Regime): boolean {
  return rule.regimes.includes(regime);
}
