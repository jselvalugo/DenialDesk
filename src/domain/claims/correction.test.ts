import { describe, expect, it } from "vitest";
import type { ClaimSnapshot } from "@/db/schema";
import {
  changedFields,
  correctionSchema,
  diffSnapshots,
  dollarsToCents,
  snapshotOf,
  splitCodes,
} from "./correction";

const base: ClaimSnapshot = snapshotOf(
  { serviceDate: "2026-08-01", diagnosisCodes: ["E11.9"], billedCents: 23_000, status: "draft" },
  [
    { lineNumber: 2, procedureCode: "97110", modifiers: ["GP"], units: 2, chargeCents: 8_000 },
    { lineNumber: 1, procedureCode: "99213", modifiers: [], units: 1, chargeCents: 15_000 },
  ],
);

const valid = {
  serviceDate: "2026-08-01",
  diagnosisCodes: ["E11.9", "I10"],
  lines: [{ lineNumber: 1, procedureCode: "99213", modifiers: ["25"], units: 1, chargeCents: 15_000 }],
  reason: "Coder review: add hypertension",
};

describe("claim correction input", () => {
  it("splits and upper-cases code lists", () => {
    expect(splitCodes(" e11.9, i10  z79.4 ,")).toEqual(["E11.9", "I10", "Z79.4"]);
    expect(splitCodes("")).toEqual([]);
  });

  it.each([
    ["125", 12_500],
    ["125.5", 12_550],
    ["$1,250.05", 125_005],
    ["0.01", 1],
    ["12.345", Number.NaN],
    ["-5", Number.NaN],
    ["abc", Number.NaN],
    // F1: malformed thousands grouping must be rejected, not silently stripped.
    ["12,50", Number.NaN],
    ["1,2,3.00", Number.NaN],
    ["1,25", Number.NaN],
    ["1250,00.00", Number.NaN],
    ["12,345", 1_234_500],
    ["1,234,567", 123_456_700],
  ])("reads %s as %s cents", (text, cents) => {
    expect(dollarsToCents(text)).toBe(cents);
  });

  it("accepts a well-formed correction", () => {
    expect(correctionSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ["procedure code", { lines: [{ ...valid.lines[0]!, procedureCode: "9921" }] }],
    ["modifier", { lines: [{ ...valid.lines[0]!, modifiers: ["G"] }] }],
    ["too many modifiers", { lines: [{ ...valid.lines[0]!, modifiers: ["25", "59", "GP", "KX", "XU"] }] }],
    ["units", { lines: [{ ...valid.lines[0]!, units: 0 }] }],
    ["charge", { lines: [{ ...valid.lines[0]!, chargeCents: Number.NaN }] }],
    ["zero charge", { lines: [{ ...valid.lines[0]!, chargeCents: 0 }] }],
    ["diagnosis format", { diagnosisCodes: ["250.00"] }],
    ["no diagnosis", { diagnosisCodes: [] }],
    ["blank reason", { reason: "   " }],
    ["date", { serviceDate: "08/01/2026" }],
  ])("rejects an invalid %s", (_label, override) => {
    expect(correctionSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe("claim version differences", () => {
  it("orders snapshot lines by line number", () => {
    expect(base.lines.map((l) => l.lineNumber)).toEqual([1, 2]);
  });

  it("finds nothing when nothing changed", () => {
    expect(changedFields(base, structuredClone(base))).toEqual([]);
  });

  it("names each changed field and shows old and new values", () => {
    const after = structuredClone(base);
    after.diagnosisCodes = ["E11.65"];
    after.lines[1]!.units = 3;
    after.lines[1]!.chargeCents = 12_000;
    expect(changedFields(base, after)).toEqual(["diagnosisCodes", "line 2 units", "line 2 chargeCents"]);
    expect(diffSnapshots(base, after)).toEqual([
      { label: "diagnosis codes", from: "E11.9", to: "E11.65" },
      { label: "line 2 units", from: "2", to: "3" },
      { label: "line 2 charge", from: "$80.00", to: "$120.00" },
    ]);
  });
});

describe("correction input bounds", () => {
  it.each(["2026-02-30", "2026-13-01", "1999-12-31"])("rejects the date of service %s", (serviceDate) => {
    expect(correctionSchema.safeParse({ ...valid, serviceDate }).success).toBe(false);
  });

  it("reads at most 200 characters of a code list", () => {
    expect(splitCodes("A,".repeat(1_000_000)).length).toBeLessThanOrEqual(100);
  });
});

describe("posting history (status and paid amount)", () => {
  it("names status and paid changes and labels them for the history", () => {
    const before = snapshotOf(
      { serviceDate: "2026-01-02", diagnosisCodes: ["E11.9"], billedCents: 10_000, status: "acknowledged" },
      [],
    );
    const after = snapshotOf(
      {
        serviceDate: "2026-01-02",
        diagnosisCodes: ["E11.9"],
        billedCents: 10_000,
        status: "paid",
        paidCents: 8_000,
      },
      [],
    );
    expect(changedFields(before, after)).toEqual(["status", "paidCents"]);
    expect(diffSnapshots(before, after)).toEqual([
      { label: "status", from: "Accepted by payer", to: "Paid" },
      { label: "paid", from: "$0.00", to: "$80.00" },
    ]);
  });
});
