import { describe, expect, it } from "vitest";
import { filtersToQuery, parseFilters } from "./filters";

describe("queue filters", () => {
  it("defaults to open denials sorted by deadline, ascending", () => {
    expect(parseFilters({})).toEqual({ status: "open", sort: "deadline", dir: "asc", page: 1 });
  });

  it("falls back to safe defaults for invalid input", () => {
    const filters = parseFilters({
      status: "drop table",
      payer: "not-a-uuid",
      category: "x",
      page: "-3",
      sort: "evil",
      dir: "sideways",
    });
    expect(filters).toEqual({ status: "open", sort: "deadline", dir: "asc", page: 1 });
  });

  it("accepts a valid sort key and direction", () => {
    const filters = parseFilters({ sort: "amount", dir: "asc" });
    expect(filters).toMatchObject({ sort: "amount", dir: "asc" });
  });

  it("defaults the direction per column when only the sort key is given", () => {
    expect(parseFilters({ sort: "amount" })).toMatchObject({ sort: "amount", dir: "desc" });
    expect(parseFilters({ sort: "deadline" })).toMatchObject({ sort: "deadline", dir: "asc" });
  });

  it("falls back to the column's default direction for an invalid dir value", () => {
    expect(parseFilters({ sort: "amount", dir: "sideways" })).toMatchObject({ sort: "amount", dir: "desc" });
  });

  it("round-trips through the query string", () => {
    const filters = parseFilters({
      status: "all",
      category: "authorization",
      assignee: "me",
      sort: "amount",
      dir: "asc",
      page: "2",
    });
    expect(filtersToQuery(filters)).toBe(
      "?status=all&category=authorization&assignee=me&sort=amount&dir=asc&page=2",
    );
    expect(filtersToQuery(filters, { page: 1 })).toBe(
      "?status=all&category=authorization&assignee=me&sort=amount&dir=asc",
    );
  });

  it("omits dir from the query string when it's the column's default direction", () => {
    const filters = parseFilters({ sort: "amount" });
    expect(filtersToQuery(filters)).toBe("?sort=amount");
  });
});
