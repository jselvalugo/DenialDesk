/**
 * Turns each report's calculation result into the SheetSpec(s) and metric definitions the
 * workbook builder needs. Kept separate from `calculations.ts` (pure math) and `workbook.ts`
 * (generic xlsx mechanics) so each layer is testable on its own.
 *
 * Small-cell suppression (R-8.7, owner decision 2026-09-26) is decided here, once per whole
 * sheet — after any flattening across sub-groups (e.g. every CARC row across every category in
 * the denials-by-category sheet) — never per sub-group, so the decision sees every sibling row
 * that will actually share one totals row. Whenever any row in a sheet ends up suppressed, the
 * sheet's own totals row is suppressed too (its count/$/rate cells), because otherwise Total minus
 * every visible row would reconstruct the hidden value(s) exactly.
 *
 * Pure domain code: never imports `@/i18n/server`. Every sheet builder takes an insight-namespace
 * translator (`t`) and a common-namespace translator (`tc`) — the route/action that calls it gets
 * them from `getT("insight")` / `getT("common")` and passes them straight through.
 */
import { CATEGORY_LABEL_KEYS, type DenialCategory } from "@/domain/carc";
import { CLAIM_STATUSES } from "@/domain/claims/status";
import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";
import { DEADLINE_BUCKET_LABEL_KEYS } from "./buckets";
import type {
  BucketGroup,
  CategoryGroup,
  DenialRateResult,
  OutcomeGroup,
  PayerGroup,
  StatusGroup,
} from "./calculations";
import type { CellValue, SheetSpec } from "./workbook";
import type { ReportId } from "./catalog";
import { applySmallCellSuppression, SUPPRESSED_CELL, type SuppressibleGroup } from "./suppression";
import { SMALL_CELL_SUPPRESSION_THRESHOLD } from "./suppression-config";

type InsightT = Translator<Messages["insight"]>;
type CommonT = Translator<Messages["common"]>;

interface SuppressibleRow<T> extends SuppressibleGroup {
  values: T;
}

/**
 * Applies small-cell suppression across one whole sheet's rows (already flattened across any
 * sub-groups) and returns the rows with their numeric/dollar/rate cells replaced by the typed
 * suppression marker wherever suppressed, plus whether any row in the sheet was suppressed at all
 * (the caller must then suppress the sheet's totals row too — see `suppressTotals`).
 */
function buildSuppressedRows<T extends Record<string, CellValue>>(
  items: SuppressibleRow<T>[],
  numericKeys: (keyof T)[],
): { rows: T[]; anySuppressed: boolean } {
  const suppressedFlags = applySmallCellSuppression(items);
  const rows = items.map((item, i) => {
    if (!suppressedFlags[i]) return item.values;
    const next = { ...item.values };
    for (const key of numericKeys) next[key] = SUPPRESSED_CELL as T[typeof key];
    return next;
  });
  return { rows, anySuppressed: suppressedFlags.some(Boolean) };
}

/**
 * Suppresses a sheet's totals row whenever any of its data rows was suppressed (R-8.7): Total
 * minus every still-visible row would otherwise reconstruct the hidden row's value exactly (or,
 * with two suppressed rows, their combined value), so the totals row can't be trusted to be safe
 * on its own once any row underneath it is hidden.
 */
function suppressTotals<T extends Record<string, CellValue>>(
  totals: T,
  anySuppressed: boolean,
  numericKeys: (keyof T)[],
): T {
  if (!anySuppressed) return totals;
  const next = { ...totals };
  for (const key of numericKeys) next[key] = SUPPRESSED_CELL as T[typeof key];
  return next;
}

export function filenameFor(reportId: string, dateFrom: string, dateTo: string): string {
  return `${reportId}_${dateFrom}_${dateTo}.xlsx`;
}

export function denialsByCategorySheet(groups: CategoryGroup[], t: InsightT, tc: CommonT): SheetSpec {
  // Flattened across every category first: suppression must see the whole sheet's sibling rows,
  // not just one category's CARC breakdown, or a category-sized blind spot could let a reader
  // back-calculate a hidden row from a category total this sheet doesn't even display but the
  // reader could reconstruct from the raw denominator elsewhere.
  const items = groups.flatMap((group) =>
    group.carcs.map((carc) => ({
      values: {
        category: tc(CATEGORY_LABEL_KEYS[group.category]),
        carc: carc.carc,
        count: carc.count,
        sumCents: carc.sumCents,
        avgCents: carc.avgCents,
      } satisfies Record<string, CellValue>,
      count: carc.count,
      sensitive: carc.sensitive,
    })),
  );
  const { rows, anySuppressed } = buildSuppressedRows(items, ["count", "sumCents", "avgCents"]);
  const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
  const totalSum = groups.reduce((sum, g) => sum + g.sumCents, 0);
  return {
    name: t("sheet.denialsByCategory"),
    columns: [
      { header: tc("word.category"), key: "category", type: "text", width: 24 },
      { header: t("columns.carc"), key: "carc", type: "text", width: 12 },
      { header: t("columns.count"), key: "count", type: "number", width: 10 },
      { header: t("columns.deniedAmount"), key: "sumCents", type: "currency", width: 16 },
      { header: t("columns.averageDeniedAmount"), key: "avgCents", type: "currency", width: 18 },
    ],
    rows,
    totals: suppressTotals(
      { category: tc("word.total"), carc: "", count: totalCount, sumCents: totalSum, avgCents: null },
      anySuppressed,
      ["count", "sumCents", "avgCents"],
    ),
  };
}

export function denialsByPayerSheet(groups: PayerGroup[], t: InsightT, tc: CommonT): SheetSpec {
  const items = groups.map((g) => ({
    values: {
      payerName: g.payerName,
      verified: g.verified ? t("value.verified") : t("value.unverified"),
      count: g.count,
      sumCents: g.sumCents,
      topCategory: tc(CATEGORY_LABEL_KEYS[g.topCategory]),
    } satisfies Record<string, CellValue>,
    count: g.count,
    sensitive: g.sensitive,
  }));
  const { rows, anySuppressed } = buildSuppressedRows(items, ["count", "sumCents"]);
  const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
  const totalSum = groups.reduce((sum, g) => sum + g.sumCents, 0);
  return {
    name: t("sheet.denialsByPayer"),
    columns: [
      { header: tc("word.payer"), key: "payerName", type: "text", width: 28 },
      { header: t("columns.verified"), key: "verified", type: "text", width: 12 },
      { header: t("columns.count"), key: "count", type: "number", width: 10 },
      { header: t("columns.deniedAmount"), key: "sumCents", type: "currency", width: 16 },
      { header: t("columns.topCategory"), key: "topCategory", type: "text", width: 20 },
    ],
    rows,
    totals: suppressTotals(
      { payerName: tc("word.total"), verified: "", count: totalCount, sumCents: totalSum, topCategory: "" },
      anySuppressed,
      ["count", "sumCents"],
    ),
  };
}

/**
 * One row of typed metrics (never text-formatted numbers), so both the on-screen table and the
 * workbook render the rate as a real percentage (e.g. 25.00%), not the string "0.25". With a zero
 * denominator, the sheet is empty with a message instead of a row of blanks.
 *
 * Not subject to small-cell suppression: this is one tenant-wide scalar for the whole date range,
 * not a breakdown into sibling rows a reader could differentially compare (see the About sheet's
 * residual-risk caveat on this report).
 */
export function denialRateSheet(result: DenialRateResult, t: InsightT): SheetSpec {
  const columns: SheetSpec["columns"] = [
    { header: t("columns.claimsSubmittedInRange"), key: "submitted", type: "number", width: 24 },
    { header: t("columns.claimsWithDenial"), key: "denied", type: "number", width: 30 },
    { header: t("columns.denialRate"), key: "rate", type: "percent", width: 16 },
  ];
  if (result.submittedClaims === 0) {
    return { name: t("sheet.denialRate"), columns, rows: [], emptyMessage: t("empty.noClaimsSubmitted") };
  }
  return {
    name: t("sheet.denialRate"),
    columns,
    rows: [{ submitted: result.submittedClaims, denied: result.deniedClaims, rate: result.rate }],
  };
}

export function denialsByDeadlineBucketSheet(groups: BucketGroup[], t: InsightT, tc: CommonT): SheetSpec {
  const items = groups.map((g) => ({
    values: {
      bucket: t(DEADLINE_BUCKET_LABEL_KEYS[g.bucket]),
      count: g.count,
      sumCents: g.sumCents,
    } satisfies Record<string, CellValue>,
    count: g.count,
    sensitive: g.sensitive,
  }));
  const { rows, anySuppressed } = buildSuppressedRows(items, ["count", "sumCents"]);
  const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
  const totalSum = groups.reduce((sum, g) => sum + g.sumCents, 0);
  return {
    name: t("sheet.denialsByDeadlineBucket"),
    columns: [
      { header: t("columns.deadlineBucket"), key: "bucket", type: "text", width: 24 },
      { header: t("columns.count"), key: "count", type: "number", width: 10 },
      { header: t("columns.deniedAmount"), key: "sumCents", type: "currency", width: 16 },
    ],
    rows,
    totals: suppressTotals(
      { bucket: tc("word.total"), count: totalCount, sumCents: totalSum },
      anySuppressed,
      ["count", "sumCents"],
    ),
  };
}

export function claimsByStatusSheet(groups: StatusGroup[], t: InsightT, tc: CommonT): SheetSpec {
  const items = groups.map((g) => ({
    values: {
      status: tc(CLAIM_STATUSES[g.status].labelKey),
      count: g.count,
      billedCents: g.billedCents,
      paidCents: g.paidCents,
      outstandingCents: g.outstandingCents,
    } satisfies Record<string, CellValue>,
    count: g.count,
    sensitive: g.sensitive,
  }));
  const numericKeys = ["count", "billedCents", "paidCents", "outstandingCents"] as const;
  const { rows, anySuppressed } = buildSuppressedRows(items, [...numericKeys]);
  const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
  const totalBilled = groups.reduce((sum, g) => sum + g.billedCents, 0);
  const totalPaid = groups.reduce((sum, g) => sum + g.paidCents, 0);
  const totalOutstanding = groups.reduce((sum, g) => sum + g.outstandingCents, 0);
  return {
    name: t("sheet.claimsByStatus"),
    columns: [
      { header: tc("word.status"), key: "status", type: "text", width: 18 },
      { header: t("columns.count"), key: "count", type: "number", width: 10 },
      { header: t("columns.billedAmount"), key: "billedCents", type: "currency", width: 16 },
      { header: t("columns.paidAmount"), key: "paidCents", type: "currency", width: 16 },
      { header: t("columns.outstandingAmount"), key: "outstandingCents", type: "currency", width: 18 },
    ],
    rows,
    totals: suppressTotals(
      {
        status: tc("word.total"),
        count: totalCount,
        billedCents: totalBilled,
        paidCents: totalPaid,
        outstandingCents: totalOutstanding,
      },
      anySuppressed,
      [...numericKeys],
    ),
  };
}

function outcomeSheet(
  groups: OutcomeGroup[],
  name: string,
  emptyMessage: string,
  columns: SheetSpec["columns"],
  totalLabel: string,
) {
  const items = groups.map((g) => ({
    values: {
      group: g.label,
      overturned: g.overturned,
      upheld: g.upheld,
      overturnRate: g.overturnRate,
      reversedCents: g.reversedCents,
    } satisfies Record<string, CellValue>,
    // Suppression keys off the decided count (overturned + upheld) — the number a reader could
    // otherwise use to infer which patient's appeal this row represents.
    count: g.overturned + g.upheld,
    sensitive: g.sensitive,
  }));
  const numericKeys = ["overturned", "upheld", "overturnRate", "reversedCents"] as const;
  const { rows, anySuppressed } = buildSuppressedRows(items, [...numericKeys]);
  const totalOverturned = groups.reduce((sum, g) => sum + g.overturned, 0);
  const totalUpheld = groups.reduce((sum, g) => sum + g.upheld, 0);
  const totalDecided = totalOverturned + totalUpheld;
  const totalReversed = groups.reduce((sum, g) => sum + g.reversedCents, 0);
  const rawTotals =
    groups.length === 0
      ? undefined
      : {
          group: totalLabel,
          overturned: totalOverturned,
          upheld: totalUpheld,
          overturnRate: totalDecided === 0 ? null : totalOverturned / totalDecided,
          reversedCents: totalReversed,
        };
  return { name, columns, rows, rawTotals, anySuppressed, emptyMessage, numericKeys };
}

/**
 * Report #6 has two sheets (by payer, by category) grouping the *same* decided-appeal rows two
 * different ways — both sheets' totals are the same underlying grand total. If only one sheet's
 * totals were suppressed, the other sheet's visible totals would reveal it, so both sheets'
 * totals rows are suppressed together whenever either sheet has a suppressed row.
 */
export function appealOutcomesSheets(
  byPayer: OutcomeGroup[],
  byCategory: OutcomeGroup[],
  t: InsightT,
  tc: CommonT,
): SheetSpec[] {
  const columns: SheetSpec["columns"] = [
    { header: t("columns.group"), key: "group", type: "text", width: 24 },
    { header: t("columns.overturned"), key: "overturned", type: "number", width: 14 },
    { header: t("columns.upheld"), key: "upheld", type: "number", width: 12 },
    { header: t("columns.overturnRate"), key: "overturnRate", type: "percent", width: 16 },
    { header: t("columns.deniedAmountReversed"), key: "reversedCents", type: "currency", width: 24 },
  ];
  const noDecidedAppeals = t("empty.noDecidedAppeals");
  const totalLabel = tc("word.total");
  const byCategoryLabeled = byCategory.map((g) => {
    const key = CATEGORY_LABEL_KEYS[g.label as DenialCategory] as
      (typeof CATEGORY_LABEL_KEYS)[DenialCategory] | undefined;
    return { ...g, label: key ? tc(key) : g.label };
  });
  const payerSheet = outcomeSheet(
    byPayer,
    t("sheet.appealOutcomesByPayer"),
    noDecidedAppeals,
    columns,
    totalLabel,
  );
  const categorySheet = outcomeSheet(
    byCategoryLabeled,
    t("sheet.appealOutcomesByCategory"),
    noDecidedAppeals,
    columns,
    totalLabel,
  );
  const anySuppressed = payerSheet.anySuppressed || categorySheet.anySuppressed;
  return [payerSheet, categorySheet].map((sheetResult) => {
    const { rawTotals, numericKeys, anySuppressed: _ignoredOwnFlag, ...sheet } = sheetResult;
    void _ignoredOwnFlag; // each sheet's own flag was already folded into the shared one above
    return {
      ...sheet,
      totals: rawTotals ? suppressTotals(rawTotals, anySuppressed, [...numericKeys]) : undefined,
    };
  });
}

/** Metric definitions shown on the About sheet, per report. The term reuses the column-header text. */
export function metricDefinitions(
  reportId: ReportId,
  t: InsightT,
  tc: CommonT,
): { term: string; definition: string }[] {
  switch (reportId) {
    case "denials-by-category":
      return [
        { term: tc("word.category"), definition: t("definitions.category") },
        { term: t("columns.deniedAmount"), definition: t("definitions.deniedAmount") },
        { term: t("columns.averageDeniedAmount"), definition: t("definitions.averageDeniedAmount") },
      ];
    case "denials-by-payer":
      return [
        { term: t("columns.verified"), definition: t("definitions.verified") },
        { term: t("columns.topCategory"), definition: t("definitions.topCategory") },
      ];
    case "denial-rate":
      return [
        { term: t("columns.claimsSubmittedInRange"), definition: t("definitions.claimsSubmittedInRange") },
        { term: t("columns.denialRate"), definition: t("definitions.denialRate") },
      ];
    case "denials-by-deadline-bucket":
      return [
        { term: t("columns.deadlineBucket"), definition: t("definitions.deadlineBucket") },
        { term: t("bucket.noDeadline"), definition: t("definitions.noDeadlineConfigured") },
      ];
    case "claims-by-status":
      return [{ term: t("columns.outstandingAmount"), definition: t("definitions.outstandingAmount") }];
    case "appeal-outcomes":
      return [
        { term: t("columns.overturnRate"), definition: t("definitions.overturnRate") },
        { term: t("columns.deniedAmountReversed"), definition: t("definitions.deniedAmountReversed") },
      ];
  }
}

/** Data caveats shown on the About sheet, per report; the small-cell-suppression note is shared. */
export function dataCaveats(reportId: ReportId, t: InsightT): string[] {
  const smallCellSuppression = t("caveats.smallCellSuppression", {
    threshold: SMALL_CELL_SUPPRESSION_THRESHOLD,
  });
  switch (reportId) {
    case "denials-by-category":
      return [t("caveats.unknownCarc"), smallCellSuppression];
    case "denials-by-payer":
      return [t("caveats.payerFilterNotApplicable"), smallCellSuppression];
    case "denial-rate":
      return [t("caveats.denialRateFallback"), t("caveats.denialRateResidualRisk")];
    case "denials-by-deadline-bucket":
      return [t("caveats.noDeadlineConfiguredExplain"), smallCellSuppression];
    case "claims-by-status":
      return [t("caveats.paidAmountsPartial"), smallCellSuppression];
    case "appeal-outcomes":
      return [t("caveats.latestOutcomeOnly"), smallCellSuppression];
  }
}
