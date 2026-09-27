import { todayIn } from "@rules/calendar";
import type { TenantTx } from "@/db/tenant";
import type { Formatters } from "@/i18n/format";
import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";
import type { ParsedFilters } from "./filters";
import { catalogEntry, type ReportId, REPORT_CATALOG } from "./catalog";
import {
  appealOutcomesSheets,
  claimsByStatusSheet,
  dataCaveats,
  denialRateSheet,
  denialsByCategorySheet,
  denialsByDeadlineBucketSheet,
  denialsByPayerSheet,
  filenameFor,
  metricDefinitions,
} from "./report-sheets";
import {
  fetchAppealOutcomes,
  fetchClaimsByStatus,
  fetchDenialRate,
  fetchDenialsByCategory,
  fetchDenialsByDeadlineBucket,
  fetchDenialsByPayer,
  listPayers,
} from "./queries";
import type { SheetSpec, WorkbookAbout } from "./workbook";
import { buildReportWorkbook, buildAllReportsWorkbook } from "./workbook";

type InsightT = Translator<Messages["insight"]>;
type CommonT = Translator<Messages["common"]>;

export interface RunReportResult {
  sheets: SheetSpec[];
  rowCount: number;
}

/** Runs one report's query + calculation and returns its sheet(s), ready for the page or a workbook. */
export async function runReport(
  tx: TenantTx,
  reportId: ReportId,
  filters: ParsedFilters,
  t: InsightT,
  tc: CommonT,
): Promise<RunReportResult> {
  const today = todayIn();
  switch (reportId) {
    case "denials-by-category": {
      const groups = await fetchDenialsByCategory(tx, filters);
      const sheet = denialsByCategorySheet(groups, t, tc);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "denials-by-payer": {
      const groups = await fetchDenialsByPayer(tx, filters);
      const sheet = denialsByPayerSheet(groups, t, tc);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "denial-rate": {
      const result = await fetchDenialRate(tx, filters);
      const sheet = denialRateSheet(result, t);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "denials-by-deadline-bucket": {
      const groups = await fetchDenialsByDeadlineBucket(tx, filters, today);
      const sheet = denialsByDeadlineBucketSheet(groups, t, tc);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "claims-by-status": {
      const groups = await fetchClaimsByStatus(tx, filters);
      const sheet = claimsByStatusSheet(groups, t, tc);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "appeal-outcomes": {
      const { byPayer, byCategory } = await fetchAppealOutcomes(tx, filters);
      const sheets = appealOutcomesSheets(byPayer, byCategory, t, tc);
      return { sheets, rowCount: sheets.reduce((sum, s) => sum + s.rows.length, 0) };
    }
  }
}

function filtersDescription(
  filters: ParsedFilters,
  payerName: string | null,
  payerFilterEnabled: boolean,
  t: InsightT,
  f: Formatters,
): string[] {
  const parts = [t("filters.dateRange", { from: f.date(filters.dateFrom), to: f.date(filters.dateTo) })];
  if (payerFilterEnabled) {
    const payer = filters.payerId ? (payerName ?? t("filters.selectedPayer")) : t("filters.allPayers");
    parts.push(t("filters.payerLine", { payer }));
  }
  return parts;
}

async function payerNameFor(tx: TenantTx, payerId: string | null): Promise<string | null> {
  if (!payerId) return null;
  const payers = await listPayers(tx);
  return payers.find((p) => p.id === payerId)?.name ?? null;
}

export interface WorkbookContext {
  practiceName: string;
  userId: string;
}

export async function buildSingleReportWorkbook(
  tx: TenantTx,
  reportId: ReportId,
  filters: ParsedFilters,
  ctx: WorkbookContext,
  t: InsightT,
  tc: CommonT,
  f: Formatters,
): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
  const entry = catalogEntry(reportId)!;
  const { sheets, rowCount } = await runReport(tx, reportId, filters, t, tc);
  const payerName = await payerNameFor(tx, filters.payerId);
  const about: WorkbookAbout = {
    reportName: t(entry.titleKey),
    practiceName: ctx.practiceName,
    filtersApplied: filtersDescription(filters, payerName, entry.payerFilterEnabled, t, f),
    generatedAt: new Date(),
    generatedByUserId: ctx.userId,
    definitions: metricDefinitions(reportId, t, tc),
    caveats: dataCaveats(reportId, t),
  };
  const buffer = await buildReportWorkbook(about, sheets, t, tc);
  return { buffer, filename: filenameFor(reportId, filters.dateFrom, filters.dateTo), rowCount };
}

export async function buildAllReportsWorkbookFor(
  tx: TenantTx,
  filters: ParsedFilters,
  ctx: WorkbookContext,
  t: InsightT,
  tc: CommonT,
  f: Formatters,
): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
  const availableIds = REPORT_CATALOG.filter((r) => r.available).map((r) => r.id as ReportId);
  let rowCount = 0;
  const allSheets: SheetSpec[] = [];
  for (const id of availableIds) {
    const { sheets, rowCount: count } = await runReport(tx, id, filters, t, tc);
    rowCount += count;
    // Each sheet's name is prefixed with its report id so it's identifiable in the combined
    // workbook; `buildAllReportsWorkbook` (via `uniqueSheetName`) guarantees uniqueness even after
    // Excel's 31-character truncation, which two similarly-named sheets (e.g. appeal outcomes' two
    // sheets) could otherwise collide on.
    for (const sheet of sheets) {
      allSheets.push({ ...sheet, name: sheets.length > 1 ? `${id} - ${sheet.name}` : id });
    }
  }
  // The combined workbook covers reports with different payer-filter behavior (e.g. denials-by-payer
  // ignores it entirely), so its own About sheet never claims a single payer filter applies to all of
  // them — each report's own sheet states its own filters via its data caveats where relevant.
  const about: WorkbookAbout = {
    reportName: t("about.allReportsName"),
    practiceName: ctx.practiceName,
    filtersApplied: filtersDescription(filters, null, false, t, f),
    generatedAt: new Date(),
    generatedByUserId: ctx.userId,
    definitions: availableIds.flatMap((id) => metricDefinitions(id, t, tc)),
    caveats: [
      ...(filters.payerId ? [t("about.combinedPayerFilterCaveat")] : []),
      ...availableIds.flatMap((id) => dataCaveats(id, t)),
    ],
  };
  const buffer = await buildAllReportsWorkbook(about, allSheets, t, tc);
  return { buffer, filename: filenameFor("all-reports", filters.dateFrom, filters.dateTo), rowCount };
}
