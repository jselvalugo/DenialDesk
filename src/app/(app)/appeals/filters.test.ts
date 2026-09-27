import { describe, expect, it } from "vitest";
import { appealFiltersToQuery, parseAppealFilters } from "./filters";

describe("appeal queue filters", () => {
  it("defaults to open appeals sorted by deadline", () => {
    expect(parseAppealFilters({})).toEqual({ status: "open", sort: "deadline", page: 1 });
  });

  it("falls back to safe defaults for invalid input", () => {
    const filters = parseAppealFilters({
      status: "drop table",
      payer: "not-a-uuid",
      level: "made_up_level",
      page: "-3",
      sort: "evil",
    });
    expect(filters).toEqual({ status: "open", sort: "deadline", page: 1 });
  });

  it("round-trips through the query string", () => {
    const filters = parseAppealFilters({ status: "all", level: "first_level", sort: "amount", page: "2" });
    expect(appealFiltersToQuery(filters)).toBe("?status=all&level=first_level&sort=amount&page=2");
    expect(appealFiltersToQuery(filters, { page: 1 })).toBe("?status=all&level=first_level&sort=amount");
  });
});
