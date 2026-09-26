import type { RuleMatch } from "./engine";

/**
 * DenialDesk's starter accounting configuration for a Florida physician practice
 * (docs/specs/revenue-cycle-accounting.md). It is a starting point the practice reviews on the
 * Rules page, not payer or legal rules: account numbers and names are an illustrative chart that
 * each practice maps to its own general ledger (⚠️ VERIFY with the practice's accountant), and
 * payer-class codes stand for the financial-class values in the practice's PM export.
 */
export const DEFAULTS_SOURCE = "DenialDesk starter configuration v1 (2026-09-26)";

export type GlKind = "cash" | "ar" | "revenue" | "adjustment";

export interface DefaultGlAccount {
  number: string;
  name: string;
  kind: GlKind;
  revenueGl?: string;
  adjustmentGl?: string;
  isDefaultAr?: boolean;
}

/** One receivable per line-of-business family (REQUIREMENTS §1.3), each with its own revenue pair. */
export const DEFAULT_GL_ACCOUNTS: DefaultGlAccount[] = [
  { number: "1000", name: "Cash — operating account", kind: "cash" },
  { number: "1050", name: "Patient payments clearing", kind: "cash" },
  {
    number: "1200",
    name: "Patient receivables — commercial and HMO",
    kind: "ar",
    revenueGl: "4000",
    adjustmentGl: "4050",
    isDefaultAr: true,
  },
  {
    number: "1210",
    name: "Patient receivables — Medicare and Medicare Advantage",
    kind: "ar",
    revenueGl: "4100",
    adjustmentGl: "4150",
  },
  {
    number: "1220",
    name: "Patient receivables — Medicaid",
    kind: "ar",
    revenueGl: "4200",
    adjustmentGl: "4250",
  },
  {
    number: "1230",
    name: "Patient receivables — workers' compensation and auto PIP",
    kind: "ar",
    revenueGl: "4300",
    adjustmentGl: "4350",
  },
  {
    number: "1240",
    name: "Patient receivables — patient responsibility",
    kind: "ar",
    revenueGl: "4400",
    adjustmentGl: "4450",
  },
  { number: "4000", name: "Patient service revenue — commercial and HMO", kind: "revenue" },
  { number: "4050", name: "Adjustments and write-offs — commercial and HMO", kind: "adjustment" },
  { number: "4100", name: "Patient service revenue — Medicare", kind: "revenue" },
  { number: "4150", name: "Adjustments and write-offs — Medicare", kind: "adjustment" },
  { number: "4200", name: "Patient service revenue — Medicaid", kind: "revenue" },
  { number: "4250", name: "Adjustments and write-offs — Medicaid", kind: "adjustment" },
  { number: "4300", name: "Patient service revenue — workers' compensation and PIP", kind: "revenue" },
  { number: "4350", name: "Adjustments and write-offs — workers' compensation and PIP", kind: "adjustment" },
  { number: "4400", name: "Patient service revenue — self-pay", kind: "revenue" },
  { number: "4450", name: "Adjustments and write-offs — self-pay", kind: "adjustment" },
  { number: "4900", name: "Prompt-pay interest income", kind: "revenue" },
  { number: "4990", name: "Voided charges and corrections", kind: "adjustment" },
];

export type PayerRegime =
  | "fl_insurer"
  | "fl_hmo"
  | "erisa_self_funded"
  | "medicare"
  | "medicare_advantage"
  | "medicaid_ffs"
  | "smmc"
  | "workers_comp"
  | "pip";

export interface DefaultPayerClass {
  code: string;
  name: string;
  arGl: string | null;
  /** Links the class to the practice's first DenialDesk payer with this regime, when there is one. */
  regime?: PayerRegime;
}

/** One class per regulatory regime DenialDesk tracks (REQUIREMENTS §1.3, §8.1), plus self-pay. */
export const DEFAULT_PAYER_CLASSES: DefaultPayerClass[] = [
  { code: "COMM", name: "Commercial (Florida-insured)", arGl: null, regime: "fl_insurer" },
  { code: "HMO", name: "Florida HMO", arGl: null, regime: "fl_hmo" },
  { code: "ERISA", name: "Self-funded employer plan (ERISA)", arGl: null, regime: "erisa_self_funded" },
  { code: "MCR", name: "Medicare Part B", arGl: "1210", regime: "medicare" },
  { code: "MA", name: "Medicare Advantage", arGl: "1210", regime: "medicare_advantage" },
  { code: "MCD", name: "Medicaid fee-for-service", arGl: "1220", regime: "medicaid_ffs" },
  { code: "SMMC", name: "Medicaid managed care (SMMC)", arGl: "1220", regime: "smmc" },
  { code: "WC", name: "Workers' compensation", arGl: "1230", regime: "workers_comp" },
  { code: "PIP", name: "Auto PIP (no-fault)", arGl: "1230", regime: "pip" },
  { code: "SELF", name: "Self-pay", arGl: "1240" },
];

export interface DefaultRule {
  code: string;
  name: string;
  description: string;
  priority: number;
  match: RuleMatch;
  arGl: string | null;
  revenueGl: string | null;
  adjustmentGl: string | null;
}

const rule = (r: Omit<DefaultRule, "arGl" | "revenueGl" | "adjustmentGl"> & Partial<DefaultRule>) =>
  ({ arGl: null, revenueGl: null, adjustmentGl: null, ...r }) as DefaultRule;

/**
 * Starter rules, first match wins. Rules only choose accounts; amounts always post as recorded.
 * Receivable, revenue, and adjustment accounts come from the line's financial class unless a rule
 * overrides them. Priorities leave gaps so a practice can insert its own rules.
 */
export const DEFAULT_RULES: DefaultRule[] = [
  rule({
    code: "PROMPT_PAY_INTEREST",
    name: "Prompt-pay interest",
    description:
      'Late-payment interest a payer adds to a claim payment is interest income, not patient service revenue. ⚠️ VERIFY how your system marks interest lines; any description containing "interest" matches.',
    priority: 10,
    match: {
      any: [
        { op: "equals", field: "status", value: "INTEREST" },
        { op: "contains", field: "description", value: "interest" },
      ],
    },
    revenueGl: "4900",
  }),
  rule({
    code: "VOIDED",
    name: "Voided charges",
    description:
      "A charge voided in the practice-management system: its reversal posts to voids and corrections, so it isn't counted as a payer write-off. ⚠️ VERIFY the status values your system uses.",
    priority: 20,
    match: { any: [{ op: "in", field: "status", values: ["VOID", "VOIDED"] }] },
    adjustmentGl: "4990",
  }),
  rule({
    code: "STANDARD",
    name: "Standard charges",
    description: "Every other line, routed by financial class.",
    priority: 1000,
    match: { always: true },
  }),
];
