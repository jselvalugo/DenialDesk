import type { RuleMatch } from "./engine";

/**
 * Default accounting configuration seeded for a practice. Source: the owner's RevCycle IQ build
 * (Google Drive "Revenue Cycle Integration": `artifacts/api-server/src/lib/rulesEngine.ts` and
 * `replit.md`, 2026-05-05). These are the practice's accounting policies, not payer or legal
 * rules; every practice can review them on the Rules page. Account and payer-class *names* are
 * descriptive labels added here — ⚠️ VERIFY against the practice's chart of accounts.
 */
export const DEFAULTS_SOURCE = "RevCycle IQ rulesEngine.ts (2026-05-05)";

export type GlKind = "cash" | "ar" | "revenue" | "adjustment";

export interface DefaultGlAccount {
  number: string;
  name: string;
  kind: GlKind;
  revenueGl?: string;
  adjustmentGl?: string;
  isDefaultAr?: boolean;
}

export const DEFAULT_GL_ACCOUNTS: DefaultGlAccount[] = [
  { number: "1010", name: "Cash — operating account", kind: "cash" },
  {
    number: "1310",
    name: "Accounts receivable — insurance",
    kind: "ar",
    revenueGl: "5210",
    adjustmentGl: "5211",
    isDefaultAr: true,
  },
  {
    number: "1320",
    name: "Accounts receivable — self-pay",
    kind: "ar",
    revenueGl: "5410",
    adjustmentGl: "5411",
  },
  {
    number: "1330",
    name: "Accounts receivable — Medicare, Medicaid, and FQHC",
    kind: "ar",
    revenueGl: "5310",
    adjustmentGl: "5311",
  },
  { number: "5210", name: "Patient service revenue — insurance", kind: "revenue" },
  { number: "5211", name: "Contractual adjustments — insurance", kind: "adjustment" },
  { number: "5310", name: "Patient service revenue — Medicare and Medicaid", kind: "revenue" },
  { number: "5311", name: "Contractual adjustments — Medicare and Medicaid", kind: "adjustment" },
  { number: "5410", name: "Patient service revenue — self-pay", kind: "revenue" },
  { number: "5411", name: "Adjustments — self-pay", kind: "adjustment" },
  { number: "5520", name: "Interest income", kind: "revenue" },
];

const MEDICARE_SET = ["MCR", "MCRMCF", "MCRMCC", "MCDMCC"];
const SELF_PAY_SET = ["Patient", "SPY", "SELF", "SELFPAY"];
const CAPITATION_SET = ["MCDMCC", "MCRMCC"];
const CASH_BASIS_SET = ["COPYC", "ESPEJ", "CERTM"];

export interface DefaultPayerClass {
  code: string;
  name: string;
  arGl: string | null;
  /** Links the class to DenialDesk payers with this regime, when the practice has one. */
  regime?: "medicare" | "medicare_advantage" | "fl_insurer" | "fl_hmo";
}

export const DEFAULT_PAYER_CLASSES: DefaultPayerClass[] = [
  { code: "MCR", name: "Medicare", arGl: "1330", regime: "medicare" },
  {
    code: "MCRMCF",
    name: "Medicare managed care (fee for service)",
    arGl: "1330",
    regime: "medicare_advantage",
  },
  { code: "MCRMCC", name: "Medicare managed care (capitated)", arGl: "1330" },
  { code: "MCDMCC", name: "Medicaid managed care (capitated)", arGl: "1330" },
  { code: "COM", name: "Commercial insurance", arGl: null, regime: "fl_insurer" },
  { code: "HMO", name: "Commercial HMO", arGl: null, regime: "fl_hmo" },
  { code: "COPYC", name: "Cash-basis program (COPYC)", arGl: null },
  { code: "ESPEJ", name: "Cash-basis program (ESPEJ)", arGl: null },
  { code: "CERTM", name: "Cash-basis program (CERTM)", arGl: null },
  { code: "Patient", name: "Self-pay (patient)", arGl: null },
  { code: "SPY", name: "Self-pay (SPY)", arGl: null },
  { code: "SELF", name: "Self-pay (SELF)", arGl: null },
  { code: "SELFPAY", name: "Self-pay (SELFPAY)", arGl: null },
];

export interface DefaultRule {
  code: string;
  name: string;
  description: string;
  priority: number;
  match: RuleMatch;
  contraBps: number;
  excluded: boolean;
  arGl: string | null;
  revenueGl: string | null;
  adjustmentGl: string | null;
}

const rule = (r: Omit<DefaultRule, "arGl" | "revenueGl" | "adjustmentGl"> & Partial<DefaultRule>) =>
  ({ arGl: null, revenueGl: null, adjustmentGl: null, ...r }) as DefaultRule;

/** The 12 RevCycle IQ rules, in their original order (first match wins). */
export const DEFAULT_RULES: DefaultRule[] = [
  rule({
    code: "INTEREST",
    name: "Interest",
    description: "Interest lines post to interest income, not patient revenue.",
    priority: 1,
    match: {
      any: [
        { op: "equals", field: "status", value: "INTEC" },
        { op: "contains", field: "description", value: "interest" },
      ],
    },
    contraBps: 0,
    excluded: false,
    arGl: "1330",
    revenueGl: "5520",
  }),
  rule({
    code: "CASH_BASIS_OTHER",
    name: "Cash-basis programs",
    description: "Recognized when cash is received; no contractual adjustment.",
    priority: 2,
    match: { any: [{ op: "in", field: "payer_class", values: CASH_BASIS_SET }] },
    contraBps: 0,
    excluded: false,
  }),
  rule({
    code: "EXCL_51CR",
    name: "Status 51CR",
    description: "Fully adjusted and excluded from standard AR.",
    priority: 3,
    match: { any: [{ op: "equals", field: "status", value: "51CR" }] },
    contraBps: 10_000,
    excluded: true,
  }),
  rule({
    code: "EXCL_FCODE",
    name: "F-codes",
    description: "CPT/HCPCS starting or ending with F (performance-measure codes); fully adjusted.",
    priority: 4,
    match: {
      any: [
        { op: "starts_with", field: "cpt", value: "F" },
        { op: "ends_with", field: "cpt", value: "F" },
      ],
    },
    contraBps: 10_000,
    excluded: true,
  }),
  rule({
    code: "EXCL_FACILIDAD_COM",
    name: "Community facility",
    description: "Services at a facility named “Comunitaria”; fully adjusted.",
    priority: 5,
    match: { any: [{ op: "contains", field: "facility", value: "comunitaria" }] },
    contraBps: 10_000,
    excluded: true,
  }),
  rule({
    code: "G0467_FQHC",
    name: "FQHC visit G0467",
    description: "FQHC visit code; routed to Medicare/Medicaid AR, no adjustment.",
    priority: 6,
    match: { any: [{ op: "equals", field: "cpt", value: "G0467" }] },
    contraBps: 0,
    excluded: false,
    arGl: "1330",
  }),
  rule({
    code: "VFC_IMMUN",
    name: "VFC immunization administration",
    description: "Vaccine administration codes 90471 and 90472; no adjustment.",
    priority: 7,
    match: { any: [{ op: "in", field: "cpt", values: ["90471", "90472"] }] },
    contraBps: 0,
    excluded: false,
  }),
  rule({
    code: "INVALID_CPT",
    name: "Invalid CPT/HCPCS",
    description: "Code isn't 5 letters or digits; fully adjusted until corrected.",
    priority: 8,
    match: { any: [{ op: "invalid_cpt" }] },
    contraBps: 10_000,
    excluded: true,
  }),
  rule({
    code: "WRAP_PPS_MEDICARE",
    name: "Medicare/Medicaid PPS wrap",
    description: "Medicare and Medicaid classes paid under PPS/wrap; fully adjusted.",
    priority: 9,
    match: { any: [{ op: "in", field: "payer_class", values: MEDICARE_SET }] },
    contraBps: 10_000,
    excluded: true,
    arGl: "1330",
  }),
  rule({
    code: "SELF_PAY",
    name: "Self-pay",
    description: "Patient responsibility; routed to self-pay AR.",
    priority: 10,
    match: { any: [{ op: "in", field: "payer_class", values: SELF_PAY_SET }] },
    contraBps: 0,
    excluded: false,
    arGl: "1320",
  }),
  rule({
    code: "CAPITATION",
    name: "Capitation",
    description:
      "Capitated managed care; fully adjusted. ⚠️ VERIFY: in the source order, rule 9 already matches these classes, so this rule never fires.",
    priority: 11,
    match: { any: [{ op: "in", field: "payer_class", values: CAPITATION_SET }] },
    contraBps: 10_000,
    excluded: true,
    arGl: "1330",
  }),
  rule({
    code: "STANDARD",
    name: "Standard",
    description: "Everything else: standard insurance revenue, no adjustment.",
    priority: 12,
    match: { always: true },
    contraBps: 0,
    excluded: false,
  }),
];
