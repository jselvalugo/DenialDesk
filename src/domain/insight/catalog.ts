import type { MessageKey } from "@/i18n/messages/types";

/**
 * The fixed catalog of Insight standard reports (docs/specs/insight-standard-reports.md). This
 * slice ships no custom/user-built reports — only these, some available today and some planned.
 * Names and purposes are message keys (insight namespace) — this module is pure domain code and
 * never imports `@/i18n/server`; callers translate with `t(entry.titleKey)` / `t(entry.purposeKey)`.
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
  titleKey: MessageKey<"insight">;
  purposeKey: MessageKey<"insight">;
  available: boolean;
  /** Whether the report's own payer filter is user-selectable (report #2 disables it). */
  payerFilterEnabled: boolean;
}

export const REPORT_CATALOG: ReportCatalogEntry[] = [
  {
    id: "denials-by-category",
    titleKey: "catalog.denialsByCategory.title",
    purposeKey: "catalog.denialsByCategory.purpose",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "denials-by-payer",
    titleKey: "catalog.denialsByPayer.title",
    purposeKey: "catalog.denialsByPayer.purpose",
    available: true,
    payerFilterEnabled: false,
  },
  {
    id: "denial-rate",
    titleKey: "catalog.denialRate.title",
    purposeKey: "catalog.denialRate.purpose",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "denials-by-deadline-bucket",
    titleKey: "catalog.denialsByDeadlineBucket.title",
    purposeKey: "catalog.denialsByDeadlineBucket.purpose",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "claims-by-status",
    titleKey: "catalog.claimsByStatus.title",
    purposeKey: "catalog.claimsByStatus.purpose",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "appeal-outcomes",
    titleKey: "catalog.appealOutcomes.title",
    purposeKey: "catalog.appealOutcomes.purpose",
    available: true,
    payerFilterEnabled: true,
  },
  {
    id: "prompt-pay-scorecard",
    titleKey: "catalog.promptPayScorecard.title",
    purposeKey: "catalog.promptPayScorecard.purpose",
    available: false,
    payerFilterEnabled: false,
  },
  {
    id: "underpayment-variance",
    titleKey: "catalog.underpaymentVariance.title",
    purposeKey: "catalog.underpaymentVariance.purpose",
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
