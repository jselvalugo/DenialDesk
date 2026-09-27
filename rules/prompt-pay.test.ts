import { describe, expect, it } from "vitest";
import { catalog } from "./catalog";
import { evaluatePromptPay, simpleInterestCents, type PayerResponse } from "./prompt-pay";
import type { RollForwardPolicy } from "./roll-forward";
import type { Regime, Rule } from "./types";

// Received 2026-03-02. Electronic: 20 → 03-22, 90 → 05-31, 120 → 06-30.
// Paper: 40 → 04-11, 120 → 06-30, 140 → 07-20. (Values come from the catalog.)
// These tests check day counting, so they run on the catalog with roll-forward switched off;
// weekend/holiday roll-forward is tested separately below with the real catalog.
const RECEIVED = "2026-03-02";
const NO_ROLL: Rule[] = catalog.map((r) => ({ ...r, rollForward: "none" }));

function run(
  responses: PayerResponse[],
  today: string,
  electronic = true,
  regime: Regime = "fl_insurer",
  rules: Rule[] = NO_ROLL,
) {
  return evaluatePromptPay({ regime, electronic, receivedDate: RECEIVED, responses, today, rules });
}

const SETS = [
  { electronic: true, dues: ["2026-03-22", "2026-05-31", "2026-06-30"] },
  { electronic: false, dues: ["2026-04-11", "2026-06-30", "2026-07-20"] },
] as const;

const dayBefore = (d: string) => new Date(Date.parse(d) - 86_400_000).toISOString().slice(0, 10);
const dayAfter = (d: string) => new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10);

describe.each(SETS)("milestone boundaries (electronic=$electronic)", ({ electronic, dues }) => {
  it("computes due dates from the catalog", () => {
    expect(run([], RECEIVED, electronic).milestones.map((m) => m.due)).toEqual(dues);
  });

  it.each([0, 1, 2])("milestone %i: open the day before, open on the day, overdue the day after", (i) => {
    const due = dues[i]!;
    expect(run([], dayBefore(due), electronic).milestones[i]).toMatchObject({
      state: "open",
      daysRemaining: 1,
    });
    expect(run([], due, electronic).milestones[i]).toMatchObject({ state: "open", daysRemaining: 0 });
    expect(run([], dayAfter(due), electronic).milestones[i]).toMatchObject({ state: "overdue", daysLate: 1 });
  });

  it.each([0, 1, 2])("milestone %i: denial the day before / of is met, the day after is late", (i) => {
    const due = dues[i]!;
    const today = "2026-12-31";
    for (const [date, state, late] of [
      [dayBefore(due), "met", 0],
      [due, "met", 0],
      [dayAfter(due), "late", 1],
    ] as const) {
      const m = run([{ kind: "denial", date }], today, electronic).milestones[i]!;
      expect(m).toMatchObject({ state, metOn: date, daysLate: late, daysRemaining: null });
    }
  });

  it("uncontestable at the boundary (R-3.1.4)", () => {
    expect(run([], dues[2]!, electronic).uncontestable).toBe(false);
    const after = run([], dayAfter(dues[2]!), electronic);
    expect(after.uncontestable).toBe(true);
    expect(after.state).toBe("uncontestable");
    expect(run([{ kind: "denial", date: dues[2]! }], "2026-12-31", electronic).uncontestable).toBe(false);
  });
});

describe("contest behaviour (F4)", () => {
  it("a contest meets pay_or_contest only; later clocks keep running", () => {
    const c = run([{ kind: "contest", date: "2026-03-20" }], "2026-06-01");
    expect(c.contested).toBe(true);
    expect(c.milestones.map((m) => m.state)).toEqual(["met", "overdue", "open"]);
    expect(c.paymentDue).toBe("2026-05-31");
    expect(c.nextDue?.ruleId).toBe("fl.promptpay.electronic.pay_or_deny");
    expect(c.state).toBe("late");
  });

  it("contest on the due date counts; the day after does not", () => {
    expect(run([{ kind: "contest", date: "2026-03-22" }], "2026-04-01").contested).toBe(true);
    const late = run([{ kind: "contest", date: "2026-03-23" }], "2026-04-01");
    expect(late.contested).toBe(false);
    expect(late.paymentDue).toBe("2026-03-22");
    expect(late.milestones[0]!.state).toBe("late");
  });

  it("starts the electronic provider response clock from the first contest", () => {
    const c = run(
      [
        { kind: "contest", date: "2026-03-25" },
        { kind: "contest", date: "2026-03-10" },
      ],
      "2026-04-01",
    );
    expect(c.providerResponseDue).toBe("2026-04-14"); // 03-10 + 35
  });

  it("paper has no provider response rule, so no due date", () => {
    expect(
      run([{ kind: "contest", date: "2026-03-10" }], "2026-04-01", false).providerResponseDue,
    ).toBeNull();
  });

  it("uncontestable when only contested through day 120", () => {
    expect(run([{ kind: "contest", date: "2026-03-10" }], "2026-07-01").uncontestable).toBe(true);
  });
});

describe("interest (R-3.1.3, accrual start ⚠️ VERIFY)", () => {
  it("paid on the due date: no interest; the day after: one day", () => {
    expect(run([{ kind: "payment", date: "2026-03-22", cents: 100_000 }], "2026-12-31").interest).toEqual([]);
    const late = run([{ kind: "payment", date: "2026-03-23", cents: 100_000 }], "2026-12-31");
    expect(late.interest).toEqual([
      {
        paymentDate: "2026-03-23",
        paidCents: 100_000,
        dueDate: "2026-03-22",
        daysLate: 1,
        ratePercent: 12,
        interestCents: 33, // 100000 × 12% / 365 = 32.88
        ruleId: "fl.promptpay.interest_rate",
        verify: true,
      },
    ]);
    expect(late.interestCents).toBe(33);
    expect(late.state).toBe("late");
  });

  it("once contested, accrues from the pay-or-deny date", () => {
    const c = run(
      [
        { kind: "contest", date: "2026-03-15" },
        { kind: "payment", date: "2026-05-31", cents: 50_000 },
      ],
      "2026-12-31",
    );
    expect(c.interest).toEqual([]);
    expect(c.state).toBe("met");
    const d = run(
      [
        { kind: "contest", date: "2026-03-15" },
        { kind: "payment", date: "2026-06-10", cents: 36_500 },
      ],
      "2026-12-31",
    );
    expect(d.interest[0]).toMatchObject({ dueDate: "2026-05-31", daysLate: 10, interestCents: 120 }); // 36500×.12×10/365
  });

  it("sums multiple payments, skipping on-time ones", () => {
    const c = run(
      [
        { kind: "payment", date: "2026-03-20", cents: 10_000 },
        { kind: "payment", date: "2026-04-21", cents: 36_500 }, // 30 days → 360
        { kind: "payment", date: "2026-04-01", cents: 73_000 }, // 10 days → 240
      ],
      "2026-12-31",
    );
    expect(c.interest.map((l) => [l.paymentDate, l.interestCents])).toEqual([
      ["2026-04-01", 240],
      ["2026-04-21", 360],
    ]);
    expect(c.interestCents).toBe(600);
  });

  it("rounds half-up to whole cents", () => {
    expect(simpleInterestCents(1825, 10, 1)).toBe(1); // exactly 0.5
    expect(simpleInterestCents(1824, 10, 1)).toBe(0); // 0.4997
    expect(simpleInterestCents(1000, 12, 1)).toBe(0); // 0.33
    expect(simpleInterestCents(4563, 12, 1)).toBe(2); // 1.50016
  });

  it("rejects payments without positive integer cents", () => {
    expect(() => run([{ kind: "payment", date: "2026-03-10" }], "2026-04-01")).toThrow();
    expect(() => run([{ kind: "payment", date: "2026-03-10", cents: 10.5 }], "2026-04-01")).toThrow();
  });

  it("ignores responses dated after today", () => {
    const c = run([{ kind: "payment", date: "2026-05-01", cents: 1000 }], "2026-03-30");
    expect(c.milestones[0]!.state).toBe("overdue");
    expect(c.interest).toEqual([]);
  });
});

describe("regime exclusion", () => {
  it.each(["medicare", "medicare_advantage", "erisa_self_funded", "medicaid_ffs"] as const)(
    "%s: FL prompt pay does not apply",
    (regime) => {
      const c = run([{ kind: "payment", date: "2026-06-01", cents: 1000 }], "2026-12-31", true, regime);
      expect(c).toMatchObject({
        applies: false,
        milestones: [],
        interest: [],
        interestCents: 0,
        paymentDue: null,
      });
    },
  );

  it("applies to FL HMO, using the HMO rule set (§ 641.3155)", () => {
    const c = run([{ kind: "payment", date: "2026-03-23", cents: 100_000 }], "2026-12-31", true, "fl_hmo");
    expect(c.applies).toBe(true);
    expect(c.milestones[0]!.ruleId).toBe("fl.hmo.promptpay.electronic.pay_or_contest");
    expect(c.milestones[0]!.citation).toMatch(/§ 641\.3155/);
    expect(c.interest[0]!.ruleId).toBe("fl.hmo.promptpay.interest_rate");
  });

  it("MA never resolves Florida rules, even if the Florida rules have a gap (regime check first)", () => {
    const gappy = catalog.filter((r) => !r.id.startsWith("fl."));
    const c = evaluatePromptPay({
      regime: "medicare_advantage",
      electronic: true,
      receivedDate: RECEIVED,
      responses: [],
      today: RECEIVED,
      rules: gappy,
    });
    expect(c.applies).toBe(false);
  });
});

describe("effective-dated rule resolution (injected catalog)", () => {
  const split = (id: string, from: string, newValue: number): Rule[] => {
    const old = catalog.find((r) => r.id === id)!;
    return [
      { ...old, effectiveTo: from },
      { ...old, effectiveFrom: from, value: newValue },
    ];
  };
  const rules: Rule[] = [
    ...catalog.filter(
      (r) => r.id !== "fl.promptpay.electronic.pay_or_contest" && r.id !== "fl.promptpay.interest_rate",
    ),
    ...split("fl.promptpay.electronic.pay_or_contest", "2026-03-02", 15),
    ...split("fl.promptpay.interest_rate", "2026-04-01", 10),
  ];

  it("uses the milestone rule in force on the received date (switchover day)", () => {
    const before = evaluatePromptPay({
      regime: "fl_insurer",
      electronic: true,
      receivedDate: "2026-03-01",
      responses: [],
      today: "2026-03-01",
      rules,
    });
    const on = evaluatePromptPay({
      regime: "fl_insurer",
      electronic: true,
      receivedDate: "2026-03-02",
      responses: [],
      today: "2026-03-02",
      rules,
    });
    expect(before.milestones[0]!.due).toBe("2026-03-21"); // old value (20): Sat 03-21 governs
    expect(before.milestones[0]!.rolledDue).toBe("2026-03-23"); // Monday, pending counsel
    expect(on.milestones[0]!.due).toBe("2026-03-17"); // new value (15)
  });

  it("uses the interest rate in force on each payment date", () => {
    const c = evaluatePromptPay({
      regime: "fl_insurer",
      electronic: true,
      receivedDate: "2026-02-01",
      responses: [
        { kind: "payment", date: "2026-03-31", cents: 36_500 },
        { kind: "payment", date: "2026-04-01", cents: 36_500 },
      ],
      today: "2026-12-31",
      rules,
    });
    expect(c.interest.map((l) => l.ratePercent)).toEqual([12, 10]);
  });
});

describe("DST", () => {
  it("counts calendar days across the spring-forward change", () => {
    // 2026-03-08 is the US DST start; 20 days from 2026-02-28 is 2026-03-20.
    const c = evaluatePromptPay({
      regime: "fl_insurer",
      electronic: true,
      receivedDate: "2026-02-28",
      responses: [],
      today: "2026-03-20",
    });
    expect(c.milestones[0]).toMatchObject({ due: "2026-03-20", state: "open", daysRemaining: 0 });
  });
});

describe("weekend/holiday roll-forward (Fla. R. Gen. Prac. & Jud. Admin. 2.514, ⚠️ VERIFY; OA-023)", () => {
  const CONFIRMED: RollForwardPolicy[] = [
    {
      confirmed: true,
      confirmedBy: { by: "Test counsel", on: "2026-09-27" },
      effectiveFrom: null,
      effectiveTo: null,
    },
  ];
  const real = (responses: PayerResponse[], today: string, rollPolicy?: RollForwardPolicy[]) =>
    evaluatePromptPay({
      regime: "fl_insurer",
      electronic: true,
      receivedDate: RECEIVED,
      responses,
      today,
      rollPolicy,
    });

  it("pending counsel: Sunday 2026-03-22 governs; Monday 03-23 is informational", () => {
    const c = real([], RECEIVED);
    expect(c.milestones.map((m) => [m.due, m.rolledDue])).toEqual([
      ["2026-03-22", "2026-03-23"],
      ["2026-05-31", "2026-06-01"],
      ["2026-06-30", null],
    ]);
    expect([c.paymentDue, c.paymentDueRolled]).toEqual(["2026-03-22", "2026-03-23"]);
  });

  it("confirmed: the rolled Monday governs and nothing is pending", () => {
    const c = real([], RECEIVED, CONFIRMED);
    expect(c.milestones.map((m) => [m.due, m.rolledDue])).toEqual([
      ["2026-03-23", null],
      ["2026-06-01", null],
      ["2026-06-30", null],
    ]);
  });

  it.each([
    ["2026-03-21", "met", 0],
    ["2026-03-22", "met", 0],
    ["2026-03-23", "late", 1],
  ] as const)("pending counsel: response on %s against the unrolled due date: %s", (date, state, late) => {
    expect(real([{ kind: "denial", date }], "2026-12-31").milestones[0]).toMatchObject({
      state,
      daysLate: late,
    });
  });

  it.each([
    ["2026-03-22", "met", 0],
    ["2026-03-23", "met", 0],
    ["2026-03-24", "late", 1],
  ] as const)("confirmed: response on %s against the rolled due date: %s", (date, state, late) => {
    expect(real([{ kind: "denial", date }], "2026-12-31", CONFIRMED).milestones[0]).toMatchObject({
      state,
      daysLate: late,
    });
  });

  it("pending counsel: interest starts the day after the unrolled date (practice-favourable)", () => {
    expect(real([{ kind: "payment", date: "2026-03-22", cents: 100_000 }], "2026-12-31").interest).toEqual(
      [],
    );
    expect(
      real([{ kind: "payment", date: "2026-03-23", cents: 100_000 }], "2026-12-31").interest[0],
    ).toMatchObject({
      dueDate: "2026-03-22",
      daysLate: 1,
    });
    expect(
      real([{ kind: "payment", date: "2026-03-24", cents: 100_000 }], "2026-12-31").interest[0],
    ).toMatchObject({
      daysLate: 2,
    });
  });

  it("confirmed: interest starts the day after the rolled date", () => {
    expect(
      real([{ kind: "payment", date: "2026-03-23", cents: 100_000 }], "2026-12-31", CONFIRMED).interest,
    ).toEqual([]);
    expect(
      real([{ kind: "payment", date: "2026-03-24", cents: 100_000 }], "2026-12-31", CONFIRMED).interest[0],
    ).toMatchObject({ dueDate: "2026-03-23", daysLate: 1 });
  });

  it("provider response to a contest: unrolled date governs, rolled pending counsel", () => {
    // Contest on Fri 2026-03-06 + 35 = Fri 04-10 (business day): no pending date.
    const weekday = real([{ kind: "contest", date: "2026-03-06" }], "2026-03-10");
    expect([weekday.providerResponseDue, weekday.providerResponseDueRolled]).toEqual(["2026-04-10", null]);
    // Contest on Sun 2026-03-08 + 35 = Sun 04-12 → Mon 04-13 pending counsel.
    const weekend = real([{ kind: "contest", date: "2026-03-08" }], "2026-03-10");
    expect([weekend.providerResponseDue, weekend.providerResponseDueRolled]).toEqual([
      "2026-04-12",
      "2026-04-13",
    ]);
  });
});
