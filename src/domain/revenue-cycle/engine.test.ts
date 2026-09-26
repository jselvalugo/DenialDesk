import { describe, expect, it } from "vitest";
import {
  describeMatch,
  EngineConfigError,
  prepareEngine,
  ruleMatchSchema,
  type EngineConfig,
  type LineInput,
} from "@/domain/revenue-cycle/engine";
import { DEFAULT_GL_ACCOUNTS, DEFAULT_PAYER_CLASSES, DEFAULT_RULES } from "@/domain/revenue-cycle/defaults";

const config: EngineConfig = {
  rules: DEFAULT_RULES.map((r) => ({ ...r, active: true })),
  payerClasses: DEFAULT_PAYER_CLASSES,
  arAccounts: DEFAULT_GL_ACCOUNTS.filter((a) => a.kind === "ar").map((a) => ({
    number: a.number,
    revenueGl: a.revenueGl!,
    adjustmentGl: a.adjustmentGl!,
  })),
  defaultArGl: "1200",
};
const route = prepareEngine(config);

const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  status: "OPEN",
  payerClass: "COMM",
  cpt: "99213",
  description: "Office visit",
  facility: "Main clinic",
  ...overrides,
});

describe("revenue cycle rules engine with the starter defaults", () => {
  it.each([
    ["interest by status", line({ status: "INTEREST" }), "PROMPT_PAY_INTEREST", "1200", "4900", "4050"],
    [
      "interest by description, any class",
      line({ description: "Late-payment Interest", payerClass: "HMO" }),
      "PROMPT_PAY_INTEREST",
      "1200",
      "4900",
      "4050",
    ],
    ["voided charge", line({ status: "VOID" }), "VOIDED", "1200", "4000", "4990"],
    [
      "voided Medicare charge",
      line({ status: "VOIDED", payerClass: "MCR" }),
      "VOIDED",
      "1210",
      "4100",
      "4990",
    ],
    ["Medicare", line({ payerClass: "MCR" }), "STANDARD", "1210", "4100", "4150"],
    ["Medicare Advantage", line({ payerClass: "MA" }), "STANDARD", "1210", "4100", "4150"],
    ["Medicaid managed care", line({ payerClass: "SMMC" }), "STANDARD", "1220", "4200", "4250"],
    ["workers' comp", line({ payerClass: "WC" }), "STANDARD", "1230", "4300", "4350"],
    ["auto PIP", line({ payerClass: "PIP" }), "STANDARD", "1230", "4300", "4350"],
    ["self-pay", line({ payerClass: "SELF" }), "STANDARD", "1240", "4400", "4450"],
    ["ERISA plan", line({ payerClass: "ERISA" }), "STANDARD", "1200", "4000", "4050"],
    ["unknown class", line({ payerClass: "BCBS" }), "STANDARD", "1200", "4000", "4050"],
    ["invalid code still routes", line({ cpt: "9921" }), "STANDARD", "1200", "4000", "4050"],
  ])("%s", (_name, input, ruleCode, arGl, revenueGl, adjustmentGl) => {
    expect(route(input)).toEqual({ ruleCode, arGl, revenueGl, adjustmentGl });
  });

  it("matches status codes exactly", () => {
    expect(route(line({ status: "void" })).ruleCode).toBe("STANDARD");
    expect(route(line({ status: "VOID " })).ruleCode).toBe("STANDARD");
  });

  it("only routes to accounts that exist in the starter chart, with the right type", () => {
    const kinds = new Map(DEFAULT_GL_ACCOUNTS.map((a) => [a.number, a.kind]));
    for (const account of DEFAULT_GL_ACCOUNTS.filter((a) => a.kind === "ar")) {
      expect(kinds.get(account.revenueGl!)).toBe("revenue");
      expect(kinds.get(account.adjustmentGl!)).toBe("adjustment");
    }
    for (const r of DEFAULT_RULES) {
      if (r.arGl) expect(kinds.get(r.arGl)).toBe("ar");
      if (r.revenueGl) expect(kinds.get(r.revenueGl)).toBe("revenue");
      if (r.adjustmentGl) expect(kinds.get(r.adjustmentGl)).toBe("adjustment");
    }
    for (const pc of DEFAULT_PAYER_CLASSES) if (pc.arGl) expect(kinds.get(pc.arGl)).toBe("ar");
  });
});

describe("engine configuration", () => {
  it("skips inactive rules", () => {
    const withoutVoid = prepareEngine({
      ...config,
      rules: config.rules.map((r) => (r.code === "VOIDED" ? { ...r, active: false } : r)),
    });
    expect(withoutVoid(line({ status: "VOID" })).ruleCode).toBe("STANDARD");
    expect(withoutVoid(line({ status: "VOID", payerClass: "MCR" })).adjustmentGl).toBe("4150");
  });

  it("orders by priority, then code", () => {
    const tie = prepareEngine({
      ...config,
      rules: [...config.rules, { ...config.rules[0]!, code: "AAA_FIRST", revenueGl: "4000", priority: 10 }],
    });
    expect(tie(line({ status: "INTEREST" })).ruleCode).toBe("AAA_FIRST");
  });

  it("requires a fallback rule", () => {
    expect(() =>
      prepareEngine({ ...config, rules: config.rules.filter((r) => r.code !== "STANDARD") }),
    ).toThrow(EngineConfigError);
  });

  it("rejects unknown AR accounts before routing any line", () => {
    expect(() => prepareEngine({ ...config, defaultArGl: "9999" })).toThrow(EngineConfigError);
    expect(() => prepareEngine({ ...config, payerClasses: [{ code: "COMM", arGl: "1399" }] })).toThrow(
      /1399/,
    );
    expect(() =>
      prepareEngine({ ...config, rules: config.rules.map((r) => ({ ...r, arGl: "4000" })) }),
    ).toThrow(/4000/);
  });

  it("validates stored conditions against the fixed vocabulary", () => {
    expect(ruleMatchSchema.safeParse({ any: [{ op: "regex", field: "cpt", value: ".*" }] }).success).toBe(
      false,
    );
    expect(ruleMatchSchema.safeParse({ any: [] }).success).toBe(false);
    expect(ruleMatchSchema.safeParse({ always: true }).success).toBe(true);
    for (const r of DEFAULT_RULES) expect(ruleMatchSchema.safeParse(r.match).success).toBe(true);
  });
});

describe("rule descriptions", () => {
  it("renders conditions in plain English", () => {
    expect(describeMatch(DEFAULT_RULES[0]!.match)).toEqual([
      "Status is INTEREST",
      'Description contains "interest"',
    ]);
    expect(describeMatch({ any: [{ op: "invalid_cpt" }] })).toEqual([
      "CPT/HCPCS isn't exactly 5 letters or digits",
    ]);
    expect(describeMatch({ always: true })).toEqual(["Every line not matched by an earlier rule"]);
  });
});
