import { todayIn } from "@rules/calendar";
import type { TenantTx } from "@/db/tenant";
import type { ParsedFilters } from "./filters";
import { catalogEntry, type ReportId, REPORT_CATALOG } from "./catalog";
import {
  appealOutcomesSheets,
  claimsByStatusSheet,
  DATA_CAVEATS,
  denialRateSheet,
  denialsByCategorySheet,
  denialsByDeadlineBucketSheet,
  denialsByPayerSheet,
  filenameFor,
  METRIC_DEFINITIONS,
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

export interface RunReportResult {
  sheets: SheetSpec[];
  rowCount: number;
}

/** Runs one report's query + calculation and returns its sheet(s), ready for the page or a workbook. */
export async function runReport(
  tx: TenantTx,
  reportId: ReportId,
  filters: ParsedFilters,
): Promise<RunReportResult> {
  const today = todayIn();
  switch (reportId) {
    case "denials-by-category": {
      const groups = await fetchDenialsByCategory(tx, filters);
      const sheet = denialsByCategorySheet(groups);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "denials-by-payer": {
      const groups = await fetchDenialsByPayer(tx, filters);
      const sheet = denialsByPayerSheet(groups);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "denial-rate": {
      const result = await fetchDenialRate(tx, filters);
      const sheet = denialRateSheet(result);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "denials-by-deadline-bucket": {
      const groups = await fetchDenialsByDeadlineBucket(tx, filters, today);
      const sheet = denialsByDeadlineBucketSheet(groups);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "claims-by-status": {
      const groups = await fetchClaimsByStatus(tx, filters);
      const sheet = claimsByStatusSheet(groups);
      return { sheets: [sheet], rowCount: sheet.rows.length };
    }
    case "appeal-outcomes": {
      const { byPayer, byCategory } = await fetchAppealOutcomes(tx, filters);
      const sheets = appealOutcomesSheets(byPayer, byCategory);
      return { sheets, rowCount: sheets.reduce((t, s) => t + s.rows.length, 0) };
    }
  }
}

function filtersDescription(
  filters: ParsedFilters,
  payerName: string | null,
  payerFilterEnabled: boolean,
): string[] {
  const parts = [`Date range: ${filters.dateFrom} to ${filters.dateTo}`];
  if (payerFilterEnabled)
    parts.push(`Payer: ${filters.payerId ? (payerName ?? "Selected payer") : "All payers"}`);
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
): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
  const entry = catalogEntry(reportId)!;
  const { sheets, rowCount } = await runReport(tx, reportId, filters);
  const payerName = await payerNameFor(tx, filters.payerId);
  const about: WorkbookAbout = {
    reportName: entry.title,
    practiceName: ctx.practiceName,
    filtersApplied: filtersDescription(filters, payerName, entry.payerFilterEnabled),
    generatedAt: new Date(),
    generatedByUserId: ctx.userId,
    definitions: METRIC_DEFINITIONS[reportId],
    caveats: DATA_CAVEATS[reportId],
  };
  const buffer = await buildReportWorkbook(about, sheets);
  return { buffer, filename: filenameFor(reportId, filters.dateFrom, filters.dateTo), rowCount };
}

export async function buildAllReportsWorkbookFor(
  tx: TenantTx,
  filters: ParsedFilters,
  ctx: WorkbookContext,
): Promise<{ buffer: Buffer; filename: string; rowCount: number }> {
  const availableIds = REPORT_CATALOG.filter((r) => r.available).map((r) => r.id as ReportId);
  const payerName = await payerNameFor(tx, filters.payerId);
  let rowCount = 0;
  const allSheets: SheetSpec[] = [];
  for (const id of availableIds) {
    const { sheets, rowCount: count } = await runReport(tx, id, filters);
    rowCount += count;
    // Each sheet keeps a unique, identifiable name in the combined workbook (Excel requires uniqueness).
    for (const sheet of sheets) {
      const name = sheets.length > 1 ? `${id}-${sheet.name}` : id;
      allSheets.push({ ...sheet, name: name.slice(0, 31) });
    }
  }
  const about: WorkbookAbout = {
    reportName: "All Insight reports",
    practiceName: ctx.practiceName,
    filtersApplied: filtersDescription(filters, payerName, true),
    generatedAt: new Date(),
    generatedByUserId: ctx.userId,
    definitions: availableIds.flatMap((id) => METRIC_DEFINITIONS[id]),
    caveats: availableIds.flatMap((id) => DATA_CAVEATS[id]),
  };
  const buffer = await buildAllReportsWorkbook(about, allSheets);
  return { buffer, filename: filenameFor("all-reports", filters.dateFrom, filters.dateTo), rowCount };
}
