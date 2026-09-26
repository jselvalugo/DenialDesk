import type { Regime, Rule } from "./types";

// The only place legal deadlines, rates, and thresholds live (CLAUDE.md, R-15.6).
// Source for Florida values: docs/REQUIREMENTS.md §3.1, §3.6, §4.2 (checked 2026-09-26). Every rule
// stays verify: true until Florida healthcare counsel confirms it; only a human changes that flag
// (and records `confirmedBy`). To change a value, add a new version with a new effectiveFrom and
// close the old one — never edit history, so older claims are judged by the rule in force then.
//
// 2026-09-26 (billing review P1): anchor, rollForward and confirmedBy were added to the baseline
// versions and the shared FL insurer/HMO rules were split into two rule sets. These record how
// the same baseline law is read (owner decision; ⚠️ counsel), not a change in the law, so they are
// applied to the baseline versions rather than as new effective-dated versions.

const BASE = { effectiveFrom: null, effectiveTo: null, verify: true, confirmedBy: null } as const;
const FL = { ...BASE, rollForward: "fl_legal_holiday" } as const;
const CMS = { ...BASE, rollForward: "federal_holiday" } as const;
const REQ_VERIFY = "Flagged ⚠️ VERIFY in REQUIREMENTS §3.1.";

/** Florida insurer rules (Fla. Stat. § 627.6131). HMO counterparts are derived below. */
const insurer: Rule[] = [
  // Prompt pay — electronic claims (payer obligations)
  {
    ...FL,
    id: "fl.promptpay.electronic.acknowledgment",
    title: "Payer must acknowledge receipt of an electronic claim",
    citation: "Fla. Stat. § 627.6131(4)(a)",
    regimes: ["fl_insurer"],
    value: 24,
    unit: "hours_after_next_business_day",
    anchor: "payer_receipt",
    rollForward: "none",
    verifyNote: "Business-day calendar for this clock is unconfirmed; not yet computed.",
  },
  {
    ...FL,
    id: "fl.promptpay.electronic.pay_or_contest",
    title: "Payer must pay, or notify that the claim is denied or contested",
    citation: "Fla. Stat. § 627.6131(4)(b)",
    regimes: ["fl_insurer"],
    value: 20,
    unit: "calendar_days",
    anchor: "payer_receipt",
  },
  {
    ...FL,
    id: "fl.promptpay.electronic.pay_or_deny",
    title: "Payer must pay or deny",
    citation: "Fla. Stat. § 627.6131(4)(e)",
    regimes: ["fl_insurer"],
    value: 90,
    unit: "calendar_days",
    anchor: "payer_receipt",
  },
  {
    ...FL,
    id: "fl.promptpay.electronic.uncontestable",
    title: "Failure to pay or deny creates an uncontestable obligation to pay",
    citation: "Fla. Stat. § 627.6131(4)(e)",
    regimes: ["fl_insurer"],
    value: 120,
    unit: "calendar_days",
    anchor: "payer_receipt",
  },
  {
    ...FL,
    id: "fl.promptpay.electronic.provider_response",
    title: "Provider must submit additional information requested on a contested claim",
    citation: "Fla. Stat. § 627.6131(4)(c)",
    regimes: ["fl_insurer"],
    value: 35,
    unit: "calendar_days",
    anchor: "contest_notice",
    verifyNote: REQ_VERIFY,
  },
  // Prompt pay — paper claims
  {
    ...FL,
    id: "fl.promptpay.paper.acknowledgment",
    title: "Payer must acknowledge receipt of a paper claim (or give electronic status access)",
    citation: "Fla. Stat. § 627.6131(5)(a)",
    regimes: ["fl_insurer"],
    value: 15,
    unit: "calendar_days",
    anchor: "payer_receipt",
  },
  {
    ...FL,
    id: "fl.promptpay.paper.pay_or_contest",
    title: "Payer must pay, deny, or contest (paper claim)",
    citation: "Fla. Stat. § 627.6131(5)(b)",
    regimes: ["fl_insurer"],
    value: 40,
    unit: "calendar_days",
    anchor: "payer_receipt",
  },
  {
    ...FL,
    id: "fl.promptpay.paper.pay_or_deny",
    title: "Payer must pay or deny (paper claim)",
    citation: "Fla. Stat. § 627.6131(5)",
    regimes: ["fl_insurer"],
    value: 120,
    unit: "calendar_days",
    anchor: "payer_receipt",
    verifyNote: REQ_VERIFY,
  },
  {
    ...FL,
    id: "fl.promptpay.paper.uncontestable",
    title: "Uncontestable obligation to pay (paper claim)",
    citation: "Fla. Stat. § 627.6131(5)",
    regimes: ["fl_insurer"],
    value: 140,
    unit: "calendar_days",
    anchor: "payer_receipt",
    verifyNote: REQ_VERIFY,
  },
  {
    ...FL,
    id: "fl.promptpay.interest_rate",
    title: "Interest on overdue payments",
    citation: "Fla. Stat. § 627.6131 (interest provision; subsection to confirm)",
    regimes: ["fl_insurer"],
    value: 12,
    unit: "percent_per_year",
    anchor: "payment_due_date",
    rollForward: "none",
    verifyNote:
      "REQUIREMENTS §3.1: verify current rate and accrual start. Owner (2026-09-26): interest accrues from the first calendar day after the prompt-pay deadline; confirm with counsel.",
  },
  // Provider obligations
  {
    ...FL,
    id: "fl.timely_filing.initial",
    title: "Provider must submit the initial claim after the date of service",
    citation: "Fla. Stat. § 627.6131(2)",
    regimes: ["fl_insurer"],
    value: 6,
    unit: "months",
    anchor: "service_date",
    verifyNote:
      "Subject to listed exceptions; flagged ⚠️ VERIFY in REQUIREMENTS §3.1. Statute says service or discharge: inpatient anchor open for counsel. Month-end clamps (Aug 31 + 6 months = Feb 28/29).",
  },
  {
    ...FL,
    id: "fl.timely_filing.secondary",
    title: "Provider must submit to the secondary payer after the primary's final determination",
    citation: "Fla. Stat. § 627.6131(2)",
    regimes: ["fl_insurer"],
    value: 90,
    unit: "calendar_days",
    anchor: "primary_final_determination",
  },
  {
    ...FL,
    id: "fl.overpayment.provider_response",
    title: "Provider must respond to a payer's overpayment claim",
    citation: "Fla. Stat. § 627.6131(6)",
    regimes: ["fl_insurer"],
    value: 40,
    unit: "calendar_days",
    anchor: "overpayment_demand_receipt",
    verifyNote: REQ_VERIFY,
  },
  {
    ...FL,
    id: "fl.overpayment.payer_lookback",
    title: "Payer must submit overpayment claims after payment",
    citation: "Fla. Stat. § 627.6131(6) (subsection to confirm)",
    regimes: ["fl_insurer"],
    value: 30,
    unit: "months",
    anchor: "payment_date",
    verifyNote: REQ_VERIFY,
  },
  {
    ...FL,
    id: "fl.retroactive_denial.limit",
    title: "Retroactive denial for ineligibility is limited after payment",
    citation: "Fla. Stat. § 627.6131(11)",
    regimes: ["fl_insurer"],
    value: 1,
    unit: "years",
    anchor: "payment_date",
    verifyNote: REQ_VERIFY,
  },
];

/**
 * HMO rule set (Fla. Stat. § 641.3155), kept separate as REQUIREMENTS §3.1 asks. Values mirror the
 * insurer rules per REQUIREMENTS ("closely mirror"); subsections are unconfirmed.
 */
const hmo: Rule[] = insurer.map((rule) => ({
  ...rule,
  id: rule.id.replace(/^fl\./, "fl.hmo."),
  citation: `Fla. Stat. § 641.3155 (mirrors ${rule.citation.replace("Fla. Stat. ", "")})`,
  regimes: ["fl_hmo"],
  verifyNote:
    `HMO subsection and value assumed to mirror § 627.6131 per REQUIREMENTS §3.1; confirm. ${rule.verifyNote ?? ""}`.trim(),
}));

const ALL_REGIMES: Regime[] = [
  "fl_insurer",
  "fl_hmo",
  "erisa_self_funded",
  "medicare",
  "medicare_advantage",
  "medicaid_ffs",
  "smmc",
  "workers_comp",
  "pip",
];

const medicareLevel = (id: string, title: string, citation: string, value: number): Rule => ({
  ...CMS,
  id,
  title,
  citation,
  regimes: ["medicare"],
  value,
  unit: "calendar_days",
  anchor: "prior_decision_receipt",
  verifyNote: "Value from REQUIREMENTS §4.2; citation and receipt presumption not checked against eCFR.",
});

export const catalog: Rule[] = [
  ...insurer,
  ...hmo,
  {
    ...FL,
    id: "fl.patient_refund",
    title: "Refund a patient's overpayment after determining it occurred",
    citation: "Fla. Stat. § 456.0625",
    regimes: ALL_REGIMES,
    value: 30,
    unit: "calendar_days",
    anchor: "overpayment_determined",
    effectiveFrom: "2026-01-01",
    verifyNote:
      "REQUIREMENTS §3.6 (SB 1808). Applies to the practitioner whatever the payer; no earlier version.",
  },
  // Medicare
  {
    ...CMS,
    id: "medicare.timely_filing",
    title: "Medicare claim must be filed within one calendar year after the date of service",
    citation: "42 CFR § 424.44(a)(1); Medicare Claims Processing Manual Ch. 1 § 70",
    regimes: ["medicare"],
    value: 1,
    unit: "years",
    anchor: "service_date",
    verifyNote:
      "Primary text not fetched (eCFR/cms.gov unavailable in research). Feb 29 + 1 year = Feb 28; a last day on a weekend or federal holiday rolls to the next federal workday.",
  },
  {
    ...CMS,
    id: "medicare.redetermination.receipt_presumption",
    title: "Notice of initial determination presumed received after its date",
    citation: "42 CFR § 405.942(a)(1)",
    regimes: ["medicare"],
    value: 5,
    unit: "calendar_days",
    anchor: "notice_date",
    rollForward: "none",
  },
  {
    ...CMS,
    id: "medicare.redetermination.filing_window",
    title: "Request redetermination after receipt of the initial determination",
    citation: "42 CFR § 405.942(a)",
    regimes: ["medicare"],
    value: 120,
    unit: "calendar_days",
    anchor: "presumed_notice_receipt",
  },
  medicareLevel(
    "medicare.reconsideration.filing_window",
    "Request QIC reconsideration after receipt of the redetermination",
    "42 CFR § 405.962(a)",
    180,
  ),
  medicareLevel(
    "medicare.alj.filing_window",
    "Request an ALJ hearing after receipt of the reconsideration",
    "42 CFR § 405.1014",
    60,
  ),
  medicareLevel(
    "medicare.council.filing_window",
    "Request Medicare Appeals Council review after receipt of the ALJ decision",
    "42 CFR § 405.1102",
    60,
  ),
  medicareLevel(
    "medicare.court.filing_window",
    "File in federal district court after receipt of the Council decision",
    "42 CFR § 405.1130",
    60,
  ),
  // Medicare amount-in-controversy thresholds: REQUIREMENTS §4.2 gives no values (open question).
];
