import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import type { RollForwardPolicy } from "./roll-forward";
import type { Rule } from "./types";
import {
  appealDeadline,
  daysUntil,
  payerResponseStatus,
  pendingRolledDate,
  promptPayMilestones,
  rulesForBasis,
  timelyFilingDeadline,
} from "./deadlines";

/** Roll-forward as it would be once counsel confirms (OA-034): the rolled date governs. */
const CONFIRMED: RollForwardPolicy[] = [
  {
    confirmed: true,
    confirmedBy: { by: "Test counsel", on: "2026-09-27" },
    effectiveFrom: null,
    effectiveTo: null,
  },
];

describe("Florida prompt-pay milestones (electronic)", () => {
  const milestones = promptPayMilestones({
    regime: "fl_insurer",
    electronic: true,
    receivedDate: "2026-03-02",
  })!;

  it("counts 20, 90, and 120 days from payer receipt; Sundays 03-22 and 05-31 govern, Monday rolls are pending counsel", () => {
    expect(milestones.map((m) => [m.rule.id, m.date, m.rolledDate])).toEqual([
      ["fl.promptpay.electronic.pay_or_contest", "2026-03-22", "2026-03-23"],
      ["fl.promptpay.electronic.pay_or_deny", "2026-05-31", "2026-06-01"],
      ["fl.promptpay.electronic.uncontestable", "2026-06-30", null],
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
    ["2026-05-30", 1],
    ["2026-05-31", 0],
    ["2026-06-01", -1],
  ])("90-day pay-or-deny boundary: on %s, %i days remain", (today, remaining) => {
    expect(daysUntil(milestones[1]!.date, today)).toBe(remaining);
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
    expect(paper.map((m) => m.rolledDate)).toEqual(["2026-04-13", null, null]);
  });

  it.each(["medicare", "medicare_advantage", "erisa_self_funded"] as const)(
    "does not apply to %s claims",
    (regime) => {
      expect(promptPayMilestones({ regime, electronic: true, receivedDate: "2026-03-02" })).toBeNull();
    },
  );

  // §3.4: regime exclusion untested for medicaid_ffs, smmc, workers_comp, pip. Behaviour is
  // correct (all return null → "Not configured"); no rule in the catalog names these regimes.
  it.each(["medicaid_ffs", "smmc", "workers_comp", "pip"] as const)(
    "does not apply to %s claims either",
    (regime) => {
      expect(promptPayMilestones({ regime, electronic: true, receivedDate: "2026-03-02" })).toBeNull();
    },
  );
});

describe("Florida prompt-pay milestones (paper)", () => {
  const paper = promptPayMilestones({ regime: "fl_insurer", electronic: false, receivedDate: "2026-03-02" })!;

  it.each([
    ["2026-04-10", 1],
    ["2026-04-11", 0],
    ["2026-04-12", -1],
  ])("40-day pay-or-contest boundary: on %s, %i days remain", (today, remaining) => {
    expect(daysUntil(paper[0]!.date, today)).toBe(remaining);
  });

  it.each([
    ["2026-06-29", 1],
    ["2026-06-30", 0],
    ["2026-07-01", -1],
  ])("120-day pay-or-deny boundary: on %s, %i days remain", (today, remaining) => {
    expect(daysUntil(paper[1]!.date, today)).toBe(remaining);
  });

  it.each([
    ["2026-07-19", 1],
    ["2026-07-20", 0],
    ["2026-07-21", -1],
  ])("140-day uncontestable boundary: on %s, %i days remain", (today, remaining) => {
    expect(daysUntil(paper[2]!.date, today)).toBe(remaining);
  });
});

describe("appeal deadlines", () => {
  it("Medicare: 5-day receipt presumption plus 120 days; Sunday 10-04 governs, Monday 10-05 pending counsel", () => {
    const deadline = appealDeadline({
      regime: "medicare",
      noticeDate: "2026-06-01",
      payerAppealWindowDays: null,
    })!;
    expect(deadline.date).toBe("2026-10-04");
    expect(deadline.rolledDate).toBe("2026-10-05");
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

  // §3.4: payer-contract appeal deadline (used for FL insurer, FL HMO, MA) had no boundary test.
  it.each([
    ["2026-08-29", 1],
    ["2026-08-30", 0],
    ["2026-08-31", -1],
  ])("payer-contract boundary: on %s, %i days remain", (today, remaining) => {
    const deadline = appealDeadline({
      regime: "fl_insurer",
      noticeDate: "2026-06-01",
      payerAppealWindowDays: 90,
    })!;
    expect(daysUntil(deadline.date, today)).toBe(remaining);
  });

  it.each(["fl_hmo", "medicare_advantage"] as const)(
    "%s: also uses the payer-contract window when configured",
    (regime) => {
      const deadline = appealDeadline({ regime, noticeDate: "2026-06-01", payerAppealWindowDays: 90 })!;
      expect(deadline).toMatchObject({ date: "2026-08-30", basis: "payer_contract" });
    },
  );

  // §3.4: appealDeadline untested for MA and ERISA with no configured window.
  it.each(["medicare_advantage", "erisa_self_funded"] as const)(
    "%s without a configured window: no deadline",
    (regime) => {
      expect(appealDeadline({ regime, noticeDate: "2026-06-01", payerAppealWindowDays: null })).toBeNull();
    },
  );
});

describe("timely filing", () => {
  it("Florida: 6 months from date of service", () => {
    expect(timelyFilingDeadline("fl_insurer", "2026-03-31")?.date).toBe("2026-09-30");
  });

  it("Medicare: 1 year from date of service; 2027-02-15 is Washington's Birthday (governs), 02-16 pending counsel", () => {
    expect(timelyFilingDeadline("medicare", "2026-02-15")).toMatchObject({
      date: "2027-02-15",
      rolledDate: "2027-02-16",
    });
    expect(timelyFilingDeadline("medicare", "2026-02-15", catalog, CONFIRMED)?.date).toBe("2027-02-16");
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

const boundary = (deadline: string, before: string, after: string) =>
  [
    [before, 1],
    [deadline, 0],
    [after, -1],
  ].map(([today, n]) => daysUntil(deadline, today as string) === n);

describe("roll-forward: Florida legal holidays vs federal holidays (⚠️ VERIFY calendars)", () => {
  it("FL: day 20 on the Friday after Thanksgiving (FL holiday, not federal): Friday governs, Monday pending", () => {
    const m = promptPayMilestones({ regime: "fl_insurer", electronic: true, receivedDate: "2026-11-07" })!;
    expect(m[0]).toMatchObject({ date: "2026-11-27", rolledDate: "2026-11-30" });
    expect(boundary("2026-11-27", "2026-11-26", "2026-11-28")).toEqual([true, true, true]);
    const confirmed = promptPayMilestones({
      regime: "fl_insurer",
      electronic: true,
      receivedDate: "2026-11-07",
      rollPolicy: CONFIRMED,
    })!;
    expect(confirmed[0]).toMatchObject({ date: "2026-11-30", rolledDate: null });
    expect(boundary("2026-11-30", "2026-11-29", "2026-12-01")).toEqual([true, true, true]);
  });

  it("FL: Juneteenth is not a Florida legal holiday, so a filing deadline on it stands", () => {
    expect(timelyFilingDeadline("fl_insurer", "2025-12-19")).toMatchObject({
      date: "2026-06-19",
      rolledDate: null,
    });
    expect(timelyFilingDeadline("fl_insurer", "2025-12-19", catalog, CONFIRMED)?.date).toBe("2026-06-19");
  });

  it("Medicare: Juneteenth is a federal holiday; file by Friday 06-19, Monday 06-22 pending counsel", () => {
    expect(timelyFilingDeadline("medicare", "2025-06-19")).toMatchObject({
      date: "2026-06-19",
      rolledDate: "2026-06-22",
    });
    expect(boundary("2026-06-19", "2026-06-18", "2026-06-20")).toEqual([true, true, true]);
    expect(timelyFilingDeadline("medicare", "2025-06-19", catalog, CONFIRMED)?.date).toBe("2026-06-22");
    expect(boundary("2026-06-22", "2026-06-21", "2026-06-23")).toEqual([true, true, true]);
  });

  it("Medicare: the Friday after Thanksgiving is a federal workday; FL rolls past it", () => {
    expect(timelyFilingDeadline("medicare", "2025-11-27")).toMatchObject({
      date: "2026-11-27",
      rolledDate: null,
    });
    expect(timelyFilingDeadline("fl_hmo", "2026-05-27")).toMatchObject({
      date: "2026-11-27",
      rolledDate: "2026-11-30",
    });
    expect(timelyFilingDeadline("fl_hmo", "2026-05-27", catalog, CONFIRMED)?.date).toBe("2026-11-30");
  });

  it("Medicare appeal: presumption step does not roll; only the last day does", () => {
    // 2026-06-29 + 5 = Sat 07-04 (never rolled); + 120 = Sun 11-01 (governs), Mon 11-02 pending counsel.
    expect(
      appealDeadline({ regime: "medicare", noticeDate: "2026-06-29", payerAppealWindowDays: null }),
    ).toMatchObject({ date: "2026-11-01", rolledDate: "2026-11-02" });
    expect(
      appealDeadline({
        regime: "medicare",
        noticeDate: "2026-06-29",
        payerAppealWindowDays: null,
        rollPolicy: CONFIRMED,
      })!.date,
    ).toBe("2026-11-02");
  });

  it("payer-contract windows are not rolled (contract governs)", () => {
    expect(
      appealDeadline({ regime: "fl_insurer", noticeDate: "2026-03-02", payerAppealWindowDays: 20 })!.date,
    ).toBe("2026-03-22");
  });
});

describe("month-end and leap years (end-of-month clamping; decision in rules-engine spec)", () => {
  it.each(["2026-08-29", "2026-08-30", "2026-08-31"])(
    "FL %s + 6 months = Sun 2027-02-28 (governs), Mon 2027-03-01 pending counsel",
    (dos) => {
      expect(timelyFilingDeadline("fl_insurer", dos)).toMatchObject({
        date: "2027-02-28",
        rolledDate: "2027-03-01",
      });
      expect(boundary("2027-02-28", "2027-02-27", "2027-03-01")).toEqual([true, true, true]);
      expect(timelyFilingDeadline("fl_insurer", dos, catalog, CONFIRMED)?.date).toBe("2027-03-01");
      expect(boundary("2027-03-01", "2027-02-28", "2027-03-02")).toEqual([true, true, true]);
    },
  );

  it("FL 2027-08-31 + 6 months = 2028-02-29 (leap year, a Tuesday)", () => {
    expect(timelyFilingDeadline("fl_insurer", "2027-08-31")?.date).toBe("2028-02-29");
    expect(timelyFilingDeadline("fl_insurer", "2027-08-29")?.date).toBe("2028-02-29");
    expect(boundary("2028-02-29", "2028-02-28", "2028-03-01")).toEqual([true, true, true]);
  });

  it("Medicare Feb 29 + 1 year = Feb 28 of the next year", () => {
    expect(timelyFilingDeadline("medicare", "2028-02-29")?.date).toBe("2029-02-28");
    expect(boundary("2029-02-28", "2029-02-27", "2029-03-01")).toEqual([true, true, true]);
  });

  it("Medicare Feb 28 in a leap year + 1 year = Feb 28, then Feb 28 → Feb 28 across a leap year", () => {
    expect(timelyFilingDeadline("medicare", "2027-02-28")?.date).toBe("2028-02-28");
    expect(timelyFilingDeadline("medicare", "2028-02-28")?.date).toBe("2029-02-28");
  });
});

describe("regime check before rule lookup", () => {
  const floridaOnly = catalog.filter((r) => r.id.startsWith("fl."));
  const noFlorida = catalog.filter((r) => !r.id.startsWith("fl."));

  it("Medicare pages do not throw when Florida rules are missing, and vice versa", () => {
    expect(timelyFilingDeadline("medicare", "2026-03-02", noFlorida)).not.toBeNull();
    expect(
      promptPayMilestones({
        regime: "medicare",
        electronic: true,
        receivedDate: "2026-03-02",
        rules: noFlorida,
      }),
    ).toBeNull();
    expect(timelyFilingDeadline("erisa_self_funded", "2026-03-02", [])).toBeNull();
    expect(timelyFilingDeadline("fl_insurer", "2026-03-02", floridaOnly)).not.toBeNull();
  });

  it("FL HMO uses the HMO rule set", () => {
    expect(timelyFilingDeadline("fl_hmo", "2026-03-31")?.basis).toBe("fl.hmo.timely_filing.initial");
    const m = promptPayMilestones({ regime: "fl_hmo", electronic: true, receivedDate: "2026-03-02" })!;
    expect(m[0]!.rule.citation).toMatch(/§ 641\.3155/);
  });
});

describe("effective-date switchover through the deadline functions", () => {
  const split = (id: string, from: string, value: number): Rule[] => {
    const old = catalog.find((r) => r.id === id)!;
    return [
      ...catalog.filter((r) => r.id !== id),
      { ...old, effectiveTo: from },
      { ...old, effectiveFrom: from, value },
    ];
  };

  it("timely filing: DOS the day before / of / after the switch", () => {
    const rules = split("fl.timely_filing.initial", "2026-07-01", 12);
    expect(timelyFilingDeadline("fl_insurer", "2026-06-30", rules)?.date).toBe("2026-12-30");
    expect(timelyFilingDeadline("fl_insurer", "2026-07-01", rules)?.date).toBe("2027-07-01");
    expect(timelyFilingDeadline("fl_insurer", "2026-07-02", rules)?.date).toBe("2027-07-02");
  });

  it("prompt pay: received the day before / of / after the switch", () => {
    const rules = split("fl.promptpay.electronic.pay_or_contest", "2026-04-01", 15);
    const due = (receivedDate: string) =>
      promptPayMilestones({ regime: "fl_insurer", electronic: true, receivedDate, rules })![0]!.date;
    expect(due("2026-03-31")).toBe("2026-04-20");
    expect(due("2026-04-01")).toBe("2026-04-16");
    expect(due("2026-04-02")).toBe("2026-04-17");
  });

  it("Medicare appeal: notice the day before / of / after the switch", () => {
    const rules = split("medicare.redetermination.filing_window", "2026-06-02", 60);
    const due = (noticeDate: string) =>
      appealDeadline({ regime: "medicare", noticeDate, payerAppealWindowDays: null, rules })!.date;
    expect(due("2026-06-01")).toBe("2026-10-04");
    expect(due("2026-06-02")).toBe("2026-08-06");
    expect(due("2026-06-03")).toBe("2026-08-07");
  });
});

describe("roll-forward policy switch (OA-034, owner 2026-09-27 option 1)", () => {
  const withSwitch: RollForwardPolicy[] = [
    { confirmed: false, confirmedBy: null, effectiveFrom: null, effectiveTo: "2027-01-01" },
    { ...CONFIRMED[0]!, effectiveFrom: "2027-01-01" },
  ];

  it("confirmed without a recorded confirmation still does not roll", () => {
    const unsigned: RollForwardPolicy[] = [{ ...CONFIRMED[0]!, confirmedBy: null }];
    expect(timelyFilingDeadline("fl_insurer", "2026-08-30", catalog, unsigned)?.date).toBe("2027-02-28");
  });

  it("is effective-dated by the unrolled last day: before / on / after the switch", () => {
    // Medicare DOS 2025-12-31 + 1 year = Thu 2026-12-31 (no roll either way).
    expect(timelyFilingDeadline("medicare", "2025-12-31", catalog, withSwitch)?.date).toBe("2026-12-31");
    // DOS 2026-01-01 + 1 year = Fri 2027-01-01 (New Year's Day): policy confirmed → Mon 01-04.
    expect(timelyFilingDeadline("medicare", "2026-01-01", catalog, withSwitch)).toMatchObject({
      date: "2027-01-04",
      rolledDate: null,
    });
    // Same DOS under the current (unconfirmed) policy: New Year's Day governs.
    expect(timelyFilingDeadline("medicare", "2026-01-01")).toMatchObject({
      date: "2027-01-01",
      rolledDate: "2027-01-04",
    });
    // DOS 2026-01-02 + 1 year = Sat 2027-01-02 → Mon 01-04 once confirmed.
    expect(timelyFilingDeadline("medicare", "2026-01-02", catalog, withSwitch)?.date).toBe("2027-01-04");
  });
});

describe("pendingRolledDate (stored appeal deadlines)", () => {
  const basis = "medicare.redetermination.receipt_presumption+medicare.redetermination.filing_window";
  it("returns the Monday behind a stored Sunday deadline, null on a business day or contract basis", () => {
    expect(pendingRolledDate("2026-10-04", rulesForBasis(basis, "2026-06-01"))).toBe("2026-10-05");
    expect(pendingRolledDate("2026-10-05", rulesForBasis(basis, "2026-06-01"))).toBeNull();
    expect(pendingRolledDate("2026-10-04", [])).toBeNull();
    expect(pendingRolledDate("2026-10-04", rulesForBasis(basis, "2026-06-01"), CONFIRMED)).toBeNull();
  });
});
