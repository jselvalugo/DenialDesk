/**
 * Pure calculations behind each Insight standard report (docs/specs/insight-standard-reports.md).
 * These take already-fetched rows (no DB access) so every acceptance criterion around sums,
 * counts, and edge cases (zero denominators, unlabeled CARCs, unverified payers) can be unit
 * tested against synthetic fixture rows without a database. The query layer
 * (`src/domain/insight/queries.ts`) fetches rows tenant-scoped and calls these.
 *
 * Small-cell suppression (R-8.7) is NOT decided here: these functions only compute each group's
 * `sensitive` flag (whether ≥1 underlying claim belongs to a sensitivity-tagged patient). Which
 * rows actually get suppressed, and whether the sheet's totals row does too, is decided once per
 * whole sheet in `report-sheets.ts` (after any flattening across sub-groups, e.g. every CARC row
 * across every category) — never per sub-group here — so the decision sees every sibling row that
 * will actually share one totals row, and back-calculation from that total can't slip through a
 * category-sized blind spot.
 */
import { CATEGORY_ORDER, type DenialCategory } from "@/domain/carc";
import { type DeadlineBucket, DEADLINE_BUCKET_ORDER, deadlineBucket } from "./buckets";

// Category enum order, used to break ties when picking a payer's "top category" (spec #2).

function sumBy<T>(rows: T[], get: (row: T) => number): number {
  return rows.reduce((total, row) => total + get(row), 0);
}

// ---------------------------------------------------------------------------------------------
// #1 Denial summary by category and CARC
// ---------------------------------------------------------------------------------------------

export interface DenialCategoryCarcRow {
  category: DenialCategory;
  carc: string;
  deniedCents: number;
  /** True when this denial's claim belongs to a patient carrying a sensitivity tag (R-8.7). */
  patientSensitive: boolean;
}

export interface CarcBreakdown {
  carc: string;
  count: number;
  sumCents: number;
  avgCents: number;
  /** True when ≥1 underlying claim is for a sensitive-tagged patient (R-8.7). */
  sensitive: boolean;
}

export interface CategoryGroup {
  category: DenialCategory;
  count: number;
  sumCents: number;
  avgCents: number;
  carcs: CarcBreakdown[];
}

export function denialsByCategoryReport(rows: DenialCategoryCarcRow[]): CategoryGroup[] {
  const byCategory = new Map<DenialCategory, DenialCategoryCarcRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  const groups: CategoryGroup[] = [];
  for (const [category, categoryRows] of byCategory) {
    const byCarc = new Map<string, DenialCategoryCarcRow[]>();
    for (const row of categoryRows) {
      const list = byCarc.get(row.carc) ?? [];
      list.push(row);
      byCarc.set(row.carc, list);
    }
    const carcs: CarcBreakdown[] = [...byCarc.entries()]
      .map(([carc, carcRows]) => {
        const sumCents = sumBy(carcRows, (r) => r.deniedCents);
        return {
          carc,
          count: carcRows.length,
          sumCents,
          avgCents: Math.round(sumCents / carcRows.length),
          sensitive: carcRows.some((r) => r.patientSensitive),
        };
      })
      .sort((a, b) => b.sumCents - a.sumCents);
    const sumCents = sumBy(categoryRows, (r) => r.deniedCents);
    groups.push({
      category,
      count: categoryRows.length,
      sumCents,
      avgCents: Math.round(sumCents / categoryRows.length),
      carcs,
    });
  }
  return groups.sort((a, b) => b.sumCents - a.sumCents);
}

// ---------------------------------------------------------------------------------------------
// #2 Denial summary by payer
// ---------------------------------------------------------------------------------------------

export interface DenialPayerRow {
  payerId: string;
  payerName: string;
  verified: boolean;
  category: DenialCategory;
  deniedCents: number;
  /** True when this denial's claim belongs to a patient carrying a sensitivity tag (R-8.7). */
  patientSensitive: boolean;
}

export interface PayerGroup {
  payerId: string;
  payerName: string;
  verified: boolean;
  count: number;
  sumCents: number;
  topCategory: DenialCategory;
  sensitive: boolean;
}

export function denialsByPayerReport(rows: DenialPayerRow[]): PayerGroup[] {
  const byPayer = new Map<string, DenialPayerRow[]>();
  for (const row of rows) {
    const list = byPayer.get(row.payerId) ?? [];
    list.push(row);
    byPayer.set(row.payerId, list);
  }
  const groups: PayerGroup[] = [];
  for (const [payerId, payerRows] of byPayer) {
    const byCategory = new Map<DenialCategory, number>();
    for (const row of payerRows) {
      byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.deniedCents);
    }
    let topCategory = payerRows[0]!.category;
    let topCents = -1;
    for (const category of CATEGORY_ORDER) {
      const cents = byCategory.get(category);
      if (cents !== undefined && cents > topCents) {
        topCents = cents;
        topCategory = category;
      }
    }
    groups.push({
      payerId,
      payerName: payerRows[0]!.payerName,
      verified: payerRows[0]!.verified,
      count: payerRows.length,
      sumCents: sumBy(payerRows, (r) => r.deniedCents),
      topCategory,
      sensitive: payerRows.some((r) => r.patientSensitive),
    });
  }
  return groups.sort((a, b) => b.sumCents - a.sumCents);
}

// ---------------------------------------------------------------------------------------------
// #3 Denial rate
// ---------------------------------------------------------------------------------------------

export interface DenialRateResult {
  submittedClaims: number;
  deniedClaims: number;
  /** null when submittedClaims is 0 — never a NaN or Infinity. */
  rate: number | null;
}

export function denialRateReport(submittedClaims: number, deniedClaims: number): DenialRateResult {
  if (submittedClaims < 0 || deniedClaims < 0) {
    throw new Error("denialRateReport expects non-negative counts");
  }
  return {
    submittedClaims,
    deniedClaims,
    rate: submittedClaims === 0 ? null : deniedClaims / submittedClaims,
  };
}

// ---------------------------------------------------------------------------------------------
// #4 Open denials by appeal-deadline bucket
// ---------------------------------------------------------------------------------------------

export interface OpenDenialRow {
  appealDeadline: string | null;
  deniedCents: number;
  /** True when this denial's claim belongs to a patient carrying a sensitivity tag (R-8.7). */
  patientSensitive: boolean;
}

export interface BucketGroup {
  bucket: DeadlineBucket;
  count: number;
  sumCents: number;
  sensitive: boolean;
}

/** Every bucket is present, even at zero, so the report never implies a deadline that isn't set. */
export function denialsByDeadlineBucketReport(rows: OpenDenialRow[], today: string): BucketGroup[] {
  const totals = new Map<DeadlineBucket, { count: number; sumCents: number; sensitive: boolean }>();
  for (const bucket of DEADLINE_BUCKET_ORDER) totals.set(bucket, { count: 0, sumCents: 0, sensitive: false });
  for (const row of rows) {
    const bucket = deadlineBucket(row.appealDeadline, today);
    const entry = totals.get(bucket)!;
    entry.count += 1;
    entry.sumCents += row.deniedCents;
    if (row.patientSensitive) entry.sensitive = true;
  }
  return DEADLINE_BUCKET_ORDER.map((bucket) => ({ bucket, ...totals.get(bucket)! }));
}

// ---------------------------------------------------------------------------------------------
// #5 Claims by status / A/R summary
// ---------------------------------------------------------------------------------------------

export type ClaimStatus =
  "draft" | "submitted" | "acknowledged" | "rejected" | "paid" | "partially_paid" | "denied" | "closed";

export const CLAIM_STATUS_ORDER: ClaimStatus[] = [
  "draft",
  "submitted",
  "acknowledged",
  "rejected",
  "paid",
  "partially_paid",
  "denied",
  "closed",
];

export interface ClaimStatusRow {
  status: ClaimStatus;
  billedCents: number;
  paidCents: number;
  /** True when this claim belongs to a patient carrying a sensitivity tag (R-8.7). */
  patientSensitive: boolean;
}

export interface StatusGroup {
  status: ClaimStatus;
  count: number;
  billedCents: number;
  paidCents: number;
  outstandingCents: number;
  sensitive: boolean;
}

export function claimsByStatusReport(rows: ClaimStatusRow[]): StatusGroup[] {
  const byStatus = new Map<ClaimStatus, ClaimStatusRow[]>();
  for (const row of rows) {
    const list = byStatus.get(row.status) ?? [];
    list.push(row);
    byStatus.set(row.status, list);
  }
  return CLAIM_STATUS_ORDER.filter((status) => byStatus.has(status)).map((status) => {
    const statusRows = byStatus.get(status)!;
    const billedCents = sumBy(statusRows, (r) => r.billedCents);
    const paidCents = sumBy(statusRows, (r) => r.paidCents);
    return {
      status,
      count: statusRows.length,
      billedCents,
      paidCents,
      outstandingCents: billedCents - paidCents,
      sensitive: statusRows.some((r) => r.patientSensitive),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// #6 Appeal outcomes
// ---------------------------------------------------------------------------------------------

export interface AppealOutcomeRow {
  key: string;
  label: string;
  status: "overturned" | "upheld";
  deniedCents: number;
  /** True when this denial's claim belongs to a patient carrying a sensitivity tag (R-8.7). */
  patientSensitive: boolean;
}

export interface OutcomeGroup {
  key: string;
  label: string;
  overturned: number;
  upheld: number;
  /** null when overturned + upheld === 0 ("No decided appeals in this period"). */
  overturnRate: number | null;
  /** Denied amount on overturned rows — an upper bound, not a captured payment (spec #6). */
  reversedCents: number;
  sensitive: boolean;
}

function groupOutcomes(rows: AppealOutcomeRow[]): OutcomeGroup[] {
  const byKey = new Map<string, AppealOutcomeRow[]>();
  for (const row of rows) {
    const list = byKey.get(row.key) ?? [];
    list.push(row);
    byKey.set(row.key, list);
  }
  const groups: OutcomeGroup[] = [];
  for (const [key, keyRows] of byKey) {
    const overturned = keyRows.filter((r) => r.status === "overturned");
    const upheld = keyRows.filter((r) => r.status === "upheld");
    const decided = overturned.length + upheld.length;
    groups.push({
      key,
      label: keyRows[0]!.label,
      overturned: overturned.length,
      upheld: upheld.length,
      overturnRate: decided === 0 ? null : overturned.length / decided,
      reversedCents: sumBy(overturned, (r) => r.deniedCents),
      sensitive: keyRows.some((r) => r.patientSensitive),
    });
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label));
}

export interface AppealOutcomesReport {
  byPayer: OutcomeGroup[];
  byCategory: OutcomeGroup[];
}

export function appealOutcomesReport(
  byPayerRows: AppealOutcomeRow[],
  byCategoryRows: AppealOutcomeRow[],
): AppealOutcomesReport {
  return { byPayer: groupOutcomes(byPayerRows), byCategory: groupOutcomes(byCategoryRows) };
}
