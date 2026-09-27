import { daysBetween } from "./calendar";
import { catalog } from "./catalog";
import { floridaRuleSet, payerResponseStatus, promptPayRuleIds, ruleDueDates } from "./deadlines";
import type { RollForwardPolicy } from "./roll-forward";
import { appliesTo, resolveRule } from "./engine";
import type { Regime, Rule } from "./types";

/**
 * Florida prompt-pay clock evaluator with late-payment interest (R-3.1.1, R-3.1.3, R-3.1.4).
 * Source: docs/REQUIREMENTS.md §3.1; behaviour per docs/reviews/2026-09-26-billing-structure-review.md F4.
 * Every value comes from the catalog; nothing statutory is written here.
 */

/**
 * "contest" = the payer contested the claim or requested more information. It is recorded by a
 * person; we do NOT infer contests from CARC/RARC (no cited mapping exists yet, F4).
 */
export type PayerResponseKind = "payment" | "denial" | "contest";

export interface PayerResponse {
  kind: PayerResponseKind;
  date: string;
  /** Payment amount in integer cents; required and > 0 for payments. */
  cents?: number;
}

/** met = on/before due; late = met after due; open = not due and not met; overdue = past due, not met. */
export type MilestoneState = "met" | "late" | "open" | "overdue";

export interface ClockMilestone {
  ruleId: string;
  title: string;
  citation: string;
  verify: boolean;
  /** Governing due date (unrolled until roll-forward is confirmed, OA-023). */
  due: string;
  /** Rolled due date, informational while pending counsel; null when it equals `due`. */
  rolledDue: string | null;
  state: MilestoneState;
  metOn: string | null;
  daysLate: number;
  daysRemaining: number | null;
}

export interface InterestLine {
  paymentDate: string;
  paidCents: number;
  dueDate: string;
  daysLate: number;
  ratePercent: number;
  interestCents: number;
  ruleId: string;
  verify: boolean;
}

export interface PromptPayClock {
  applies: boolean;
  receivedDate: string;
  electronic: boolean;
  milestones: ClockMilestone[];
  contested: boolean;
  paymentDue: string | null;
  /** Rolled payment-due date, informational while pending counsel; null when equal. */
  paymentDueRolled: string | null;
  uncontestable: boolean;
  providerResponseDue: string | null;
  /** Rolled provider-response date, informational while pending counsel; null when equal. */
  providerResponseDueRolled: string | null;
  interest: InterestLine[];
  interestCents: number;
  nextDue: ClockMilestone | null;
  state: "open" | "met" | "late" | "uncontestable";
}

function tryResolve(id: string, asOf: string, rules: Rule[]): Rule | null {
  try {
    return resolveRule(id, asOf, rules);
  } catch {
    return null;
  }
}

function milestone(
  rule: Rule,
  receivedDate: string,
  metOn: string | null,
  today: string,
  policy: RollForwardPolicy[] | undefined,
): ClockMilestone {
  const { date: due, rolledDate: rolledDue } = ruleDueDates(rule, receivedDate, policy);
  const base = {
    ruleId: rule.id,
    title: rule.title,
    citation: rule.citation,
    verify: rule.verify,
    due,
    rolledDue,
  };
  if (metOn !== null) {
    // Reuse payerResponseStatus: a response on the due date itself counts as met.
    const { met, daysLate } = payerResponseStatus(due, metOn);
    return { ...base, state: met ? "met" : "late", metOn, daysLate, daysRemaining: null };
  }
  const remaining = daysBetween(today, due);
  return remaining >= 0
    ? { ...base, state: "open", metOn: null, daysLate: 0, daysRemaining: remaining }
    : { ...base, state: "overdue", metOn: null, daysLate: -remaining, daysRemaining: remaining };
}

/**
 * Simple interest, rounded half-up to whole cents, in integer arithmetic (no floats on money):
 * paidCents × rate% × daysLate / 365. The rate is scaled to 1/10,000 of a percent.
 */
export function simpleInterestCents(paidCents: number, ratePercent: number, daysLate: number): number {
  const rateScaled = BigInt(Math.round(ratePercent * 10_000));
  const num = BigInt(paidCents) * rateScaled * BigInt(daysLate);
  const den = 365n * 100n * 10_000n;
  return Number((num * 2n + den) / (2n * den));
}

/**
 * Evaluate the Florida prompt-pay clock for one claim as of `today` (YYYY-MM-DD).
 *
 * - Regime: FL prompt pay applies only where every milestone rule lists the regime (FL insurer,
 *   FL HMO). Medicare, Medicare Advantage, self-funded ERISA, etc. return `applies: false`.
 * - Rules are resolved as in force on `receivedDate` (effective-dated); the interest rate is
 *   resolved as in force on each payment date.
 * - Responses dated after `today` are ignored (not yet happened as of the evaluation date).
 * - pay_or_contest is met by the first payment, denial or contest; pay_or_deny and uncontestable
 *   are met only by the first payment or denial — a contest does not stop them (F4).
 * - contested: a contest dated on/before the pay_or_contest due date.
 * - Due dates: the UNROLLED date governs until counsel confirms roll-forward (ROLL_FORWARD_POLICY,
 *   owner 2026-09-27 option 1, practice-favourable); the rolled date is reported as informational.
 * - paymentDue (⚠️ VERIFY, accrual start): pay_or_deny due if contested, else pay_or_contest due.
 *   Interest runs from the first calendar day after it (owner 2026-09-26).
 * - uncontestable (R-3.1.4): no payment or denial by the uncontestable due date.
 * - providerResponseDue: `fl.promptpay.<electronic|paper>.provider_response` counted from the first
 *   contest date (taken as the payer's notice date); null when there is no contest or no such rule
 *   (REQUIREMENTS §3.1 gives no paper value, so paper is null).
 * - Interest: each payment dated after paymentDue accrues simple interest for the days late.
 * - state: uncontestable wins; else late if any milestone late/overdue; else open if any open; else met.
 */
export function evaluatePromptPay(input: {
  regime: Regime;
  electronic: boolean;
  receivedDate: string;
  responses: PayerResponse[];
  today: string;
  /** Rule set to resolve from; defaults to the catalog (injectable for effective-date tests). */
  rules?: Rule[];
  /** Roll-forward policy; defaults to ROLL_FORWARD_POLICY (injectable for tests). */
  rollPolicy?: RollForwardPolicy[];
}): PromptPayClock {
  const rules = input.rules ?? catalog;
  const { receivedDate, electronic, today } = input;
  const empty: PromptPayClock = {
    applies: false,
    receivedDate,
    electronic,
    milestones: [],
    contested: false,
    paymentDue: null,
    paymentDueRolled: null,
    uncontestable: false,
    providerResponseDue: null,
    providerResponseDueRolled: null,
    interest: [],
    interestCents: 0,
    nextDue: null,
    state: "met",
  };

  // Regime check before rule lookup: MA, Medicare, ERISA etc. never resolve Florida rules.
  const set = floridaRuleSet(input.regime);
  if (set === null) return empty;
  const ids = promptPayRuleIds(input.regime, electronic);
  if (ids === null) throw new Error(`No prompt-pay rule ids for regime ${input.regime}`);
  const kind = electronic ? "electronic" : "paper";
  const [contestRule, denyRule, uncontestableRule] = ids.map((id) =>
    resolveRule(id, receivedDate, rules),
  ) as [Rule, Rule, Rule];
  if (![contestRule, denyRule, uncontestableRule].every((r) => appliesTo(r, input.regime))) return empty;

  for (const r of input.responses) {
    if (r.kind === "payment" && !(Number.isInteger(r.cents) && r.cents! > 0)) {
      throw new Error("A payment response needs a positive integer amount in cents");
    }
  }
  const responses = input.responses
    .filter((r) => r.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const firstAny = responses[0]?.date ?? null;
  const firstPayOrDeny = responses.find((r) => r.kind !== "contest")?.date ?? null;
  const firstContest = responses.find((r) => r.kind === "contest")?.date ?? null;

  const milestones = [
    milestone(contestRule, receivedDate, firstAny, today, input.rollPolicy),
    milestone(denyRule, receivedDate, firstPayOrDeny, today, input.rollPolicy),
    milestone(uncontestableRule, receivedDate, firstPayOrDeny, today, input.rollPolicy),
  ];
  const [contestM, denyM, uncontestableM] = milestones as [ClockMilestone, ClockMilestone, ClockMilestone];

  const contested = firstContest !== null && firstContest <= contestM.due;
  const paymentDue = contested ? denyM.due : contestM.due;
  const paymentDueRolled = contested ? denyM.rolledDue : contestM.rolledDue;
  const uncontestable = uncontestableM.state === "late" || uncontestableM.state === "overdue";

  const responseRule =
    firstContest === null
      ? null
      : tryResolve(`${set}.promptpay.${kind}.provider_response`, receivedDate, rules);
  const responseDue =
    responseRule && firstContest && appliesTo(responseRule, input.regime)
      ? ruleDueDates(responseRule, firstContest, input.rollPolicy)
      : null;

  const interest: InterestLine[] = [];
  for (const r of responses) {
    if (r.kind !== "payment") continue;
    const daysLate = daysBetween(paymentDue, r.date);
    if (daysLate <= 0) continue;
    const rate = resolveRule(`${set}.promptpay.interest_rate`, r.date, rules);
    interest.push({
      paymentDate: r.date,
      paidCents: r.cents!,
      dueDate: paymentDue,
      daysLate,
      ratePercent: rate.value,
      interestCents: simpleInterestCents(r.cents!, rate.value, daysLate),
      ruleId: rate.id,
      // Accrual start is our interpretation (⚠️ VERIFY), so lines stay flagged regardless.
      verify: true,
    });
  }

  const pending = milestones.filter((m) => m.state === "open" || m.state === "overdue");
  const nextDue = pending.reduce<ClockMilestone | null>(
    (a, m) => (a === null || m.due < a.due ? m : a),
    null,
  );
  const state = uncontestable
    ? "uncontestable"
    : milestones.some((m) => m.state === "late" || m.state === "overdue")
      ? "late"
      : milestones.some((m) => m.state === "open")
        ? "open"
        : "met";

  return {
    applies: true,
    receivedDate,
    electronic,
    milestones,
    contested,
    paymentDue,
    paymentDueRolled,
    uncontestable,
    providerResponseDue: responseDue?.date ?? null,
    providerResponseDueRolled: responseDue?.rolledDate ?? null,
    interest,
    interestCents: interest.reduce((sum, l) => sum + l.interestCents, 0),
    nextDue,
    state,
  };
}
