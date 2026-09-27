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
 */
import { CATEGORY_LABELS } from "@/domain/carc";
import { DEADLINE_BUCKET_LABELS } from "./buckets";
import type {
  BucketGroup,
  CategoryGroup,
  ClaimStatus,
  DenialRateResult,
  OutcomeGroup,
  PayerGroup,
  StatusGroup,
} from "./calculations";
import type { CellValue, SheetSpec } from "./workbook";
import { catalogEntry, type ReportId } from "./catalog";
import { applySmallCellSuppression, SUPPRESSED_CELL, type SuppressibleGroup } from "./suppression";

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

export function reportTitle(reportId: ReportId): string {
  return catalogEntry(reportId)?.title ?? reportId;
}

export function filenameFor(reportId: string, dateFrom: string, dateTo: string): string {
  return `${reportId}_${dateFrom}_${dateTo}.xlsx`;
}

export function denialsByCategorySheet(groups: CategoryGroup[]): SheetSpec {
  // Flattened across every category first: suppression must see the whole sheet's sibling rows,
  // not just one category's CARC breakdown, or a category-sized blind spot could let a reader
  // back-calculate a hidden row from a category total this sheet doesn't even display but the
  // reader could reconstruct from the raw denominator elsewhere.
  const items = groups.flatMap((group) =>
    group.carcs.map((carc) => ({
      values: {
        category: CATEGORY_LABELS[group.category],
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
  const totalCount = groups.reduce((t, g) => t + g.count, 0);
  const totalSum = groups.reduce((t, g) => t + g.sumCents, 0);
  return {
    name: "Denials by category",
    columns: [
      { header: "Category", key: "category", type: "text", width: 24 },
      { header: "CARC", key: "carc", type: "text", width: 12 },
      { header: "Count", key: "count", type: "number", width: 10 },
      { header: "Denied ($)", key: "sumCents", type: "currency", width: 16 },
      { header: "Average denied ($)", key: "avgCents", type: "currency", width: 18 },
    ],
    rows,
    totals: suppressTotals(
      { category: "Total", carc: "", count: totalCount, sumCents: totalSum, avgCents: null },
      anySuppressed,
      ["count", "sumCents", "avgCents"],
    ),
  };
}

export function denialsByPayerSheet(groups: PayerGroup[]): SheetSpec {
  const items = groups.map((g) => ({
    values: {
      payerName: g.payerName,
      verified: g.verified ? "Verified" : "Unverified",
      count: g.count,
      sumCents: g.sumCents,
      topCategory: CATEGORY_LABELS[g.topCategory],
    } satisfies Record<string, CellValue>,
    count: g.count,
    sensitive: g.sensitive,
  }));
  const { rows, anySuppressed } = buildSuppressedRows(items, ["count", "sumCents"]);
  const totalCount = groups.reduce((t, g) => t + g.count, 0);
  const totalSum = groups.reduce((t, g) => t + g.sumCents, 0);
  return {
    name: "Denials by payer",
    columns: [
      { header: "Payer", key: "payerName", type: "text", width: 28 },
      { header: "Verified", key: "verified", type: "text", width: 12 },
      { header: "Count", key: "count", type: "number", width: 10 },
      { header: "Denied ($)", key: "sumCents", type: "currency", width: 16 },
      { header: "Top category", key: "topCategory", type: "text", width: 20 },
    ],
    rows,
    totals: suppressTotals(
      { payerName: "Total", verified: "", count: totalCount, sumCents: totalSum, topCategory: "" },
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
export function denialRateSheet(result: DenialRateResult): SheetSpec {
  const columns: SheetSpec["columns"] = [
    { header: "Claims submitted in range", key: "submitted", type: "number", width: 24 },
    { header: "Claims with a denial (by notice date)", key: "denied", type: "number", width: 30 },
    { header: "Denial rate", key: "rate", type: "percent", width: 16 },
  ];
  if (result.submittedClaims === 0) {
    return { name: "Denial rate", columns, rows: [], emptyMessage: "No claims submitted in this period" };
  }
  return {
    name: "Denial rate",
    columns,
    rows: [{ submitted: result.submittedClaims, denied: result.deniedClaims, rate: result.rate }],
  };
}

export function denialsByDeadlineBucketSheet(groups: BucketGroup[]): SheetSpec {
  const items = groups.map((g) => ({
    values: {
      bucket: DEADLINE_BUCKET_LABELS[g.bucket],
      count: g.count,
      sumCents: g.sumCents,
    } satisfies Record<string, CellValue>,
    count: g.count,
    sensitive: g.sensitive,
  }));
  const { rows, anySuppressed } = buildSuppressedRows(items, ["count", "sumCents"]);
  const totalCount = groups.reduce((t, g) => t + g.count, 0);
  const totalSum = groups.reduce((t, g) => t + g.sumCents, 0);
  return {
    name: "Open denials by deadline",
    columns: [
      { header: "Bucket", key: "bucket", type: "text", width: 24 },
      { header: "Count", key: "count", type: "number", width: 10 },
      { header: "Denied ($)", key: "sumCents", type: "currency", width: 16 },
    ],
    rows,
    totals: suppressTotals({ bucket: "Total", count: totalCount, sumCents: totalSum }, anySuppressed, [
      "count",
      "sumCents",
    ]),
  };
}

const STATUS_LABELS: Record<ClaimStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  acknowledged: "Acknowledged",
  rejected: "Rejected",
  paid: "Paid",
  partially_paid: "Partially paid",
  denied: "Denied",
  closed: "Closed",
};

export function claimsByStatusSheet(groups: StatusGroup[]): SheetSpec {
  const items = groups.map((g) => ({
    values: {
      status: STATUS_LABELS[g.status],
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
  const totalCount = groups.reduce((t, g) => t + g.count, 0);
  const totalBilled = groups.reduce((t, g) => t + g.billedCents, 0);
  const totalPaid = groups.reduce((t, g) => t + g.paidCents, 0);
  const totalOutstanding = groups.reduce((t, g) => t + g.outstandingCents, 0);
  return {
    name: "Claims by status",
    columns: [
      { header: "Status", key: "status", type: "text", width: 18 },
      { header: "Count", key: "count", type: "number", width: 10 },
      { header: "Billed ($)", key: "billedCents", type: "currency", width: 16 },
      { header: "Paid ($)", key: "paidCents", type: "currency", width: 16 },
      { header: "Outstanding ($)", key: "outstandingCents", type: "currency", width: 18 },
    ],
    rows,
    totals: suppressTotals(
      {
        status: "Total",
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
  const totalOverturned = groups.reduce((t, g) => t + g.overturned, 0);
  const totalUpheld = groups.reduce((t, g) => t + g.upheld, 0);
  const totalDecided = totalOverturned + totalUpheld;
  const totalReversed = groups.reduce((t, g) => t + g.reversedCents, 0);
  const rawTotals =
    groups.length === 0
      ? undefined
      : {
          group: "Total",
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
export function appealOutcomesSheets(byPayer: OutcomeGroup[], byCategory: OutcomeGroup[]): SheetSpec[] {
  const columns: SheetSpec["columns"] = [
    { header: "Group", key: "group", type: "text", width: 24 },
    { header: "Overturned", key: "overturned", type: "number", width: 14 },
    { header: "Upheld", key: "upheld", type: "number", width: 12 },
    { header: "Overturn rate", key: "overturnRate", type: "percent", width: 16 },
    { header: "Denied amount reversed ($)", key: "reversedCents", type: "currency", width: 24 },
  ];
  const NO_DECIDED_APPEALS = "No decided appeals in this period";
  const byCategoryLabeled = byCategory.map((g) => ({
    ...g,
    label: CATEGORY_LABELS[g.label as never] ?? g.label,
  }));
  const payerSheet = outcomeSheet(byPayer, "Appeal outcomes by payer", NO_DECIDED_APPEALS, columns);
  const categorySheet = outcomeSheet(
    byCategoryLabeled,
    "Appeal outcomes by category",
    NO_DECIDED_APPEALS,
    columns,
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

export const METRIC_DEFINITIONS: Record<ReportId, { term: string; definition: string }[]> = {
  "denials-by-category": [
    {
      term: "Category",
      definition: "DenialDesk's work-queue classification for the denial's CARC (REQUIREMENTS §8.3).",
    },
    { term: "Denied ($)", definition: "Sum of the denied amount (denials.deniedCents) for the group." },
    { term: "Average denied ($)", definition: "Denied ($) divided by count, for the group." },
  ],
  "denials-by-payer": [
    { term: "Verified", definition: "Whether the payer has a confirmed EDI payer ID and regulatory regime." },
    {
      term: "Top category",
      definition:
        "The category with the largest sum of denied dollars for that payer; ties broken by category enum order.",
    },
  ],
  "denial-rate": [
    {
      term: "Claims submitted in range",
      definition:
        "Claims with status other than draft, whose submission date (or service date, if not yet submitted) falls in the selected range.",
    },
    {
      term: "Denial rate",
      definition:
        "Distinct claims with at least one denial in range, divided by distinct claims submitted in range.",
    },
  ],
  "denials-by-deadline-bucket": [
    {
      term: "Bucket",
      definition:
        "Days remaining to the appeal deadline, computed the same way as the denial queue (rules/deadlines.ts); never re-derived.",
    },
    {
      term: "No deadline configured",
      definition: "The payer is unverified or has no configured appeal window; never guessed.",
    },
  ],
  "claims-by-status": [{ term: "Outstanding ($)", definition: "Billed ($) minus paid ($) for the group." }],
  "appeal-outcomes": [
    {
      term: "Overturn rate",
      definition:
        "Overturned divided by (overturned + upheld) for the group; blank when there are no decided appeals in range.",
    },
    {
      term: "Denied amount reversed ($)",
      definition:
        "Sum of denied dollars on overturned rows only — an upper bound, not a captured payment (no remittances table yet).",
    },
  ],
};

const SMALL_CELL_SUPPRESSION_CAVEAT =
  "Small-cell suppression (R-8.7): a row that includes a claim for a patient carrying a " +
  "sensitivity tag (R-3.5.1) and whose count is under the suppression threshold shows " +
  '"Suppressed (<11)" instead of its count and dollar amounts/rates, to avoid identifying that ' +
  "patient. When exactly one row in the sheet would be suppressed, the next-smallest row with a " +
  "nonzero count is also suppressed so the hidden value can't be inferred from the others. " +
  "Whenever any row in a sheet is suppressed, that sheet's own totals row is suppressed too — " +
  "otherwise Total minus the visible rows would reconstruct the hidden value(s) exactly. " +
  "Accepted residual risk (⚠️ VERIFY with counsel): this suppression is per report and per date " +
  "range — comparing two overlapping date ranges of the same report, or two different reports " +
  "covering the same claims, can still let a determined reader difference out a suppressed cell; " +
  "no cross-report or cross-range differencing guard exists in this slice. ⚠️ VERIFY: the " +
  "threshold (11) follows CMS's public-use-file cell-size suppression convention as a policy " +
  "baseline, not a Florida statute — confirm with counsel.";

const DENIAL_RATE_RESIDUAL_RISK_CAVEAT =
  "This report is one tenant-wide rate for the whole date range, not a row-by-row breakdown, so " +
  "small-cell suppression (R-8.7) does not apply to it the same way. Accepted residual risk " +
  "(⚠️ VERIFY with counsel): the denied-claims count is a tenant-wide total, not suppressed even " +
  "when small, and a narrow enough date range or payer filter could still make it identify a " +
  "single sensitive-tagged patient's claim.";

export const DATA_CAVEATS: Record<ReportId, string[]> = {
  "denials-by-category": [
    "A CARC code outside the reference list (src/domain/carc.ts) is shown by its raw code with no description.",
    SMALL_CELL_SUPPRESSION_CAVEAT,
  ],
  "denials-by-payer": [
    "The payer filter is not applicable to this report — it is the payer breakdown.",
    SMALL_CELL_SUPPRESSION_CAVEAT,
  ],
  "denial-rate": [
    "Submission-date tracking (C3 837P) is not yet built; falls back to service date when submittedAt is null.",
    DENIAL_RATE_RESIDUAL_RISK_CAVEAT,
  ],
  "denials-by-deadline-bucket": [
    '"No deadline configured" includes unverified payers and payers with no configured appeal window.',
    SMALL_CELL_SUPPRESSION_CAVEAT,
  ],
  "claims-by-status": [
    "Paid amounts are recorded only where captured — 835 remittance posting is not yet built.",
    SMALL_CELL_SUPPRESSION_CAVEAT,
  ],
  "appeal-outcomes": [
    "Reports on current denial status only; there is no appeals history table yet, so a denial that flipped status is shown by its latest outcome.",
    SMALL_CELL_SUPPRESSION_CAVEAT,
  ],
};
