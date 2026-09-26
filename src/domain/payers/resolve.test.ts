import { describe, expect, it } from "vitest";
import { resolvePayerByName } from "./resolve";

const payers = [
  { id: "1", name: "Florida Blue", verified: true },
  { id: "2", name: "Aetna", verified: false },
  { id: "3", name: "AvMed", verified: false },
  { id: "4", name: "AvMed", verified: true },
];

describe("resolvePayerByName (spec: payer-catalog P1)", () => {
  it("resolves empty text to self-pay", () => {
    expect(resolvePayerByName(payers, "")).toEqual({ status: "self_pay" });
  });

  it("resolves whitespace-only text to self-pay", () => {
    expect(resolvePayerByName(payers, "   ")).toEqual({ status: "self_pay" });
  });

  it("matches a payer name exactly", () => {
    expect(resolvePayerByName(payers, "Aetna")).toEqual({
      status: "matched",
      payer: { id: "2", name: "Aetna", verified: false },
    });
  });

  it("matches case-insensitively", () => {
    expect(resolvePayerByName(payers, "florida blue")).toEqual({
      status: "matched",
      payer: { id: "1", name: "Florida Blue", verified: true },
    });
  });

  it("trims leading and trailing whitespace before matching (fixes the trailing-space bug)", () => {
    expect(resolvePayerByName(payers, "  Aetna  ")).toEqual({
      status: "matched",
      payer: { id: "2", name: "Aetna", verified: false },
    });
  });

  it("returns unmatched for text that matches no payer, rather than self-pay", () => {
    expect(resolvePayerByName(payers, "Not A Real Payer")).toEqual({ status: "unmatched" });
  });

  it("prefers the verified payer when names collide", () => {
    expect(resolvePayerByName(payers, "AvMed")).toEqual({
      status: "matched",
      payer: { id: "4", name: "AvMed", verified: true },
    });
  });
});
