import { describe, expect, it } from "vitest";
import {
  appealOutcomesReport,
  claimsByStatusReport,
  denialRateReport,
  denialsByCategoryReport,
  denialsByDeadlineBucketReport,
  denialsByPayerReport,
} from "./calculations";

describe("denialsByCategoryReport", () => {
  it("sums, counts, and averages per category and CARC, ordered by sum descending", () => {
    const result = denialsByCategoryReport([
      { category: "coding", carc: "11", deniedCents: 1000, patientSensitive: false },
      { category: "coding", carc: "11", deniedCents: 500, patientSensitive: false },
      { category: "coding", carc: "4", deniedCents: 200, patientSensitive: false },
      { category: "eligibility", carc: "27", deniedCents: 5000, patientSensitive: false },
    ]);
    expect(result[0]!.category).toBe("eligibility");
    expect(result[0]!.sumCents).toBe(5000);
    expect(result[1]!.category).toBe("coding");
    expect(result[1]!.count).toBe(3);
    expect(result[1]!.sumCents).toBe(1700);
    const carc11 = result[1]!.carcs.find((c) => c.carc === "11")!;
    expect(carc11.count).toBe(2);
    expect(carc11.sumCents).toBe(1500);
    expect(carc11.avgCents).toBe(750);
  });

  it("keeps a CARC outside the reference list rather than dropping it", () => {
    const result = denialsByCategoryReport([
      { category: "other", carc: "999999", deniedCents: 300, patientSensitive: false },
    ]);
    expect(result[0]!.carcs[0]!.carc).toBe("999999");
  });

  it("returns an empty list for zero denials, never a divide-by-zero average", () => {
    expect(denialsByCategoryReport([])).toEqual([]);
  });

  it("suppresses a small, sensitive-tagged CARC row and, by complementary suppression, the next-smallest sibling row, while a much larger row stays visible", () => {
    const sensitiveRows = Array.from({ length: 5 }, () => ({
      category: "coding" as const,
      carc: "11",
      deniedCents: 100,
      patientSensitive: true,
    }));
    const mediumRows = Array.from({ length: 8 }, () => ({
      category: "coding" as const,
      carc: "4",
      deniedCents: 200,
      patientSensitive: false,
    }));
    const bulkRows = Array.from({ length: 1_000 }, () => ({
      category: "coding" as const,
      carc: "29",
      deniedCents: 300,
      patientSensitive: false,
    }));
    const result = denialsByCategoryReport([...sensitiveRows, ...mediumRows, ...bulkRows]);
    const coding = result.find((g) => g.category === "coding")!;
    // "11" (count 5, sensitive) is suppressed outright.
    expect(coding.carcs.find((c) => c.carc === "11")!.suppressed).toBe(true);
    // "4" (count 8, not sensitive) is the next-smallest visible row — complementary suppression
    // hides it too, so a reader can't back out "11" from the category total minus "4" and "29".
    expect(coding.carcs.find((c) => c.carc === "4")!.suppressed).toBe(true);
    // "29" (count 1000) is far larger and stays visible.
    expect(coding.carcs.find((c) => c.carc === "29")!.suppressed).toBe(false);
  });
});

describe("denialsByPayerReport", () => {
  it("picks the top category by sum, breaking ties by category enum order", () => {
    const result = denialsByPayerReport([
      {
        payerId: "p1",
        payerName: "Payer One",
        verified: true,
        category: "coding",
        deniedCents: 100,
        patientSensitive: false,
      },
      {
        payerId: "p1",
        payerName: "Payer One",
        verified: true,
        category: "eligibility",
        deniedCents: 100,
        patientSensitive: false,
      },
    ]);
    // eligibility precedes coding in the enum order (see src/db/schema.ts denialCategoryEnum).
    expect(result[0]!.topCategory).toBe("eligibility");
  });

  it("labels an unverified payer without merging it into another payer's row", () => {
    const result = denialsByPayerReport([
      {
        payerId: "p1",
        payerName: "Acme",
        verified: false,
        category: "coding",
        deniedCents: 100,
        patientSensitive: false,
      },
      {
        payerId: "p2",
        payerName: "Acme",
        verified: true,
        category: "coding",
        deniedCents: 200,
        patientSensitive: false,
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.payerId === "p1")!.verified).toBe(false);
    expect(result.find((r) => r.payerId === "p2")!.verified).toBe(true);
  });
});

describe("denialRateReport", () => {
  it("returns null rate for a zero denominator", () => {
    expect(denialRateReport(0, 0).rate).toBeNull();
  });

  it("computes distinct denied / distinct submitted", () => {
    expect(denialRateReport(100, 25).rate).toBeCloseTo(0.25);
  });

  it("rejects negative counts", () => {
    expect(() => denialRateReport(-1, 0)).toThrow();
  });
});

describe("denialsByDeadlineBucketReport", () => {
  const today = "2026-09-26";

  it("includes every bucket even at zero, including no_deadline", () => {
    const result = denialsByDeadlineBucketReport([], today);
    expect(result.map((r) => r.bucket)).toEqual(["past_deadline", "0-7", "8-30", "31-plus", "no_deadline"]);
    expect(result.every((r) => r.count === 0 && r.sumCents === 0)).toBe(true);
  });

  it("buckets a null deadline as no_deadline, never guessed", () => {
    const result = denialsByDeadlineBucketReport(
      [{ appealDeadline: null, deniedCents: 500, patientSensitive: false }],
      today,
    );
    expect(result.find((r) => r.bucket === "no_deadline")!.count).toBe(1);
  });

  it("puts exactly 7 days out in 0-7 and 8 days out in 8-30 (boundary)", () => {
    const result = denialsByDeadlineBucketReport(
      [
        { appealDeadline: "2026-10-03", deniedCents: 100, patientSensitive: false }, // +7 days
        { appealDeadline: "2026-10-04", deniedCents: 200, patientSensitive: false }, // +8 days
      ],
      today,
    );
    expect(result.find((r) => r.bucket === "0-7")!.count).toBe(1);
    expect(result.find((r) => r.bucket === "0-7")!.sumCents).toBe(100);
    expect(result.find((r) => r.bucket === "8-30")!.count).toBe(1);
    expect(result.find((r) => r.bucket === "8-30")!.sumCents).toBe(200);
  });

  it("puts exactly 30 days out in 8-30 and 31 days out in 31-plus (boundary)", () => {
    const result = denialsByDeadlineBucketReport(
      [
        { appealDeadline: "2026-10-26", deniedCents: 100, patientSensitive: false }, // +30 days
        { appealDeadline: "2026-10-27", deniedCents: 200, patientSensitive: false }, // +31 days
      ],
      today,
    );
    expect(result.find((r) => r.bucket === "8-30")!.count).toBe(1);
    expect(result.find((r) => r.bucket === "31-plus")!.count).toBe(1);
  });

  it("puts a deadline of yesterday in past_deadline and today's deadline in 0-7 (boundary)", () => {
    const result = denialsByDeadlineBucketReport(
      [
        { appealDeadline: "2026-09-25", deniedCents: 100, patientSensitive: false }, // -1 day
        { appealDeadline: "2026-09-26", deniedCents: 200, patientSensitive: false }, // 0 days
      ],
      today,
    );
    expect(result.find((r) => r.bucket === "past_deadline")!.count).toBe(1);
    expect(result.find((r) => r.bucket === "0-7")!.count).toBe(1);
  });
});

describe("claimsByStatusReport", () => {
  it("sums billed, paid, and outstanding per status", () => {
    const result = claimsByStatusReport([
      { status: "paid", billedCents: 10000, paidCents: 10000, patientSensitive: false },
      { status: "denied", billedCents: 5000, paidCents: 0, patientSensitive: false },
      { status: "denied", billedCents: 3000, paidCents: 1000, patientSensitive: false },
    ]);
    const denied = result.find((r) => r.status === "denied")!;
    expect(denied.count).toBe(2);
    expect(denied.billedCents).toBe(8000);
    expect(denied.paidCents).toBe(1000);
    expect(denied.outstandingCents).toBe(7000);
  });

  it("omits statuses with no rows rather than showing a fake zero row", () => {
    const result = claimsByStatusReport([
      { status: "paid", billedCents: 100, paidCents: 100, patientSensitive: false },
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("appealOutcomesReport", () => {
  it("computes overturn rate per group and totals reversed cents from overturned rows only", () => {
    const report = appealOutcomesReport(
      [
        { key: "p1", label: "Payer One", status: "overturned", deniedCents: 1000, patientSensitive: false },
        { key: "p1", label: "Payer One", status: "upheld", deniedCents: 2000, patientSensitive: false },
      ],
      [],
    );
    const p1 = report.byPayer.find((g) => g.key === "p1")!;
    expect(p1.overturnRate).toBeCloseTo(0.5);
    expect(p1.reversedCents).toBe(1000);
  });

  it("shows null overturn rate (not a rate) when there are no decided appeals", () => {
    const report = appealOutcomesReport([], []);
    expect(report.byPayer).toEqual([]);
  });
});
