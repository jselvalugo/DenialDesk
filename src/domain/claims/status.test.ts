import { describe, expect, it } from "vitest";
import { FILING_WARNING_DAYS, filingStatus, isUnsubmitted, submittedFilingStatus } from "./status";

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

describe("timely filing of a sent claim awaiting receipt (review D2)", () => {
  // Deadline 2026-09-30 (Florida, from 2026-03-31). Instants are UTC; EDT is UTC−4, so the Eastern
  // day 2026-09-30 runs 2026-09-30T04:00Z to 2026-10-01T03:59:59Z.
  it.each([
    ["2026-09-29T15:00:00Z", "2026-09-29", true], // day before
    ["2026-09-30T15:00:00Z", "2026-09-30", true], // day of: submitting on the deadline is on time
    ["2026-10-01T03:59:59Z", "2026-09-30", true], // 11:59 PM EDT on the deadline day
    ["2026-10-01T04:00:00Z", "2026-10-01", false], // midnight EDT: the day after
    ["2026-10-01T15:00:00Z", "2026-10-01", false], // day after
  ])("Florida claim submitted at %s (Eastern %s) is on time: %s", (at, submittedOn, onTime) => {
    const status = submittedFilingStatus("fl_insurer", "2026-03-31", new Date(at));
    expect(status).toMatchObject({ submittedOn, onTime, withinPendingExtension: false });
    expect(status?.deadline.date).toBe("2026-09-30");
  });

  // Medicare: 2027-02-15 (a federal holiday) governs; 2027-02-16 is the rolled date pending counsel.
  it.each([
    ["2027-02-14T15:00:00Z", true, false], // day before
    ["2027-02-15T15:00:00Z", true, false], // day of the governing date
    ["2027-02-16T15:00:00Z", false, true], // day after: late, but within the pending extension
    ["2027-02-17T15:00:00Z", false, false], // after the rolled date too
  ])(
    "Medicare claim submitted at %s: on time %s, pending extension %s",
    (at, onTime, withinPendingExtension) => {
      const status = submittedFilingStatus("medicare", "2026-02-15", new Date(at));
      expect(status).toMatchObject({ onTime, withinPendingExtension });
    },
  );

  it("computes nothing for an unverified payer or a regime without a filing rule", () => {
    const at = new Date("2026-04-01T15:00:00Z");
    expect(submittedFilingStatus(null, "2026-03-31", at)).toBeNull();
    expect(submittedFilingStatus("erisa_self_funded", "2026-03-31", at)).toBeNull();
  });
});
