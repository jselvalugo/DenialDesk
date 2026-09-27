import { describe, expect, it } from "vitest";
import { formatCents, formatDate, parseDollarsToCents } from "./format";

describe("formatCents", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [123456, "$1,234.56"],
    [-98765, "-$987.65"],
    [100000000, "$1,000,000.00"],
    // F2: negative zero (e.g. deductions negated for display with no net adjustment) must read
    // as $0.00, never -$0.00.
    [-0, "$0.00"],
  ])("formats %i cents as %s", (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it("rejects fractional cents", () => {
    expect(() => formatCents(10.5)).toThrow();
  });
});

describe("formatDate", () => {
  it("formats without shifting the calendar day", () => {
    expect(formatDate("2026-01-01")).toBe("01/01/2026");
    expect(formatDate("2026-12-31")).toBe("12/31/2026");
  });

  it("rejects timestamps", () => {
    expect(() => formatDate("2026-01-01T10:00:00Z")).toThrow();
  });
});

describe("parseDollarsToCents", () => {
  it.each([
    ["0.29", 29],
    ["125", 12500],
    ["1250.00", 125000],
    ["0", 0],
    ["999999999", 99999999900],
  ])("parses %s as %i cents", (text, cents) => {
    expect(parseDollarsToCents(text)).toBe(cents);
  });

  it.each([["1.005"], [""], ["-5"], ["1,250"], ["$5"], ["five"], ["1.5.5"], [" "]])("rejects %j", (text) => {
    expect(parseDollarsToCents(text)).toBeNull();
  });
});

describe("formatDate in other languages", () => {
  it("uses day-first order for Spanish and Portuguese and keeps month-first for English", () => {
    expect(formatDate("2026-12-31", "en")).toBe("12/31/2026");
    expect(formatDate("2026-12-31", "es")).toBe("31/12/2026");
    expect(formatDate("2026-12-31", "pt")).toBe("31/12/2026");
  });
});
