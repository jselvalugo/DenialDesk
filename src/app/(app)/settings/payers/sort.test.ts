import { describe, expect, it } from "vitest";
import { parsePayerSort, payerListHref } from "./sort";

describe("payer list sort", () => {
  it("defaults to name, ascending", () => {
    expect(parsePayerSort({})).toEqual({ sort: "name", dir: "asc" });
  });

  it("falls back to safe defaults for an invalid sort key or direction", () => {
    expect(parsePayerSort({ sort: "ediPayerId", dir: "sideways" })).toEqual({ sort: "name", dir: "asc" });
  });

  it("accepts a valid sort key and direction", () => {
    expect(parsePayerSort({ sort: "name", dir: "desc" })).toEqual({ sort: "name", dir: "desc" });
  });

  it("falls back to the column's default direction for an invalid dir value", () => {
    expect(parsePayerSort({ sort: "name", dir: "sideways" })).toEqual({ sort: "name", dir: "asc" });
  });

  it("builds a href with only the non-default params", () => {
    expect(payerListHref("name", "asc")).toBe("/settings/payers");
    expect(payerListHref("name", "desc")).toBe("/settings/payers?dir=desc");
  });
});
