import { describe, expect, it } from "vitest";
import {
  appealOutcomesSheets,
  claimsByStatusSheet,
  denialsByCategorySheet,
  denialsByDeadlineBucketSheet,
  denialsByPayerSheet,
} from "./report-sheets";
import { isSuppressedCell } from "./suppression";
import type { BucketGroup, CategoryGroup, OutcomeGroup, PayerGroup, StatusGroup } from "./calculations";

/**
 * These tests exercise the actual sheet output (what both the on-screen table and the .xlsx
 * export render), not the raw group data — the small-cell suppression decision (R-8.7) lives in
 * this file, not in `calculations.ts`.
 */

function sumVisible(values: (number | { suppressed: true })[]): number | null {
  // Mirrors what a reader of the sheet could compute: sum only the cells they can actually read.
  // Returns null once any input is itself suppressed (they can't sum what they can't see).
  let total = 0;
  for (const v of values) {
    if (isSuppressedCell(v)) return null;
    total += v;
  }
  return total;
}

describe("denialsByPayerSheet — small-cell suppression (R-8.7)", () => {
  it("suppresses a single-row sheet's lone row and its totals row", () => {
    const groups: PayerGroup[] = [
      {
        payerId: "p1",
        payerName: "Solo Payer",
        verified: true,
        count: 3,
        sumCents: 900,
        topCategory: "coding",
        sensitive: true,
      },
    ];
    const sheet = denialsByPayerSheet(groups);
    expect(isSuppressedCell(sheet.rows[0]!.count)).toBe(true);
    expect(isSuppressedCell(sheet.rows[0]!.sumCents)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.count)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.sumCents)).toBe(true);
  });

  it("for every suppressed row, Total minus the visible rows can never reconstruct it (totals suppressed too)", () => {
    const groups: PayerGroup[] = [
      {
        payerId: "p1",
        payerName: "Sensitive",
        verified: true,
        count: 2,
        sumCents: 200,
        topCategory: "coding",
        sensitive: true,
      },
      {
        payerId: "p2",
        payerName: "Medium",
        verified: true,
        count: 5,
        sumCents: 500,
        topCategory: "coding",
        sensitive: false,
      },
      {
        payerId: "p3",
        payerName: "Huge",
        verified: true,
        count: 500,
        sumCents: 50_000,
        topCategory: "coding",
        sensitive: false,
      },
    ];
    const sheet = denialsByPayerSheet(groups);
    const suppressedRows = sheet.rows.filter((r) => isSuppressedCell(r.count));
    expect(suppressedRows.length).toBeGreaterThan(0);
    // The totals row must be suppressed whenever any row is, so a reader can never compute
    // Total − (every visible row) and land on a suppressed row's true value.
    expect(isSuppressedCell(sheet.totals!.count)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.sumCents)).toBe(true);
    // Even if it weren't, summing the still-visible rows is impossible once any row is hidden.
    const visibleCounts = sheet.rows.map((r) => r.count as number | { suppressed: true });
    expect(sumVisible(visibleCounts)).toBeNull();
  });

  it("leaves rows and totals alone when nothing is sensitive, regardless of count", () => {
    const groups: PayerGroup[] = [
      {
        payerId: "p1",
        payerName: "A",
        verified: true,
        count: 1,
        sumCents: 100,
        topCategory: "coding",
        sensitive: false,
      },
      {
        payerId: "p2",
        payerName: "B",
        verified: true,
        count: 2,
        sumCents: 200,
        topCategory: "coding",
        sensitive: false,
      },
    ];
    const sheet = denialsByPayerSheet(groups);
    expect(sheet.rows.every((r) => !isSuppressedCell(r.count))).toBe(true);
    expect(isSuppressedCell(sheet.totals!.count)).toBe(false);
    expect(sheet.totals!.count).toBe(3);
  });
});

describe("denialsByCategorySheet — small-cell suppression applies across the whole flattened sheet", () => {
  it("suppresses a small sensitive CARC row even when it's alone in its own category (cross-category complement)", () => {
    const groups: CategoryGroup[] = [
      {
        category: "coding",
        count: 2,
        sumCents: 200,
        avgCents: 100,
        carcs: [{ carc: "11", count: 2, sumCents: 200, avgCents: 100, sensitive: true }],
      },
      {
        category: "eligibility",
        count: 500,
        sumCents: 50_000,
        avgCents: 100,
        carcs: [{ carc: "27", count: 500, sumCents: 50_000, avgCents: 100, sensitive: false }],
      },
    ];
    const sheet = denialsByCategorySheet(groups);
    const codingRow = sheet.rows.find((r) => r.carc === "11")!;
    const eligRow = sheet.rows.find((r) => r.carc === "27")!;
    expect(isSuppressedCell(codingRow.count)).toBe(true);
    // Complementary suppression reaches across categories — the whole sheet is one sibling set.
    expect(isSuppressedCell(eligRow.count)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.count)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.sumCents)).toBe(true);
  });
});

describe("denialsByDeadlineBucketSheet — never picks a zero-count bucket as the complement", () => {
  it("suppresses the small sensitive bucket, leaves the zero-count buckets alone, and suppresses totals", () => {
    const groups: BucketGroup[] = [
      { bucket: "past_deadline", count: 0, sumCents: 0, sensitive: false },
      { bucket: "0-7", count: 3, sumCents: 300, sensitive: true },
      { bucket: "8-30", count: 0, sumCents: 0, sensitive: false },
      { bucket: "31-plus", count: 40, sumCents: 4_000, sensitive: false },
      { bucket: "no_deadline", count: 0, sumCents: 0, sensitive: false },
    ];
    const sheet = denialsByDeadlineBucketSheet(groups);
    const rowFor = (bucket: string) => sheet.rows.find((r) => r.bucket === bucket)!;
    expect(isSuppressedCell(rowFor("Past deadline").count)).toBe(false);
    expect(rowFor("Past deadline").count).toBe(0);
    expect(isSuppressedCell(rowFor("0–7 days").count)).toBe(true);
    expect(isSuppressedCell(rowFor("8–30 days").count)).toBe(false);
    expect(rowFor("8–30 days").count).toBe(0);
    expect(isSuppressedCell(rowFor("No deadline configured").count)).toBe(false);
    expect(rowFor("No deadline configured").count).toBe(0);
    // "31+ days" (count 40) is the only nonzero, not-yet-suppressed row, so it becomes the
    // complement (the zero-count buckets were correctly skipped as candidates, but a complement
    // still has to be picked from whatever nonzero rows remain).
    expect(isSuppressedCell(rowFor("31+ days").count)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.count)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.sumCents)).toBe(true);
  });

  it("suppresses no complement at all when the only other bucket is zero (nothing eligible to hide behind)", () => {
    const groups: BucketGroup[] = [
      { bucket: "past_deadline", count: 0, sumCents: 0, sensitive: false },
      { bucket: "0-7", count: 3, sumCents: 300, sensitive: true },
      { bucket: "8-30", count: 0, sumCents: 0, sensitive: false },
      { bucket: "31-plus", count: 0, sumCents: 0, sensitive: false },
      { bucket: "no_deadline", count: 0, sumCents: 0, sensitive: false },
    ];
    const sheet = denialsByDeadlineBucketSheet(groups);
    const suppressedCount = sheet.rows.filter((r) => isSuppressedCell(r.count)).length;
    expect(suppressedCount).toBe(1); // only the sensitive row — no zero-count row was chosen
    // The totals row still gets suppressed, closing the back-calculation path Total − zeros = it.
    expect(isSuppressedCell(sheet.totals!.count)).toBe(true);
  });
});

describe("claimsByStatusSheet — suppresses every numeric column and the totals row", () => {
  it("suppresses billed/paid/outstanding on a small sensitive status row, and the totals row", () => {
    const groups: StatusGroup[] = [
      {
        status: "denied",
        count: 2,
        billedCents: 500,
        paidCents: 0,
        outstandingCents: 500,
        sensitive: true,
      },
      {
        status: "paid",
        count: 500,
        billedCents: 100_000,
        paidCents: 100_000,
        outstandingCents: 0,
        sensitive: false,
      },
    ];
    const sheet = claimsByStatusSheet(groups);
    const deniedRow = sheet.rows.find((r) => r.status === "Denied")!;
    expect(isSuppressedCell(deniedRow.count)).toBe(true);
    expect(isSuppressedCell(deniedRow.billedCents)).toBe(true);
    expect(isSuppressedCell(deniedRow.paidCents)).toBe(true);
    expect(isSuppressedCell(deniedRow.outstandingCents)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.billedCents)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.paidCents)).toBe(true);
    expect(isSuppressedCell(sheet.totals!.outstandingCents)).toBe(true);
  });
});

describe("appealOutcomesSheets — suppresses the outcome totals row too", () => {
  it("suppresses a small sensitive group's outcome counts and the sheet's totals row", () => {
    const byPayer: OutcomeGroup[] = [
      {
        key: "p1",
        label: "Sensitive Payer",
        overturned: 1,
        upheld: 1,
        overturnRate: 0.5,
        reversedCents: 100,
        sensitive: true,
      },
      {
        key: "p2",
        label: "Bulk Payer",
        overturned: 200,
        upheld: 100,
        overturnRate: 2 / 3,
        reversedCents: 20_000,
        sensitive: false,
      },
    ];
    const byPayerSheet = appealOutcomesSheets(byPayer, [])[0]!;
    const sensitiveRow = byPayerSheet.rows.find((r) => r.group === "Sensitive Payer")!;
    expect(isSuppressedCell(sensitiveRow.overturned)).toBe(true);
    expect(isSuppressedCell(sensitiveRow.upheld)).toBe(true);
    expect(isSuppressedCell(sensitiveRow.overturnRate)).toBe(true);
    expect(isSuppressedCell(sensitiveRow.reversedCents)).toBe(true);
    expect(isSuppressedCell(byPayerSheet.totals!.overturned)).toBe(true);
    expect(isSuppressedCell(byPayerSheet.totals!.upheld)).toBe(true);
    expect(isSuppressedCell(byPayerSheet.totals!.overturnRate)).toBe(true);
    expect(isSuppressedCell(byPayerSheet.totals!.reversedCents)).toBe(true);
  });

  it("leaves totals unsuppressed and present when nothing is sensitive", () => {
    const byPayer: OutcomeGroup[] = [
      {
        key: "p1",
        label: "A",
        overturned: 1,
        upheld: 1,
        overturnRate: 0.5,
        reversedCents: 100,
        sensitive: false,
      },
    ];
    const byPayerSheet = appealOutcomesSheets(byPayer, [])[0]!;
    expect(isSuppressedCell(byPayerSheet.totals!.overturned)).toBe(false);
    expect(byPayerSheet.totals!.overturned).toBe(1);
  });

  it("suppresses both sheets' totals together when only the by-payer sheet has a suppressed row (same underlying decided appeals)", () => {
    // Both sheets group the very same set of decided appeals — one by payer, one by category —
    // so they share one true grand total. If the by-category sheet's totals stayed visible while
    // the by-payer sheet's were suppressed, a reader could read the true total off the
    // by-category sheet and use it to back out the by-payer sheet's suppressed row.
    const byPayer: OutcomeGroup[] = [
      {
        key: "p1",
        label: "Sensitive Payer",
        overturned: 1,
        upheld: 1,
        overturnRate: 0.5,
        reversedCents: 100,
        sensitive: true,
      },
      {
        key: "p2",
        label: "Bulk Payer",
        overturned: 200,
        upheld: 100,
        overturnRate: 2 / 3,
        reversedCents: 20_000,
        sensitive: false,
      },
    ];
    // Grouped by category instead: same total decided count (202 overturned, 101 upheld), no row
    // here is itself suppressed (no sensitive category row, and none is under the threshold).
    const byCategory: OutcomeGroup[] = [
      {
        key: "coding",
        label: "coding",
        overturned: 201,
        upheld: 101,
        overturnRate: 201 / 302,
        reversedCents: 20_100,
        sensitive: false,
      },
    ];
    const [byPayerSheet, byCategorySheet] = appealOutcomesSheets(byPayer, byCategory);
    // The by-payer sheet has a suppressed row, as before.
    expect(isSuppressedCell(byPayerSheet!.totals!.overturned)).toBe(true);
    // The by-category sheet has no suppressed row of its own, but its totals must be suppressed
    // too, since they equal the by-payer sheet's true (suppressed) totals.
    expect(byCategorySheet!.rows.every((r) => !isSuppressedCell(r.overturned))).toBe(true);
    expect(isSuppressedCell(byCategorySheet!.totals!.overturned)).toBe(true);
    expect(isSuppressedCell(byCategorySheet!.totals!.upheld)).toBe(true);
    expect(isSuppressedCell(byCategorySheet!.totals!.overturnRate)).toBe(true);
    expect(isSuppressedCell(byCategorySheet!.totals!.reversedCents)).toBe(true);
  });
});
