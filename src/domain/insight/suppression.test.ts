import { describe, expect, it } from "vitest";
import { applySmallCellSuppression, isSuppressedCell, SUPPRESSED_CELL, suppressedLabel } from "./suppression";
import { SMALL_CELL_SUPPRESSION_THRESHOLD } from "./suppression-config";

describe("applySmallCellSuppression", () => {
  it("suppresses a sensitive row at the threshold boundary: 10 suppressed, 11 shown", () => {
    expect(SMALL_CELL_SUPPRESSION_THRESHOLD).toBe(11);
    // A lone row (no siblings), so complementary suppression (which only applies when there is
    // more than one row) cannot interfere with the plain threshold check being tested here.
    expect(applySmallCellSuppression([{ count: 10, sensitive: true }])).toEqual([true]);
    expect(applySmallCellSuppression([{ count: 11, sensitive: true }])).toEqual([false]);
  });

  it("never suppresses a count of 0, even if sensitive", () => {
    const groups = [{ count: 0, sensitive: true }];
    expect(applySmallCellSuppression(groups)).toEqual([false]);
  });

  it("leaves non-sensitive rows unaffected regardless of count", () => {
    const groups = [
      { count: 1, sensitive: false },
      { count: 5, sensitive: false },
      { count: 10, sensitive: false },
    ];
    expect(applySmallCellSuppression(groups)).toEqual([false, false, false]);
  });

  it("applies complementary suppression: exactly one suppressed row also hides the next-smallest visible row", () => {
    const groups = [
      { count: 3, sensitive: true }, // suppressed on its own
      { count: 50, sensitive: false },
      { count: 20, sensitive: false }, // next-smallest of the remaining visible rows
    ];
    expect(applySmallCellSuppression(groups)).toEqual([true, false, true]);
  });

  it("suppresses both rows of a two-row group when one would otherwise be suppressed alone", () => {
    const groups = [
      { count: 1, sensitive: true },
      { count: 3, sensitive: false },
    ];
    expect(applySmallCellSuppression(groups)).toEqual([true, true]);
  });

  it("does not add complementary suppression when zero or more than one row is already suppressed", () => {
    expect(
      applySmallCellSuppression([
        { count: 5, sensitive: false },
        { count: 8, sensitive: false },
      ]),
    ).toEqual([false, false]);

    expect(
      applySmallCellSuppression([
        { count: 3, sensitive: true },
        { count: 4, sensitive: true },
        { count: 100, sensitive: false },
      ]),
    ).toEqual([true, true, false]);
  });

  it("does not add complementary suppression to a lone suppressed row with no siblings", () => {
    expect(applySmallCellSuppression([{ count: 2, sensitive: true }])).toEqual([true]);
  });

  it("never picks a zero-count row as the complement, even if it is the smallest remaining", () => {
    // Deadline-bucket-shaped case: one small sensitive row, one empty bucket, one large bucket.
    // The zero-count row must never be "the complement" — there's nothing to hide in a 0, and
    // suppressing it would be misleading, not protective.
    const groups = [
      { count: 3, sensitive: true },
      { count: 0, sensitive: false },
      { count: 40, sensitive: false },
    ];
    expect(applySmallCellSuppression(groups)).toEqual([true, false, true]);
  });

  it("chooses no complement at all when every other row has a zero count", () => {
    const groups = [
      { count: 3, sensitive: true },
      { count: 0, sensitive: false },
    ];
    expect(applySmallCellSuppression(groups)).toEqual([true, false]);
  });
});

describe("suppressedLabel / isSuppressedCell", () => {
  it("labels the suppression marker with the configured threshold", () => {
    expect(suppressedLabel()).toBe("Suppressed (<11)");
  });

  it("recognizes only the typed suppressed-cell marker, never a string comparison", () => {
    expect(isSuppressedCell(SUPPRESSED_CELL)).toBe(true);
    expect(isSuppressedCell({ suppressed: true })).toBe(true);
    // A genuine value that happens to read like the label is never mistaken for the marker.
    expect(isSuppressedCell(suppressedLabel())).toBe(false);
    expect(isSuppressedCell(11)).toBe(false);
    expect(isSuppressedCell("Suppressed")).toBe(false);
    expect(isSuppressedCell(null)).toBe(false);
    expect(isSuppressedCell(undefined)).toBe(false);
  });
});
