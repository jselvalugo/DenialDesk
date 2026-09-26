import {
  addCalendarDays,
  addMonths,
  daysBetween,
  holidayCalendars,
  rollForwardToBusinessDay,
} from "./calendar";
import { catalog } from "./catalog";
import { appliesTo, resolveRule } from "./engine";
import type { Regime, Rule } from "./types";

export interface Deadline {
  date: string;
  /** Rule IDs, or "payer_contract", that produced the date. */
  basis: string;
  citation: string;
  verify: boolean;
}

/**
 * Last day of `rule`'s period counted from `anchorDate`, then rolled forward per `rule.rollForward`
 * when it lands on a weekend or holiday (Fla. R. Gen. Prac. & Jud. Admin. 2.514(a); CMS for
 * Medicare; ⚠️ VERIFY). Months and years clamp to the last day of the target month
 * (Aug 31 + 6 months = Feb 28/29; Feb 29 + 1 year = Feb 28).
 */
export function ruleDueDate(rule: Rule, anchorDate: string): string {
  let date: string;
  if (rule.unit === "calendar_days") date = addCalendarDays(anchorDate, rule.value);
  else if (rule.unit === "months") date = addMonths(anchorDate, rule.value);
  else if (rule.unit === "years") date = addMonths(anchorDate, rule.value * 12);
  else throw new Error(`Rule "${rule.id}" (${rule.unit}) is not a date period`);
  return rule.rollForward === "none"
    ? date
    : rollForwardToBusinessDay(date, holidayCalendars[rule.rollForward]);
}

/**
 * Regime check before rule lookup (review §4.2): the rule-set prefix for Florida prompt pay, or
 * null where it does not apply. Medicare, Medicare Advantage (owner 2026-09-26: plan contract
 * governs; ⚠️ counsel), self-funded ERISA and others are never under Florida prompt pay.
 */
export function floridaRuleSet(regime: Regime): "fl" | "fl.hmo" | null {
  if (regime === "fl_insurer") return "fl";
  if (regime === "fl_hmo") return "fl.hmo";
  return null;
}

/**
 * Appeal deadline for a denial.
 * - Medicare Part B: redetermination window from presumed receipt of the notice (42 CFR § 405.942).
 * - Everyone else: the appeal window configured from the payer contract, if any. We don't infer
 *   commercial or Medicare Advantage appeal windows — they come from contracts and plan documents.
 *
 * `regime` here is a verified `Regime`, never null: callers must not invoke this for a payer whose
 * regime hasn't been verified (spec: payer-catalog P1 — a payer's `regime` column is nullable until
 * a human confirms it). Check `payer.regime !== null` (or `assertPayerVerified` /
 * `isPayerVerified`, `src/domain/payers/verification.ts`) before calling.
 */
export function appealDeadline(input: {
  regime: Regime;
  noticeDate: string;
  payerAppealWindowDays: number | null;
  rules?: Rule[];
}): Deadline | null {
  if (input.regime === "medicare") {
    const rules = input.rules ?? catalog;
    const presumption = resolveRule("medicare.redetermination.receipt_presumption", input.noticeDate, rules);
    const window = resolveRule("medicare.redetermination.filing_window", input.noticeDate, rules);
    return {
      date: ruleDueDate(window, ruleDueDate(presumption, input.noticeDate)),
      basis: `${presumption.id}+${window.id}`,
      citation: window.citation,
      verify: presumption.verify || window.verify,
    };
  }
  if (input.payerAppealWindowDays === null) return null;
  return {
    date: addCalendarDays(input.noticeDate, input.payerAppealWindowDays),
    basis: "payer_contract",
    citation: "Payer contract",
    verify: false,
  };
}

export interface Milestone {
  rule: Rule;
  date: string;
}

/** Prompt-pay milestone rule IDs for a regime and claim medium, or null outside FL prompt pay. */
export function promptPayRuleIds(regime: Regime, electronic: boolean): string[] | null {
  const set = floridaRuleSet(regime);
  if (set === null) return null;
  const kind = electronic ? "electronic" : "paper";
  return ["pay_or_contest", "pay_or_deny", "uncontestable"].map((m) => `${set}.promptpay.${kind}.${m}`);
}

/**
 * Florida prompt-pay milestones counted from the payer's documented receipt date (R-3.1.1).
 * Returns null for regimes Florida prompt pay does not cover (Medicare, self-funded ERISA, …).
 */
export function promptPayMilestones(input: {
  regime: Regime;
  electronic: boolean;
  receivedDate: string;
  rules?: Rule[];
}): Milestone[] | null {
  const ids = promptPayRuleIds(input.regime, input.electronic);
  if (ids === null) return null;
  const rules = ids.map((id) => resolveRule(id, input.receivedDate, input.rules ?? catalog));
  if (!rules.every((rule) => appliesTo(rule, input.regime))) return null;
  return rules.map((rule) => ({ rule, date: ruleDueDate(rule, input.receivedDate) }));
}

/**
 * Initial-claim timely-filing deadline from the date of service. Owner (2026-09-26, ⚠️ counsel):
 * the claim is timely if *submitted* by this date, evidenced by the clearinghouse acknowledgement.
 */
export function timelyFilingDeadline(
  regime: Regime,
  serviceDate: string,
  rules: Rule[] = catalog,
): Deadline | null {
  const set = floridaRuleSet(regime);
  const id = regime === "medicare" ? "medicare.timely_filing" : set ? `${set}.timely_filing.initial` : null;
  if (id === null) return null;
  const rule = resolveRule(id, serviceDate, rules);
  if (!appliesTo(rule, regime)) return null;
  return {
    date: ruleDueDate(rule, serviceDate),
    basis: rule.id,
    citation: rule.citation,
    verify: rule.verify,
  };
}

/** Days from `today` until `deadline`: positive = remaining, 0 = due today, negative = overdue. */
export function daysUntil(deadline: string, today: string): number {
  return daysBetween(today, deadline);
}

/** The rules behind a stored deadline basis ("ruleA+ruleB"), as in force on `asOf`. */
export function rulesForBasis(basis: string, asOf: string, rules: Rule[] = catalog): Rule[] {
  if (basis === "payer_contract") return [];
  return basis.split("+").map((id) => resolveRule(id, asOf, rules));
}

/**
 * Whether a payer response (e.g. the denial notice date) met a prompt-pay milestone.
 * Responding on the milestone date itself counts as met.
 */
export function payerResponseStatus(
  milestoneDate: string,
  responseDate: string,
): { met: boolean; daysLate: number } {
  const daysLate = Math.max(0, daysBetween(milestoneDate, responseDate));
  return { met: daysLate === 0, daysLate };
}
