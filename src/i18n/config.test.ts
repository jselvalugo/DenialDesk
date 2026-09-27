import { describe, expect, it } from "vitest";
import { isLocale, negotiateLocale } from "./config";

describe("negotiateLocale", () => {
  it("defaults to English without a usable header", () => {
    expect(negotiateLocale(null)).toBe("en");
    expect(negotiateLocale("")).toBe("en");
    expect(negotiateLocale("fr-CA, de;q=0.8")).toBe("en");
  });
  it("honors quality order and ignores regions", () => {
    expect(negotiateLocale("pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt");
    expect(negotiateLocale("fr;q=0.9, es-419;q=0.8, en;q=0.7")).toBe("es");
    expect(negotiateLocale("en;q=0.5, es")).toBe("es");
    expect(negotiateLocale("es;q=0, en")).toBe("en");
  });
});

describe("isLocale", () => {
  it("accepts only the supported codes", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("pt")).toBe(true);
    expect(isLocale("pt-BR")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
