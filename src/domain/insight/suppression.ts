/**
 * Small-cell suppression for Insight standard reports (R-8.7, owner decision 2026-09-26). Pure
 * domain logic, no DB access, so it is exercised identically by the on-screen report table and
 * the .xlsx export (`report-sheets.ts` calls this once per sheet and both surfaces render the same
 * suppressed/visible cells — "keep suppression in the domain layer so view and export match").
 */
import { SMALL_CELL_SUPPRESSION_THRESHOLD, suppressedLabel } from "./suppression-config";

export interface SuppressibleGroup {
  /** The row's claim/denial count for this group. */
  count: number;
  /** True when at least one underlying claim belongs to a patient with a sensitivity tag. */
  sensitive: boolean;
}

/**
 * Applies small-cell suppression across one whole sheet's worth of sibling rows — every row that
 * will appear together under one totals row (e.g. every CARC row across every category in the
 * denials-by-category sheet, every payer row, every deadline bucket, every claim status, every
 * appeal-outcome group). Returns, in the same order as `groups`, whether each row is suppressed.
 *
 * Rules:
 * - A count of 0 is never suppressed — there is nothing to reveal.
 * - A row is suppressed when it is sensitive-linked and its count is between 1 and
 *   `SMALL_CELL_SUPPRESSION_THRESHOLD - 1` inclusive.
 * - Complementary suppression: if exactly one row in the set ends up suppressed, the
 *   next-smallest-count row *with a nonzero count* among the remaining, still-visible rows is
 *   also suppressed (even if it is not itself sensitive-linked), so a reader can never back out
 *   the hidden row's value from the other visible rows in the same sheet. A zero-count row is
 *   never chosen as the complement (suppressing "0" reveals nothing and would be misleading). If
 *   every remaining visible row has a count of 0, no complement is chosen — the totals-row
 *   suppression this function's caller applies (see `report-sheets.ts`) still closes the
 *   back-calculation path via Total minus the visible rows.
 *
 * This function decides row-level suppression only. The caller is responsible for also
 * suppressing the sheet's totals row whenever any row here is suppressed (Total − every visible
 * row would otherwise reveal the hidden value or values) — see `suppressTotalsIfAnyRowSuppressed`.
 */
export function applySmallCellSuppression<T extends SuppressibleGroup>(groups: readonly T[]): boolean[] {
  const suppressed = groups.map(
    (g) => g.sensitive && g.count > 0 && g.count < SMALL_CELL_SUPPRESSION_THRESHOLD,
  );
  const suppressedCount = suppressed.filter(Boolean).length;
  if (suppressedCount === 1 && groups.length > 1) {
    let candidateIndex = -1;
    for (let i = 0; i < groups.length; i++) {
      if (suppressed[i]) continue;
      if (groups[i]!.count <= 0) continue; // never pick a zero-count row as the complement
      if (candidateIndex === -1 || groups[i]!.count < groups[candidateIndex]!.count) {
        candidateIndex = i;
      }
    }
    if (candidateIndex !== -1) suppressed[candidateIndex] = true;
  }
  return suppressed;
}

export { suppressedLabel, SMALL_CELL_SUPPRESSION_THRESHOLD };

/**
 * An explicit, typed marker for a suppressed cell — used instead of comparing a cell's rendered
 * text against the marker label, so a genuine data value that happens to match the label text can
 * never be misread as suppressed (or vice versa). `report-sheets.ts` writes this into a row/totals
 * record in place of a real count/dollar/rate value; `workbook.ts` and the on-screen page check
 * for it with `isSuppressedCell` before applying any number/currency/percent formatting.
 */
export interface SuppressedCell {
  readonly suppressed: true;
}

export const SUPPRESSED_CELL: SuppressedCell = Object.freeze({ suppressed: true });

export function isSuppressedCell(value: unknown): value is SuppressedCell {
  return (
    typeof value === "object" && value !== null && (value as { suppressed?: unknown }).suppressed === true
  );
}
