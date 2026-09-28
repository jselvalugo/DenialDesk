import { describe, expect, it } from "vitest";
import {
  FILING_WARNING_DAYS,
  filingStatus,
  isUnsubmitted,
  submittedFilingState,
  submittedOnDate,
} from "./status";

// Florida: 6 months from 2026-03-31 → 2026-09-30 (fl.timely_filing.initial, ⚠️ VERIFY).
// Medicare: 1 year from 2026-02-15 → 2027-02-15, Washington's Birthday (federal holiday). Until
// counsel confirms roll-forward (OA-034, owner 2026-09-27 option 1) 02-15 governs; the rolled
// 2027-02-16 is informational only (medicare.timely_filing, ⚠️ VERIFY).
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
    ["2027-02-14", "due_soon"], // day before the conservative date
    ["2027-02-15", "due_soon"], // day of: holiday, but still the governing date
    ["2027-02-16", "past_deadline"], // day after: the rolled date does not keep the claim open
  ])("Medicare claim on %s is %s", (today, state) => {
    const status = filingStatus("medicare", "2026-02-15", today);
    expect(status.deadline?.date).toBe("2027-02-15");
    expect(status.deadline?.rolledDate).toBe("2027-02-16");
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

  it("computes no deadline for an unverified payer (null regime, spec: payer-catalog P1)", () => {
    expect(filingStatus(null, "2026-03-31", "2026-09-26")).toEqual({
      state: "payer_unverified",
      deadline: null,
      daysRemaining: null,
    });
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

describe("sent-claim timely filing by submission date (R-3.1.5, billing review D2)", () => {
  // Florida: 6 months from 2026-03-31 -> 2026-09-30 (fl.timely_filing.initial, ⚠️ VERIFY).
  const deadline = filingStatus("fl_insurer", "2026-03-31", "2026-01-01").deadline!;

  it.each([
    ["2026-09-29", "sent_on_time"], // day before the deadline
    ["2026-09-30", "sent_on_time"], // day of: sending on the deadline is on time
    ["2026-10-01", "sent_late"], // day after
  ])("a claim sent %s is %s", (submittedOn, state) => {
    expect(deadline.date).toBe("2026-09-30");
    expect(submittedFilingState(deadline, submittedOn)).toBe(state);
  });

  it("uses the unrolled Medicare date, not the rolled one (OA-034 option 1)", () => {
    const medicare = filingStatus("medicare", "2026-02-15", "2026-03-01").deadline!;
    expect(medicare.rolledDate).toBe("2027-02-16");
    expect(submittedFilingState(medicare, "2027-02-15")).toBe("sent_on_time");
    expect(submittedFilingState(medicare, "2027-02-16")).toBe("sent_late");
  });
});

describe("submission date on the Eastern legal clock", () => {
  it.each([
    ["2026-10-01T03:59:00Z", "2026-09-30", "sent_on_time"], // 11:59 PM EDT on the deadline
    ["2026-10-01T04:00:00Z", "2026-10-01", "sent_late"], // midnight EDT, the day after
  ])("a claim sent at %s counts as %s", (instant, date, state) => {
    const deadline = filingStatus("fl_insurer", "2026-03-31", "2026-01-01").deadline!;
    expect(submittedOnDate(new Date(instant))).toBe(date);
    expect(submittedFilingState(deadline, submittedOnDate(new Date(instant)))).toBe(state);
  });
});
