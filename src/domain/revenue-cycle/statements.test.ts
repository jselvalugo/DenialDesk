import { describe, expect, it } from "vitest";
import { denialsByClass, incomeStatement, kpis, type MonthActivity } from "./statements";

const jan = { periodYear: 2026, periodMonth: 1 };
const feb = { periodYear: 2026, periodMonth: 2 };

describe("incomeStatement", () => {
  it("lists charges by revenue account less adjustments by adjustment account, per month", () => {
    const names = new Map([
      ["4000", "Patient service revenue — commercial"],
      ["4050", "Adjustments and write-offs — commercial"],
      ["4900", "Prompt-pay interest income"],
    ]);
    const statement = incomeStatement(
      [jan, feb],
      [
        { ...jan, account: "4000", cents: 10_000 },
        { ...feb, account: "4000", cents: 12_000 },
        { ...feb, account: "4900", cents: 300 },
        { ...feb, account: "4999", cents: 0 }, // zero rows are dropped
        { periodYear: 2025, periodMonth: 12, account: "4000", cents: 99 }, // outside the months
      ],
      [
        { ...jan, account: "4050", cents: 4_000 },
        { ...feb, account: "4050", cents: 5_000 },
        { ...feb, account: "4060", cents: 100 },
      ],
      names,
    );
    expect(statement.revenue.map((r) => [r.account, r.byMonth, r.totalCents])).toEqual([
      ["4000", [10_000, 12_000], 22_000],
      ["4900", [0, 300], 300],
    ]);
    expect(statement.deductions.map((r) => [r.account, r.name])).toEqual([
      ["4050", "Adjustments and write-offs — commercial"],
      ["4060", "Not in the chart of accounts"],
    ]);
    expect(statement.grossCents).toEqual([10_000, 12_300]);
    expect(statement.deductionCents).toEqual([4_000, 5_100]);
    expect(statement.netCents).toEqual([6_000, 7_200]);
  });
});

describe("kpis", () => {
  const month = (m: number, net: number, payments: number, year = 2026): MonthActivity => ({
    periodYear: year,
    periodMonth: m,
    netRevenueCents: net,
    paymentsCents: payments,
  });

  it("uses the latest month and trails ratios over three calendar months", () => {
    // Feb 28 + Mar 31 + Apr 30 = 89 days; revenue 8,900.00 → 100.00 a day; A/R 4,500.00 → 45 days.
    const result = kpis(
      [
        month(1, 999_999, 1),
        month(3, 300_000, 250_000),
        month(4, 290_000, 270_000),
        month(2, 300_000, 280_000),
      ],
      450_000,
    )!;
    expect(result.latest).toEqual({ periodYear: 2026, periodMonth: 4 });
    expect(result).toMatchObject({ netRevenueCents: 290_000, paymentsCents: 270_000, openArCents: 450_000 });
    expect(result.daysInAr).toBe(45);
    expect(result.netCollectionBps).toBe(Math.round((800_000 * 10_000) / 890_000));
    expect(result.trailingMonths).toBe(3);
  });

  it("uses the open A/R it is given, so credit balances don't shorten days in A/R", () => {
    // Open balances 3,100.00 with a 100.00 credit elsewhere: days use 3,100.00, not the net 3,000.00.
    const result = kpis([month(1, 310_000, 0)], 310_000)!;
    expect(result.daysInAr).toBe(31);
  });

  it("leaves out months beyond three calendar months after a gap, across a year end", () => {
    // Nov 2025 is four months before Feb 2026, so only Dec (31) + Feb (28) count.
    const result = kpis(
      [month(11, 900_000, 900_000, 2025), month(12, 310_000, 0, 2025), month(2, 280_000, 0)],
      0,
    )!;
    expect(result.trailingMonths).toBe(2);
    expect(result.netCollectionBps).toBe(0);
  });

  it("returns no ratios without revenue, and nothing without months", () => {
    expect(kpis([month(1, 0, 0)], 500)).toMatchObject({ daysInAr: null, netCollectionBps: null });
    expect(kpis([], 0)).toBeNull();
  });
});

describe("denialsByClass", () => {
  it("maps denials to classes through the regime, first class by code, and reports the rest", () => {
    const result = denialsByClass(
      [
        { regime: "fl_insurer", count: 2, deniedCents: 5_000 },
        { regime: "medicare", count: 1, deniedCents: 9_000 },
        { regime: "pip", count: 1, deniedCents: 700 },
      ],
      [
        { code: "MCR", regime: "medicare" },
        { code: "COMM", regime: "fl_insurer" },
        { code: "COMM2", regime: "fl_insurer" },
        { code: "SELF", regime: null },
      ],
    );
    expect(result).toEqual([
      { payerClass: "MCR", count: 1, deniedCents: 9_000 },
      { payerClass: "COMM", count: 2, deniedCents: 5_000 },
      { payerClass: "Unmapped", count: 1, deniedCents: 700 },
    ]);
  });

  it("reports an unverified payer's denials (null regime) as Unmapped, not a crash (spec: payer-catalog P1)", () => {
    const result = denialsByClass(
      [
        { regime: "fl_insurer", count: 1, deniedCents: 1_000 },
        { regime: null, count: 3, deniedCents: 4_400 },
      ],
      [{ code: "COMM", regime: "fl_insurer" }],
    );
    expect(result).toEqual([
      { payerClass: "Unmapped", count: 3, deniedCents: 4_400 },
      { payerClass: "COMM", count: 1, deniedCents: 1_000 },
    ]);
  });
});
