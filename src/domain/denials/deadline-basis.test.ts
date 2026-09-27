import { describe, expect, it } from "vitest";
import { payerContractBasisText } from "./deadline-basis";

describe("payer-contract deadline explanation (review F7)", () => {
  it("quotes the current window when it still produces the stored date", () => {
    expect(payerContractBasisText("2026-09-01", "2026-10-31", 60, "Contract §4.2")).toBe(
      "From the payer contract: 60 days after the notice date (Contract §4.2).",
    );
    expect(payerContractBasisText("2026-09-01", "2026-10-31", 60, null)).toBe(
      "From the payer contract: 60 days after the notice date.",
    );
  });

  it("never renders 'null days' when the window was cleared", () => {
    const text = payerContractBasisText("2026-09-01", "2026-10-31", null, null);
    expect(text).not.toContain("null");
    expect(text).toBe(
      "From the payer contract window used when this deadline was computed. It no longer matches the payer's current appeal window; confirm this date against the current contract.",
    );
  });

  it("does not quote a window that no longer matches the stored date", () => {
    const text = payerContractBasisText("2026-09-01", "2026-10-31", 90, "Contract §4.2");
    expect(text).not.toContain("90 days");
    expect(text).toContain("confirm this date against the current contract");
  });
});
