import { describe, expect, it } from "vitest";
import { appealFiltersToQuery, parseAppealFilters } from "./filters";

describe("appeal queue filters", () => {
  it("defaults to open appeals sorted by deadline, ascending", () => {
    expect(parseAppealFilters({})).toEqual({ status: "open", sort: "deadline", dir: "asc", page: 1 });
  });

  it("falls back to safe defaults for invalid input", () => {
    const filters = parseAppealFilters({
      status: "drop table",
      payer: "not-a-uuid",
      level: "made_up_level",
      page: "-3",
      sort: "evil",
      dir: "sideways",
    });
    expect(filters).toEqual({ status: "open", sort: "deadline", dir: "asc", page: 1 });
  });

  it("accepts a valid sort key and direction", () => {
    expect(parseAppealFilters({ sort: "amount", dir: "asc" })).toMatchObject({ sort: "amount", dir: "asc" });
  });

  it("defaults the direction per column when only the sort key is given", () => {
    expect(parseAppealFilters({ sort: "amount" })).toMatchObject({ sort: "amount", dir: "desc" });
    expect(parseAppealFilters({ sort: "deadline" })).toMatchObject({ sort: "deadline", dir: "asc" });
  });

  it("falls back to the column's default direction for an invalid dir value", () => {
    expect(parseAppealFilters({ sort: "amount", dir: "sideways" })).toMatchObject({
      sort: "amount",
      dir: "desc",
    });
  });

  it("round-trips through the query string", () => {
    const filters = parseAppealFilters({
      status: "all",
      level: "first_level",
      sort: "amount",
      dir: "asc",
      page: "2",
    });
    expect(appealFiltersToQuery(filters)).toBe("?status=all&level=first_level&sort=amount&dir=asc&page=2");
    expect(appealFiltersToQuery(filters, { page: 1 })).toBe(
      "?status=all&level=first_level&sort=amount&dir=asc",
    );
  });

  it("omits dir from the query string when it's the column's default direction", () => {
    expect(appealFiltersToQuery(parseAppealFilters({ sort: "amount" }))).toBe("?sort=amount");
  });
});
