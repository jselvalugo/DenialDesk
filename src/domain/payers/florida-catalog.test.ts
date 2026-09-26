import { describe, expect, it } from "vitest";
import { FLORIDA_PAYER_CATALOG } from "./florida-catalog";

describe("Florida payer catalog (spec: payer-catalog P1)", () => {
  it("has no duplicate names, case-insensitive", () => {
    const seen = new Set<string>();
    for (const entry of FLORIDA_PAYER_CATALOG) {
      const key = entry.name.trim().toLowerCase();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("carries a name and a source for every entry, and nothing else (CLAUDE.md #9)", () => {
    for (const entry of FLORIDA_PAYER_CATALOG) {
      expect(Object.keys(entry).sort()).toEqual(["name", "source"]);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.source.length).toBeGreaterThan(0);
    }
  });

  it("never invents a payer ID or regulatory regime", () => {
    for (const entry of FLORIDA_PAYER_CATALOG) {
      expect(entry).not.toHaveProperty("ediPayerId");
      expect(entry).not.toHaveProperty("regime");
    }
  });
});
