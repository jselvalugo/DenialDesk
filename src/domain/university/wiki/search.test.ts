import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH, normalizeQuery } from "./search";

describe("normalizeQuery", () => {
  it("caps the query length and keeps short input as is", () => {
    expect(normalizeQuery("carc")).toBe("carc");
    expect(normalizeQuery("x".repeat(500))).toHaveLength(MAX_QUERY_LENGTH);
  });
});
