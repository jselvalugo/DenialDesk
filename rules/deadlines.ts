import { addCalendarDays, addMonths, daysBetween } from "./calendar";
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
}): Deadline | null {
  if (input.regime === "medicare") {
    const presumption = resolveRule("medicare.redetermination.receipt_presumption", input.noticeDate);
    const window = resolveRule("medicare.redetermination.filing_window", input.noticeDate);
    return {
      date: addCalendarDays(input.noticeDate, presumption.value + window.value),
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

const ELECTRONIC = [
  "fl.promptpay.electronic.pay_or_contest",
  "fl.promptpay.electronic.pay_or_deny",
  "fl.promptpay.electronic.uncontestable",
];
const PAPER = [
  "fl.promptpay.paper.pay_or_contest",
  "fl.promptpay.paper.pay_or_deny",
  "fl.promptpay.paper.uncontestable",
];

/**
 * Florida prompt-pay milestones counted from the payer's documented receipt date (R-3.1.1).
 * Returns null for regimes Florida prompt pay does not cover (Medicare, self-funded ERISA, …).
 */
export function promptPayMilestones(input: {
  regime: Regime;
  electronic: boolean;
  receivedDate: string;
}): Milestone[] | null {
  const ids = input.electronic ? ELECTRONIC : PAPER;
  const rules = ids.map((id) => resolveRule(id, input.receivedDate));
  if (!rules.every((rule) => appliesTo(rule, input.regime))) return null;
  return rules.map((rule) => ({ rule, date: addCalendarDays(input.receivedDate, rule.value) }));
}

export function timelyFilingDeadline(regime: Regime, serviceDate: string): Deadline | null {
  const id = regime === "medicare" ? "medicare.timely_filing" : "fl.timely_filing.initial";
  const rule = resolveRule(id, serviceDate);
  if (!appliesTo(rule, regime)) return null;
  return {
    date: addMonths(serviceDate, rule.value),
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
export function rulesForBasis(basis: string, asOf: string): Rule[] {
  if (basis === "payer_contract") return [];
  return basis.split("+").map((id) => resolveRule(id, asOf));
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

/** Medicare appeal levels after redetermination (REQUIREMENTS §4.2, R-4.2.1). */
export type MedicareAppealLevel = "reconsideration" | "alj_hearing" | "council_review" | "judicial_review";

const MEDICARE_LEVEL_WINDOW: Record<MedicareAppealLevel, string> = {
  reconsideration: "medicare.reconsideration.filing_window",
  alj_hearing: "medicare.alj_hearing.filing_window",
  council_review: "medicare.council_review.filing_window",
  judicial_review: "medicare.judicial_review.filing_window",
};

/** The level a party may request after a decision at the given level. */
export const MEDICARE_LEVEL_AFTER = {
  redetermination: "reconsideration",
  reconsideration: "alj_hearing",
  alj_hearing: "council_review",
  council_review: "judicial_review",
} as const satisfies Record<string, MedicareAppealLevel>;

/**
 * Deadline to request `nextLevel` of a Medicare appeal, counted from the prior level's decision
 * (notice) date: the 5-day receipt presumption plus the level's window, in calendar days — the same
 * convention as `appealDeadline` for redetermination. Rules resolve as in force on the decision
 * date. Returns null for any regime other than Medicare (MA and commercial appeals follow plan
 * documents and contracts).
 */
export function medicareNextLevelDeadline(input: {
  regime: Regime;
  nextLevel: MedicareAppealLevel;
  priorDecisionDate: string;
}): Deadline | null {
  const window = resolveRule(MEDICARE_LEVEL_WINDOW[input.nextLevel], input.priorDecisionDate);
  if (!appliesTo(window, input.regime)) return null;
  const presumption = resolveRule("medicare.appeals.receipt_presumption", input.priorDecisionDate);
  return {
    date: addCalendarDays(input.priorDecisionDate, presumption.value + window.value),
    basis: `${presumption.id}+${window.id}`,
    citation: window.citation,
    verify: presumption.verify || window.verify,
  };
}
