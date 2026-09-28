import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";
import { CMS_SOURCE, OIR_SOURCE, SMMC_SOURCE } from "./florida-catalog";
import { payerSourceLabel } from "./source-label";

const t = createTranslator(en.settings, "en");

describe("payerSourceLabel (spec: settings-and-custom-fields S2 PR4)", () => {
  it("reads a null source as not recorded", () => {
    expect(payerSourceLabel(null, t)).toBe("Not recorded");
  });

  it("maps each Florida catalog source to its own label", () => {
    expect(payerSourceLabel(OIR_SOURCE, t)).toBe("Florida OIR licensee list");
    expect(payerSourceLabel(SMMC_SOURCE, t)).toBe("AHCA Medicaid managed care plan list");
    expect(payerSourceLabel(CMS_SOURCE, t)).toBe("CMS");
  });

  it("falls back to the generic reference label for any other source, never the raw string", () => {
    for (const source of ["Some other list — ⚠️ VERIFY", "", OIR_SOURCE.toLowerCase()]) {
      const label = payerSourceLabel(source, t);
      expect(label).toBe("Reference list (not yet verified)");
      expect(label).not.toContain("⚠️");
    }
  });
});
