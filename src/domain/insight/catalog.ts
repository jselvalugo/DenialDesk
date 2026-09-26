/**
 * The fixed catalog of Insight standard reports (docs/specs/insight-standard-reports.md). This
 * slice ships no custom/user-built reports — only these, some available today and some planned.
 */

export type ReportId =
  | "denials-by-category"
  | "denials-by-payer"
  | "denial-rate"
  | "denials-by-deadline-bucket"
  | "claims-by-status"
  | "appeal-outcomes";

export interface ReportCatalogEntry {
  id: ReportId | "prompt-pay-scorecard" | "underpayment-variance";
  title: string;
  purpose: string;
  available: boolean;
  /** Whether the report's own payer filter is user-selectable (report #2 disables it). */
  payerFilterEnabled: boolean;
}

export const REPORT_CATALOG: ReportCatalogEntry[] = [
  {
    id: "denials-by-category",
    title: "Denial summary by category and CARC",
    purpose: "Where denial dollars and volume concentrate, by root cause.",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "denials-by-payer",
    title: "Denial summary by payer",
    purpose: "Which payers generate the most denial dollars and volume, and their top category.",
    available: true,
    payerFilterEnabled: false,
  },
  {
    id: "denial-rate",
    title: "Denial rate",
    purpose: "The share of billed claims that received at least one denial.",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "denials-by-deadline-bucket",
    title: "Open denials by appeal-deadline bucket",
    purpose: "A report-form total of what the denial queue already sorts by.",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "claims-by-status",
    title: "Claims by status / A/R summary",
    purpose: "How much is outstanding and in what state, from the claims table itself.",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "appeal-outcomes",
    title: "Appeal outcomes",
    purpose: "Overturn vs. upheld rates by payer and category.",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "prompt-pay-scorecard",
    title: "Prompt-pay scorecard",
    purpose: "Planned — see spec (blocked on notice-classification fix, billing review F4).",
    available: false,
    payerFilterEnabled: false,
  },
  {
    id: "underpayment-variance",
    title: "Underpayment variance",
    purpose: "Planned — see spec (blocked on a payer_contracts / fee-schedule table).",
    available: false,
    payerFilterEnabled: false,
  },
];

export const AVAILABLE_REPORT_IDS = REPORT_CATALOG.filter((r) => r.available).map((r) => r.id as ReportId);

export function isAvailableReportId(id: string): id is ReportId {
  return (AVAILABLE_REPORT_IDS as string[]).includes(id);
}

export function catalogEntry(id: string) {
  return REPORT_CATALOG.find((r) => r.id === id);
}
