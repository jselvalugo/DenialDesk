import {
  addCalendarDays,
  addMonths,
  daysBetween,
  holidayCalendars,
  rollForwardToBusinessDay,
} from "./calendar";
import { catalog } from "./catalog";
import { appliesTo, resolveRule } from "./engine";
import { ROLL_FORWARD_POLICY, rollForwardConfirmed, type RollForwardPolicy } from "./roll-forward";
import type { Regime, Rule } from "./types";

export interface Deadline {
  /** Governing date: used for alerts, sorting, "past deadline" and blocking. */
  date: string;
  /**
   * Weekend/holiday-rolled date while roll-forward is pending counsel (OA-034); informational
   * only. Null when it equals `date` or roll-forward is confirmed (then `date` is already rolled).
   */
  rolledDate: string | null;
  /** Rule IDs, or "payer_contract", that produced the date. */
  basis: string;
  citation: string;
  verify: boolean;
}

export interface DueDates {
  /** Governing date (see Deadline.date). */
  date: string;
  /** Last day of the period, before any roll-forward. */
  unrolled: string;
  /** Last day rolled forward per `rule.rollForward` (equals `unrolled` when it is a business day). */
  rolled: string;
  /** `rolled` when it differs from the governing date (roll-forward pending counsel); else null. */
  rolledDate: string | null;
}

/**
 * Last day of `rule`'s period counted from `anchorDate`. Months and years clamp to the last day of
 * the target month (Aug 31 + 6 months = Feb 28/29; Feb 29 + 1 year = Feb 28).
 *
 * Roll-forward past weekends/holidays per `rule.rollForward` (Fla. R. Gen. Prac. & Jud. Admin.
 * 2.514(a); CMS for Medicare; ⚠️ VERIFY) governs only once ROLL_FORWARD_POLICY is confirmed.
 * Until then (owner 2026-09-27, option 1) the UNROLLED date governs for both sides — provider
 * deadlines are earlier, payer lateness and interest start sooner — and the rolled date is
 * returned as `rolledDate` for display "(pending counsel)".
 */
export function ruleDueDates(
  rule: Rule,
  anchorDate: string,
  policy: RollForwardPolicy[] = ROLL_FORWARD_POLICY,
): DueDates {
  let unrolled: string;
  if (rule.unit === "calendar_days") unrolled = addCalendarDays(anchorDate, rule.value);
  else if (rule.unit === "months") unrolled = addMonths(anchorDate, rule.value);
  else if (rule.unit === "years") unrolled = addMonths(anchorDate, rule.value * 12);
  else throw new Error(`Rule "${rule.id}" (${rule.unit}) is not a date period`);
  const rolled =
    rule.rollForward === "none"
      ? unrolled
      : rollForwardToBusinessDay(unrolled, holidayCalendars[rule.rollForward]);
  const date = rollForwardConfirmed(unrolled, policy) ? rolled : unrolled;
  return { date, unrolled, rolled, rolledDate: rolled !== date ? rolled : null };
}

/** Governing due date of `rule` from `anchorDate` (see ruleDueDates). */
export function ruleDueDate(
  rule: Rule,
  anchorDate: string,
  policy: RollForwardPolicy[] = ROLL_FORWARD_POLICY,
): string {
  return ruleDueDates(rule, anchorDate, policy).date;
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
  rollPolicy?: RollForwardPolicy[];
}): Deadline | null {
  if (input.regime === "medicare") {
    const rules = input.rules ?? catalog;
    const presumption = resolveRule("medicare.redetermination.receipt_presumption", input.noticeDate, rules);
    const window = resolveRule("medicare.redetermination.filing_window", input.noticeDate, rules);
    const due = ruleDueDates(
      window,
      ruleDueDate(presumption, input.noticeDate, input.rollPolicy),
      input.rollPolicy,
    );
    return {
      date: due.date,
      rolledDate: due.rolledDate,
      basis: `${presumption.id}+${window.id}`,
      citation: window.citation,
      verify: presumption.verify || window.verify,
    };
  }
  if (input.payerAppealWindowDays === null) return null;
  return {
    date: addCalendarDays(input.noticeDate, input.payerAppealWindowDays),
    rolledDate: null,
    basis: "payer_contract",
    citation: "Payer contract",
    verify: false,
  };
}

export interface Milestone {
  rule: Rule;
  /** Governing date (unrolled until roll-forward is confirmed). */
  date: string;
  /** Rolled date pending counsel, informational; null when it equals `date`. */
  rolledDate: string | null;
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
  rollPolicy?: RollForwardPolicy[];
}): Milestone[] | null {
  const ids = promptPayRuleIds(input.regime, input.electronic);
  if (ids === null) return null;
  const rules = ids.map((id) => resolveRule(id, input.receivedDate, input.rules ?? catalog));
  if (!rules.every((rule) => appliesTo(rule, input.regime))) return null;
  return rules.map((rule) => {
    const due = ruleDueDates(rule, input.receivedDate, input.rollPolicy);
    return { rule, date: due.date, rolledDate: due.rolledDate };
  });
}

/**
 * Initial-claim timely-filing deadline from the date of service. Owner (2026-09-26, ⚠️ counsel):
 * the claim is timely if *submitted* by this date, evidenced by the clearinghouse acknowledgement.
 */
export function timelyFilingDeadline(
  regime: Regime,
  serviceDate: string,
  rules: Rule[] = catalog,
  rollPolicy: RollForwardPolicy[] = ROLL_FORWARD_POLICY,
): Deadline | null {
  const set = floridaRuleSet(regime);
  const id = regime === "medicare" ? "medicare.timely_filing" : set ? `${set}.timely_filing.initial` : null;
  if (id === null) return null;
  const rule = resolveRule(id, serviceDate, rules);
  if (!appliesTo(rule, regime)) return null;
  const due = ruleDueDates(rule, serviceDate, rollPolicy);
  return {
    date: due.date,
    rolledDate: due.rolledDate,
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
 * The rolled date behind a stored governing deadline while roll-forward is pending counsel, or
 * null. `basisRules` are rulesForBasis(...); the last rule is the one whose last day could roll.
 */
export function pendingRolledDate(
  date: string,
  basisRules: Rule[],
  policy: RollForwardPolicy[] = ROLL_FORWARD_POLICY,
): string | null {
  const last = basisRules.at(-1);
  if (!last || last.rollForward === "none" || rollForwardConfirmed(date, policy)) return null;
  const rolled = rollForwardToBusinessDay(date, holidayCalendars[last.rollForward]);
  return rolled !== date ? rolled : null;
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
 * convention as `appealDeadline` for redetermination. The unrolled date governs while roll-forward
 * is pending counsel (option 1); the federal-holiday-rolled date is returned as `rolledDate`. Rules resolve as in force on the decision
 * date. Returns null for any regime other than Medicare (MA and commercial appeals follow plan
 * documents and contracts).
 */
export function medicareNextLevelDeadline(input: {
  regime: Regime;
  nextLevel: MedicareAppealLevel;
  priorDecisionDate: string;
  rules?: Rule[];
  rollPolicy?: RollForwardPolicy[];
}): Deadline | null {
  const rules = input.rules ?? catalog;
  const window = resolveRule(MEDICARE_LEVEL_WINDOW[input.nextLevel], input.priorDecisionDate, rules);
  if (!appliesTo(window, input.regime)) return null;
  const presumption = resolveRule("medicare.appeals.receipt_presumption", input.priorDecisionDate, rules);
  // Same path as appealDeadline: unrolled date governs while roll-forward is pending (option 1).
  const due = ruleDueDates(
    window,
    ruleDueDate(presumption, input.priorDecisionDate, input.rollPolicy),
    input.rollPolicy,
  );
  return {
    date: due.date,
    rolledDate: due.rolledDate,
    basis: `${presumption.id}+${window.id}`,
    citation: window.citation,
    verify: presumption.verify || window.verify,
  };
}
