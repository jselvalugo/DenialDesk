import { describe, expect, it } from "vitest";
import { reviewReasons } from "./imports";
import type { MonthlyLine } from "./monthly-file";

const line = (overrides: Partial<MonthlyLine>): MonthlyLine => ({
  rowNumber: 2,
  patientName: "Synthetic Patient",
  accountNumber: "SYN-1",
  serviceDate: "2026-03-15",
  cpt: "99213",
  description: "",
  facility: "",
  payerName: "",
  payerClass: "Commercial",
  status: "",
  billedCents: 100,
  paymentCents: 0,
  adjustmentCents: 0,
  balanceCents: 100,
  ...overrides,
});

describe("reviewReasons: after_period boundary (§3.4)", () => {
  it.each([
    ["2026-03-31", false], // last day of the period
    ["2026-04-01", true], // day after the period
  ])("service date %s → flagged %s", (serviceDate, flagged) => {
    const reasons = reviewReasons(line({ serviceDate }), "2026-03-31");
    expect(reasons.includes("after_period")).toBe(flagged);
  });
});
