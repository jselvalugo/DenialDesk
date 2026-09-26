import { describe, expect, it } from "vitest";
import { FILING_WARNING_DAYS, filingStatus, isUnsubmitted } from "./status";

// Florida: 6 months from 2026-03-31 → 2026-09-30 (fl.timely_filing.initial, ⚠️ VERIFY).
// Medicare: 12 months from 2026-02-15 → 2027-02-15 (medicare.timely_filing, ⚠️ VERIFY).
describe("timely-filing status (R-3.1.5)", () => {
  it.each([
    ["2026-09-29", "due_soon", 1], // day before the deadline
    ["2026-09-30", "due_soon", 0], // day of: filing today is on time
    ["2026-10-01", "past_deadline", -1], // day after
  ])("Florida claim on %s is %s (%i days)", (today, state, days) => {
    const status = filingStatus("fl_insurer", "2026-03-31", today);
    expect(status.deadline?.date).toBe("2026-09-30");
    expect(status.deadline?.basis).toBe("fl.timely_filing.initial");
    expect(status).toMatchObject({ state, daysRemaining: days });
  });

  it.each([
    ["2027-02-14", "due_soon"],
    ["2027-02-15", "due_soon"],
    ["2027-02-16", "past_deadline"],
  ])("Medicare claim on %s is %s", (today, state) => {
    const status = filingStatus("medicare", "2026-02-15", today);
    expect(status.deadline?.date).toBe("2027-02-15");
    expect(status.state).toBe(state);
  });

  it("warns inside the display window and not before it", () => {
    const deadline = "2026-09-30";
    const edge = new Date(Date.parse(deadline) - FILING_WARNING_DAYS * 86_400_000).toISOString().slice(0, 10);
    const dayBefore = new Date(Date.parse(edge) - 86_400_000).toISOString().slice(0, 10);
    expect(filingStatus("fl_hmo", "2026-03-31", edge).state).toBe("due_soon");
    expect(filingStatus("fl_hmo", "2026-03-31", dayBefore).state).toBe("open");
  });

  it("does not guess a deadline for regimes without a statutory rule", () => {
    for (const regime of ["erisa_self_funded", "medicare_advantage"] as const) {
      expect(filingStatus(regime, "2026-03-31", "2026-09-26")).toEqual({
        state: "not_configured",
        deadline: null,
        daysRemaining: null,
      });
    }
  });

  it("only draft and rejected claims are unsubmitted", () => {
    expect(isUnsubmitted("draft")).toBe(true);
    expect(isUnsubmitted("rejected")).toBe(true);
    for (const status of [
      "submitted",
      "acknowledged",
      "paid",
      "partially_paid",
      "denied",
      "closed",
    ] as const) {
      expect(isUnsubmitted(status)).toBe(false);
    }
  });
});
