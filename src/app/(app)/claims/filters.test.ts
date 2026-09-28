import { describe, expect, it } from "vitest";
import { claimFiltersToQuery, parseClaimFilters } from "./filters";

describe("claim list filters", () => {
  it("defaults to unsubmitted claims, page 1, group's own priority order (no sort key)", () => {
    expect(parseClaimFilters({})).toEqual({
      group: "unsubmitted",
      payerId: undefined,
      filing: undefined,
      sort: undefined,
      dir: undefined,
      page: 1,
    });
  });

  it("falls back to safe values for invalid input", () => {
    expect(
      parseClaimFilters({ group: "x", payer: "not-a-uuid", filing: "soon", page: "-4", sort: "evil" }),
    ).toEqual({
      group: "unsubmitted",
      payerId: undefined,
      filing: undefined,
      sort: undefined,
      dir: undefined,
      page: 1,
    });
  });

  it("ignores filing risk outside unsubmitted claims", () => {
    expect(parseClaimFilters({ group: "all", filing: "past_deadline" }).filing).toBeUndefined();
  });

  it("accepts a valid sort key and direction", () => {
    expect(parseClaimFilters({ sort: "billed", dir: "asc" })).toMatchObject({ sort: "billed", dir: "asc" });
  });

  it("defaults the direction per column when only the sort key is given", () => {
    expect(parseClaimFilters({ sort: "billed" })).toMatchObject({ sort: "billed", dir: "desc" });
    expect(parseClaimFilters({ sort: "claimNumber" })).toMatchObject({ sort: "claimNumber", dir: "asc" });
  });

  it("falls back to the column's default direction for an invalid dir value", () => {
    expect(parseClaimFilters({ sort: "billed", dir: "sideways" })).toMatchObject({
      sort: "billed",
      dir: "desc",
    });
  });

  it("round-trips through the query string", () => {
    const filters = parseClaimFilters({ filing: "due_soon", page: "3" });
    expect(claimFiltersToQuery(filters)).toBe("?filing=due_soon&page=3");
    expect(claimFiltersToQuery(filters, { page: 1 })).toBe("?filing=due_soon");
  });

  it("round-trips a sort and non-default direction through the query string", () => {
    const filters = parseClaimFilters({ sort: "patientName", dir: "desc" });
    expect(claimFiltersToQuery(filters)).toBe("?sort=patientName&dir=desc");
  });

  it("omits dir from the query string when it's the column's default direction", () => {
    expect(claimFiltersToQuery(parseClaimFilters({ sort: "payer" }))).toBe("?sort=payer");
  });
});
