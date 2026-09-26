import { describe, expect, it } from "vitest";
import { parseFilters } from "./filters";

describe("parseFilters", () => {
  it("defaults to the last 90 days when no dates are given", () => {
    const result = parseFilters({});
    expect(result.error).toBeNull();
    expect(result.dateFrom < result.dateTo).toBe(true);
  });

  it("rejects an end date before the start date without throwing", () => {
    const result = parseFilters({ dateFrom: "2026-09-01", dateTo: "2026-08-01" });
    expect(result.error).toMatch(/end date/i);
  });

  it("accepts an equal start and end date", () => {
    const result = parseFilters({ dateFrom: "2026-09-01", dateTo: "2026-09-01" });
    expect(result.error).toBeNull();
  });

  it("ignores a malformed or malicious payerId rather than passing it through", () => {
    const result = parseFilters({ payerId: "'; drop table payers; --" });
    expect(result.payerId).toBeNull();
  });

  it("keeps a valid payer UUID", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const result = parseFilters({ payerId: id });
    expect(result.payerId).toBe(id);
  });

  it("rejects a date that doesn't exist (Feb 31) with a visible error", () => {
    const result = parseFilters({ dateFrom: "2026-02-31", dateTo: "2026-03-01" });
    expect(result.error).toMatch(/doesn't exist/i);
  });

  it("rejects a malformed end date with a visible error", () => {
    const result = parseFilters({ dateFrom: "2026-01-01", dateTo: "not-a-date" });
    expect(result.error).toMatch(/doesn't exist/i);
  });

  it("caps the range at 3 years", () => {
    const result = parseFilters({ dateFrom: "2020-01-01", dateTo: "2026-01-01" });
    expect(result.error).toMatch(/3 years/i);
  });

  it("accepts a range just under 3 years", () => {
    const result = parseFilters({ dateFrom: "2023-09-27", dateTo: "2026-09-26" });
    expect(result.error).toBeNull();
  });
});
