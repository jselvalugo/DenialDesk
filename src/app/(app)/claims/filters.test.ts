import { describe, expect, it } from "vitest";
import { claimFiltersToQuery, parseClaimFilters } from "./filters";

describe("claim list filters", () => {
  it("defaults to unsubmitted claims, page 1", () => {
    expect(parseClaimFilters({})).toEqual({
      group: "unsubmitted",
      payerId: undefined,
      filing: undefined,
      page: 1,
    });
  });

  it("falls back to safe values for invalid input", () => {
    expect(parseClaimFilters({ group: "x", payer: "not-a-uuid", filing: "soon", page: "-4" })).toEqual({
      group: "unsubmitted",
      payerId: undefined,
      filing: undefined,
      page: 1,
    });
  });

  it("ignores filing risk outside unsubmitted claims", () => {
    expect(parseClaimFilters({ group: "all", filing: "past_deadline" }).filing).toBeUndefined();
  });

  it("round-trips through the query string", () => {
    const filters = parseClaimFilters({ filing: "due_soon", page: "3" });
    expect(claimFiltersToQuery(filters)).toBe("?filing=due_soon&page=3");
    expect(claimFiltersToQuery(filters, { page: 1 })).toBe("?filing=due_soon");
  });
});
