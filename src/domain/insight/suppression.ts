/**
 * Small-cell suppression for Insight standard reports (R-8.7, owner decision 2026-09-26). Pure
 * domain logic, no DB access, so it is exercised identically by the on-screen report table and
 * the .xlsx export (`report-sheets.ts` calls this once per report and both surfaces render the
 * same suppressed/visible flags — "keep suppression in the domain layer so view and export
 * match").
 */
import { SMALL_CELL_SUPPRESSION_THRESHOLD, suppressedLabel } from "./suppression-config";

export interface SuppressibleGroup {
  /** The row's claim/denial count for this group. */
  count: number;
  /** True when at least one underlying claim belongs to a patient with a sensitivity tag. */
  sensitive: boolean;
}

/**
 * Applies small-cell suppression across one set of sibling rows that would otherwise appear
 * together in a report (e.g. every CARC row within one denial category, every payer row, every
 * deadline bucket, every claim status, every appeal-outcome group). Returns, in the same order as
 * `groups`, whether each row is suppressed.
 *
 * Rules:
 * - A count of 0 is never suppressed — there is nothing to reveal.
 * - A row is suppressed when it is sensitive-linked and its count is between 1 and
 *   `SMALL_CELL_SUPPRESSION_THRESHOLD - 1` inclusive.
 * - Complementary suppression: if exactly one row in the set ends up suppressed, the
 *   next-smallest-count row among the remaining, still-visible rows is also suppressed (even if
 *   it is not itself sensitive-linked), so a reader can never back out the hidden row's value from
 *   the other visible rows in the same set. With only two rows in the set, this suppresses both.
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
      if (candidateIndex === -1 || groups[i]!.count < groups[candidateIndex]!.count) {
        candidateIndex = i;
      }
    }
    if (candidateIndex !== -1) suppressed[candidateIndex] = true;
  }
  return suppressed;
}

export { suppressedLabel, SMALL_CELL_SUPPRESSION_THRESHOLD };

/** True when a sheet/table cell value is the suppression marker, regardless of the column's type. */
export function isSuppressedValue(value: string | number | null): boolean {
  return value === suppressedLabel();
}
