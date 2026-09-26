import { describe, expect, it } from "vitest";
import { assertPayerVerified, isPayerVerified, UnverifiedPayerError } from "./verification";

describe("payer verification guard (spec: payer-catalog P1)", () => {
  it("treats a payer with both an EDI payer ID and a regime as verified", () => {
    expect(isPayerVerified({ ediPayerId: "12345", regime: "fl_insurer" })).toBe(true);
  });

  it.each([
    [{ ediPayerId: null, regime: "fl_insurer" }],
    [{ ediPayerId: "12345", regime: null }],
    [{ ediPayerId: null, regime: null }],
  ])("treats %o as unverified", (payer) => {
    expect(isPayerVerified(payer)).toBe(false);
  });

  it("assertPayerVerified passes through a verified payer without throwing", () => {
    expect(() => assertPayerVerified({ ediPayerId: "12345", regime: "fl_insurer" })).not.toThrow();
  });

  it("assertPayerVerified refuses an unverified payer (blocks 837P submission)", () => {
    expect(() => assertPayerVerified({ ediPayerId: null, regime: null })).toThrow(UnverifiedPayerError);
  });
});
