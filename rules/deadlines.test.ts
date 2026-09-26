import { describe, expect, it } from "vitest";
import {
  appealDeadline,
  daysUntil,
  payerResponseStatus,
  promptPayMilestones,
  rulesForBasis,
  timelyFilingDeadline,
} from "./deadlines";

describe("Florida prompt-pay milestones (electronic)", () => {
  const milestones = promptPayMilestones({
    regime: "fl_insurer",
    electronic: true,
    receivedDate: "2026-03-02",
  })!;

  it("counts 20, 90, and 120 days from payer receipt", () => {
    expect(milestones.map((m) => [m.rule.id, m.date])).toEqual([
      ["fl.promptpay.electronic.pay_or_contest", "2026-03-22"],
      ["fl.promptpay.electronic.pay_or_deny", "2026-05-31"],
      ["fl.promptpay.electronic.uncontestable", "2026-06-30"],
    ]);
  });

  it.each([
    ["2026-03-21", 1],
    ["2026-03-22", 0],
    ["2026-03-23", -1],
  ])("20-day boundary: on %s, %i days remain", (today, remaining) => {
    expect(daysUntil(milestones[0]!.date, today)).toBe(remaining);
  });

  it.each([
    ["2026-06-29", 1],
    ["2026-06-30", 0],
    ["2026-07-01", -1],
  ])("120-day uncontestable boundary: on %s, %i days remain", (today, remaining) => {
    expect(daysUntil(milestones[2]!.date, today)).toBe(remaining);
  });

  it("uses the paper-claim rules for paper claims", () => {
    const paper = promptPayMilestones({ regime: "fl_hmo", electronic: false, receivedDate: "2026-03-02" })!;
    expect(paper.map((m) => m.date)).toEqual(["2026-04-11", "2026-06-30", "2026-07-20"]);
  });

  it.each(["medicare", "medicare_advantage", "erisa_self_funded"] as const)(
    "does not apply to %s claims",
    (regime) => {
      expect(promptPayMilestones({ regime, electronic: true, receivedDate: "2026-03-02" })).toBeNull();
    },
  );
});

describe("appeal deadlines", () => {
  it("Medicare: 5-day receipt presumption plus 120 days", () => {
    const deadline = appealDeadline({
      regime: "medicare",
      noticeDate: "2026-06-01",
      payerAppealWindowDays: null,
    })!;
    expect(deadline.date).toBe("2026-10-04");
    expect(deadline.citation).toBe("42 CFR § 405.942(a)");
    expect(deadline.verify).toBe(true);
  });

  it.each([
    ["2026-10-03", 1],
    ["2026-10-04", 0],
    ["2026-10-05", -1],
  ])("Medicare boundary: on %s, %i days remain", (today, remaining) => {
    const deadline = appealDeadline({
      regime: "medicare",
      noticeDate: "2026-06-01",
      payerAppealWindowDays: null,
    })!;
    expect(daysUntil(deadline.date, today)).toBe(remaining);
  });

  it("commercial: uses the payer-contract window", () => {
    const deadline = appealDeadline({
      regime: "fl_insurer",
      noticeDate: "2026-06-01",
      payerAppealWindowDays: 90,
    })!;
    expect(deadline).toMatchObject({ date: "2026-08-30", basis: "payer_contract" });
  });

  it("commercial without a configured window: no deadline rather than a guess", () => {
    expect(
      appealDeadline({ regime: "fl_hmo", noticeDate: "2026-06-01", payerAppealWindowDays: null }),
    ).toBeNull();
  });
});

describe("timely filing", () => {
  it("Florida: 6 months from date of service", () => {
    expect(timelyFilingDeadline("fl_insurer", "2026-03-31")?.date).toBe("2026-09-30");
  });

  it("Medicare: 12 months from date of service", () => {
    expect(timelyFilingDeadline("medicare", "2026-02-15")?.date).toBe("2027-02-15");
  });

  it("does not guess for regimes without a rule", () => {
    expect(timelyFilingDeadline("erisa_self_funded", "2026-02-15")).toBeNull();
  });
});

describe("payer response against a milestone", () => {
  it.each([
    ["2026-03-21", true, 0], // day before
    ["2026-03-22", true, 0], // day of
    ["2026-03-23", false, 1], // day after
  ])("responding on %s: met=%s, late by %i", (response, met, daysLate) => {
    expect(payerResponseStatus("2026-03-22", response)).toEqual({ met, daysLate });
  });
});

describe("rulesForBasis", () => {
  it("resolves each rule behind a stored basis", () => {
    const rules = rulesForBasis(
      "medicare.redetermination.receipt_presumption+medicare.redetermination.filing_window",
      "2026-06-01",
    );
    expect(rules.map((r) => r.value)).toEqual([5, 120]);
  });

  it("has no rules for contract-based deadlines", () => {
    expect(rulesForBasis("payer_contract", "2026-06-01")).toEqual([]);
  });
});
