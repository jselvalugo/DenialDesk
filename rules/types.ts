export type Regime =
  | "fl_insurer"
  | "fl_hmo"
  | "erisa_self_funded"
  | "medicare"
  | "medicare_advantage"
  | "medicaid_ffs"
  | "smmc"
  | "workers_comp"
  | "pip";

export type RuleUnit =
  | "calendar_days"
  | "business_days"
  | "months"
  | "years"
  /** "Within N hours after the beginning of the next business day" (§ 627.6131(4)(a)). Catalog only. */
  | "hours_after_next_business_day"
  | "percent_per_year";

/** The event a clock counts from. Anchors used to live implicitly in callers (review §4.2). */
export type RuleAnchor =
  | "service_date"
  | "payer_receipt"
  | "notice_date"
  | "presumed_notice_receipt"
  | "contest_notice"
  | "primary_final_determination"
  | "overpayment_demand_receipt"
  | "payment_date"
  | "overpayment_determined"
  | "payment_due_date"
  | "prior_decision_receipt";

/**
 * What happens when a computed last day is not a business day (owner decision 2026-09-26, ⚠️ counsel):
 * - "fl_legal_holiday": next day that is not a weekend or Florida legal holiday (Fla. R. Gen. Prac. &
 *   Jud. Admin. 2.514(a)(3)).
 * - "federal_holiday": next federal workday (CMS; 5 U.S.C. § 6103 holidays).
 * - "none": no roll-forward (intermediate steps, rates, and thresholds).
 */
export type RollForward = "fl_legal_holiday" | "federal_holiday" | "none";

/** A human's record that counsel confirmed a rule version. Only a human sets it (R-15.6). */
export interface Confirmation {
  by: string;
  on: string;
  note?: string;
}

export interface Rule {
  /** Stable ID, e.g. "fl.insurer.electronic.pay_or_contest". Versions share the ID. */
  id: string;
  title: string;
  /** Statute or regulation, e.g. "Fla. Stat. § 627.6131(4)(b)". */
  citation: string;
  regimes: Regime[];
  /** For percent_per_year this is a percent (12 = 12 %); money math must stay in integer cents. */
  value: number;
  unit: RuleUnit;
  anchor: RuleAnchor | null;
  rollForward: RollForward;
  /** First date this version applies (inclusive). Null = in force before our baseline; exact start unconfirmed. */
  effectiveFrom: string | null;
  /** Last date this version applies (exclusive). Null = still in force. */
  effectiveTo: string | null;
  /** True until Florida healthcare counsel confirms the value (R-15.6). Only a human clears it. */
  verify: boolean;
  verifyNote?: string;
  /** Counsel's confirmation; null until recorded. Clearing `verify` requires this. */
  confirmedBy: Confirmation | null;
}
