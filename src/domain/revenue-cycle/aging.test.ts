import { describe, expect, it } from "vitest";
import {
  ageReceivables,
  agingTotals,
  bucketFor,
  parseDepositFile,
  reconcileDeposits,
  rollForward,
  type MonthTotals,
} from "./aging";
import { depositsToCsv, generateDeposits, generateMonthlyFiles } from "./synthetic-file";

const OPEN = { syntheticOnly: false };

describe("bucketFor", () => {
  it.each([
    ["2026-03-31", "0_30"], // same day
    ["2026-03-01", "0_30"], // 30 days
    ["2026-02-28", "31_60"], // 31 days
    ["2026-01-30", "31_60"], // 60 days
    ["2026-01-29", "61_90"], // 61 days
    ["2025-12-31", "61_90"], // 90 days
    ["2025-12-30", "91_120"], // 91 days
    ["2025-12-01", "91_120"], // 120 days
    ["2025-11-30", "over_120"], // 121 days
    ["2026-04-02", "0_30"], // service after the month end is treated as current
  ])("%s as of 2026-03-31 → %s", (date, bucket) => expect(bucketFor(date, "2026-03-31")).toBe(bucket));
});

describe("ageReceivables", () => {
  it("ages open balances by class, lists credit balances apart, and skips closed lines", () => {
    const aging = ageReceivables(
      agingTotals(
        [
          { payerClass: "COMM", serviceDate: "2026-03-20", balanceCents: 10_000 },
          { payerClass: "COMM", serviceDate: "2025-10-01", balanceCents: 2_500 },
          { payerClass: "SELF", serviceDate: "2026-02-10", balanceCents: 4_000 },
          { payerClass: "SELF", serviceDate: "2026-02-10", balanceCents: 0 },
          { payerClass: "MCR", serviceDate: "2026-01-05", balanceCents: -700 },
        ],
        "2026-03-31",
      ),
    );
    expect(
      aging.rows.map((r) => [r.payerClass, r.totalCents, r.buckets["0_30"], r.buckets.over_120]),
    ).toEqual([
      ["COMM", 12_500, 10_000, 2_500],
      ["SELF", 4_000, 0, 0],
    ]);
    expect(aging.rows[1]!.buckets["31_60"]).toBe(4_000);
    expect(aging.totals.totalCents).toBe(16_500);
    expect(Object.values(aging.totals.buckets).reduce((a, b) => a + b, 0)).toBe(16_500);
    expect(aging.credits).toEqual([{ payerClass: "MCR", lines: 1, totalCents: -700 }]);
  });
});

describe("rollForward", () => {
  const month = (m: number, o: Partial<MonthTotals>): MonthTotals => ({
    periodYear: 2026,
    periodMonth: m,
    chargesCents: 0,
    paymentsCents: 0,
    adjustmentsCents: 0,
    balanceCents: 0,
    ...o,
  });

  it("explains each month from the prior one and reports differences", () => {
    const rows = rollForward([
      month(2, { chargesCents: 1_000, paymentsCents: 300, adjustmentsCents: 200, balanceCents: 5_500 }),
      month(1, { balanceCents: 5_000 }),
      month(3, { chargesCents: 100, balanceCents: 5_590 }),
      month(5, { balanceCents: 9 }),
    ]);
    expect(rows.map((r) => [r.periodMonth, r.openingCents, r.unexplainedCents])).toEqual([
      [1, null, null],
      [2, 5_000, 0],
      [3, 5_500, -10], // a missing line or an incomplete export
      [5, null, null], // April wasn't imported
    ]);
  });

  it("holds exactly for the synthetic simulation", () => {
    const files = generateMonthlyFiles({
      seed: 9,
      periodYear: 2026,
      periodMonth: 6,
      months: 5,
      facilities: [],
    });
    const sum = (
      lines: (typeof files)[number]["lines"],
      key: "billedCents" | "paymentCents" | "adjustmentCents" | "balanceCents",
    ) => lines.reduce((t, l) => t + l[key], 0);
    const rows = rollForward(
      files.map((f) => ({
        periodYear: f.periodYear,
        periodMonth: f.periodMonth,
        chargesCents: sum(f.lines, "billedCents"),
        paymentsCents: sum(f.lines, "paymentCents"),
        adjustmentsCents: sum(f.lines, "adjustmentCents"),
        balanceCents: sum(f.lines, "balanceCents"),
      })),
    );
    expect(rows.slice(1).every((r) => r.unexplainedCents === 0)).toBe(true);
  });
});

describe("reconcileDeposits", () => {
  it("tracks payments posted but not deposited as the running difference", () => {
    const rows = reconcileDeposits(
      [
        { periodYear: 2026, periodMonth: 2, paymentsCents: 900 },
        { periodYear: 2026, periodMonth: 1, paymentsCents: 1_000 },
        { periodYear: 2026, periodMonth: 3, paymentsCents: 500 },
      ],
      [
        { depositDate: "2026-01-15", amountCents: 950 },
        { depositDate: "2026-02-03", amountCents: 50 },
        { depositDate: "2026-02-20", amountCents: 300 },
        { depositDate: "2026-03-10", amountCents: 1_200 },
        { depositDate: "2025-12-31", amountCents: 1 }, // outside the months shown
      ],
    );
    expect(
      rows.map((r) => [r.periodMonth, r.depositsCents, r.differenceCents, r.clearingCents, r.alert]),
    ).toEqual([
      [1, 950, 50, 50, false], // 5% of the month's payments: normal lag
      [2, 350, 550, 600, true], // over half the month's payments undeposited
      [3, 1_200, -700, -100, false], // deposits ran ahead of posting (negative)
    ]);
  });

  it("restarts after a missing month", () => {
    const rows = reconcileDeposits(
      [
        { periodYear: 2026, periodMonth: 1, paymentsCents: 1_000 },
        { periodYear: 2026, periodMonth: 3, paymentsCents: 500 },
      ],
      [{ depositDate: "2026-03-05", amountCents: 400 }],
    );
    expect(rows.map((r) => [r.clearingCents, r.afterGap])).toEqual([
      [1_000, false],
      [100, true],
    ]);
  });

  it("clears to the in-transit share for the synthetic deposits", () => {
    const files = generateMonthlyFiles({
      seed: 4,
      periodYear: 2026,
      periodMonth: 3,
      months: 3,
      facilities: [],
    });
    const deposits = generateDeposits(files, 4);
    const rows = reconcileDeposits(
      files.map((f) => ({
        periodYear: f.periodYear,
        periodMonth: f.periodMonth,
        paymentsCents: f.lines.reduce((t, l) => t + l.paymentCents, 0),
      })),
      deposits,
    );
    const lastMonthDeposits = deposits.filter((d) => d.depositDate.startsWith("2026-03"));
    expect(rows.at(-1)!.clearingCents).toBeGreaterThan(0);
    expect(rows.at(-1)!.clearingCents).toBeLessThan(rows.at(-1)!.paymentsCents);
    expect(lastMonthDeposits.length).toBeGreaterThan(0);
  });
});

describe("parseDepositFile", () => {
  it("reads only the date and amount, ignoring other columns", () => {
    const result = parseDepositFile(
      'Posted Date,Description,Account,Amount\n03/02/2026,"EFT Harbor Plan",****1234,"$1,250.00"\n3/9/2026,Lockbox,****1234,(20.00)\n',
      OPEN,
    );
    expect(result).toEqual({
      ok: true,
      deposits: [
        { rowNumber: 2, depositDate: "2026-03-02", amountCents: 125_000 },
        { rowNumber: 3, depositDate: "2026-03-09", amountCents: -2_000 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("1234");
  });

  it("rejects the whole file on bad rows without echoing values", () => {
    const result = parseDepositFile("Date,Amount\n02/30/2026,12\n03/01/2026,12x5\n03/02/2026,0\n", OPEN);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.map((p) => p.row)).toEqual([2, 3, 4]);
    expect(JSON.stringify(result)).not.toContain("12x5");
  });

  it("accepts only marked synthetic files where synthetic-only applies, and plausible dates", () => {
    const unmarked = parseDepositFile("Date,Amount\n03/01/2026,1.00\n", { syntheticOnly: true });
    expect(!unmarked.ok && unmarked.problems[0]!.message).toMatch(/synthetic deposit files only/);
    const wrong = parseDepositFile("Date,Amount,Synthetic marker\n03/01/2026,1.00,REAL\n", {
      syntheticOnly: true,
    });
    expect(!wrong.ok && wrong.problems[0]!.message).toMatch(/Synthetic marker/);
    const marked = parseDepositFile("Date,Amount,Synthetic marker\n03/01/2026,1.00,SYN-DEPOSIT\n", {
      syntheticOnly: true,
    });
    expect(marked.ok).toBe(true);
    expect(parseDepositFile("Date,Amount\n03/01/1999,1.00\n", OPEN).ok).toBe(false);
  });

  it("names blank amounts and ignores the Credit column of debit/credit exports", () => {
    const blank = parseDepositFile("Date,Amount\n03/01/2026,\n", OPEN);
    expect(!blank.ok && blank.problems[0]!.message).toBe("Amount is blank.");
    expect(parseDepositFile("Date,Debit,Credit\n03/01/2026,5.00,\n", OPEN).ok).toBe(false);
  });

  it("needs exactly one date and one amount column", () => {
    expect(parseDepositFile("Date,Amount,Deposit amount\n03/01/2026,1,1\n", OPEN).ok).toBe(false);
    expect(parseDepositFile("When,Amount\n03/01/2026,1\n", OPEN).ok).toBe(false);
    expect(parseDepositFile("Date,Amount\n", OPEN).ok).toBe(false);
  });

  it("round-trips synthetic deposits", () => {
    const files = generateMonthlyFiles({
      seed: 2,
      periodYear: 2026,
      periodMonth: 3,
      months: 2,
      facilities: [],
    });
    const deposits = generateDeposits(files, 2);
    const parsed = parseDepositFile(depositsToCsv(deposits), { syntheticOnly: true });
    expect(
      parsed.ok && parsed.deposits.map(({ depositDate, amountCents }) => ({ depositDate, amountCents })),
    ).toEqual(deposits);
  });
});
