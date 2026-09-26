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

export type RuleUnit = "calendar_days" | "months" | "percent_per_year";

export interface Rule {
  /** Stable ID, e.g. "fl.insurer.electronic.pay_or_contest". Versions share the ID. */
  id: string;
  title: string;
  /** Statute or regulation, e.g. "Fla. Stat. § 627.6131(4)(b)". */
  citation: string;
  regimes: Regime[];
  value: number;
  unit: RuleUnit;
  /** First date this version applies (inclusive). Null = in force before our baseline; exact start unconfirmed. */
  effectiveFrom: string | null;
  /** Last date this version applies (exclusive). Null = still in force. */
  effectiveTo: string | null;
  /** True until Florida healthcare counsel confirms the value (R-15.6). Only a human clears it. */
  verify: boolean;
  verifyNote?: string;
}
