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
});
