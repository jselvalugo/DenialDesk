import { describe, expect, it } from "vitest";
import { firstLevelDeadline } from "./deadline";

describe("firstLevelDeadline", () => {
  it("computes the Medicare redetermination deadline from the rules engine", () => {
    const deadline = firstLevelDeadline({
      regime: "medicare",
      noticeDate: "2026-06-01",
      payerAppealWindowDays: null,
    });
    // 5-day receipt presumption + 120-day filing window (rules/deadlines.test.ts covers the rule values).
    expect(deadline?.date).toBe("2026-10-04");
    expect(deadline?.basis).toContain("medicare.redetermination");
  });

  it("uses the payer contract window for a verified commercial regime", () => {
    const deadline = firstLevelDeadline({
      regime: "fl_insurer",
      noticeDate: "2026-01-01",
      payerAppealWindowDays: 30,
    });
    expect(deadline).toEqual({
      date: "2026-01-31",
      basis: "payer_contract",
      citation: "Payer contract",
      verify: false,
    });
  });

  it("is not configured when the payer has no contract window on file", () => {
    expect(
      firstLevelDeadline({ regime: "fl_insurer", noticeDate: "2026-01-01", payerAppealWindowDays: null }),
    ).toBeNull();
  });

  it("is not configured when the payer's regulatory regime isn't verified yet", () => {
    expect(
      firstLevelDeadline({ regime: null, noticeDate: "2026-01-01", payerAppealWindowDays: 30 }),
    ).toBeNull();
  });
});
