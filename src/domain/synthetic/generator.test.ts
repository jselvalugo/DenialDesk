import { describe, expect, it } from "vitest";
import { CARC } from "@/domain/carc";
import { GENERATED_CARCS, generateDataset, isValidNpi, npiCheckDigit } from "./generator";

const dataset = generateDataset({ asOf: "2026-09-26" });

describe("synthetic data generator", () => {
  it("is deterministic for a seed", () => {
    expect(generateDataset({ asOf: "2026-09-26" })).toEqual(dataset);
    expect(generateDataset({ asOf: "2026-09-26", seed: 7 })).not.toEqual(dataset);
  });

  it("marks every identifier as synthetic", () => {
    for (const patient of dataset.patients) {
      expect(patient.mrn).toMatch(/^SYN-/);
      expect(patient.memberId).toMatch(/^SYN\d+$/);
    }
    for (const claim of dataset.claims) expect(claim.claimNumber).toMatch(/^CLM-SYN-/);
    for (const payer of dataset.payers) expect(payer.ediPayerId).toMatch(/^SYN/);
  });

  it("generates valid NPIs (CMS Luhn check digit)", () => {
    // Known valid example from the CMS NPI check-digit documentation: 123456789 → 3.
    expect(npiCheckDigit("123456789")).toBe(3);
    for (const provider of dataset.providers) expect(isValidNpi(provider.npi)).toBe(true);
  });

  it("only emits CARCs from the reference list", () => {
    expect(GENERATED_CARCS.length).toBeGreaterThan(0);
    for (const claim of dataset.claims) {
      if (claim.denial) expect(CARC[claim.denial.carc]).toBeDefined();
    }
  });

  it("produces a realistic mix of denials with notices no later than asOf", () => {
    const denials = dataset.claims.flatMap((c) => (c.denial ? [c.denial] : []));
    expect(denials.length).toBeGreaterThan(40);
    expect(new Set(denials.map((d) => d.category)).size).toBeGreaterThan(5);
    for (const denial of denials) {
      expect(denial.noticeDate <= dataset.asOf).toBe(true);
      expect(Number.isSafeInteger(denial.deniedCents)).toBe(true);
    }
  });
});
