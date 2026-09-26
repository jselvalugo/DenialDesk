import { describe, expect, it } from "vitest";
import { filtersToQuery, parseFilters } from "./filters";

describe("queue filters", () => {
  it("defaults to open denials sorted by deadline", () => {
    expect(parseFilters({})).toEqual({ status: "open", sort: "deadline", page: 1 });
  });

  it("falls back to safe defaults for invalid input", () => {
    const filters = parseFilters({
      status: "drop table",
      payer: "not-a-uuid",
      category: "x",
      page: "-3",
      sort: "evil",
    });
    expect(filters).toEqual({ status: "open", sort: "deadline", page: 1 });
  });

  it("round-trips through the query string", () => {
    const filters = parseFilters({
      status: "all",
      category: "authorization",
      assignee: "me",
      sort: "amount",
      page: "2",
    });
    expect(filtersToQuery(filters)).toBe("?status=all&category=authorization&assignee=me&sort=amount&page=2");
    expect(filtersToQuery(filters, { page: 1 })).toBe(
      "?status=all&category=authorization&assignee=me&sort=amount",
    );
  });
});
