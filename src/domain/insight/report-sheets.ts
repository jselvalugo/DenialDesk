/**
 * Turns each report's calculation result into the SheetSpec(s) and metric definitions the
 * workbook builder needs. Kept separate from `calculations.ts` (pure math) and `workbook.ts`
 * (generic xlsx mechanics) so each layer is testable on its own.
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
import type { SheetSpec } from "./workbook";
import { catalogEntry, type ReportId } from "./catalog";
import { suppressedLabel } from "./suppression";

/**
 * Small-cell suppression (R-8.7, owner decision 2026-09-26): when `suppressed` is true, every
 * numeric/rate value in `values` is replaced with the suppression marker text so neither the
 * on-screen table nor the .xlsx export shows the underlying count or dollar amount. Non-numeric
 * identifying columns (category, payer name, status, bucket label) are left untouched — only the
 * count/dollar/rate cells are hidden.
 */
function suppressRow<T extends Record<string, string | number | null>>(
  values: T,
  suppressed: boolean,
  numericKeys: (keyof T)[],
): T {
  if (!suppressed) return values;
  const label = suppressedLabel();
  const next = { ...values };
  for (const key of numericKeys) next[key] = label as T[typeof key];
  return next;
}

export function reportTitle(reportId: ReportId): string {
  return catalogEntry(reportId)?.title ?? reportId;
}

export function filenameFor(reportId: string, dateFrom: string, dateTo: string): string {
  return `${reportId}_${dateFrom}_${dateTo}.xlsx`;
}

export function denialsByCategorySheet(groups: CategoryGroup[]): SheetSpec {
  const rows = groups.flatMap((group) =>
    group.carcs.map((carc) =>
      suppressRow(
        {
          category: CATEGORY_LABELS[group.category],
          carc: carc.carc,
          count: carc.count,
          sumCents: carc.sumCents,
          avgCents: carc.avgCents,
        },
        carc.suppressed,
        ["count", "sumCents", "avgCents"],
      ),
    ),
  );
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
    totals: { category: "Total", carc: "", count: totalCount, sumCents: totalSum, avgCents: null },
  };
}

export function denialsByPayerSheet(groups: PayerGroup[]): SheetSpec {
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
    rows: groups.map((g) =>
      suppressRow(
        {
          payerName: g.payerName,
          verified: g.verified ? "Verified" : "Unverified",
          count: g.count,
          sumCents: g.sumCents,
          topCategory: CATEGORY_LABELS[g.topCategory],
        },
        g.suppressed,
        ["count", "sumCents"],
      ),
    ),
    totals: { payerName: "Total", verified: "", count: totalCount, sumCents: totalSum, topCategory: "" },
  };
}

/**
 * One row of typed metrics (never text-formatted numbers), so both the on-screen table and the
 * workbook render the rate as a real percentage (e.g. 25.00%), not the string "0.25". With a zero
 * denominator, the sheet is empty with a message instead of a row of blanks.
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
  const totalCount = groups.reduce((t, g) => t + g.count, 0);
  const totalSum = groups.reduce((t, g) => t + g.sumCents, 0);
  return {
    name: "Open denials by deadline",
    columns: [
      { header: "Bucket", key: "bucket", type: "text", width: 24 },
      { header: "Count", key: "count", type: "number", width: 10 },
      { header: "Denied ($)", key: "sumCents", type: "currency", width: 16 },
    ],
    rows: groups.map((g) =>
      suppressRow(
        { bucket: DEADLINE_BUCKET_LABELS[g.bucket], count: g.count, sumCents: g.sumCents },
        g.suppressed,
        ["count", "sumCents"],
      ),
    ),
    totals: { bucket: "Total", count: totalCount, sumCents: totalSum },
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
    rows: groups.map((g) =>
      suppressRow(
        {
          status: STATUS_LABELS[g.status],
          count: g.count,
          billedCents: g.billedCents,
          paidCents: g.paidCents,
          outstandingCents: g.outstandingCents,
        },
        g.suppressed,
        ["count", "billedCents", "paidCents", "outstandingCents"],
      ),
    ),
    totals: {
      status: "Total",
      count: totalCount,
      billedCents: totalBilled,
      paidCents: totalPaid,
      outstandingCents: totalOutstanding,
    },
  };
}

function outcomeRows(groups: OutcomeGroup[]) {
  return groups.map((g) =>
    suppressRow(
      {
        group: g.label,
        overturned: g.overturned,
        upheld: g.upheld,
        overturnRate: g.overturnRate,
        reversedCents: g.reversedCents,
      },
      g.suppressed,
      ["overturned", "upheld", "overturnRate", "reversedCents"],
    ),
  );
}

export function appealOutcomesSheets(byPayer: OutcomeGroup[], byCategory: OutcomeGroup[]): SheetSpec[] {
  const columns: SheetSpec["columns"] = [
    { header: "Group", key: "group", type: "text", width: 24 },
    { header: "Overturned", key: "overturned", type: "number", width: 14 },
    { header: "Upheld", key: "upheld", type: "number", width: 12 },
    { header: "Overturn rate", key: "overturnRate", type: "percent", width: 16 },
    { header: "Denied amount reversed ($)", key: "reversedCents", type: "currency", width: 24 },
  ];
  const NO_DECIDED_APPEALS = "No decided appeals in this period";
  return [
    {
      name: "Appeal outcomes by payer",
      columns,
      rows: outcomeRows(byPayer),
      emptyMessage: NO_DECIDED_APPEALS,
    },
    {
      name: "Appeal outcomes by category",
      columns,
      rows: outcomeRows(byCategory).map((r) => ({
        ...r,
        group: CATEGORY_LABELS[r.group as never] ?? r.group,
      })),
      emptyMessage: NO_DECIDED_APPEALS,
    },
  ];
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
  "patient. When exactly one row in a breakdown would be suppressed, the next-smallest row is " +
  "also suppressed so the hidden value can't be inferred from the others. Totals still reflect " +
  "every row, suppressed or not. ⚠️ VERIFY: the threshold (11) follows CMS's public-use-file " +
  "cell-size suppression convention as a policy baseline, not a Florida statute — confirm with " +
  "counsel.";

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
